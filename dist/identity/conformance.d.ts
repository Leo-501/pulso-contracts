/**
 * Bateria de conformidade da identidade.
 *
 * As mesmas verificações rodam contra o serviço de verdade (`pulso-identity`) e
 * contra o duplo em memória (`createIdentityStub`). Enquanto os dois passarem,
 * um produto testado com o duplo está testado contra o comportamento real; se
 * divergirem, um dos dois cai — que é o único jeito honesto de um duplo existir.
 *
 * Deliberadamente não cobre o que é próprio de cada lado: o duplo não tem RLS,
 * papéis de banco nem auditoria, e o serviço não tem `expireAll`. O que está
 * aqui é a fronteira que o produto enxerga.
 */
export type ConformanceResponse = {
    status: number;
    data: any;
};
export type ConformanceTarget = {
    /** Chamada crua, já com a credencial de serviço válida aplicada. */
    call(method: 'GET' | 'POST', path: string, options?: {
        body?: unknown;
        session?: string;
        kind?: 'web' | 'mobile';
    }): Promise<ConformanceResponse>;
    /** Chamada com credencial de serviço errada. */
    callSemCredencial(path: string, body: unknown): Promise<ConformanceResponse>;
    fixtures: {
        /** Empresa com pelo menos duas unidades. */
        company: string;
        password: string;
        /** Administrador da empresa. */
        admin: string;
        /** Pessoa com vínculo em duas unidades desta empresa. */
        duasUnidades: string;
        /** Técnico, para exercitar papel sem poder administrativo. */
        technician: string;
    };
};
export type ConformanceCheck = {
    name: string;
    run(target: ConformanceTarget): Promise<void>;
};
export declare const identityConformance: ConformanceCheck[];
//# sourceMappingURL=conformance.d.ts.map