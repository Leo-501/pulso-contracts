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

export type ConformanceResponse = { status: number; data: any };
export type ConformanceTarget = {
  /** Chamada crua, já com a credencial de serviço válida aplicada. */
  call(
    method: 'GET' | 'POST',
    path: string,
    options?: { body?: unknown; session?: string; kind?: 'web' | 'mobile' },
  ): Promise<ConformanceResponse>;
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

export type ConformanceCheck = { name: string; run(target: ConformanceTarget): Promise<void> };

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('conformidade: ' + message);
}
const eq = (actual: unknown, expected: unknown, what: string) =>
  ok(actual === expected, `${what}: esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);

const novoEmail = () => `conformidade-${globalThis.crypto.randomUUID().slice(0, 8)}@demo.local`;

async function entrar(t: ConformanceTarget, email: string, password?: string, company?: string) {
  return t.call('POST', '/api/auth/login', {
    body: {
      company: company ?? t.fixtures.company,
      email,
      password: password ?? t.fixtures.password,
    },
  });
}
const introspectar = (t: ConformanceTarget, token: string, kind: 'web' | 'mobile' = 'web') =>
  t.call('POST', '/api/introspect', { body: { token, kind } });

/** Cria uma conta descartável e devolve a sessão dela já com senha definitiva. */
async function contaNova(t: ConformanceTarget, admin: string, over: Record<string, unknown> = {}) {
  const sites = (await t.call('GET', '/api/users', { session: admin })).data.sites;
  const criada = await t.call('POST', '/api/users', {
    session: admin,
    body: {
      name: 'Pessoa de Conformidade',
      email: novoEmail(),
      role: 'technician',
      site_ids: [sites[0].id],
      ...over,
    },
  });
  ok(criada.status < 300, 'criar conta descartável deveria funcionar: ' + JSON.stringify(criada.data));
  return criada.data as { id: string; email: string; temporary_password: string };
}

export const identityConformance: ConformanceCheck[] = [
  {
    name: 'nenhuma rota atende sem credencial de serviço, e a falha vem marcada',
    async run(t) {
      const sem = await t.callSemCredencial('/api/introspect', { token: 'qualquer' });
      eq(sem.status, 401, 'status sem credencial');
      // O marcador é o que impede o produto de repassar 401 ao navegador e
      // deslogar todo mundo por causa de um erro de configuração.
      eq(sem.data?.code, 'service_credential', 'código da falha de credencial');
    },
  },
  {
    name: 'login devolve token e contexto resolvido',
    async run(t) {
      const sessao = await entrar(t, t.fixtures.admin);
      ok(sessao.status < 300, 'login do administrador deveria funcionar');
      ok(typeof sessao.data.token === 'string' && sessao.data.token.length >= 32, 'token opaco');
      eq(sessao.data.principal.email, t.fixtures.admin, 'e-mail no principal');
      eq(sessao.data.principal.role, 'admin', 'papel no principal');
      ok(sessao.data.principal.site_name, 'unidade resolvida');
      ok(Date.parse(sessao.data.expires_at) > Date.now(), 'validade no futuro');
    },
  },
  {
    name: 'senha errada e empresa errada dão a mesma recusa',
    async run(t) {
      const senha = await entrar(t, t.fixtures.admin, 'senha-errada-de-proposito');
      eq(senha.status, 401, 'status da senha errada');
      const empresa = await entrar(t, t.fixtures.admin, undefined, 'empresa-que-nao-existe');
      eq(empresa.status, 401, 'status da empresa errada');
      eq(empresa.data.message, senha.data.message, 'as duas mensagens precisam ser iguais');
    },
  },
  {
    name: 'a unidade de entrada é a mesma em toda entrada',
    async run(t) {
      // Ordenar por uuid sorteava a unidade de quem tem mais de uma. O defeito só
      // aparece em repetição, então a verificação repete.
      const vistas = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const sessao = await entrar(t, t.fixtures.duasUnidades);
        ok(sessao.status < 300, 'login de quem tem duas unidades');
        vistas.add(sessao.data.principal.site_id);
      }
      eq(vistas.size, 1, 'unidades de entrada distintas em três logins');
    },
  },
  {
    name: 'introspecção devolve o contexto e nunca o token',
    async run(t) {
      const sessao = await entrar(t, t.fixtures.admin);
      const resposta = await introspectar(t, sessao.data.token);
      eq(resposta.status < 300, true, 'introspecção responde sucesso');
      eq(resposta.data.active, true, 'sessão viva');
      eq(resposta.data.principal.id, sessao.data.principal.id, 'mesma pessoa');
      ok(!JSON.stringify(resposta.data).includes(sessao.data.token), 'o token não pode voltar');
    },
  },
  {
    name: 'token inválido é active:false, não erro',
    async run(t) {
      for (const token of ['', 'nao-e-um-token', 'a'.repeat(64)]) {
        const resposta = await introspectar(t, token);
        ok(resposta.status < 400, `token ${JSON.stringify(token)} não pode virar erro`);
        eq(resposta.data.active, false, 'token inválido');
        eq(resposta.data.principal, undefined, 'nada acompanha uma negativa');
      }
    },
  },
  {
    name: 'sessão web não vale como mobile e vice-versa',
    async run(t) {
      const web = await entrar(t, t.fixtures.technician);
      eq((await introspectar(t, web.data.token, 'mobile')).data.active, false, 'web como mobile');
      const mobile = await t.call('POST', '/api/auth/mobile/login', {
        body: {
          company: t.fixtures.company,
          email: t.fixtures.technician,
          password: t.fixtures.password,
          device_id: globalThis.crypto.randomUUID(),
        },
      });
      ok(mobile.status < 300, 'login mobile do técnico');
      eq((await introspectar(t, mobile.data.token, 'web')).data.active, false, 'mobile como web');
      eq((await introspectar(t, mobile.data.token, 'mobile')).data.active, true, 'mobile como mobile');
    },
  },
  {
    name: 'o aplicativo recusa perfis administrativos',
    async run(t) {
      const recusa = await t.call('POST', '/api/auth/mobile/login', {
        body: {
          company: t.fixtures.company,
          email: t.fixtures.admin,
          password: t.fixtures.password,
          device_id: globalThis.crypto.randomUUID(),
        },
      });
      eq(recusa.status, 403, 'administrador no aplicativo');
    },
  },
  {
    name: 'encerrar a sessão a revoga na hora',
    async run(t) {
      const sessao = await entrar(t, t.fixtures.admin);
      eq((await introspectar(t, sessao.data.token)).data.active, true, 'antes do logout');
      await t.call('POST', '/api/auth/logout', { session: sessao.data.token, body: {} });
      eq((await introspectar(t, sessao.data.token)).data.active, false, 'depois do logout');
    },
  },
  {
    name: 'a lista de unidades respeita o vínculo, não a empresa',
    async run(t) {
      const duas = await entrar(t, t.fixtures.duasUnidades);
      const tecnico = await entrar(t, t.fixtures.technician);
      const delas = (await t.call('GET', '/api/sites', { session: duas.data.token })).data;
      const dele = (await t.call('GET', '/api/sites', { session: tecnico.data.token })).data;
      ok(delas.length >= 2, 'quem tem duas unidades precisa ver duas');
      ok(dele.length < delas.length, 'quem tem uma não pode ver as da empresa inteira');
    },
  },
  {
    name: 'trocar de unidade emite sessão nova e revoga a anterior',
    async run(t) {
      const sessao = await entrar(t, t.fixtures.duasUnidades);
      const unidades = (await t.call('GET', '/api/sites', { session: sessao.data.token })).data;
      const outra = unidades.find((s: any) => s.id !== sessao.data.principal.site_id);
      ok(outra, 'precisa haver outra unidade');
      const nova = await t.call('POST', '/api/auth/site', {
        session: sessao.data.token,
        body: { site_id: outra.id },
      });
      ok(nova.status < 300, 'troca de unidade');
      eq(nova.data.principal.site_id, outra.id, 'a unidade nova');
      ok(nova.data.token !== sessao.data.token, 'o token precisa ser outro');
      eq((await introspectar(t, sessao.data.token)).data.active, false, 'a anterior fica revogada');
    },
  },
  {
    name: 'unidade sem vínculo é recusada',
    async run(t) {
      const tecnico = await entrar(t, t.fixtures.technician);
      const duas = await entrar(t, t.fixtures.duasUnidades);
      const dele = (await t.call('GET', '/api/sites', { session: tecnico.data.token })).data;
      const delas = (await t.call('GET', '/api/sites', { session: duas.data.token })).data;
      const semVinculo = delas.find((s: any) => !dele.some((d: any) => d.id === s.id));
      ok(semVinculo, 'precisa haver unidade fora do vínculo do técnico');
      const recusa = await t.call('POST', '/api/auth/site', {
        session: tecnico.data.token,
        body: { site_id: semVinculo.id },
      });
      eq(recusa.status, 403, 'unidade fora do vínculo');
    },
  },
  {
    name: 'trocar a senha encerra as outras sessões e preserva a atual',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const conta = await contaNova(t, admin);
      const primeira = (await entrar(t, conta.email, conta.temporary_password)).data.token;
      const segunda = (await entrar(t, conta.email, conta.temporary_password)).data.token;
      const nova = 'Conformidade@2026!';
      const troca = await t.call('POST', '/api/auth/password', {
        session: segunda,
        body: { current: conta.temporary_password, next: nova },
      });
      ok(troca.status < 300, 'troca de senha: ' + JSON.stringify(troca.data));
      eq((await introspectar(t, primeira)).data.active, false, 'a outra sessão cai');
      eq((await introspectar(t, segunda)).data.active, true, 'a atual permanece');
      eq(
        (await introspectar(t, segunda)).data.principal.must_change_password,
        false,
        'a exigência de troca some',
      );
      ok((await entrar(t, conta.email, nova)).status < 300, 'a senha nova entra');
      eq((await entrar(t, conta.email, conta.temporary_password)).status, 401, 'a antiga não');
    },
  },
  {
    name: 'o quadro traz as pessoas e as unidades da empresa',
    async run(t) {
      const sessao = (await entrar(t, t.fixtures.admin)).data.token;
      const quadro = await t.call('GET', '/api/roster', { session: sessao });
      ok(quadro.status < 300, 'quadro de pessoas');
      ok(Date.parse(quadro.data.generated_at) > 0, 'data de geração');
      ok(quadro.data.sites.length >= 2, 'as unidades da empresa, não as do vínculo');
      ok(
        quadro.data.sites.every((s: any) => s.timezone),
        'cada unidade precisa do fuso, que o produto projeta',
      );
      const eu = quadro.data.people.find((p: any) => p.email === t.fixtures.admin);
      ok(eu, 'o administrador precisa aparecer no quadro');
      eq(eu.membership_active, true, 'vínculo ativo');
      ok(eu.site_ids.length >= 1, 'unidades do vínculo');
    },
  },
  {
    name: 'o quadro conserva quem teve o vínculo desativado',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const conta = await contaNova(t, admin);
      await t.call('POST', `/api/users/${conta.id}`, { session: admin, body: { active: false } });
      const quadro = await t.call('GET', '/api/roster', { session: admin });
      const pessoa = quadro.data.people.find((p: any) => p.id === conta.id);
      // Sumir com a linha quebraria o cruzamento de nome no histórico de quem saiu.
      ok(pessoa, 'quem saiu precisa continuar no quadro');
      eq(pessoa.membership_active, false, 'marcado como inativo');
    },
  },
  {
    name: 'contas são do administrador',
    async run(t) {
      const tecnico = (await entrar(t, t.fixtures.technician)).data.token;
      eq((await t.call('GET', '/api/users', { session: tecnico })).status, 403, 'técnico listando');
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      ok((await t.call('GET', '/api/users', { session: admin })).status < 300, 'admin listando');
    },
  },
  {
    name: 'a senha temporária vem uma vez e repetir o vínculo dá 409',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const sites = (await t.call('GET', '/api/users', { session: admin })).data.sites;
      const corpo = {
        name: 'Pessoa de Conformidade',
        email: novoEmail(),
        role: 'technician',
        site_ids: [sites[0].id],
      };
      const criada = await t.call('POST', '/api/users', { session: admin, body: corpo });
      ok(criada.status < 300, 'criação');
      ok(
        /^[A-HJ-NP-Z2-9]{10}\d{2}$/.test(criada.data.temporary_password),
        'formato da senha temporária: ' + criada.data.temporary_password,
      );
      eq(
        (await t.call('POST', '/api/users', { session: admin, body: corpo })).status,
        409,
        'vínculo repetido',
      );
      ok((await entrar(t, corpo.email, criada.data.temporary_password)).status < 300, 'ela entra');
    },
  },
  {
    name: 'senha temporária autentica mas não administra ninguém',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const conta = await contaNova(t, admin, { role: 'admin' });
      const sessao = await entrar(t, conta.email, conta.temporary_password);
      eq(sessao.data.principal.must_change_password, true, 'exigência de troca');
      eq(
        (await t.call('GET', '/api/users', { session: sessao.data.token })).status,
        403,
        'administrar com senha temporária',
      );
    },
  },
  {
    name: 'mudar o vínculo encerra as sessões da pessoa alterada',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const conta = await contaNova(t, admin);
      const dela = (await entrar(t, conta.email, conta.temporary_password)).data.token;
      eq((await introspectar(t, dela)).data.active, true, 'antes da mudança');
      const mudanca = await t.call('POST', `/api/users/${conta.id}`, {
        session: admin,
        body: { role: 'operator' },
      });
      ok(mudanca.status < 300, 'mudança de papel');
      eq((await introspectar(t, dela)).data.active, false, 'depois da mudança');
    },
  },
  {
    name: 'redefinir a senha derruba as sessões e volta a exigir troca',
    async run(t) {
      const admin = (await entrar(t, t.fixtures.admin)).data.token;
      const conta = await contaNova(t, admin);
      const dela = (await entrar(t, conta.email, conta.temporary_password)).data.token;
      const reset = await t.call('POST', `/api/users/${conta.id}/password`, {
        session: admin,
        body: {},
      });
      ok(reset.status < 300, 'redefinição');
      ok(/^[A-HJ-NP-Z2-9]{10}\d{2}$/.test(reset.data.temporary_password), 'formato');
      eq((await introspectar(t, dela)).data.active, false, 'a sessão dela cai');
      const nova = await entrar(t, conta.email, reset.data.temporary_password);
      eq(nova.data.principal.must_change_password, true, 'volta a exigir troca');
    },
  },
  {
    name: 'o administrador não remove o próprio acesso',
    async run(t) {
      const sessao = await entrar(t, t.fixtures.admin);
      const eu = sessao.data.principal.id;
      for (const body of [{ active: false }, { role: 'viewer' }]) {
        const tentativa = await t.call('POST', `/api/users/${eu}`, {
          session: sessao.data.token,
          body,
        });
        eq(tentativa.status, 400, 'auto-remoção com ' + JSON.stringify(body));
      }
      ok(
        (await t.call('GET', '/api/users', { session: sessao.data.token })).status < 300,
        'continua administrando',
      );
    },
  },
  {
    name: 'corpo fora do contrato vira 400 com o campo apontado',
    async run(t) {
      const recusa = await t.call('POST', '/api/auth/login', {
        body: { company: t.fixtures.company, email: 'nao-e-email', password: 'x' },
      });
      eq(recusa.status, 400, 'corpo inválido');
      ok(Array.isArray(recusa.data.issues), 'a recusa precisa apontar os campos');
      ok(
        recusa.data.issues.some((i: any) => i.field === 'email'),
        'o campo errado precisa estar na lista',
      );
    },
  },
];
