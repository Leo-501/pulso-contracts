import { z } from 'zod';
import { idSchema, roles } from './index.js';
// Contrato entre o serviço de identidade (`pulso-identity`) e os produtos que
// dependem dele. O token da sessão é opaco de propósito: o produto não o
// interpreta, ele pergunta. É isso que preserva a revogação — uma sessão
// encerrada para de valer sem esperar prazo de expiração de token assinado.
export const introspectionRequestSchema = z
    .object({
    token: z.string().min(1).max(512),
    kind: z.enum(['web', 'mobile']).default('web'),
})
    .strict();
const principalSchema = z.object({
    id: idSchema,
    name: z.string(),
    email: z.string(),
    tenant_id: idSchema,
    tenant_name: z.string(),
    site_id: idSchema,
    site_name: z.string(),
    timezone: z.string(),
    role: z.enum(roles),
    must_change_password: z.boolean(),
});
export const introspectionSchema = z.union([
    // Estrita: nada acompanha uma negativa. Principal junto de `active:false`
    // indica serviço confuso, e aceitar isso seria aceitar um estado impossível.
    z.object({ active: z.literal(false) }).strict(),
    // Tolerante: campo novo aqui é mudança aditiva, e um consumidor antigo precisa
    // continuar funcionando quando a identidade for implantada antes dele.
    z.object({
        active: z.literal(true),
        principal: principalSchema,
        expires_at: z.string(),
    }),
]);
export class IdentityUnavailableError extends Error {
    constructor(cause) {
        super('O serviço de identidade não respondeu.');
        this.name = 'IdentityUnavailableError';
        this.cause = cause;
    }
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
export class IdentityClient {
    options;
    cache = new Map();
    pending = new Map();
    cacheMs;
    timeoutMs;
    fetch;
    constructor(options) {
        this.options = options;
        this.cacheMs = options.cacheMs ?? 5_000;
        this.timeoutMs = options.timeoutMs ?? 3_000;
        this.fetch = options.fetch ?? globalThis.fetch;
    }
    async introspect(token, kind = 'web') {
        const key = kind + ':' + token;
        const now = Date.now();
        const hit = this.cache.get(key);
        if (hit && hit.until > now)
            return hit.value;
        if (hit)
            this.cache.delete(key);
        // Requisições simultâneas com o mesmo token compartilham um único envio:
        // sem isso, uma rajada de chamadas do mesmo cliente vira uma rajada igual
        // contra a identidade.
        const inflight = this.pending.get(key);
        if (inflight)
            return inflight;
        const promise = this.ask(token, kind)
            .then((result) => {
            if (result.active && this.cacheMs > 0)
                this.cache.set(key, { until: Date.now() + this.cacheMs, value: result });
            return result;
        })
            .finally(() => this.pending.delete(key));
        this.pending.set(key, promise);
        return promise;
    }
    /** Descarta a entrada em cache. O produto chama isto ao encerrar a sessão. */
    forget(token) {
        for (const kind of ['web', 'mobile'])
            this.cache.delete(kind + ':' + token);
    }
    async ask(token, kind) {
        let response;
        try {
            response = await this.fetch(this.options.baseUrl.replace(/\/+$/, '') + '/api/introspect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-pulso-client': this.options.clientId,
                    authorization: 'Bearer ' + this.options.clientSecret,
                },
                body: JSON.stringify({ token, kind }),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
            throw new IdentityUnavailableError(error);
        }
        if (!response.ok)
            throw new IdentityUnavailableError(new Error('HTTP ' + response.status));
        return introspectionSchema.parse(await response.json());
    }
}
//# sourceMappingURL=identity.js.map