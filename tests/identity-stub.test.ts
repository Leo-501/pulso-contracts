import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClienteIdentidade } from '../src/identity/index.js';
import {
  criarIdentidadeDuplo,
  conformidadeIdentidade,
  type AlvoConformidade,
} from '../src/identity/testing.js';

const SENHA = 'Demo@2026!';

/**
 * O mesmo cenário que o seed de `pulso-identity` monta. A bateria de
 * conformidade roda contra os dois, então os cenários precisam ser equivalentes
 * — é isso que dá sentido a uma divergência.
 */
const cenario = () =>
  criarIdentidadeDuplo({
    cliente: { id: 'cmms', segredo: 'segredo-de-demonstracao-nao-use-em-producao' },
    empresas: [
      {
        apelido: 'aurora',
        nome: 'Indústrias Aurora',
        unidades: [
          { nome: 'Unidade 01', cidade: 'Caçapava' },
          { nome: 'Unidade 02', cidade: 'Jacareí' },
        ],
      },
      {
        apelido: 'horizonte',
        nome: 'Fábrica Horizonte',
        unidades: [{ nome: 'Unidade 01', cidade: 'Taubaté' }],
      },
    ],
    pessoas: [
      // Só o gestor de Aurora alcança a segunda unidade, como no seed do serviço.
      {
        email: 'gestor@demo.local',
        nome: 'Marina Costa',
        senha: SENHA,
        vinculos: [
          { empresa: 'aurora', papel: 'gestor', unidades: ['Unidade 01', 'Unidade 02'] },
          { empresa: 'horizonte', papel: 'gestor', unidades: ['Unidade 01'] },
        ],
      },
      {
        email: 'tecnico@demo.local',
        nome: 'Rafael Lima',
        senha: SENHA,
        vinculos: [
          { empresa: 'aurora', papel: 'tecnico', unidades: ['Unidade 01'] },
          { empresa: 'horizonte', papel: 'tecnico', unidades: ['Unidade 01'] },
        ],
      },
      {
        email: 'admin@demo.local',
        nome: 'Ana Ribeiro',
        senha: SENHA,
        vinculos: [
          { empresa: 'aurora', papel: 'administrador', unidades: ['Unidade 01'] },
          { empresa: 'horizonte', papel: 'administrador', unidades: ['Unidade 01'] },
        ],
      },
      {
        email: 'operador@demo.local',
        nome: 'Camila Santos',
        senha: SENHA,
        vinculos: [{ empresa: 'aurora', papel: 'solicitante', unidades: ['Unidade 01'] }],
      },
    ],
  });

function alvo(duplo: ReturnType<typeof cenario>): AlvoConformidade {
  const chamar = async (
    metodo: 'GET' | 'POST',
    caminho: string,
    opcoes: { corpo?: unknown; sessao?: string; tipo?: 'painel' | 'aplicativo' } = {},
    credencial = true,
  ) => {
    const resposta = await duplo.fetch('http://identidade.local' + caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'x-pulso-cliente': credencial ? duplo.cliente.id : 'errado',
        authorization: 'Bearer ' + (credencial ? duplo.cliente.segredo : 'errado'),
        ...(opcoes.sessao ? { 'x-pulso-sessao': opcoes.sessao } : {}),
        ...(opcoes.tipo ? { 'x-pulso-tipo-sessao': opcoes.tipo } : {}),
      },
      ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
    } as RequestInit);
    return { status: resposta.status, dados: await resposta.json().catch(() => null) };
  };
  return {
    chamar: (metodo, caminho, opcoes) => chamar(metodo, caminho, opcoes),
    chamarSemCredencial: (caminho, corpo) => chamar('POST', caminho, { corpo }, false),
    dados: {
      empresa: 'aurora',
      senha: SENHA,
      administrador: 'admin@demo.local',
      duasUnidades: 'gestor@demo.local',
      tecnico: 'tecnico@demo.local',
    },
  };
}

for (const verificacao of conformidadeIdentidade)
  test(`conformidade do duplo: ${verificacao.nome}`, async () => {
    await verificacao.rodar(alvo(cenario()));
  });

// --- O que é do duplo e não da bateria ------------------------------------

test('o cliente real conversa com o duplo sem saber que é duplo', async () => {
  const duplo = cenario();
  const cliente = new ClienteIdentidade({
    baseUrl: 'http://identidade.local',
    clienteId: duplo.cliente.id,
    clienteSegredo: duplo.cliente.segredo,
    fetch: duplo.fetch,
  });
  const sessao = await cliente.entrar({
    empresa: 'aurora',
    email: 'gestor@demo.local',
    senha: SENHA,
  });
  const contexto = await cliente.introspectar(sessao.token);
  assert.equal(contexto.ativa, true);
  assert.equal(contexto.ativa && contexto.contexto.papel, 'gestor');
  const quadro = await cliente.quadro(sessao.token);
  assert.equal(quadro.pessoas.length, 4);
  await cliente.sair(sessao.token);
  assert.equal((await cliente.introspectar(sessao.token)).ativa, false);
});

test('os identificadores do cenário são estáveis e consultáveis pelo teste', async () => {
  const duplo = cenario();
  const unidade = duplo.unidadeId('aurora', 'Unidade 01');
  assert.match(unidade, /^[0-9a-f-]{36}$/);
  assert.notEqual(unidade, duplo.unidadeId('aurora', 'Unidade 02'));
  // A mesma unidade em empresas diferentes precisa ser identificador diferente.
  assert.notEqual(unidade, duplo.unidadeId('horizonte', 'Unidade 01'));
  const sessao = await alvo(duplo).chamar('POST', '/api/entrar', {
    corpo: { empresa: 'aurora', email: 'gestor@demo.local', senha: SENHA },
  });
  assert.equal(
    sessao.dados.contexto.unidade_id,
    unidade,
    'a entrada é a primeira em ordem alfabética',
  );
  assert.equal(sessao.dados.contexto.empresa_id, duplo.empresaId('aurora'));
  assert.equal(sessao.dados.contexto.id, duplo.pessoaId('gestor@demo.local'));
});

test('expirar a sessão pelo duplo derruba o acesso sem esperar oito horas', async () => {
  const duplo = cenario();
  const a = alvo(duplo);
  const sessao = await a.chamar('POST', '/api/entrar', {
    corpo: { empresa: 'aurora', email: 'admin@demo.local', senha: SENHA },
  });
  const perguntar = () =>
    a.chamar('POST', '/api/introspeccao', { corpo: { token: sessao.dados.token } });
  assert.equal((await perguntar()).dados.ativa, true);
  duplo.expirarTudo();
  assert.equal((await perguntar()).dados.ativa, false);
});

test('empresas diferentes não enxergam o quadro uma da outra', async () => {
  const a = alvo(cenario());
  const aurora = await a.chamar('POST', '/api/entrar', {
    corpo: { empresa: 'aurora', email: 'operador@demo.local', senha: SENHA },
  });
  const horizonte = await a.chamar('POST', '/api/entrar', {
    corpo: { empresa: 'horizonte', email: 'admin@demo.local', senha: SENHA },
  });
  const la = (await a.chamar('GET', '/api/quadro', { sessao: horizonte.dados.token })).dados;
  // Camila só existe em Aurora; se ela aparecer no quadro de Horizonte, o duplo
  // está mentindo sobre o isolamento e testaria o produto contra uma fantasia.
  assert.ok(!la.pessoas.some((p: any) => p.id === aurora.dados.contexto.id));
  assert.equal(la.unidades.length, 1);
});
