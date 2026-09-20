import {
  loginSchema,
  membershipSchema,
  passwordSchema,
  siteSchema,
  userSchema,
  type Role,
} from '../index.js';
import { mobileLoginSchema } from '../mobile.js';

/**
 * Identidade de mentira, em memória, para a suíte de um produto.
 *
 * Ela é um `fetch`, não um cliente: quem estiver sendo testado usa o
 * `IdentityClient` de verdade, com o cache, o envio compartilhado e a falha
 * fechada reais. Só o outro lado da rede é simulado.
 *
 * Existe porque a alternativa — cada produto subir o serviço de identidade na
 * própria suíte — obrigaria a depender do repositório dele, que é privado, e a
 * empilhar dependência git dentro de dependência git, o que o pnpm recusa.
 *
 * A fidelidade não é promessa: é verificada. A bateria `identityConformance`
 * roda contra este duplo e contra o serviço de verdade, e uma divergência
 * derruba um dos dois.
 */

export * from './conformance.js';

const uuid = () => globalThis.crypto.randomUUID();
const SESSION_MS = 8 * 3_600_000;

export type StubTenantSpec = {
  slug: string;
  name: string;
  sites: { name: string; city?: string; timezone?: string }[];
};
export type StubPersonSpec = {
  email: string;
  name: string;
  password: string;
  active?: boolean;
  must_change_password?: boolean;
  memberships: { tenant: string; role: Role; sites?: string[]; active?: boolean }[];
};
export type StubSpec = {
  client?: { id: string; secret: string };
  tenants: StubTenantSpec[];
  people: StubPersonSpec[];
};

type Site = { id: string; name: string; city: string; timezone: string; tenant_id: string };
type Tenant = { id: string; slug: string; name: string };
type Membership = { role: Role; active: boolean; sites: Set<string> };
type Person = {
  id: string;
  email: string;
  name: string;
  password: string;
  active: boolean;
  must_change_password: boolean;
  memberships: Map<string, Membership>;
};
type Session = {
  token: string;
  user: string;
  tenant: string;
  site: string;
  kind: 'web' | 'mobile';
  expires: number;
};

