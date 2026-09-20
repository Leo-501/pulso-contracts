import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ClienteIdentidade,
  IdentidadeIndisponivel,
  IdentidadeRecusou,
  esquemaIntrospeccao,
  esquemaPedidoIntrospeccao,
  type Introspeccao,
} from '../src/identity/index.js';

const contexto = () => ({
  id: randomUUID(),
  nome: 'Marina Costa',
  email: 'gestor@demo.local',
  empresa_id: randomUUID(),
  empresa_nome: 'Indústrias Aurora',
  unidade_id: randomUUID(),
  unidade_nome: 'Unidade 01',
  fuso: 'America/Sao_Paulo',
  papel: 'gestor' as const,
  trocar_senha: false,
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
  new ClienteIdentidade({
    baseUrl: 'http://identidade.local/',
    clienteId: 'cmms',
    clienteSegredo: 'segredo',
    fetch: fetchImpl,
    ...(cacheMs === undefined ? {} : { cacheMs }),
  });

test('a credencial de serviço e o token vão no envio, e a barra final não duplica', async () => {
  const seen: string[] = [];
  const { state, fetchImpl } = transport(() => ({ ativa: true, contexto: contexto(), expira_em: 'depois' }));
  const wrapped = (async (url: string, init: any) => {
    seen.push(url);
    return (fetchImpl as any)(url, init);
  }) as unknown as typeof globalThis.fetch;
  await client(wrapped).introspectar('abc123');
  assert.equal(seen[0], 'http://identidade.local/api/introspeccao');
  assert.equal(state.headers[0]['x-pulso-cliente'], 'cmms');
  assert.equal(state.headers[0].authorization, 'Bearer segredo');
  assert.deepEqual(state.bodies[0], { token: 'abc123', tipo: 'painel' });
});

test('resposta positiva é reaproveitada dentro da janela e expira depois dela', async () => {
  const { state, fetchImpl } = transport(() => ({ ativa: true, contexto: contexto(), expira_em: 'depois' }));
  const c = client(fetchImpl, 50);
  await c.introspectar('tok');
  await c.introspectar('tok');
  await c.introspectar('tok');
  assert.equal(state.calls, 1, 'a janela deveria ter absorvido as repetições');
  await new Promise((r) => setTimeout(r, 60));
  await c.introspectar('tok');
  assert.equal(state.calls, 2, 'passada a janela, precisa perguntar de novo');
});

test('cacheMs zero devolve revogação imediata ao custo de um salto por chamada', async () => {
  const { state, fetchImpl } = transport(() => ({ ativa: true, contexto: contexto(), expira_em: 'depois' }));
  const c = client(fetchImpl, 0);
  await c.introspectar('tok');
  await c.introspectar('tok');
  assert.equal(state.calls, 2);
});

test('resposta negativa nunca entra no cache', async () => {
  // Um token perguntado cedo demais não pode ficar marcado como inválido.
  const { state, fetchImpl } = transport((_b, call) =>
    call === 1 ? { ativa: false } : { ativa: true, contexto: contexto(), expira_em: 'depois' },
  );
  const c = client(fetchImpl, 10_000);
  assert.equal((await c.introspectar('tok')).ativa, false);
  assert.equal((await c.introspectar('tok')).ativa, true, 'a negativa não podia ter sido guardada');
  assert.equal(state.calls, 2);
});

test('encerrar a sessão descarta a entrada em cache sem esperar a janela', async () => {
  const { state, fetchImpl } = transport(() => ({ ativa: true, contexto: contexto(), expira_em: 'depois' }));
  const c = client(fetchImpl, 10_000);
  await c.introspectar('tok');
  c.esquecer('tok');
  await c.introspectar('tok');
  assert.equal(state.calls, 2);
});

test('chamadas simultâneas com o mesmo token compartilham um único envio', async () => {
  let liberar: (v: unknown) => void = () => {};
  const espera = new Promise((r) => (liberar = r));
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls++;
    await espera;
    return new Response(JSON.stringify({ ativa: true, contexto: contexto(), expira_em: 'd' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  const c = client(fetchImpl);
  const todas = Promise.all([c.introspectar('tok'), c.introspectar('tok'), c.introspectar('tok')]);
  liberar(null);
  const resultados = await todas;
  assert.equal(state.calls, 1);
  assert.equal(
    resultados.every((r) => r.ativa),
    true,
  );
});

test('identidade fora do ar falha fechado, e a falha não fica grudada', async () => {
  const { state, fetchImpl } = transport((_b, call) =>
    call === 1 ? new Error('conexão recusada') : { ativa: true, contexto: contexto(), expira_em: 'd' },
  );
  const c = client(fetchImpl);
  await assert.rejects(() => c.introspectar('tok'), IdentidadeIndisponivel);
  // A promessa com falha precisa sair de `pending`, senão o cliente fica travado.
  assert.equal((await c.introspectar('tok')).ativa, true);
  assert.equal(state.calls, 2);
});

test('erro HTTP da identidade não é confundido com token inválido', async () => {
  // Devolver `ativa:false` aqui trataria indisponibilidade como logout.
  const { fetchImpl } = transport(() => 500);
  await assert.rejects(() => client(fetchImpl).introspectar('tok'), IdentidadeIndisponivel);
});

test('resposta fora do contrato é recusada em vez de virar acesso', async () => {
  const { fetchImpl } = transport(() => ({ ativa: true, contexto: { id: 'nao-e-uuid' } }));
  await assert.rejects(() => client(fetchImpl).introspectar('tok'));
});

test('o schema do pedido recusa token gigante e assume sessão web', () => {
  assert.deepEqual(esquemaPedidoIntrospeccao.parse({ token: 'abc' }), { token: 'abc', tipo: 'painel' });
  assert.equal(esquemaPedidoIntrospeccao.safeParse({ token: 'x'.repeat(513) }).success, false);
  assert.equal(esquemaPedidoIntrospeccao.safeParse({ token: '' }).success, false);
  assert.equal(
    esquemaPedidoIntrospeccao.safeParse({ token: 'abc', tipo: 'painel', extra: 1 }).success,
    false,
  );
});

test('o schema da resposta aceita as duas formas e recusa a mistura', () => {
  const negativa: Introspeccao = { ativa: false };
  assert.deepEqual(esquemaIntrospeccao.parse(negativa), negativa);
  const positiva = { ativa: true as const, contexto: contexto(), expira_em: 'amanhã' };
  assert.deepEqual(esquemaIntrospeccao.parse(positiva), positiva);
  assert.equal(esquemaIntrospeccao.safeParse({ ativa: false, contexto: contexto() }).success, false);
  assert.equal(esquemaIntrospeccao.safeParse({ ativa: true }).success, false);
  // Campo desconhecido numa positiva é tolerado de propósito: é como a identidade
  // evolui sem derrubar um consumidor que ainda não subiu.
  const futura = esquemaIntrospeccao.safeParse({ ...positiva, campo_novo: 'de uma versão adiante' });
  assert.equal(futura.success, true);
});

// --- SDK: as rotas além da introspecção ---------------------------------

test('recusa da identidade atravessa com o código e a mensagem originais', async () => {
  // 401 aqui é senha errada, não serviço fora do ar. Tratar os dois igual
  // deslogaria todo mundo durante uma queda — ou esconderia a senha errada.
  const { fetchImpl } = transport(() => ({
    __status: 401,
    mensagem: 'Empresa, e-mail ou senha inválidos.',
  }));
  await assert.rejects(
    () => client(fetchImpl).entrar({ empresa: 'aurora', email: 'a@b.c', senha: 'x' }),
    (error: unknown) => {
      assert.ok(error instanceof IdentidadeRecusou);
      assert.equal(error.status, 401);
      assert.equal(error.message, 'Empresa, e-mail ou senha inválidos.');
      return true;
    },
  );
});

test('falha do serviço não vira recusa, mesmo nas rotas de escrita', async () => {
  const { fetchImpl } = transport(() => 503);
  await assert.rejects(() => client(fetchImpl).entrar({}), IdentidadeIndisponivel);
});

test('os campos inválidos do 400 chegam ao produto', async () => {
  const { fetchImpl } = transport(() => ({
    __status: 400,
    mensagem: 'Confira os campos informados.',
    campos: [{ campo: 'email', mensagem: 'E-mail inválido.' }],
  }));
  await assert.rejects(
    () => client(fetchImpl).criarConta('tok', {}),
    (error: unknown) => {
      assert.ok(error instanceof IdentidadeRecusou);
      assert.deepEqual(error.campos, [{ campo: 'email', mensagem: 'E-mail inválido.' }]);
      return true;
    },
  );
});

test('consulta não leva corpo e o token da sessão vai no cabeçalho próprio', async () => {
  const { state, fetchImpl } = transport(() => []);
  await client(fetchImpl).unidades('tok-da-sessao');
  assert.equal(state.inits[0].method, 'GET');
  assert.equal(state.inits[0].body, undefined);
  assert.equal(state.headers[0]['x-pulso-sessao'], 'tok-da-sessao');
  // Sem corpo, sem Content-Type: um GET com Content-Type é ruído que alguns
  // intermediários tratam como requisição malformada.
  assert.equal(state.headers[0]['Content-Type'], undefined);
});

test('trocar de unidade descarta o token anterior do cache', async () => {
  const antes = contexto();
  const { state, fetchImpl } = transport((_b, _call, url) =>
    url.endsWith('/api/unidade')
      ? { token: 'novo', expira_em: 'depois', contexto: contexto() }
      : { ativa: true, contexto: antes, expira_em: 'depois' },
  );
  const c = client(fetchImpl);
  await c.introspectar('velho');
  await c.introspectar('velho');
  assert.equal(state.calls, 1, 'a segunda introspecção veio do cache');
  await c.trocarUnidade('velho', { unidade_id: antes.unidade_id });
  // O token velho foi revogado do outro lado. Se continuasse em cache, valeria
  // pela janela inteira com o escopo da unidade anterior.
  await c.introspectar('velho');
  assert.equal(state.calls, 3);
});

test('trocar a senha descarta o contexto em cache', async () => {
  // `trocar_senha` acabou de mudar; o contexto guardado está errado.
  const { state, fetchImpl } = transport((_b, _call, url) =>
    url.endsWith('/api/senha')
      ? { ok: true }
      : { ativa: true, contexto: contexto(), expira_em: 'depois' },
  );
  const c = client(fetchImpl);
  await c.introspectar('tok');
  await c.trocarSenha('tok', { atual: 'a', nova: 'b' });
  await c.introspectar('tok');
  assert.equal(state.calls, 3);
});

test('o quadro de pessoas é recusado se vier fora do contrato', async () => {
  const { fetchImpl } = transport(() => ({ gerado_em: 'agora', pessoas: [{ id: 'nao-e-uuid' }] }));
  await assert.rejects(() => client(fetchImpl).quadro('tok'));
});

test('o quadro de pessoas aceita empresa sem ninguém', async () => {
  const { fetchImpl } = transport(() => ({ gerado_em: 'agora', pessoas: [], unidades: [] }));
  const quadro = await client(fetchImpl).quadro('tok');
  assert.deepEqual(quadro.pessoas, []);
});

test('credencial de serviço errada não desloga ninguém: falha fechado', async () => {
  // A introspecção nunca recusa token com 4xx — token inválido é ativa:false em
  // 200. Um 401 aqui é o produto com credencial errada, e repassá-lo ao navegador
  // deslogaria todo mundo de uma vez por causa de um erro de configuração.
  const { fetchImpl } = transport(() => ({
    __status: 401,
    mensagem: 'Credencial de serviço inválida.',
    codigo: 'credencial_servico',
  }));
  await assert.rejects(() => client(fetchImpl).introspectar('tok'), IdentidadeIndisponivel);
});

test('introspecção trata qualquer 4xx como indisponibilidade, mesmo sem o código', async () => {
  const { fetchImpl } = transport(() => ({ __status: 403, mensagem: 'proibido' }));
  await assert.rejects(() => client(fetchImpl).introspectar('tok'), IdentidadeIndisponivel);
});

test('nas demais rotas o código separa credencial do produto de senha da pessoa', async () => {
  const doProduto = transport(() => ({
    __status: 401,
    mensagem: 'Credencial de serviço inválida.',
    codigo: 'credencial_servico',
  }));
  await assert.rejects(() => client(doProduto.fetchImpl).entrar({}), IdentidadeIndisponivel);

  const daPessoa = transport(() => ({ __status: 401, mensagem: 'Empresa, e-mail ou senha inválidos.' }));
  await assert.rejects(() => client(daPessoa.fetchImpl).entrar({}), IdentidadeRecusou);
});

test('mudar o vínculo de alguém descarta o cache, e não só o token de quem mudou', async () => {
  // O administrador não conhece os tokens de quem ele desativou: eles são opacos
  // e vivem na identidade. Sem descartar tudo, quem perdeu o acesso continuaria
  // entrando pela janela inteira do cache — revogação pedida por uma pessoa,
  // adiada por uma otimização.
  const { state, fetchImpl } = transport((_b, _call, url) =>
    url.includes('/api/pessoas/')
      ? { ok: true }
      : { ativa: true, contexto: contexto(), expira_em: 'depois' },
  );
  const c = client(fetchImpl);
  await c.introspectar('token-de-outra-pessoa');
  assert.equal((await c.introspectar('token-de-outra-pessoa')).ativa, true);
  assert.equal(state.calls, 1, 'a segunda veio do cache');
  await c.alterarConta('token-do-admin', 'alguem', { ativa: false });
  await c.introspectar('token-de-outra-pessoa');
  assert.equal(state.calls, 3, 'a introspecção precisa ir à identidade de novo');
});

test('redefinir senha e trocar a própria senha também descartam o cache', async () => {
  for (const acao of [
    (c: ClienteIdentidade) => c.redefinirSenha('administrador', 'alguem'),
    (c: ClienteIdentidade) => c.trocarSenha('minha', { atual: 'a', nova: 'b' }),
  ]) {
    const { state, fetchImpl } = transport((_b, _call, url) =>
      url.includes('/senha')
        ? { ok: true, id: randomUUID(), senha_temporaria: 'ABCDEFGHJK12' }
        : { ativa: true, contexto: contexto(), expira_em: 'depois' },
    );
    const c = client(fetchImpl);
    await c.introspectar('outra');
    await acao(c);
    await c.introspectar('outra');
    assert.equal(state.calls, 3);
  }
});
