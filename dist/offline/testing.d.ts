import { DatabaseSync } from 'node:sqlite';
import type { BancoSql } from './store.js';
/** Adaptador SQLite para a suíte. O aplicativo usa o dele, com SQLCipher. */
export declare function bancoSqlite(caminho?: string): {
    bruto: DatabaseSync;
    adaptador: BancoSql;
};
//# sourceMappingURL=testing.d.ts.map