import type { ManifestEntry, MobileOperation, PullResponse } from '../mobile.js';
import { OfflineStore } from './store.js';

export class SyncError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export interface SyncTransport {
  pull(known: ManifestEntry[]): Promise<PullResponse>;
  send(operation: MobileOperation): Promise<unknown>;
}
export class SyncEngine {
  private running?: Promise<void>;
  constructor(
    private store: OfflineStore,
    private transport: SyncTransport,
  ) {}
  sync() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    try {
      // Refresh authorizations and removals before attempting queued writes.
      await this.store.apply(await this.transport.pull(await this.store.manifest()));
      for (const entry of await this.store.queue()) {
        if (entry.state !== 'pending') continue;
        try {
          const receipt = await this.transport.send(JSON.parse(entry.payload));
          await this.store.mark(entry.id, 'confirmed', null, receipt);
        } catch (error) {
          if (
            !(error instanceof SyncError) ||
            error.status === 0 ||
            error.status >= 500 ||
            error.status === 429
          )
            throw error;
          if (error.status === 401) throw error;
          await this.store.mark(
            entry.id,
            error.status === 409 ? 'conflict' : 'rejected',
            error.message,
          );
        }
      }
      await this.store.apply(await this.transport.pull(await this.store.manifest()));
    } catch (error) {
      if (error instanceof SyncError && error.status === 401) {
        // Never mask an authorization failure with a local I/O error; the caller must lock its UI.
        await this.store.lockCache().catch(() => {});
      }
      throw error;
    }
  }
}
