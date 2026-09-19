import {
  mobileOperationSchema,
  mobileScope,
  type CachedRecord,
  type ManifestEntry,
  type MobileOperation,
  type MobileOrder,
  type PullResponse,
} from '../mobile.js';

export type SqlValue = string | number | null;
export interface SqlExecutor {
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlExecutor {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
export type OutboxEntry = {
  id: string;
  kind: MobileOperation['kind'];
  order_id: string | null;
  payload: string;
  state: 'pending' | 'confirmed' | 'conflict' | 'rejected' | 'superseded' | 'dismissed';
  error: string | null;
  receipt: string | null;
  created_at: string;
};

export class OfflineStore {
  constructor(
    public db: SqlDatabase,
    public scope: string,
  ) {}
  async init() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (entity TEXT NOT NULL, id TEXT NOT NULL, etag TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(entity,id));
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, order_id TEXT, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', error TEXT, receipt TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_checklist ON outbox(order_id)
        WHERE kind='order.checklist' AND state IN ('pending','conflict','rejected');
    `);
    await this.db.transaction(async (tx) => {
      const existing = (
        await tx.all<{ value: string }>("SELECT value FROM metadata WHERE key='scope'")
      )[0];
      if (existing && existing.value !== this.scope)
        throw new Error('O banco local pertence a outra conta ou unidade.');
      await tx.run("INSERT OR IGNORE INTO metadata(key,value) VALUES('scope',?)", [this.scope]);
    });
    return this;
  }
  async manifest(): Promise<ManifestEntry[]> {
    return this.db.all<ManifestEntry>('SELECT entity,id,etag FROM records ORDER BY entity,id');
  }
  async records(): Promise<CachedRecord[]> {
    const rows = await this.db.all<ManifestEntry & { data: string }>(
      'SELECT * FROM records ORDER BY entity,id',
    );
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  async lastSync() {
    return (
      (await this.db.all<{ value: string }>("SELECT value FROM metadata WHERE key='last_sync'"))[0]
        ?.value ?? null
    );
  }
  async apply(response: PullResponse) {
    if (
      response.protocol !== 1 ||
      response.scope !== this.scope ||
      mobileScope(response.user) !== this.scope
    )
      throw new Error('Resposta de sincronização de outra conta ou unidade.');
    await this.db.transaction(async (tx) => {
      for (const row of response.removed)
        await tx.run('DELETE FROM records WHERE entity=? AND id=?', [row.entity, row.id]);
      for (const row of response.upserts)
        await tx.run(
          'INSERT INTO records(entity,id,etag,data) VALUES(?,?,?,?) ON CONFLICT(entity,id) DO UPDATE SET etag=excluded.etag,data=excluded.data',
          [row.entity, row.id, row.etag, JSON.stringify(row.data)],
        );
      await tx.run(
        "INSERT INTO metadata(key,value) VALUES('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [response.server_time],
      );
    });
  }
  async enqueue(input: MobileOperation) {
    const operation = mobileOperationSchema.parse(input);
    await this.db.transaction((tx) => this.insert(tx, operation));
  }
  private async insert(tx: SqlExecutor, operation: MobileOperation) {
    const existing = (
      await tx.all<OutboxEntry>('SELECT * FROM outbox WHERE id=?', [operation.id])
    )[0];
    if (existing) {
      if (existing.payload !== JSON.stringify(operation))
        throw new Error('Esta identificação já foi usada para outro registro.');
      return;
    }
    if (
      operation.kind === 'order.checklist' &&
      (
        await tx.all(
          "SELECT id FROM outbox WHERE order_id=? AND state IN ('pending','conflict','rejected')",
          [operation.order_id],
        )
      ).length
    )
      throw new Error('Esta OS já tem respostas aguardando sincronização ou revisão.');
    await tx.run('INSERT INTO outbox(id,kind,order_id,payload,created_at) VALUES(?,?,?,?,?)', [
      operation.id,
      operation.kind,
      operation.kind === 'order.checklist' ? operation.order_id : null,
      JSON.stringify(operation),
      new Date().toISOString(),
    ]);
  }
  async queue(): Promise<OutboxEntry[]> {
    return this.db.all('SELECT * FROM outbox ORDER BY created_at,id');
  }
  async mark(
    id: string,
    state: 'confirmed' | 'conflict' | 'rejected',
    error: string | null,
    receipt: unknown = null,
  ) {
    await this.db.run(
      "UPDATE outbox SET state=?,error=?,receipt=? WHERE id=? AND state='pending'",
      [state, error, receipt == null ? null : JSON.stringify(receipt), id],
    );
  }
  async lockCache() {
    // Keep the encrypted outbox for reauthentication by the SAME scope. Stop exposing downloaded records.
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM records');
      await tx.run("DELETE FROM metadata WHERE key='last_sync'");
    });
  }
  async dismiss(id: string) {
    await this.db.run(
      "UPDATE outbox SET state='dismissed' WHERE id=? AND state IN ('conflict','rejected')",
      [id],
    );
  }
  async reapplyChecklist(id: string, newId: string) {
    await this.db.transaction(async (tx) => {
      const entry = (
        await tx.all<OutboxEntry>("SELECT * FROM outbox WHERE id=? AND state='conflict'", [id])
      )[0];
      if (!entry) throw new Error('Atualize a fila antes de revisar este conflito.');
      const op = mobileOperationSchema.parse(JSON.parse(entry.payload));
      if (op.kind !== 'order.checklist')
        throw new Error('Esta operação exige correção pelo solicitante.');
      const row = (
        await tx.all<{ data: string }>("SELECT data FROM records WHERE entity='order' AND id=?", [
          op.order_id,
        ])
      )[0];
      const order: MobileOrder | undefined = row && JSON.parse(row.data);
      if (!order || !['in_progress', 'paused'].includes(order.status))
        throw new Error('A OS não está disponível para preencher o checklist.');
      if (
        Object.keys(op.body.answers).some((key) => !order.checklist.some((item) => item.id === key))
      )
        throw new Error('Os itens do checklist mudaram. Consulte o gestor antes de reaplicar.');
      const replacement = mobileOperationSchema.parse({
        ...op,
        id: newId,
        body: { ...op.body, version: order.version },
      });
      await tx.run("UPDATE outbox SET state='superseded',receipt=? WHERE id=?", [
        JSON.stringify({ replacement: newId }),
        id,
      ]);
      await this.insert(tx, replacement);
    });
  }
}
