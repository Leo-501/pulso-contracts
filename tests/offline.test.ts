import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OfflineStore } from '../src/offline/store.js';
import { sqliteDatabase as database } from '../src/offline/testing.js';
import { SyncEngine, SyncError, type SyncTransport } from '../src/offline/sync.js';
import {
  mobileScope,
  qrIdentifier,
  type MobileOperation,
  type MobileUser,
  type PullResponse,
} from '../src/mobile.js';

const user: MobileUser = {
  id: randomUUID(),
  tenant_id: randomUUID(),
  site_id: randomUUID(),
  role: 'technician',
  name: 'Técnico',
  email: 'tech@example.test',
  tenant_name: 'Fábrica',
  site_name: 'Unidade',
  timezone: 'America/Sao_Paulo',
};
const scope = mobileScope(user),
  asset = randomUUID(),
  order = randomUUID(),
  item = randomUUID();
function snapshot(version = 1): PullResponse {
  return {
    protocol: 1,
    scope,
    user,
    server_time: new Date().toISOString(),
    removed: [],
    upserts: [
      {
        entity: 'asset',
        id: asset,
        etag: 'a'.repeat(64),
        data: {
          id: asset,
          code: 'PR-01',
          name: 'Prensa',
          location: 'Estamparia',
          criticality: 'high',
          manufacturer: '',
          model: '',
          qr_token: randomUUID(),
        },
      },
      {
        entity: 'order',
        id: order,
        etag: String(version).repeat(64),
        data: {
          id: order,
          number: 1,
          asset_id: asset,
          title: 'Verificar prensa',
          description: '',
          type: 'preventive',
          priority: 'high',
          status: 'in_progress',
          due_date: '2026-09-12',
          version,
          checklist: [{ id: item, label: 'Verificar vedação', answer: 'nok' }],
          resolution: '',
        },
      },
    ],
  };
}
function operation(): MobileOperation {
  return {
    id: randomUUID(),
    kind: 'request.create',
    body: {
      asset_id: asset,
      title: 'Ruído na prensa',
      description: 'Ruído após ligar a máquina',
      machine_stopped: true,
    },
  };
}
function checklist(): MobileOperation {
  return {
    id: randomUUID(),
    kind: 'order.checklist',
    order_id: order,
    body: { version: 1, answers: { [item]: 'ok' } },
  };
}

