import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlExecutor } from './store.js';

export function sqliteDatabase(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const executor: SqlExecutor = {
    async run(sql, params = []) {
      raw.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
  };
  const adapter: SqlDatabase = {
    ...executor,
    async exec(sql) {
      raw.exec(sql);
    },
    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        const result = await fn(executor);
        raw.exec('COMMIT');
        return result;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { raw, adapter };
}
