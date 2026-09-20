import type { ItemManifesto, OperacaoAplicativo, RespostaDownload } from '../mobile.js';
import { BaseLocal } from './store.js';
export declare class ErroSincronizacao extends Error {
    status: number;
    constructor(mensagem: string, status: number);
}
export interface TransporteSincronizacao {
    baixar(conhecidos: ItemManifesto[]): Promise<RespostaDownload>;
    enviar(operacao: OperacaoAplicativo): Promise<unknown>;
}
export declare class MotorSincronizacao {
    private base;
    private transporte;
    private emCurso?;
    constructor(base: BaseLocal, transporte: TransporteSincronizacao);
    /** Cliques simultâneos em sincronizar compartilham o mesmo envio. */
    sincronizar(): Promise<void>;
    private rodar;
}
//# sourceMappingURL=sync.d.ts.map