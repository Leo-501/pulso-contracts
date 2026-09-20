import type { ManifestEntry, MobileOperation, PullResponse } from '../mobile.js';
import { OfflineStore } from './store.js';
export declare class SyncError extends Error {
    status: number;
    constructor(message: string, status: number);
}
export interface SyncTransport {
    pull(known: ManifestEntry[]): Promise<PullResponse>;
    send(operation: MobileOperation): Promise<unknown>;
}
export declare class SyncEngine {
    private store;
    private transport;
    private running?;
    constructor(store: OfflineStore, transport: SyncTransport);
    sync(): Promise<void>;
    private run;
}
//# sourceMappingURL=sync.d.ts.map