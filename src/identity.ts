import { z } from 'zod';
import { idSchema, roles, type Role } from './index.js';

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
export type Introspection =
  | { active: false }
  | { active: true; principal: Principal; expires_at: string };

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
export const introspectionSchema: z.ZodType<Introspection> = z.union([
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

type Entry = { until: number; value: Extract<Introspection, { active: true }> };

export class IdentityUnavailableError extends Error {
  constructor(cause: unknown) {
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
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Introspection>>();
  private readonly cacheMs: number;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: IdentityClientOptions) {
    this.cacheMs = options.cacheMs ?? 5_000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async introspect(token: string, kind: 'web' | 'mobile' = 'web'): Promise<Introspection> {
    const key = kind + ':' + token;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.value;
    if (hit) this.cache.delete(key);
    // Requisições simultâneas com o mesmo token compartilham um único envio:
    // sem isso, uma rajada de chamadas do mesmo cliente vira uma rajada igual
    // contra a identidade.
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
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
  forget(token: string) {
    for (const kind of ['web', 'mobile']) this.cache.delete(kind + ':' + token);
  }

  private async ask(token: string, kind: 'web' | 'mobile'): Promise<Introspection> {
    let response: Response;
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
    } catch (error) {
      throw new IdentityUnavailableError(error);
    }
    if (!response.ok) throw new IdentityUnavailableError(new Error('HTTP ' + response.status));
    return introspectionSchema.parse(await response.json());
  }
}