test('fila e dados baixados persistem após fechar e reabrir o SQLite', async () => {
  const dir = resolve('../../work/cmms-offline');
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, randomUUID() + '.sqlite');
  let db = database(file),
    store = await new OfflineStore(db.adapter, scope).init();
  const op = operation();
  await store.apply(snapshot());
  await store.enqueue(op);
  db.raw.close();
  db = database(file);
  store = await new OfflineStore(db.adapter, scope).init();
  assert.equal((await store.queue())[0].id, op.id);
  assert.equal((await store.records()).length, 2);
  assert.ok(await store.lastSync());
  db.raw.close();
});
test('base local não pode ser aberta em outra conta e recusa snapshot de outro escopo', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.apply(snapshot());
  await assert.rejects(() => new OfflineStore(db.adapter, 'outro-escopo').init(), /outra conta/);
  await assert.rejects(() => store.apply({ ...snapshot(), scope: 'outra-unidade' }), /outra conta/);
  assert.equal((await store.records()).length, 2);
  db.raw.close();
});
test('falha no meio do pull reverte remoções, alterações e data de sincronização', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.apply(snapshot());
  const before = await store.records(),
    time = await store.lastSync();
  db.raw.exec(
    "CREATE TRIGGER fail_order BEFORE UPDATE ON records WHEN NEW.entity='order' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;",
  );
  await assert.rejects(
    () => store.apply({ ...snapshot(2), removed: [{ entity: 'asset', id: asset }] }),
    /simulated disk failure/,
  );
  assert.deepEqual(await store.records(), before);
  assert.equal(await store.lastSync(), time);
  db.raw.close();
});
test('queda depois do commit mantém o mesmo UUID para repetir sem criar outro registro', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  const op = operation();
  await store.enqueue(op);
  const receipts = new Map<string, unknown>();
  const sent: string[] = [];
  let loseResponse = true;
  const transport: SyncTransport = {
    async pull() {
      return snapshot();
    },
    async send(entry) {
      sent.push(entry.id);
      if (!receipts.has(entry.id)) receipts.set(entry.id, { id: randomUUID() });
      if (loseResponse) {
        loseResponse = false;
        throw new SyncError('Conexão interrompida após gravar', 0);
      }
      return receipts.get(entry.id);
    },
  };
  await assert.rejects(() => new SyncEngine(store, transport).sync(), /interrompida/);
  assert.equal((await store.queue())[0].state, 'pending');
  await new SyncEngine(store, transport).sync();
  assert.deepEqual(sent, [op.id, op.id]);
  assert.equal(receipts.size, 1);
  assert.equal((await store.queue())[0].state, 'confirmed');
  db.raw.close();
});
test('cliques concorrentes em sincronizar compartilham o mesmo envio', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.enqueue(operation());
  let sent = 0;
  const engine = new SyncEngine(store, {
    async pull() {
      return snapshot();
    },
    async send() {
      sent++;
      return { ok: true };
    },
  });
  await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
  assert.equal(sent, 1);
  db.raw.close();
});
test('conflito preserva respostas, não é reenviado sozinho e aceita revisão explícita', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  const op = checklist();
  await store.enqueue(op);
  let sends = 0;
  const engine = new SyncEngine(store, {
    async pull() {
      return snapshot(2);
    },
    async send() {
      sends++;
      throw new SyncError('Checklist mudou', 409);
    },
  });
  await engine.sync();
  await engine.sync();
  assert.equal(sends, 1);
  const failed = (await store.queue())[0];
  assert.equal(failed.state, 'conflict');
  assert.deepEqual(JSON.parse(failed.payload), op);
  await assert.rejects(() => store.enqueue(checklist()), /já tem respostas/);
  const newId = randomUUID();
  await store.reapplyChecklist(op.id, newId);
  const queue = await store.queue();
  assert.equal(queue.find((q) => q.id === op.id)!.state, 'superseded');
  const replacement = JSON.parse(queue.find((q) => q.id === newId)!.payload);
  assert.equal(replacement.body.version, 2);
  assert.equal(replacement.body.answers[item], 'ok');
  db.raw.close();
});
test('remoção por reatribuição elimina o cache e conserva as respostas rejeitadas', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.apply(snapshot());
  const op = checklist();
  await store.enqueue(op);
  await new SyncEngine(store, {
    async pull() {
      return { ...snapshot(), upserts: [], removed: [{ entity: 'order', id: order }] };
    },
    async send() {
      throw new SyncError('OS não encontrada', 404);
    },
  }).sync();
  assert.equal(
    (await store.records()).some((r) => r.entity === 'order'),
    false,
  );
  assert.equal((await store.queue())[0].state, 'rejected');
  assert.deepEqual(JSON.parse((await store.queue())[0].payload), op);
  db.raw.close();
});
test('sessão revogada bloqueia o download e preserva apenas a fila protegida para nova autenticação', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.apply(snapshot());
  await store.enqueue(operation());
  let sends = 0;
  await assert.rejects(
    () =>
      new SyncEngine(store, {
        async pull() {
          throw new SyncError('Sessão revogada', 401);
        },
        async send() {
          sends++;
        },
      }).sync(),
    /revogada/,
  );
  assert.equal(sends, 0);
  assert.equal((await store.records()).length, 0);
  assert.equal((await store.queue())[0].state, 'pending');
  db.raw.close();
});
test('indisponibilidade e rate limit mantêm registros pendentes para uma próxima tentativa', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.enqueue(operation());
  for (const status of [429, 503]) {
    await assert.rejects(
      () =>
        new SyncEngine(store, {
          async pull() {
            return snapshot();
          },
          async send() {
            throw new SyncError('Tente depois', status);
          },
        }).sync(),
      /Tente depois/,
    );
    assert.equal((await store.queue())[0].state, 'pending');
  }
  db.raw.close();
});
test('QR extrai apenas identificadores válidos sem executar ou seguir o conteúdo', () => {
  const id = randomUUID();
  assert.equal(qrIdentifier(id), id);
  assert.equal(qrIdentifier('https://fabrica.example/qr/' + id), id);
  assert.equal(qrIdentifier('javascript:alert(1)'), null);
  assert.equal(qrIdentifier('https://fabrica.example/login'), null);
  assert.equal(qrIdentifier('qualquer texto'), null);
});
test('salvamento local repetido reutiliza a operação e não permite trocar seu conteúdo', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  const op = operation();
  await store.enqueue(op);
  await store.enqueue(op);
  assert.equal((await store.queue()).length, 1);
  await assert.rejects(
    () =>
      store.enqueue({ ...op, body: { ...op.body, title: 'Outra ocorrência' } } as MobileOperation),
    /outro registro/,
  );
  db.raw.close();
});
test('arquivamento preserva o conteúdo recusado e não descarta envios ainda incertos', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  const op = operation();
  await store.enqueue(op);
  await store.dismiss(op.id);
  assert.equal((await store.queue())[0].state, 'pending');
  await store.mark(op.id, 'rejected', 'Ativo inativo');
  await store.dismiss(op.id);
  const entry = (await store.queue())[0];
  assert.equal(entry.state, 'dismissed');
  assert.deepEqual(JSON.parse(entry.payload), op);
  db.raw.close();
});
test('falha de disco ao limpar cache não mascara a revogação que bloqueia a interface', async () => {
  const db = database(),
    store = await new OfflineStore(db.adapter, scope).init();
  await store.apply(snapshot());
  db.raw.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'disk failure'); END;",
  );
  await assert.rejects(
    () =>
      new SyncEngine(store, {
        async pull() {
          throw new SyncError('Revogado', 401);
        },
        async send() {},
      }).sync(),
    (error: unknown) => error instanceof SyncError && error.status === 401,
  );
  db.raw.close();
});
