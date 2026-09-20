import { z } from 'zod';
import { idSchema, roles, type Role } from '../index.js';

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

/** Sessão emitida pela identidade. O produto guarda o token como preferir. */
export type IssuedSession = { token: string; expires_at: string; principal: Principal };
export const issuedSessionSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  principal: principalSchema,
});

/**
 * Quadro de pessoas de uma empresa, para o produto manter projeção local.
 *
 * A projeção existe para o produto cruzar nome de responsável e listar a equipe
 * sem um salto de rede por linha, e para as chaves estrangeiras de histórico
 * continuarem valendo. Ela **não é fonte de verdade de acesso**: quem decide se
 * alguém entra é a introspecção, que acontece a cada requisição. Projeção
 * atrasada não abre porta; ela apenas deixa de fechar uma que já está fechada.
 */
export const rosterSchema = z.object({
  generated_at: z.string(),
  people: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      email: z.string(),
      active: z.boolean(),
      role: z.enum(roles),
      membership_active: z.boolean(),
      site_ids: z.array(idSchema),
    }),
  ),
  sites: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      city: z.string(),
      timezone: z.string(),
    }),
  ),
});
export type Roster = z.infer<typeof rosterSchema>;

/** Conta criada. A senha temporária vem uma única vez e não é recuperável. */
export const accountCreatedSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  role: z.enum(roles),
  temporary_password: z.string().nullable(),
});
export type AccountCreated = z.infer<typeof accountCreatedSchema>;

export const accountListSchema = z.object({
  users: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      email: z.string(),
      must_change_password: z.boolean(),
      role: z.enum(roles),
      active: z.boolean(),
      site_ids: z.array(idSchema),
    }),
  ),
  sites: z.array(z.object({ id: idSchema, name: z.string(), city: z.string() })),
});
export type AccountList = z.infer<typeof accountListSchema>;

export const siteListSchema = z.array(
  z.object({ id: idSchema, name: z.string(), city: z.string() }),
);

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

const okSchema = z.object({ ok: z.boolean() });
const resetSchema = z.object({ id: idSchema, temporary_password: z.string() });

type Entry = { until: number; value: Extract<Introspection, { active: true }> };

export class IdentityUnavailableError extends Error {
  constructor(cause: unknown) {
    super('O serviço de identidade não respondeu.');
    this.name = 'IdentityUnavailableError';
    this.cause = cause;
  }
}

/**
 * Recusa da identidade: credencial inválida, senha errada, papel insuficiente.
 * Carrega o código e a mensagem originais para o produto repassá-los sem
 * reescrever regra que não é dele.
 */
export class IdentityRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "IdentityRejectedError";
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

  /**
   * Autentica e devolve a sessão. O produto guarda o token como preferir — o
   * painel em cookie próprio, o aplicativo em armazenamento seguro. A identidade
   * não emite cookie: cookie é preso a domínio, e produtos em hosts diferentes
   * não o compartilhariam.
   */
  login(body: unknown) {
    return this.call('/api/auth/login', issuedSessionSchema, { method: 'POST', body });
  }
  mobileLogin(body: unknown) {
    return this.call('/api/auth/mobile/login', issuedSessionSchema, { method: 'POST', body });
  }
  async logout(token: string) {
    this.forget(token);
    await this.call('/api/auth/logout', okSchema, { method: 'POST', session: token });
  }
  sites(token: string) {
    return this.call('/api/sites', siteListSchema, { method: 'GET', session: token });
  }
  async switchSite(token: string, body: unknown) {
    const issued = await this.call('/api/auth/site', issuedSessionSchema, {
      method: 'POST',
      body,
      session: token,
    });
    // A sessão anterior foi revogada do outro lado; manter a entrada em cache
    // deixaria o token morto valendo pela janela inteira.
    this.forget(token);
    return issued;
  }
  async changePassword(token: string, body: unknown) {
    const result = await this.call('/api/auth/password', okSchema, {
      method: 'POST',
      body,
      session: token,
    });
    // `must_change_password` mudou; o contexto em cache está desatualizado.
    this.forget(token);
    return result;
  }

  /** Quadro de pessoas da empresa da sessão, para o produto projetar. */
  roster(token: string) {
    return this.call('/api/roster', rosterSchema, { method: 'GET', session: token });
  }
  accounts(token: string) {
    return this.call('/api/users', accountListSchema, { method: 'GET', session: token });
  }
  createAccount(token: string, body: unknown) {
    return this.call('/api/users', accountCreatedSchema, { method: 'POST', body, session: token });
  }
  async updateAccount(token: string, id: string, body: unknown) {
    const result = await this.call('/api/users/' + encodeURIComponent(id), okSchema, {
      method: 'POST',
      body,
      session: token,
    });
    // Mudar papel ou unidades encerra as sessões da pessoa alterada. O cache
    // desta instância é por token, então não há o que invalidar aqui — mas o
    // produto precisa reprojetar, e é por isso que isto devolve em vez de void.
    return result;
  }
  resetAccountPassword(token: string, id: string) {
    return this.call(
      '/api/users/' + encodeURIComponent(id) + '/password',
      resetSchema,
      { method: 'POST', session: token },
    );
  }

  /**
   * A introspecção nunca recusa um token com 4xx — token inválido é `active:false`
   * em 200. Então qualquer 4xx aqui é problema do produto, tipicamente credencial
   * de serviço errada, e precisa falhar fechado como indisponibilidade.
   *
   * Deixar a recusa atravessar seria desastroso: o produto repassaria 401 ao
   * navegador e um erro de configuração no deploy deslogaria todo mundo de uma
   * vez, em vez de devolver indisponibilidade enquanto alguém conserta.
   */
  private async ask(token: string, kind: 'web' | 'mobile'): Promise<Introspection> {
    try {
      return await this.call('/api/introspect', introspectionSchema, {
        method: 'POST',
        body: { token, kind },
      });
    } catch (error) {
      if (error instanceof IdentityRejectedError) throw new IdentityUnavailableError(error);
      throw error;
    }
  }

  /**
   * Um único ponto de rede. A distinção que ele preserva é a que importa: 4xx é
   * recusa da identidade e atravessa com o código e a mensagem originais, que já
   * estão em português; qualquer outra coisa é indisponibilidade e falha fechado.
   * Tratar as duas igual deslogaria todo mundo durante uma queda do serviço.
   */
  private async call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method: 'GET' | 'POST'; body?: unknown; session?: string; kind?: 'web' | 'mobile' },
  ): Promise<T> {
    const headers: Record<string, string> = {
      'x-pulso-client': this.options.clientId,
      authorization: 'Bearer ' + this.options.clientSecret,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.session) headers['x-pulso-session'] = init.session;
    if (init.kind) headers['x-pulso-session-kind'] = init.kind;
    let response: Response;
    try {
      response = await this.fetch(this.options.baseUrl.replace(/\/+$/, '') + path, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new IdentityUnavailableError(error);
    }
    if (response.status >= 400 && response.status < 500) {
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        issues?: { field: string; message: string }[];
      };
      // A identidade marca a falha da credencial do produto. Ela não é recusa do
      // usuário: ninguém acerta a senha se o produto não consegue nem perguntar.
      if (payload.code === 'service_credential')
        throw new IdentityUnavailableError(new Error(payload.message ?? 'credencial de serviço'));
      throw new IdentityRejectedError(
        response.status,
        payload.message ?? 'Não foi possível concluir a operação.',
        payload.issues,
      );
    }
    if (!response.ok) throw new IdentityUnavailableError(new Error('HTTP ' + response.status));
    return schema.parse(await response.json());
  }
}
