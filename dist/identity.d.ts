import { z } from 'zod';
import { type Role } from './index.js';
export declare const introspectionRequestSchema: z.ZodObject<{
    token: z.ZodString;
    kind: z.ZodDefault<z.ZodEnum<{
        web: "web";
        mobile: "mobile";
    }>>;
}, z.core.$strict>;
export type IntrospectionRequest = z.infer<typeof introspectionRequestSchema>;
/** Contexto resolvido de quem está chamando: empresa, unidade e papel. */
export type Principal = {
    id: string;
    name: string;
    email: string;
    tenant_id: string;
    tenant_name: string;
    site_id: string;
    site_name: string;
    timezone: string;
    role: Role;
    must_change_password: boolean;
};
/**
 * Resposta sempre 200, mesmo para token inválido, no espírito da RFC 7662.
 * Distinguir "inválido" de "erro do serviço" por código HTTP transformaria a
 * rota em oráculo para quem tivesse a credencial de serviço.
 */
export type Introspection = {
    active: false;
} | {
    active: true;
    principal: Principal;
    expires_at: string;
};
export declare const introspectionSchema: z.ZodType<Introspection>;
/** Sessão emitida pela identidade. O produto guarda o token como preferir. */
export type IssuedSession = {
    token: string;
    expires_at: string;
    principal: Principal;
};
export declare const issuedSessionSchema: z.ZodObject<{
    token: z.ZodString;
    expires_at: z.ZodString;
    principal: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        email: z.ZodString;
        tenant_id: z.ZodString;
        tenant_name: z.ZodString;
        site_id: z.ZodString;
        site_name: z.ZodString;
        timezone: z.ZodString;
        role: z.ZodEnum<{
            admin: "admin";
            manager: "manager";
            technician: "technician";
            operator: "operator";
            storekeeper: "storekeeper";
            viewer: "viewer";
        }>;
        must_change_password: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * Quadro de pessoas de uma empresa, para o produto manter projeção local.
 *
 * A projeção existe para o produto cruzar nome de responsável e listar a equipe
 * sem um salto de rede por linha, e para as chaves estrangeiras de histórico
 * continuarem valendo. Ela **não é fonte de verdade de acesso**: quem decide se
 * alguém entra é a introspecção, que acontece a cada requisição. Projeção
 * atrasada não abre porta; ela apenas deixa de fechar uma que já está fechada.
 */
export declare const rosterSchema: z.ZodObject<{
    generated_at: z.ZodString;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        email: z.ZodString;
        active: z.ZodBoolean;
        role: z.ZodEnum<{
            admin: "admin";
            manager: "manager";
            technician: "technician";
            operator: "operator";
            storekeeper: "storekeeper";
            viewer: "viewer";
        }>;
        membership_active: z.ZodBoolean;
        site_ids: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    sites: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        city: z.ZodString;
        timezone: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Roster = z.infer<typeof rosterSchema>;
/** Conta criada. A senha temporária vem uma única vez e não é recuperável. */
export declare const accountCreatedSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        manager: "manager";
        technician: "technician";
        operator: "operator";
        storekeeper: "storekeeper";
        viewer: "viewer";
    }>;
    temporary_password: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type AccountCreated = z.infer<typeof accountCreatedSchema>;
export declare const accountListSchema: z.ZodObject<{
    users: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        email: z.ZodString;
        must_change_password: z.ZodBoolean;
        role: z.ZodEnum<{
            admin: "admin";
            manager: "manager";
            technician: "technician";
            operator: "operator";
            storekeeper: "storekeeper";
            viewer: "viewer";
        }>;
        active: z.ZodBoolean;
        site_ids: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    sites: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        city: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AccountList = z.infer<typeof accountListSchema>;
export declare const siteListSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    city: z.ZodString;
}, z.core.$strip>>;
export type IdentityClientOptions = {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    /**
     * Janela em que uma introspecção positiva é reaproveitada. É o atraso máximo
     * da revogação: encerrar uma sessão só surte efeito no produto depois disso.
     * Zero desliga o cache e devolve revogação imediata ao custo de um salto de
     * rede por requisição.
     */
    cacheMs?: number;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
};
export declare class IdentityUnavailableError extends Error {
    constructor(cause: unknown);
}
/**
 * Recusa da identidade: credencial inválida, senha errada, papel insuficiente.
 * Carrega o código e a mensagem originais para o produto repassá-los sem
 * reescrever regra que não é dele.
 */
export declare class IdentityRejectedError extends Error {
    readonly status: number;
    readonly issues?: {
        field: string;
        message: string;
    }[] | undefined;
    constructor(status: number, message: string, issues?: {
        field: string;
        message: string;
    }[] | undefined);
}
/**
 * Cliente de introspecção com cache curto.
 *
 * Falha fechado: se a identidade não responde, `introspect` lança em vez de
 * liberar o acesso. A consequência é que a identidade vira dependência dura de
 * disponibilidade de todo produto do portfólio — o preço de manter a revogação
 * síncrona em vez de usar token assinado.
 *
 * Só resposta positiva entra no cache. Negativa nunca: um token recém-emitido
 * que tenha sido perguntado cedo demais ficaria marcado como inválido.
 */
export declare class IdentityClient {
    private readonly options;
    private readonly cache;
    private readonly pending;
    private readonly cacheMs;
    private readonly timeoutMs;
    private readonly fetch;
    constructor(options: IdentityClientOptions);
    introspect(token: string, kind?: 'web' | 'mobile'): Promise<Introspection>;
    /** Descarta a entrada em cache. O produto chama isto ao encerrar a sessão. */
    forget(token: string): void;
    /**
     * Autentica e devolve a sessão. O produto guarda o token como preferir — o
     * painel em cookie próprio, o aplicativo em armazenamento seguro. A identidade
     * não emite cookie: cookie é preso a domínio, e produtos em hosts diferentes
     * não o compartilhariam.
     */
    login(body: unknown): Promise<{
        token: string;
        expires_at: string;
        principal: {
            id: string;
            name: string;
            email: string;
            tenant_id: string;
            tenant_name: string;
            site_id: string;
            site_name: string;
            timezone: string;
            role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
            must_change_password: boolean;
        };
    }>;
    mobileLogin(body: unknown): Promise<{
        token: string;
        expires_at: string;
        principal: {
            id: string;
            name: string;
            email: string;
            tenant_id: string;
            tenant_name: string;
            site_id: string;
            site_name: string;
            timezone: string;
            role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
            must_change_password: boolean;
        };
    }>;
    logout(token: string): Promise<void>;
    sites(token: string): Promise<{
        id: string;
        name: string;
        city: string;
    }[]>;
    switchSite(token: string, body: unknown): Promise<{
        token: string;
        expires_at: string;
        principal: {
            id: string;
            name: string;
            email: string;
            tenant_id: string;
            tenant_name: string;
            site_id: string;
            site_name: string;
            timezone: string;
            role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
            must_change_password: boolean;
        };
    }>;
    changePassword(token: string, body: unknown): Promise<{
        ok: boolean;
    }>;
    /** Quadro de pessoas da empresa da sessão, para o produto projetar. */
    roster(token: string): Promise<{
        generated_at: string;
        people: {
            id: string;
            name: string;
            email: string;
            active: boolean;
            role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
            membership_active: boolean;
            site_ids: string[];
        }[];
        sites: {
            id: string;
            name: string;
            city: string;
            timezone: string;
        }[];
    }>;
    accounts(token: string): Promise<{
        users: {
            id: string;
            name: string;
            email: string;
            must_change_password: boolean;
            role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
            active: boolean;
            site_ids: string[];
        }[];
        sites: {
            id: string;
            name: string;
            city: string;
        }[];
    }>;
    createAccount(token: string, body: unknown): Promise<{
        id: string;
        email: string;
        name: string;
        role: "admin" | "manager" | "technician" | "operator" | "storekeeper" | "viewer";
        temporary_password: string | null;
    }>;
    updateAccount(token: string, id: string, body: unknown): Promise<{
        ok: boolean;
    }>;
    resetAccountPassword(token: string, id: string): Promise<{
        id: string;
        temporary_password: string;
    }>;
    /**
     * A introspecção nunca recusa um token com 4xx — token inválido é `active:false`
     * em 200. Então qualquer 4xx aqui é problema do produto, tipicamente credencial
     * de serviço errada, e precisa falhar fechado como indisponibilidade.
     *
     * Deixar a recusa atravessar seria desastroso: o produto repassaria 401 ao
     * navegador e um erro de configuração no deploy deslogaria todo mundo de uma
     * vez, em vez de devolver indisponibilidade enquanto alguém conserta.
     */
    private ask;
    /**
     * Um único ponto de rede. A distinção que ele preserva é a que importa: 4xx é
     * recusa da identidade e atravessa com o código e a mensagem originais, que já
     * estão em português; qualquer outra coisa é indisponibilidade e falha fechado.
     * Tratar as duas igual deslogaria todo mundo durante uma queda do serviço.
     */
    private call;
}
//# sourceMappingURL=identity.d.ts.map