import { type ItemManifesto, type OperacaoAplicativo, type RegistroLocal, type RespostaDownload } from '../mobile.js';
export type ValorSql = string | number | null;
export interface ExecutorSql {
    executar(sql: string, parametros?: ValorSql[]): Promise<void>;
    consultar<T>(sql: string, parametros?: ValorSql[]): Promise<T[]>;
}
export interface BancoSql extends ExecutorSql {
    script(sql: string): Promise<void>;
    transacao<T>(fn: (tx: ExecutorSql) => Promise<T>): Promise<T>;
}
export type ItemFila = {
    id: string;
    tipo: OperacaoAplicativo['tipo'];
    ordem_id: string | null;
    corpo: string;
    situacao: 'pendente' | 'confirmada' | 'conflito' | 'rejeitada' | 'substituida' | 'arquivada';
    erro: string | null;
    recibo: string | null;
    criado_em: string;
};
export declare class BaseLocal {
    db: BancoSql;
    escopo: string;
    constructor(db: BancoSql, escopo: string);
    iniciar(): Promise<this>;
    manifesto(): Promise<ItemManifesto[]>;
    registros(): Promise<RegistroLocal[]>;
    ultimaSincronizacao(): Promise<string>;
    aplicar(resposta: RespostaDownload): Promise<void>;
    enfileirar(entrada: OperacaoAplicativo): Promise<void>;
    private inserir;
    fila(): Promise<ItemFila[]>;
    marcar(id: string, situacao: 'confirmada' | 'conflito' | 'rejeitada', erro: string | null, recibo?: unknown): Promise<void>;
    /**
     * Guarda a fila cifrada para nova autenticação do **mesmo** escopo, e para de
     * expor o que foi baixado. Trabalho de campo ainda não enviado não pode sumir
     * porque a sessão expirou.
     */
    bloquearCache(): Promise<void>;
    arquivar(id: string): Promise<void>;
    reaplicarChecklist(id: string, novoId: string): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map