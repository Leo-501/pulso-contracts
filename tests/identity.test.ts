import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  IdentityClient,
  IdentityUnavailableError,
  IdentityRejectedError,
  introspectionSchema,
  introspectionRequestSchema,
  type Introspection,
} from '../src/identity.js';

const principal = () => ({
  id: randomUUID(),
  name: 'Marina Costa',
  email: 'gestor@demo.local',
  tenant_id: randomUUID(),
  tenant_name: 'Indústrias Aurora',
  site_id: randomUUID(),
  site_name: 'Unidade 01',
  timezone: 'America/Sao_Paulo',
  role: 'manager' as const,
  must_change_password: false,
});

/** Transporte simulado que conta chamadas e permite roteirizar a resposta. */
function transport(responder: (body: any, call: number, url: string) => unknown) {
  const state = {
    calls: 0,
    headers: [] as Record<string, string>[],
    bodies: [] as any[],
    inits: [] as any[],
    urls: [] as string[],
  };
  const fetchImpl = (async (url: string, init: any) => {
    state.calls++;
    state.headers.push(init.headers);
    state.inits.push(init);
    state.urls.push(url);
    // Consulta não leva corpo; tentar interpretá-lo mascararia o defeito de
    // enviar um.
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    state.bodies.push(body);
    const result: any = responder(body, state.calls, url);
    if (result instanceof Error) throw result;
    if (typeof result === "number")
      return new Response("erro", { status: result, headers: { "Content-Type": "text/plain" } });
    // `__status` roteiriza uma recusa com corpo, que é como a identidade
    // responde 4xx de verdade.
    const { __status, ...payload } = result ?? {};
    return new Response(JSON.stringify(__status ? payload : result), {
      status: __status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { state, fetchImpl };
}
const client = (fetchImpl: typeof globalThis.fetch, cacheMs?: number) =>
  new IdentityClient({
    baseUrl: 'http://identidade.local/',
    clientId: 'cmms',
    clientSecret: 'segredo',
    fetch: fetchImpl,
    ...(cacheMs === undefined ? {} : { cacheMs }),
  });

test('a credencial de serviço e o token vão no envio, e a barra final não duplica', async () => {
  const seen: string[] = [];
  const { state, fetchImpl } = transport(() => ({ active: true, principal: principal(), expires_at: 'depois' }));
  const wrapped = (async (url: string, init: any) => {
    seen.push(url);
    return (fetchImpl as any)(url, init);
  }) as unknown as typeof globalThis.fetch;
  await client(wrapped).introspect('abc123');
  assert.equal(seen[0], 'http://identidade.local/api/introspect');
  assert.equal(state.headers[0]['x-pulso-client'], 'cmms');
  assert.equal(state.headers[0].authorization, 'Bearer segredo');
  assert.deepEqual(state.bodies[0], { token: 'abc123', kind: 'web' });
});

test('resposta positiva é reaproveitada dentro da janela e expira depois dela', async () => {
  const { state, fetchImpl } = transport(() => ({ active: true, principal: principal(), expires_at: 'depois' }));
  const c = client(fetchImpl, 50);
  await c.introspect('tok');
  await c.introspect('tok');
  await c.introspect('tok');
  assert.equal(state.calls, 1, 'a janela deveria ter absorvido as repetições');
  await new Promise((r) => setTimeout(r, 60));
  await c.introspect('tok');
  assert.equal(state.calls, 2, 'passada a janela, precisa perguntar de novo');
});

test('cacheMs zero devolve revogação imediata ao custo de um salto por chamada', async () => {
  const { state, fetchImpl } = transport(() => ({ active: true, principal: principal(), expires_at: 'depois' }));
  const c = client(fetchImpl, 0);
  await c.introspect('tok');
  await c.introspect('tok');
  assert.equal(state.calls, 2);
});

test('resposta negativa nunca entra no cache', async () => {
  // Um token perguntado cedo demais não pode ficar marcado como inválido.
  const { state, fetchImpl } = transport((_b, call) =>
    call === 1 ? { active: false } : { active: true, principal: principal(), expires_at: 'depois' },
  );
  const c = client(fetchImpl, 10_000);
  assert.equal((await c.introspect('tok')).active, false);
  assert.equal((await c.introspect('tok')).active, true, 'a negativa não podia ter sido guardada');
  assert.equal(state.calls, 2);
});

test('encerrar a sessão descarta a entrada em cache sem esperar a janela', async () => {
  const { state, fetchImpl } = transport(() => ({ active: true, principal: principal(), expires_at: 'depois' }));
  const c = client(fetchImpl, 10_000);
  await c.introspect('tok');
  c.forget('tok');
  await c.introspect('tok');
  assert.equal(state.calls, 2);
});

test('chamadas simultâneas com o mesmo token compartilham um único envio', async () => {
  let liberar: (v: unknown) => void = () => {};
  const espera = new Promise((r) => (liberar = r));
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls++;
    await espera;
    return new Response(JSON.stringify({ active: true, principal: principal(), expires_at: 'd' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  const c = client(fetchImpl);
  const todas = Promise.all([c.introspect('tok'), c.introspect('tok'), c.introspect('tok')]);
  liberar(null);
  const resultados = await todas;
  assert.equal(state.calls, 1);
  assert.equal(
    resultados.every((r) => r.active),
    true,
  );
});

test('identidade fora do ar falha fechado, e a falha não fica grudada', async () => {
  const { state, fetchImpl } = transport((_b, call) =>
    call === 1 ? new Error('conexão recusada') : { active: true, principal: principal(), expires_at: 'd' },
  );
  const c = client(fetchImpl);
  await assert.rejects(() => c.introspect('tok'), IdentityUnavailableError);
  // A promessa com falha precisa sair de `pending`, senão o cliente fica travado.
  assert.equal((await c.introspect('tok')).active, true);
  assert.equal(state.calls, 2);
});

test('erro HTTP da identidade não é confundido com token inválido', async () => {
  // Devolver `active:false` aqui trataria indisponibilidade como logout.
  const { fetchImpl } = transport(() => 500);
  await assert.rejects(() => client(fetchImpl).introspect('tok'), IdentityUnavailableError);
});

test('resposta fora do contrato é recusada em vez de virar acesso', async () => {
  const { fetchImpl } = transport(() => ({ active: true, principal: { id: 'nao-e-uuid' } }));
  await assert.rejects(() => client(fetchImpl).introspect('tok'));
});

test('o schema do pedido recusa token gigante e assume sessão web', () => {
  assert.deepEqual(introspectionRequestSchema.parse({ token: 'abc' }), { token: 'abc', kind: 'web' });
  assert.equal(introspectionRequestSchema.safeParse({ token: 'x'.repeat(513) }).success, false);
  assert.equal(introspectionRequestSchema.safeParse({ token: '' }).success, false);
  assert.equal(
    introspectionRequestSchema.safeParse({ token: 'abc', kind: 'web', extra: 1 }).success,
    false,
  );
});

test('o schema da resposta aceita as duas formas e recusa a mistura', () => {
  const negativa: Introspection = { active: false };
  assert.deepEqual(introspectionSchema.parse(negativa), negativa);
  const positiva = { active: true as const, principal: principal(), expires_at: 'amanhã' };
  assert.deepEqual(introspectionSchema.parse(positiva), positiva);
  assert.equal(introspectionSchema.safeParse({ active: false, principal: principal() }).success, false);
  assert.equal(introspectionSchema.safeParse({ active: true }).success, false);
  // Campo desconhecido numa positiva é tolerado de propósito: é como a identidade
  // evolui sem derrubar um consumidor que ainda não subiu.
  const futura = introspectionSchema.safeParse({ ...positiva, campo_novo: 'de uma versão adiante' });
  assert.equal(futura.success, true);
});

// --- SDK: as rotas além da introspecção ---------------------------------

test('recusa da identidade atravessa com o código e a mensagem originais', async () => {
  // 401 aqui é senha errada, não serviço fora do ar. Tratar os dois igual
  // deslogaria todo mundo durante uma queda — ou esconderia a senha errada.
  const { fetchImpl } = transport(() => ({
    __status: 401,
    message: 'Empresa, e-mail ou senha inválidos.',
  }));
  await assert.rejects(
    () => client(fetchImpl).login({ company: 'aurora', email: 'a@b.c', password: 'x' }),
    (error: unknown) => {
      assert.ok(error instanceof IdentityRejectedError);
      assert.equal(error.status, 401);
      assert.equal(error.message, 'Empresa, e-mail ou senha inválidos.');
      return true;
    },
  );
});

test('falha do serviço não vira recusa, mesmo nas rotas de escrita', async () => {
  const { fetchImpl } = transport(() => 503);
  await assert.rejects(() => client(fetchImpl).login({}), IdentityUnavailableError);
});

test('os campos inválidos do 400 chegam ao produto', async () => {
  const { fetchImpl } = transport(() => ({
    __status: 400,
    message: 'Confira os campos informados.',
    issues: [{ field: 'email', message: 'E-mail inválido.' }],
  }));
  await assert.rejects(
    () => client(fetchImpl).createAccount('tok', {}),
    (error: unknown) => {
      assert.ok(error instanceof IdentityRejectedError);
      assert.deepEqual(error.issues, [{ field: 'email', message: 'E-mail inválido.' }]);
      return true;
    },
  );
});

test('consulta não leva corpo e o token da sessão vai no cabeçalho próprio', async () => {
  const { state, fetchImpl } = transport(() => []);
  await client(fetchImpl).sites('tok-da-sessao');
  assert.equal(state.inits[0].method, 'GET');
  assert.equal(state.inits[0].body, undefined);
  assert.equal(state.headers[0]['x-pulso-session'], 'tok-da-sessao');
  // Sem corpo, sem Content-Type: um GET com Content-Type é ruído que alguns
  // intermediários tratam como requisição malformada.
  assert.equal(state.headers[0]['Content-Type'], undefined);
});

test('trocar de unidade descarta o token anterior do cache', async () => {
  const antes = principal();
  const { state, fetchImpl } = transport((_b, _call, url) =>
    url.endsWith('/api/auth/site')
      ? { token: 'novo', expires_at: 'depois', principal: principal() }
      : { active: true, principal: antes, expires_at: 'depois' },
  );
  const c = client(fetchImpl);
  await c.introspect('velho');
  await c.introspect('velho');
  assert.equal(state.calls, 1, 'a segunda introspecção veio do cache');
  await c.switchSite('velho', { site_id: antes.site_id });
  // O token velho foi revogado do outro lado. Se continuasse em cache, valeria
  // pela janela inteira com o escopo da unidade anterior.
  await c.introspect('velho');
  assert.equal(state.calls, 3);
});

test('trocar a senha descarta o contexto em cache', async () => {
  // `must_change_password` acabou de mudar; o contexto guardado está errado.
  const { state, fetchImpl } = transport((_b, _call, url) =>
    url.endsWith('/api/auth/password')
      ? { ok: true }
      : { active: true, principal: principal(), expires_at: 'depois' },
  );
  const c = client(fetchImpl);
  await c.introspect('tok');
  await c.changePassword('tok', { current: 'a', next: 'b' });
  await c.introspect('tok');
  assert.equal(state.calls, 3);
});

test('o quadro de pessoas é recusado se vier fora do contrato', async () => {
  const { fetchImpl } = transport(() => ({ generated_at: 'agora', people: [{ id: 'nao-e-uuid' }] }));
  await assert.rejects(() => client(fetchImpl).roster('tok'));
});

test('o quadro de pessoas aceita empresa sem ninguém', async () => {
  const { fetchImpl } = transport(() => ({ generated_at: 'agora', people: [], sites: [] }));
  const quadro = await client(fetchImpl).roster('tok');
  assert.deepEqual(quadro.people, []);
});
