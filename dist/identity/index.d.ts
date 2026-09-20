import { z } from 'zod';
import { type Papel } from '../index.js';
/**
 * Tipo da sessão. O serviço separa sessão de painel de sessão de aplicativo, e
 * toda rota que recebe uma sessão precisa saber qual das duas está chegando:
 * perguntar pelo tipo errado é o mesmo que perguntar por uma sessão inexistente.
 */
export type TipoSessao = 'painel' | 'aplicativo';
export declare const esquemaPedidoIntrospeccao: z.ZodObject<{
    token: z.ZodString;
    tipo: z.ZodDefault<z.ZodEnum<{
        painel: "painel";
        aplicativo: "aplicativo";
    }>>;
}, z.core.$strict>;
export type PedidoIntrospeccao = z.infer<typeof esquemaPedidoIntrospeccao>;
/** Contexto resolvido de quem está chamando: empresa, unidade e papel. */
export type Contexto = {
    id: string;
    nome: string;
    email: string;
    empresa_id: string;
    empresa_nome: string;
    unidade_id: string;
    unidade_nome: string;
    fuso: string;
    papel: Papel;
    trocar_senha: boolean;
};
/**
 * Resposta sempre 200, mesmo para token inválido, no espírito da RFC 7662.
 * Distinguir "inválido" de "erro do serviço" por código HTTP transformaria a
 * rota em oráculo para quem tivesse a credencial de serviço.
 */
