import { DatabaseSync } from 'node:sqlite';
import type { BancoSql, ExecutorSql } from './store.js';

/** Adaptador SQLite para a suíte. O aplicativo usa o dele, com SQLCipher. */
export function bancoSqlite(caminho = ':memory:') {
  const bruto = new DatabaseSync(caminho);
  const executor: ExecutorSql = {
    async executar(sql, parametros = []) {
      bruto.prepare(sql).run(...parametros);
    },
    async consultar<T>(sql: string, parametros = []) {
      return bruto.prepare(sql).all(...parametros) as T[];
    },
  };
  const adaptador: BancoSql = {
    ...executor,
    async script(sql) {
      bruto.exec(sql);
    },
    async transacao(fn) {
      bruto.exec('BEGIN');
      try {
        const resultado = await fn(executor);
        bruto.exec('COMMIT');
        return resultado;
      } catch (e) {
        bruto.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { bruto, adaptador };
}
