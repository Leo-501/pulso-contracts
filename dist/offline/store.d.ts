import { type CachedRecord, type ManifestEntry, type MobileOperation, type PullResponse } from '../mobile.js';
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
export declare class OfflineStore {
    db: SqlDatabase;
    scope: string;
    constructor(db: SqlDatabase, scope: string);
    init(): Promise<this>;
    manifest(): Promise<ManifestEntry[]>;
    records(): Promise<CachedRecord[]>;
    lastSync(): Promise<string>;
    apply(response: PullResponse): Promise<void>;
    enqueue(input: MobileOperation): Promise<void>;
    private insert;
    queue(): Promise<OutboxEntry[]>;
    mark(id: string, state: 'confirmed' | 'conflict' | 'rejected', error: string | null, receipt?: unknown): Promise<void>;
    lockCache(): Promise<void>;
    dismiss(id: string): Promise<void>;
    reapplyChecklist(id: string, newId: string): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map