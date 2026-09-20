import { type Papel } from '../index.js';
/**
 * Identidade de mentira, em memória, para a suíte de um produto.
 *
 * Ela é um `fetch`, não um cliente: quem estiver sendo testado usa o
 * `ClienteIdentidade` de verdade, com o cache, o envio compartilhado e a falha
 * fechada reais. Só o outro lado da rede é simulado.
 *
 * Existe porque a alternativa — cada produto subir o serviço de identidade na
 * própria suíte — obrigaria a depender do repositório dele, que é privado, e a
 * empilhar dependência git dentro de dependência git, o que o pnpm recusa.
 *
 * A fidelidade não é promessa: é verificada. A bateria `conformidadeIdentidade`
 * roda contra este duplo e contra o serviço de verdade, e uma divergência
 * derruba um dos dois.
 */
export * from './conformance.js';
export type EmpresaDuplo = {
    apelido: string;
    nome: string;
    unidades: {
        nome: string;
        cidade?: string;
        fuso?: string;
    }[];
};
export type PessoaDuplo = {
    email: string;
    nome: string;
    senha: string;
    ativo?: boolean;
    trocar_senha?: boolean;
    vinculos: {
        empresa: string;
        papel: Papel;
        unidades?: string[];
        ativo?: boolean;
    }[];
};
export type EspecificacaoDuplo = {
    cliente?: {
        id: string;
        segredo: string;
    };
    empresas: EmpresaDuplo[];
    pessoas: PessoaDuplo[];
};
export type IdentidadeDuplo = {
    /** Passe para `new ClienteIdentidade({ fetch })`. */
    fetch: typeof globalThis.fetch;
    cliente: {
        id: string;
        segredo: string;
    };
    empresaId(apelido: string): string;
    unidadeId(apelido: string, unidade: string): string;
    pessoaId(email: string): string;
    /** Rotas pedidas, na ordem, para o teste conferir que o produto não fala demais. */
    chamadas: {
        metodo: string;
        caminho: string;
    }[];
    /** Adianta o relógio das sessões, para exercitar expiração sem esperar. */
    expirarTudo(): void;
};
export declare function criarIdentidadeDuplo(spec: EspecificacaoDuplo): IdentidadeDuplo;
//# sourceMappingURL=testing.d.ts.map