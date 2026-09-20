import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityClient } from '../src/identity/index.js';
import {
  createIdentityStub,
  identityConformance,
  type ConformanceTarget,
} from '../src/identity/testing.js';

const SENHA = 'Demo@2026!';

/**
 * O mesmo cenário que o seed de `pulso-identity` monta. A bateria de
 * conformidade roda contra os dois, então os cenários precisam ser equivalentes
 * — é isso que dá sentido a uma divergência.
 */
const cenario = () =>
  createIdentityStub({
    client: { id: 'cmms', secret: 'segredo-de-demonstracao-nao-use-em-producao' },
    tenants: [
      {
        slug: 'aurora',
        name: 'Indústrias Aurora',
        sites: [
          { name: 'Unidade 01', city: 'Caçapava' },
          { name: 'Unidade 02', city: 'Jacareí' },
        ],
      },
      { slug: 'horizonte', name: 'Fábrica Horizonte', sites: [{ name: 'Unidade 01', city: 'Taubaté' }] },
    ],
    people: [
      // Só o gestor de Aurora alcança a segunda unidade, como no seed do serviço.
      {
        email: 'gestor@demo.local',
        name: 'Marina Costa',
        password: SENHA,
        memberships: [
          { tenant: 'aurora', role: 'manager', sites: ['Unidade 01', 'Unidade 02'] },
          { tenant: 'horizonte', role: 'manager', sites: ['Unidade 01'] },
        ],
      },
      {
        email: 'tecnico@demo.local',
        name: 'Rafael Lima',
        password: SENHA,
        memberships: [
          { tenant: 'aurora', role: 'technician', sites: ['Unidade 01'] },
          { tenant: 'horizonte', role: 'technician', sites: ['Unidade 01'] },
        ],
      },
      {
        email: 'admin@demo.local',
        name: 'Ana Ribeiro',
        password: SENHA,
        memberships: [
          { tenant: 'aurora', role: 'admin', sites: ['Unidade 01'] },
          { tenant: 'horizonte', role: 'admin', sites: ['Unidade 01'] },
        ],
      },
      {
        email: 'operador@demo.local',
        name: 'Camila Santos',
        password: SENHA,
        memberships: [{ tenant: 'aurora', role: 'operator', sites: ['Unidade 01'] }],
      },
    ],
  });

function alvo(stub: ReturnType<typeof cenario>): ConformanceTarget {
  const chamar = async (
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; session?: string; kind?: 'web' | 'mobile' } = {},
    credencial = true,
  ) => {
    const response = await stub.fetch('http://identidade.local' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-pulso-client': credencial ? stub.client.id : 'errado',
        authorization: 'Bearer ' + (credencial ? stub.client.secret : 'errado'),
        ...(options.session ? { 'x-pulso-session': options.session } : {}),
        ...(options.kind ? { 'x-pulso-session-kind': options.kind } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    } as RequestInit);
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  return {
    call: (method, path, options) => chamar(method, path, options),
    callSemCredencial: (path, body) => chamar('POST', path, { body }, false),
    fixtures: {
      company: 'aurora',
      password: SENHA,
      admin: 'admin@demo.local',
      duasUnidades: 'gestor@demo.local',
      technician: 'tecnico@demo.local',
    },
  };
}

for (const check of identityConformance)
  test(`conformidade do duplo: ${check.name}`, async () => {
    await check.run(alvo(cenario()));
  });

// --- O que é do duplo e não da bateria ------------------------------------

test('o cliente real conversa com o duplo sem saber que é duplo', async () => {
  const stub = cenario();
  const cliente = new IdentityClient({
    baseUrl: 'http://identidade.local',
    clientId: stub.client.id,
    clientSecret: stub.client.secret,
    fetch: stub.fetch,
  });
  const sessao = await cliente.login({
    company: 'aurora',
    email: 'gestor@demo.local',
    password: SENHA,
  });
  const contexto = await cliente.introspect(sessao.token);
  assert.equal(contexto.active, true);
  assert.equal(contexto.active && contexto.principal.role, 'manager');
  const quadro = await cliente.roster(sessao.token);
  assert.equal(quadro.people.length, 4);
  await cliente.logout(sessao.token);
  assert.equal((await cliente.introspect(sessao.token)).active, false);
});

test('os identificadores do cenário são estáveis e consultáveis pelo teste', async () => {
  const stub = cenario();
  const unidade = stub.siteId('aurora', 'Unidade 01');
  assert.match(unidade, /^[0-9a-f-]{36}$/);
  assert.notEqual(unidade, stub.siteId('aurora', 'Unidade 02'));
  // A mesma unidade em empresas diferentes precisa ser identificador diferente.
  assert.notEqual(unidade, stub.siteId('horizonte', 'Unidade 01'));
  const sessao = await alvo(stub).call('POST', '/api/auth/login', {
    body: { company: 'aurora', email: 'gestor@demo.local', password: SENHA },
  });
  assert.equal(sessao.data.principal.site_id, unidade, 'a entrada é a primeira em ordem alfabética');
  assert.equal(sessao.data.principal.tenant_id, stub.tenantId('aurora'));
  assert.equal(sessao.data.principal.id, stub.userId('gestor@demo.local'));
});

test('expirar a sessão pelo duplo derruba o acesso sem esperar oito horas', async () => {
  const stub = cenario();
  const t = alvo(stub);
  const sessao = await t.call('POST', '/api/auth/login', {
    body: { company: 'aurora', email: 'admin@demo.local', password: SENHA },
  });
  assert.equal((await t.call('POST', '/api/introspect', { body: { token: sessao.data.token } })).data.active, true);
  stub.expireAll();
  assert.equal((await t.call('POST', '/api/introspect', { body: { token: sessao.data.token } })).data.active, false);
});

test('empresas diferentes não enxergam o quadro uma da outra', async () => {
  const t = alvo(cenario());
  const aurora = await t.call('POST', '/api/auth/login', {
    body: { company: 'aurora', email: 'operador@demo.local', password: SENHA },
  });
  const horizonte = await t.call('POST', '/api/auth/login', {
    body: { company: 'horizonte', email: 'admin@demo.local', password: SENHA },
  });
  const la = (await t.call('GET', '/api/roster', { session: horizonte.data.token })).data;
  // Camila só existe em Aurora; se ela aparecer no quadro de Horizonte, o duplo
  // está mentindo sobre o isolamento e testaria o produto contra uma fantasia.
  assert.ok(!la.people.some((p: any) => p.id === aurora.data.principal.id));
  assert.equal(la.sites.length, 1);
});
