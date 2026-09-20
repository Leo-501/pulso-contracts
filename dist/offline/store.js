import { esquemaOperacaoAplicativo, escopoAplicativo, } from '../mobile.js';
export class BaseLocal {
    db;
    escopo;
    constructor(db, escopo) {
        this.db = db;
        this.escopo = escopo;
    }
    async iniciar() {
        // Instalação anterior ao vocabulário em português. Criar as tabelas novas ao
        // lado das antigas deixaria a fila de trabalho não enviado invisível, e
        // perder trabalho de campo em silêncio é pior do que recusar a abrir.
        const antigas = await this.db.consultar("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('outbox','records','metadata')");
        if (antigas.length)
            throw new Error('Este banco local é de uma versão anterior e pode conter registros ainda não enviados. ' +
                'Sincronize pela versão antiga do aplicativo antes de atualizar.');
        await this.db.script(`
      CREATE TABLE IF NOT EXISTS metadados (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registros (entidade TEXT NOT NULL, id TEXT NOT NULL, etag TEXT NOT NULL, dados TEXT NOT NULL, PRIMARY KEY(entidade,id));
      CREATE TABLE IF NOT EXISTS fila (
        id TEXT PRIMARY KEY, tipo TEXT NOT NULL, ordem_id TEXT, corpo TEXT NOT NULL,
        situacao TEXT NOT NULL DEFAULT 'pendente', erro TEXT, recibo TEXT, criado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS um_checklist_pendente ON fila(ordem_id)
        WHERE tipo='ordem.checklist' AND situacao IN ('pendente','conflito','rejeitada');
    `);
        await this.db.transacao(async (tx) => {
            const atual = (await tx.consultar("SELECT valor FROM metadados WHERE chave='escopo'"))[0];
            if (atual && atual.valor !== this.escopo)
                throw new Error('O banco local pertence a outra conta ou unidade.');
            await tx.executar("INSERT OR IGNORE INTO metadados(chave,valor) VALUES('escopo',?)", [
                this.escopo,
            ]);
        });
        return this;
    }
    async manifesto() {
        return this.db.consultar('SELECT entidade,id,etag FROM registros ORDER BY entidade,id');
    }
    async registros() {
        const linhas = await this.db.consultar('SELECT * FROM registros ORDER BY entidade,id');
        return linhas.map((r) => ({ ...r, dados: JSON.parse(r.dados) }));
    }
    async ultimaSincronizacao() {
        return ((await this.db.consultar("SELECT valor FROM metadados WHERE chave='ultima_sincronizacao'"))[0]?.valor ?? null);
    }
    async aplicar(resposta) {
        if (resposta.protocolo !== 1 ||
            resposta.escopo !== this.escopo ||
            escopoAplicativo(resposta.pessoa) !== this.escopo)
            throw new Error('Resposta de sincronização de outra conta ou unidade.');
        await this.db.transacao(async (tx) => {
            for (const linha of resposta.removidos)
                await tx.executar('DELETE FROM registros WHERE entidade=? AND id=?', [
                    linha.entidade,
                    linha.id,
                ]);
            for (const linha of resposta.gravar)
                await tx.executar('INSERT INTO registros(entidade,id,etag,dados) VALUES(?,?,?,?) ON CONFLICT(entidade,id) DO UPDATE SET etag=excluded.etag,dados=excluded.dados', [linha.entidade, linha.id, linha.etag, JSON.stringify(linha.dados)]);
            await tx.executar("INSERT INTO metadados(chave,valor) VALUES('ultima_sincronizacao',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", [resposta.hora_servidor]);
        });
    }
    async enfileirar(entrada) {
        const operacao = esquemaOperacaoAplicativo.parse(entrada);
        await this.db.transacao((tx) => this.inserir(tx, operacao));
    }
    async inserir(tx, operacao) {
        const existente = (await tx.consultar('SELECT * FROM fila WHERE id=?', [operacao.id]))[0];
        if (existente) {
            if (existente.corpo !== JSON.stringify(operacao))
                throw new Error('Esta identificação já foi usada para outro registro.');
            return;
        }
        if (operacao.tipo === 'ordem.checklist' &&
            (await tx.consultar("SELECT id FROM fila WHERE ordem_id=? AND situacao IN ('pendente','conflito','rejeitada')", [operacao.ordem_id])).length)
            throw new Error('Esta OS já tem respostas aguardando sincronização ou revisão.');
        await tx.executar('INSERT INTO fila(id,tipo,ordem_id,corpo,criado_em) VALUES(?,?,?,?,?)', [
            operacao.id,
            operacao.tipo,
            operacao.tipo === 'ordem.checklist' ? operacao.ordem_id : null,
            JSON.stringify(operacao),
            new Date().toISOString(),
        ]);
    }
    async fila() {
        return this.db.consultar('SELECT * FROM fila ORDER BY criado_em,id');
    }
    async marcar(id, situacao, erro, recibo = null) {
        await this.db.executar("UPDATE fila SET situacao=?,erro=?,recibo=? WHERE id=? AND situacao='pendente'", [situacao, erro, recibo == null ? null : JSON.stringify(recibo), id]);
    }
    /**
     * Guarda a fila cifrada para nova autenticação do **mesmo** escopo, e para de
     * expor o que foi baixado. Trabalho de campo ainda não enviado não pode sumir
     * porque a sessão expirou.
     */
    async bloquearCache() {
        await this.db.transacao(async (tx) => {
            await tx.executar('DELETE FROM registros');
            await tx.executar("DELETE FROM metadados WHERE chave='ultima_sincronizacao'");
        });
    }
    async arquivar(id) {
        await this.db.executar("UPDATE fila SET situacao='arquivada' WHERE id=? AND situacao IN ('conflito','rejeitada')", [id]);
    }
    async reaplicarChecklist(id, novoId) {
        await this.db.transacao(async (tx) => {
            const item = (await tx.consultar("SELECT * FROM fila WHERE id=? AND situacao='conflito'", [id]))[0];
            if (!item)
                throw new Error('Atualize a fila antes de revisar este conflito.');
            const operacao = esquemaOperacaoAplicativo.parse(JSON.parse(item.corpo));
            if (operacao.tipo !== 'ordem.checklist')
                throw new Error('Esta operação exige correção pelo solicitante.');
            const linha = (await tx.consultar("SELECT dados FROM registros WHERE entidade='ordem' AND id=?", [operacao.ordem_id]))[0];
            const ordem = linha && JSON.parse(linha.dados);
            if (!ordem || !['em_execucao', 'pausada'].includes(ordem.situacao))
                throw new Error('A OS não está disponível para preencher o checklist.');
            if (Object.keys(operacao.corpo.respostas).some((chave) => !ordem.checklist.some((item) => item.id === chave)))
                throw new Error('Os itens do checklist mudaram. Consulte o gestor antes de reaplicar.');
            const substituta = esquemaOperacaoAplicativo.parse({
                ...operacao,
                id: novoId,
                corpo: { ...operacao.corpo, versao: ordem.versao },
            });
            await tx.executar("UPDATE fila SET situacao='substituida',recibo=? WHERE id=?", [
                JSON.stringify({ substituta: novoId }),
                id,
            ]);
            await this.inserir(tx, substituta);
        });
    }
}
//# sourceMappingURL=store.js.map