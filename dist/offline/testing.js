import { DatabaseSync } from 'node:sqlite';
export function sqliteDatabase(path = ':memory:') {
    const raw = new DatabaseSync(path);
    const executor = {
        async run(sql, params = []) {
            raw.prepare(sql).run(...params);
        },
        async all(sql, params = []) {
            return raw.prepare(sql).all(...params);
        },
    };
    const adapter = {
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
            }
            catch (e) {
                raw.exec('ROLLBACK');
                throw e;
            }
        },
    };
    return { raw, adapter };
}
//# sourceMappingURL=testing.js.map