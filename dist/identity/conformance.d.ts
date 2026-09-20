/**
 * Bateria de conformidade da identidade.
 *
 * As mesmas verificações rodam contra o serviço de verdade (`pulso-identity`) e
 * contra o duplo em memória (`criarIdentidadeDuplo`). Enquanto os dois passarem,
 * um produto testado com o duplo está testado contra o comportamento real; se
 * divergirem, um dos dois cai — que é o único jeito honesto de um duplo existir.
 *
 * Deliberadamente não cobre o que é próprio de cada lado: o duplo não tem RLS,
 * papéis de banco nem auditoria, e o serviço não tem `expirarTudo`. O que está
 * aqui é a fronteira que o produto enxerga.
 */
export type RespostaConformidade = {
    status: number;
    dados: any;
};
export type AlvoConformidade = {
    /** Chamada crua, já com a credencial de serviço válida aplicada. */
    chamar(metodo: 'GET' | 'POST', caminho: string, opcoes?: {
        corpo?: unknown;
        sessao?: string;
        tipo?: 'painel' | 'aplicativo';
    }): Promise<RespostaConformidade>;
    /** Chamada com credencial de serviço errada. */
    chamarSemCredencial(caminho: string, corpo: unknown): Promise<RespostaConformidade>;
    dados: {
        /** Empresa com pelo menos duas unidades. */
        empresa: string;
        senha: string;
        /** Administrador da empresa. */
        administrador: string;
        /** Pessoa com vínculo em duas unidades desta empresa. */
        duasUnidades: string;
        /** Técnico, para exercitar papel sem poder administrativo. */
        tecnico: string;
    };
};
export type VerificacaoConformidade = {
    nome: string;
    rodar(alvo: AlvoConformidade): Promise<void>;
};
export declare const conformidadeIdentidade: VerificacaoConformidade[];
//# sourceMappingURL=conformance.d.ts.map