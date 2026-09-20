import { DatabaseSync } from 'node:sqlite';
/** Adaptador SQLite para a suíte. O aplicativo usa o dele, com SQLCipher. */
export function bancoSqlite(caminho = ':memory:') {
    const bruto = new DatabaseSync(caminho);
    const executor = {
        async executar(sql, parametros = []) {
            bruto.prepare(sql).run(...parametros);
        },
        async consultar(sql, parametros = []) {
            return bruto.prepare(sql).all(...parametros);
        },
    };
    const adaptador = {
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
            }
            catch (e) {
                bruto.exec('ROLLBACK');
                throw e;
            }
        },
    };
    return { bruto, adaptador };
}
//# sourceMappingURL=testing.js.map