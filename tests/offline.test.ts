import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BaseLocal } from '../src/offline/store.js';
import { bancoSqlite as database } from '../src/offline/testing.js';
import { MotorSincronizacao, ErroSincronizacao, type TransporteSincronizacao } from '../src/offline/sync.js';
import {
  escopoAplicativo,
  identificadorQr,
  type OperacaoAplicativo,
  type PessoaAplicativo,
  type RespostaDownload,
} from '../src/mobile.js';

const user: PessoaAplicativo = {
  id: randomUUID(),
  empresa_id: randomUUID(),
  unidade_id: randomUUID(),
  papel: 'tecnico',
  nome: 'Técnico',
  email: 'tech@example.test',
  empresa_nome: 'Fábrica',
  unidade_nome: 'Unidade',
  fuso: 'America/Sao_Paulo',
};
const scope = escopoAplicativo(user),
  asset = randomUUID(),
  order = randomUUID(),
  item = randomUUID();
function snapshot(version = 1): RespostaDownload {
  return {
    protocolo: 1,
    escopo: scope,
    pessoa: user,
    hora_servidor: new Date().toISOString(),
    removidos: [],
    gravar: [
      {
        entidade: 'ativo',
        id: asset,
        etag: 'a'.repeat(64),
        dados: {
          id: asset,
          codigo: 'PR-01',
          nome: 'Prensa',
          local: 'Estamparia',
          criticidade: 'alta',
          fabricante: '',
          modelo: '',
          token_qr: randomUUID(),
        },
      },
      {
        entidade: 'ordem',
        id: order,
        etag: String(version).repeat(64),
        dados: {
          id: order,
          numero: 1,
          ativo_id: asset,
          titulo: 'Verificar prensa',
          descricao: '',
          tipo: 'preventiva',
          prioridade: 'alta',
          situacao: 'em_execucao',
          prazo: '2026-09-12',
          versao: version,
          checklist: [{ id: item, rotulo: 'Verificar vedação', resposta: 'nok' }],
          resolucao: '',
        },
      },
    ],
  };
}
function operation(): OperacaoAplicativo {
  return {
    id: randomUUID(),
    tipo: 'solicitacao.criar',
    corpo: {
      ativo_id: asset,
      titulo: 'Ruído na prensa',
      descricao: 'Ruído após ligar a máquina',
      maquina_parada: true,
    },
  };
}
function checklist(): OperacaoAplicativo {
  return {
    id: randomUUID(),
    tipo: 'ordem.checklist',
    ordem_id: order,
    corpo: { versao: 1, respostas: { [item]: 'ok' } },
  };
}

