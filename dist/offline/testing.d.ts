import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase } from './store.js';
export declare function sqliteDatabase(path?: string): {
    raw: DatabaseSync;
    adapter: SqlDatabase;
};
//# sourceMappingURL=testing.d.ts.map