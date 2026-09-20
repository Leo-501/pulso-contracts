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
    private ask;
}
//# sourceMappingURL=identity.d.ts.map