export type IdentityStub = {
  /** Passe para `new IdentityClient({ fetch })`. */
  fetch: typeof globalThis.fetch;
  client: { id: string; secret: string };
  tenantId(slug: string): string;
  siteId(slug: string, site: string): string;
  userId(email: string): string;
  /** Rotas pedidas, na ordem, para o teste conferir que o produto não fala demais. */
  calls: { method: string; path: string }[];
  /** Adianta o relógio das sessões, para exercitar expiração sem esperar. */
  expireAll(): void;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function createIdentityStub(spec: StubSpec): IdentityStub {
  const client = spec.client ?? { id: 'produto', secret: 'segredo-de-teste' };
  const tenants = new Map<string, Tenant>();
  const sites = new Map<string, Site>();
  const people = new Map<string, Person>();
  const sessions = new Map<string, Session>();
  const calls: { method: string; path: string }[] = [];
  // Mesmo limite do serviço: sem ele, o duplo seria mais permissivo que a
  // produção e um teste de força bruta passaria aqui e falharia lá.
  const attempts = new Map<string, number>();

  for (const t of spec.tenants) {
    const tenant: Tenant = { id: uuid(), slug: t.slug, name: t.name };
    tenants.set(t.slug, tenant);
    for (const s of t.sites)
      sites.set(t.slug + '/' + s.name, {
        id: uuid(),
        name: s.name,
        city: s.city ?? 'Cidade',
        timezone: s.timezone ?? 'America/Sao_Paulo',
        tenant_id: tenant.id,
      });
  }
  for (const p of spec.people) {
    const person: Person = {
      id: uuid(),
      email: p.email.toLowerCase(),
      name: p.name,
      password: p.password,
      active: p.active ?? true,
      must_change_password: p.must_change_password ?? false,
      memberships: new Map(),
    };
    for (const m of p.memberships) {
      const tenant = tenants.get(m.tenant);
      if (!tenant) throw new Error(`empresa desconhecida no duplo: ${m.tenant}`);
      const nomes = m.sites ?? spec.tenants.find((t) => t.slug === m.tenant)!.sites.map((s) => s.name);
      person.memberships.set(tenant.id, {
        role: m.role,
        active: m.active ?? true,
        sites: new Set(nomes.map((n) => sites.get(m.tenant + '/' + n)!.id)),
      });
    }
    people.set(person.email, person);
  }

  const byId = (id: string) => [...people.values()].find((p) => p.id === id);
  const siteById = (id: string) => [...sites.values()].find((s) => s.id === id);
  const tenantById = (id: string) => [...tenants.values()].find((t) => t.id === id);

  /** Unidade de entrada: a primeira em ordem alfabética, nunca a de menor uuid. */
  const landing = (membership: Membership) =>
    [...membership.sites]
      .map((id) => siteById(id)!)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];

  const principalOf = (session: Session) => {
    const person = byId(session.user)!;
    const membership = person.memberships.get(session.tenant)!;
    const site = siteById(session.site)!;
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      tenant_id: session.tenant,
      tenant_name: tenantById(session.tenant)!.name,
      site_id: site.id,
      site_name: site.name,
      timezone: site.timezone,
      role: membership.role,
      must_change_password: person.must_change_password,
    };
  };

  /** Mesma verificação que a resolução do serviço faz a cada pergunta. */
  const alive = (session: Session | undefined, kind: 'web' | 'mobile') => {
    if (!session || session.kind !== kind || session.expires <= Date.now()) return undefined;
    const person = byId(session.user);
    const membership = person?.memberships.get(session.tenant);
    if (!person?.active || !membership?.active) return undefined;
    if (!membership.sites.has(session.site)) return undefined;
    return session;
  };

  const issue = (person: Person, tenant: string, site: string, kind: 'web' | 'mobile') => {
    const session: Session = {
      token: [...Array(8)].map(() => uuid().replace(/-/g, '')).join('').slice(0, 64),
      user: person.id,
      tenant,
      site,
      kind,
      expires: Date.now() + SESSION_MS,
    };
    sessions.set(session.token, session);
    return {
      token: session.token,
      expires_at: new Date(session.expires).toISOString(),
      principal: principalOf(session),
    };
  };

  function authenticate(body: unknown, mobile: boolean) {
    const data = mobile ? mobileLoginSchema.parse(body) : loginSchema.parse(body);
    const key = `${data.company}:${data.email.toLowerCase()}`;
    const used = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, used);
    if (used > 10) throw new HttpError(403, 'Muitas tentativas. Aguarde 15 minutos.');
    const tenant = tenants.get(data.company);
    const person = people.get(data.email.toLowerCase());
    const membership = tenant && person?.memberships.get(tenant.id);
    // Empresa errada e senha errada dão a mesma resposta: distinguir vazaria a
    // existência da conta.
    if (!tenant || !person || !membership || !person.active || !membership.active)
      throw new HttpError(401, 'Empresa, e-mail ou senha inválidos.');
    if (person.password !== data.password)
      throw new HttpError(401, 'Empresa, e-mail ou senha inválidos.');
    if (mobile && !['technician', 'operator'].includes(membership.role))
      throw new HttpError(
        403,
        'Este aplicativo atende técnicos e solicitantes. Use o painel para os demais perfis.',
      );
    attempts.delete(key);
    return issue(person, tenant.id, landing(membership).id, mobile ? 'mobile' : 'web');
  }

  function sessionOf(headers: Headers) {
    const token = headers.get('x-pulso-session') ?? '';
    const kind = headers.get('x-pulso-session-kind') === 'mobile' ? 'mobile' : 'web';
    const session = alive(sessions.get(token), kind);
    if (!session) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    return session;
  }

  function admin(session: Session) {
    const principal = principalOf(session);
    if (principal.must_change_password)
      throw new HttpError(403, 'Defina uma nova senha antes de continuar.');
    if (principal.role !== 'admin')
      throw new HttpError(403, 'Esta ação exige um administrador da empresa.');
    return principal;
  }

  /** Um administrador só concede as unidades em que ele próprio atua. */
  function authorizedSites(session: Session, ids: string[]) {
    const minhas = byId(session.user)!.memberships.get(session.tenant)!.sites;
    if (!ids.every((id) => minhas.has(id)))
      throw new HttpError(400, 'Só é possível conceder acesso às unidades em que você atua.');
  }

  const temporary = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = [...Array(12)].map(() => Math.floor(Math.random() * 256));
    return (
      bytes.slice(0, 10).map((b) => alphabet[b % alphabet.length]).join('') +
      String(bytes[10] % 10) +
      String(bytes[11] % 10)
    );
  };

  const killSessions = (userId: string, tenant?: string, keep?: string) => {
    for (const [token, s] of sessions)
      if (s.user === userId && (tenant === undefined || s.tenant === tenant) && token !== keep)
        sessions.delete(token);
  };

  const membershipsOf = (tenantId: string) =>
    [...people.values()]
      .filter((p) => p.memberships.has(tenantId))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  function route(method: string, path: string, body: any, headers: Headers): unknown {
    if (method === 'POST' && path === '/api/introspect') {
      const kind = body?.kind === 'mobile' ? 'mobile' : 'web';
      const session = alive(sessions.get(String(body?.token ?? '')), kind);
      // Sempre 200. Token inválido é `active:false`, nunca erro: distinguir por
      // código transformaria a rota em oráculo para quem tivesse a credencial.
      if (!session) return { active: false };
      return {
        active: true,
        principal: principalOf(session),
        expires_at: new Date(session.expires).toISOString(),
      };
    }
    if (method === 'POST' && path === '/api/auth/login') return authenticate(body, false);
    if (method === 'POST' && path === '/api/auth/mobile/login') return authenticate(body, true);
    if (method === 'POST' && path === '/api/auth/logout') {
      sessions.delete(headers.get('x-pulso-session') ?? '');
      return { ok: true };
    }

    const session = sessionOf(headers);

    if (method === 'GET' && path === '/api/sites') {
      const membership = byId(session.user)!.memberships.get(session.tenant)!;
      return [...membership.sites]
        .map((id) => siteById(id)!)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, city: s.city }));
    }
    if (method === 'POST' && path === '/api/auth/site') {
      const { site_id } = siteSchema.parse(body);
      const person = byId(session.user)!;
      if (!person.memberships.get(session.tenant)!.sites.has(site_id))
        throw new HttpError(403, 'Você não tem acesso a esta unidade.');
      const issued = issue(person, session.tenant, site_id, 'web');
      // A anterior é revogada: um token antigo que continuasse valendo carregaria
      // o escopo da unidade de antes.
      sessions.delete(session.token);
      return issued;
    }
    if (method === 'POST' && path === '/api/auth/password') {
      const data = passwordSchema.parse(body);
      const person = byId(session.user)!;
      if (person.password !== data.current) throw new HttpError(401, 'Senha atual incorreta.');
      person.password = data.next;
      person.must_change_password = false;
      killSessions(person.id, undefined, session.token);
      return { ok: true };
    }
    if (method === 'GET' && path === '/api/roster') {
      return {
        generated_at: new Date().toISOString(),
        // Quem tem vínculo inativo continua vindo: sumir com a linha quebraria o
        // cruzamento de nome no histórico de quem já saiu.
        people: membershipsOf(session.tenant).map((p) => {
          const m = p.memberships.get(session.tenant)!;
          return {
            id: p.id,
            name: p.name,
            email: p.email,
            active: p.active,
            role: m.role,
            membership_active: m.active,
            site_ids: [...m.sites].sort(),
          };
        }),
        sites: [...sites.values()]
          .filter((s) => s.tenant_id === session.tenant)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name, city: s.city, timezone: s.timezone })),
      };
    }

    if (method === 'GET' && path === '/api/users') {
      admin(session);
      return {
        users: membershipsOf(session.tenant)
          .filter((p) => p.active)
          .map((p) => {
            const m = p.memberships.get(session.tenant)!;
            return {
              id: p.id,
              name: p.name,
              email: p.email,
              must_change_password: p.must_change_password,
              role: m.role,
              active: m.active,
              site_ids: [...m.sites].sort(),
            };
          }),
        sites: [...byId(session.user)!.memberships.get(session.tenant)!.sites]
          .map((id) => siteById(id)!)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name, city: s.city })),
      };
    }
    if (method === 'POST' && path === '/api/users') {
      admin(session);
      const data = userSchema.parse(body);
      authorizedSites(session, data.site_ids);
      const email = data.email.toLowerCase();
      const existing = people.get(email);
      if (existing?.memberships.has(session.tenant))
        throw new HttpError(409, 'Esta pessoa já tem acesso a esta empresa.');
      const password = temporary();
      // Quem já usa o portfólio noutra empresa mantém a senha que tem; devolver
      // uma temporária aqui invalidaria o acesso que ela já usa.
      const person: Person =
        existing ??
        {
          id: uuid(),
          email,
          name: data.name,
          password,
          active: true,
          must_change_password: true,
          memberships: new Map(),
        };
      person.memberships.set(session.tenant, {
        role: data.role,
        active: true,
        sites: new Set(data.site_ids),
      });
      people.set(email, person);
      return {
        id: person.id,
        email,
        name: person.name,
        role: data.role,
        temporary_password: existing ? null : password,
      };
    }
    const alvo = /^\/api\/users\/([^/]+)(\/password)?$/.exec(path);
    if (method === 'POST' && alvo) {
      admin(session);
      const id = decodeURIComponent(alvo[1]);
      const person = byId(id);
      const membership = person?.memberships.get(session.tenant);
      if (!person || !membership) throw new HttpError(404, 'Vínculo não encontrado nesta empresa.');
      if (alvo[2]) {
        const password = temporary();
        person.password = password;
        person.must_change_password = true;
        killSessions(person.id);
        return { id, temporary_password: password };
      }
      const data = membershipSchema.parse(body);
      if (!Object.keys(data).length) throw new HttpError(400, 'Informe o que deve mudar.');
      if (id === session.user && (data.active === false || (data.role && data.role !== 'admin')))
        throw new HttpError(400, 'Você não pode remover o próprio acesso de administrador.');
      if (data.role !== undefined) membership.role = data.role;
      if (data.active !== undefined) membership.active = data.active;
      if (data.site_ids) {
        authorizedSites(session, data.site_ids);
        membership.sites = new Set(data.site_ids);
      }
      killSessions(person.id, session.tenant);
      return { ok: true };
    }
    throw new HttpError(404, 'Rota inexistente na identidade de teste: ' + method + ' ' + path);
  }

  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? {});
    calls.push({ method, path: url.pathname });
    // Nenhuma rota é anônima. Esta falha não é recusa do usuário: ninguém acerta a
    // senha se o produto não consegue nem perguntar, e por isso ela vem marcada.
    if (
      headers.get('x-pulso-client') !== client.id ||
      headers.get('authorization') !== 'Bearer ' + client.secret
    )
      return json(401, { message: 'Credencial de serviço inválida.', code: 'service_credential' });
    let body: any;
    if (init.body !== undefined) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return json(400, { message: 'Confira os campos informados.' });
      }
    }
    try {
      return json(method === 'POST' ? 201 : 200, route(method, url.pathname, body, headers));
    } catch (error: any) {
      if (error instanceof HttpError)
        return json(error.status, { message: error.message, ...error.extra });
      if (error?.issues)
        return json(400, {
          message: 'Confira os campos informados.',
          issues: error.issues.map((i: any) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      return json(500, { message: 'Falha na identidade de teste: ' + error?.message });
    }
  }) as unknown as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    client,
    calls,
    tenantId: (slug) => tenants.get(slug)!.id,
    siteId: (slug, site) => sites.get(slug + '/' + site)!.id,
    userId: (email) => people.get(email.toLowerCase())!.id,
    expireAll: () => {
      for (const s of sessions.values()) s.expires = Date.now() - 1;
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