test('fila e dados baixados persistem após fechar e reabrir o SQLite', async () => {
  const dir = resolve('../../work/cmms-offline');
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, randomUUID() + '.sqlite');
  let db = database(file),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  const op = operation();
  await store.aplicar(snapshot());
  await store.enfileirar(op);
  db.bruto.close();
  db = database(file);
  store = await new BaseLocal(db.adaptador, scope).iniciar();
  assert.equal((await store.fila())[0].id, op.id);
  assert.equal((await store.registros()).length, 2);
  assert.ok(await store.ultimaSincronizacao());
  db.bruto.close();
});
test('base local não pode ser aberta em outra conta e recusa snapshot de outro escopo', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.aplicar(snapshot());
  await assert.rejects(() => new BaseLocal(db.adaptador, 'outro-escopo').iniciar(), /outra conta/);
  await assert.rejects(() => store.aplicar({ ...snapshot(), escopo: 'outra-unidade' }), /outra conta/);
  assert.equal((await store.registros()).length, 2);
  db.bruto.close();
});
test('falha no meio do pull reverte remoções, alterações e data de sincronização', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.aplicar(snapshot());
  const before = await store.registros(),
    time = await store.ultimaSincronizacao();
  db.bruto.exec(
    "CREATE TRIGGER fail_order BEFORE UPDATE ON registros WHEN NEW.entidade='ordem' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;",
  );
  await assert.rejects(
    () => store.aplicar({ ...snapshot(2), removidos: [{ entidade: 'ativo', id: asset }] }),
    /simulated disk failure/,
  );
  assert.deepEqual(await store.registros(), before);
  assert.equal(await store.ultimaSincronizacao(), time);
  db.bruto.close();
});
test('queda depois do commit mantém o mesmo UUID para repetir sem criar outro registro', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  const op = operation();
  await store.enfileirar(op);
  const recibos = new Map<string, unknown>();
  const sent: string[] = [];
  let loseResponse = true;
  const transport: TransporteSincronizacao = {
    async baixar() {
      return snapshot();
    },
    async enviar(entry) {
      sent.push(entry.id);
      if (!recibos.has(entry.id)) recibos.set(entry.id, { id: randomUUID() });
      if (loseResponse) {
        loseResponse = false;
        throw new ErroSincronizacao('Conexão interrompida após gravar', 0);
      }
      return recibos.get(entry.id);
    },
  };
  await assert.rejects(() => new MotorSincronizacao(store, transport).sincronizar(), /interrompida/);
  assert.equal((await store.fila())[0].situacao, 'pendente');
  await new MotorSincronizacao(store, transport).sincronizar();
  assert.deepEqual(sent, [op.id, op.id]);
  assert.equal(recibos.size, 1);
  assert.equal((await store.fila())[0].situacao, 'confirmada');
  db.bruto.close();
});
test('cliques concorrentes em sincronizar compartilham o mesmo envio', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.enfileirar(operation());
  let sent = 0;
  const engine = new MotorSincronizacao(store, {
    async baixar() {
      return snapshot();
    },
    async enviar() {
      sent++;
      return { ok: true };
    },
  });
  await Promise.all([engine.sincronizar(), engine.sincronizar(), engine.sincronizar()]);
  assert.equal(sent, 1);
  db.bruto.close();
});
test('conflito preserva respostas, não é reenviado sozinho e aceita revisão explícita', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  const op = checklist();
  await store.enfileirar(op);
  let sends = 0;
  const engine = new MotorSincronizacao(store, {
    async baixar() {
      return snapshot(2);
    },
    async enviar() {
      sends++;
      throw new ErroSincronizacao('Checklist mudou', 409);
    },
  });
  await engine.sincronizar();
  await engine.sincronizar();
  assert.equal(sends, 1);
  const failed = (await store.fila())[0];
  assert.equal(failed.situacao, 'conflito');
  assert.deepEqual(JSON.parse(failed.corpo), op);
  await assert.rejects(() => store.enfileirar(checklist()), /já tem respostas/);
  const newId = randomUUID();
  await store.reaplicarChecklist(op.id, newId);
  const queue = await store.fila();
  assert.equal(queue.find((q) => q.id === op.id)!.situacao, 'substituida');
  const replacement = JSON.parse(queue.find((q) => q.id === newId)!.corpo);
  assert.equal(replacement.corpo.versao, 2);
  assert.equal(replacement.corpo.respostas[item], 'ok');
  db.bruto.close();
});
test('remoção por reatribuição elimina o cache e conserva as respostas rejeitadas', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.aplicar(snapshot());
  const op = checklist();
  await store.enfileirar(op);
  await new MotorSincronizacao(store, {
    async baixar() {
      return { ...snapshot(), gravar: [], removidos: [{ entidade: 'ordem', id: order }] };
    },
    async enviar() {
      throw new ErroSincronizacao('OS não encontrada', 404);
    },
  }).sincronizar();
  assert.equal(
    (await store.registros()).some((r) => r.entidade === 'ordem'),
    false,
  );
  assert.equal((await store.fila())[0].situacao, 'rejeitada');
  assert.deepEqual(JSON.parse((await store.fila())[0].corpo), op);
  db.bruto.close();
});
test('sessão revogada bloqueia o download e preserva apenas a fila protegida para nova autenticação', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.aplicar(snapshot());
  await store.enfileirar(operation());
  let sends = 0;
  await assert.rejects(
    () =>
      new MotorSincronizacao(store, {
        async baixar() {
          throw new ErroSincronizacao('Sessão revogada', 401);
        },
        async enviar() {
          sends++;
        },
      }).sincronizar(),
    /revogada/,
  );
  assert.equal(sends, 0);
  assert.equal((await store.registros()).length, 0);
  assert.equal((await store.fila())[0].situacao, 'pendente');
  db.bruto.close();
});
test('indisponibilidade e rate limit mantêm registros pendentes para uma próxima tentativa', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.enfileirar(operation());
  for (const status of [429, 503]) {
    await assert.rejects(
      () =>
        new MotorSincronizacao(store, {
          async baixar() {
            return snapshot();
          },
          async enviar() {
            throw new ErroSincronizacao('Tente depois', status);
          },
        }).sincronizar(),
      /Tente depois/,
    );
    assert.equal((await store.fila())[0].situacao, 'pendente');
  }
  db.bruto.close();
});
test('QR extrai apenas identificadores válidos sem executar ou seguir o conteúdo', () => {
  const id = randomUUID();
  assert.equal(identificadorQr(id), id);
  assert.equal(identificadorQr('https://fabrica.example/qr/' + id), id);
  assert.equal(identificadorQr('javascript:alert(1)'), null);
  assert.equal(identificadorQr('https://fabrica.example/login'), null);
  assert.equal(identificadorQr('qualquer texto'), null);
});
test('salvamento local repetido reutiliza a operação e não permite trocar seu conteúdo', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  const op = operation();
  await store.enfileirar(op);
  await store.enfileirar(op);
  assert.equal((await store.fila()).length, 1);
  await assert.rejects(
    () =>
      store.enfileirar({ ...op, corpo: { ...op.corpo, titulo: 'Outra ocorrência' } } as OperacaoAplicativo),
    /outro registro/,
  );
  db.bruto.close();
});
test('arquivamento preserva o conteúdo recusado e não descarta envios ainda incertos', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  const op = operation();
  await store.enfileirar(op);
  await store.arquivar(op.id);
  assert.equal((await store.fila())[0].situacao, 'pendente');
  await store.marcar(op.id, 'rejeitada', 'Ativo inativo');
  await store.arquivar(op.id);
  const entry = (await store.fila())[0];
  assert.equal(entry.situacao, 'arquivada');
  assert.deepEqual(JSON.parse(entry.corpo), op);
  db.bruto.close();
});
test('falha de disco ao limpar cache não mascara a revogação que bloqueia a interface', async () => {
  const db = database(),
    store = await new BaseLocal(db.adaptador, scope).iniciar();
  await store.aplicar(snapshot());
  db.bruto.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON registros BEGIN SELECT RAISE(ABORT,'disk failure'); END;",
  );
  await assert.rejects(
    () =>
      new MotorSincronizacao(store, {
        async baixar() {
          throw new ErroSincronizacao('Revogado', 401);
        },
        async enviar() {},
      }).sincronizar(),
    (erro: unknown) => erro instanceof ErroSincronizacao && erro.status === 401,
  );
  db.bruto.close();
});