export type Introspeccao = {
    ativa: false;
} | {
    ativa: true;
    contexto: Contexto;
    expira_em: string;
};
export declare const esquemaIntrospeccao: z.ZodType<Introspeccao>;
/** Sessão emitida pela identidade. O produto guarda o token como preferir. */
export type SessaoEmitida = {
    token: string;
    expira_em: string;
    contexto: Contexto;
};
export declare const esquemaSessaoEmitida: z.ZodObject<{
    token: z.ZodString;
    expira_em: z.ZodString;
    contexto: z.ZodObject<{
        id: z.ZodString;
        nome: z.ZodString;
        email: z.ZodString;
        empresa_id: z.ZodString;
        empresa_nome: z.ZodString;
        unidade_id: z.ZodString;
        unidade_nome: z.ZodString;
        fuso: z.ZodString;
        papel: z.ZodEnum<{
            administrador: "administrador";
            gestor: "gestor";
            tecnico: "tecnico";
            solicitante: "solicitante";
            almoxarife: "almoxarife";
            consulta: "consulta";
        }>;
        trocar_senha: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * Quadro de pessoas de uma empresa, para o produto manter projeção local.
 *
 * A projeção existe para o produto cruzar nome de responsável e listar a equipe
 * sem um salto de rede por linha, e para as chaves estrangeiras de histórico
 * continuarem valendo. Ela **não é fonte de verdade de acesso**: quem decide se
 * alguém entra é a introspecção, a cada requisição. Projeção atrasada não abre
 * porta; ela apenas deixa de fechar uma que já está fechada.
 */
export declare const esquemaQuadro: z.ZodObject<{
    gerado_em: z.ZodString;
    pessoas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        nome: z.ZodString;
        email: z.ZodString;
        ativo: z.ZodBoolean;
        papel: z.ZodEnum<{
            administrador: "administrador";
            gestor: "gestor";
            tecnico: "tecnico";
            solicitante: "solicitante";
            almoxarife: "almoxarife";
            consulta: "consulta";
        }>;
        vinculo_ativo: z.ZodBoolean;
        unidade_ids: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    unidades: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        nome: z.ZodString;
        cidade: z.ZodString;
        fuso: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Quadro = z.infer<typeof esquemaQuadro>;
/** Conta criada. A senha temporária vem uma única vez e não é recuperável. */
export declare const esquemaContaCriada: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    nome: z.ZodString;
    papel: z.ZodEnum<{
        administrador: "administrador";
        gestor: "gestor";
        tecnico: "tecnico";
        solicitante: "solicitante";
        almoxarife: "almoxarife";
        consulta: "consulta";
    }>;
    senha_temporaria: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type ContaCriada = z.infer<typeof esquemaContaCriada>;
export declare const esquemaListaContas: z.ZodObject<{
    pessoas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        nome: z.ZodString;
        email: z.ZodString;
        trocar_senha: z.ZodBoolean;
        papel: z.ZodEnum<{
            administrador: "administrador";
            gestor: "gestor";
            tecnico: "tecnico";
            solicitante: "solicitante";
            almoxarife: "almoxarife";
            consulta: "consulta";
        }>;
        ativo: z.ZodBoolean;
        unidade_ids: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    unidades: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        nome: z.ZodString;
        cidade: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ListaContas = z.infer<typeof esquemaListaContas>;
export declare const esquemaListaUnidades: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    nome: z.ZodString;
    cidade: z.ZodString;
}, z.core.$strip>>;
export type OpcoesClienteIdentidade = {
    baseUrl: string;
    clienteId: string;
    clienteSegredo: string;
    /**
     * Janela em que uma introspecção positiva é reaproveitada. É o atraso máximo
     * da revogação por expiração: encerrar uma sessão só surte efeito no produto
     * depois disso. Zero desliga o cache e devolve revogação imediata ao custo de
     * um salto de rede por requisição.
     *
     * Revogação que alguém **pediu** não espera esta janela: as rotas que
     * derrubam sessão do outro lado chamam `esquecerTudo`.
     */
    cacheMs?: number;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
};
export declare class IdentidadeIndisponivel extends Error {
    constructor(causa: unknown);
}
/**
 * Recusa da identidade: credencial inválida, senha errada, papel insuficiente.
 * Carrega o código e a mensagem originais para o produto repassá-los sem
 * reescrever regra que não é dele.
 */
export declare class IdentidadeRecusou extends Error {
    readonly status: number;
    readonly campos?: {
        campo: string;
        mensagem: string;
    }[] | undefined;
    constructor(status: number, mensagem: string, campos?: {
        campo: string;
        mensagem: string;
    }[] | undefined);
}
/**
 * Cliente de introspecção com cache curto.
 *
 * Falha fechado: se a identidade não responde, `introspectar` lança em vez de
 * liberar o acesso. A consequência é que a identidade vira dependência dura de
 * disponibilidade de todo produto do portfólio — o preço de manter a revogação
 * síncrona em vez de usar token assinado.
 *
 * Só resposta positiva entra no cache. Negativa nunca: um token recém-emitido
 * que tenha sido perguntado cedo demais ficaria marcado como inválido.
 */
export declare class ClienteIdentidade {
    private readonly opcoes;
    private readonly cache;
    private readonly emCurso;
    private readonly cacheMs;
    private readonly timeoutMs;
    private readonly fetch;
    constructor(opcoes: OpcoesClienteIdentidade);
    introspectar(token: string, tipo?: TipoSessao): Promise<Introspeccao>;
    /** Descarta a entrada em cache. O produto chama isto ao encerrar a sessão. */
    esquecer(token: string): void;
    /**
     * Descarta o cache inteiro.
     *
     * Existe para a revogação pedida por uma pessoa. O cache é indexado por token,
     * e um administrador que desativa um vínculo não conhece os tokens de quem ele
     * desativou — são opacos e vivem na identidade. Sem isto, quem acabou de
     * perder o acesso seguiria entrando pela janela inteira do cache.
     *
     * É grosseiro de propósito: custa uma introspecção a mais por sessão viva, e
     * mudança de acesso é rara. O contrário — deixar valer um acesso que alguém
     * mandou cortar — não é aceitável em nenhuma janela.
     */
    esquecerTudo(): void;
    /**
     * Autentica e devolve a sessão. O produto guarda o token como preferir — o
     * painel em cookie próprio, o aplicativo em armazenamento seguro. A identidade
     * não emite cookie: cookie é preso a domínio, e produtos em hosts diferentes
     * não o compartilhariam.
     */
    entrar(corpo: unknown): Promise<{
        token: string;
        expira_em: string;
        contexto: {
            id: string;
            nome: string;
            email: string;
            empresa_id: string;
            empresa_nome: string;
            unidade_id: string;
            unidade_nome: string;
            fuso: string;
            papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
            trocar_senha: boolean;
        };
    }>;
    entrarAplicativo(corpo: unknown): Promise<{
        token: string;
        expira_em: string;
        contexto: {
            id: string;
            nome: string;
            email: string;
            empresa_id: string;
            empresa_nome: string;
            unidade_id: string;
            unidade_nome: string;
            fuso: string;
            papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
            trocar_senha: boolean;
        };
    }>;
    sair(token: string, tipo?: TipoSessao): Promise<void>;
    unidades(token: string, tipo?: TipoSessao): Promise<{
        id: string;
        nome: string;
        cidade: string;
    }[]>;
    trocarUnidade(token: string, corpo: unknown): Promise<{
        token: string;
        expira_em: string;
        contexto: {
            id: string;
            nome: string;
            email: string;
            empresa_id: string;
            empresa_nome: string;
            unidade_id: string;
            unidade_nome: string;
            fuso: string;
            papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
            trocar_senha: boolean;
        };
    }>;
    trocarSenha(token: string, corpo: unknown): Promise<{
        ok: boolean;
    }>;
    /** Quadro de pessoas da empresa da sessão, para o produto projetar. */
    quadro(token: string, tipo?: TipoSessao): Promise<{
        gerado_em: string;
        pessoas: {
            id: string;
            nome: string;
            email: string;
            ativo: boolean;
            papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
            vinculo_ativo: boolean;
            unidade_ids: string[];
        }[];
        unidades: {
            id: string;
            nome: string;
            cidade: string;
            fuso: string;
        }[];
    }>;
    contas(token: string): Promise<{
        pessoas: {
            id: string;
            nome: string;
            email: string;
            trocar_senha: boolean;
            papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
            ativo: boolean;
            unidade_ids: string[];
        }[];
        unidades: {
            id: string;
            nome: string;
            cidade: string;
        }[];
    }>;
    criarConta(token: string, corpo: unknown): Promise<{
        id: string;
        email: string;
        nome: string;
        papel: "administrador" | "gestor" | "tecnico" | "solicitante" | "almoxarife" | "consulta";
        senha_temporaria: string | null;
    }>;
    alterarConta(token: string, id: string, corpo: unknown): Promise<{
        ok: boolean;
    }>;
    redefinirSenha(token: string, id: string): Promise<{
        id: string;
        senha_temporaria: string;
    }>;
    /**
     * A introspecção nunca recusa um token com 4xx — token inválido é
     * `ativa:false` em 200. Então qualquer 4xx aqui é problema do produto,
     * tipicamente credencial de serviço errada, e precisa falhar fechado.
     *
     * Deixar a recusa atravessar seria desastroso: o produto repassaria 401 ao
     * navegador e um erro de configuração no deploy deslogaria todo mundo de uma
     * vez, em vez de devolver indisponibilidade enquanto alguém conserta.
     */
    private perguntar;
    /**
     * Um único ponto de rede. A distinção que ele preserva é a que importa: 4xx é
     * recusa da identidade e atravessa com o código e a mensagem originais, que já
     * estão em português; qualquer outra coisa é indisponibilidade e falha fechado.
     * Tratar as duas igual deslogaria todo mundo durante uma queda do serviço.
     */
    private chamar;
}
//# sourceMappingURL=index.d.ts.map