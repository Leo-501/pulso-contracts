/**
 * Bateria de conformidade da identidade.
 *
 * As mesmas verificações rodam contra o serviço de verdade (`pulso-identity`) e
 * contra o duplo em memória (`criarIdentidadeDuplo`). Enquanto os dois passarem,
 * um produto testado com o duplo está testado contra o comportamento real; se
 * divergirem, um dos dois cai — que é o único jeito honesto de um duplo existir.
 *
 * Deliberadamente não cobre o que é próprio de cada lado: o duplo não tem RLS,
 * papéis de banco nem auditoria, e o serviço não tem `expirarTudo`. O que está
 * aqui é a fronteira que o produto enxerga.
 */

export type RespostaConformidade = { status: number; dados: any };
export type AlvoConformidade = {
  /** Chamada crua, já com a credencial de serviço válida aplicada. */
  chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    opcoes?: { corpo?: unknown; sessao?: string; tipo?: 'painel' | 'aplicativo' },
  ): Promise<RespostaConformidade>;
  /** Chamada com credencial de serviço errada. */
  chamarSemCredencial(caminho: string, corpo: unknown): Promise<RespostaConformidade>;
  dados: {
    /** Empresa com pelo menos duas unidades. */
    empresa: string;
    senha: string;
    /** Administrador da empresa. */
    administrador: string;
    /** Pessoa com vínculo em duas unidades desta empresa. */
    duasUnidades: string;
    /** Técnico, para exercitar papel sem poder administrativo. */
    tecnico: string;
  };
};

export type VerificacaoConformidade = {
  nome: string;
  rodar(alvo: AlvoConformidade): Promise<void>;
};

function ok(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new Error('conformidade: ' + mensagem);
}
const igual = (obtido: unknown, esperado: unknown, oque: string) =>
  ok(
    obtido === esperado,
    `${oque}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`,
  );

const novoEmail = () => `conformidade-${globalThis.crypto.randomUUID().slice(0, 8)}@demo.local`;

async function entrar(a: AlvoConformidade, email: string, senha?: string, empresa?: string) {
  return a.chamar('POST', '/api/entrar', {
    corpo: {
      empresa: empresa ?? a.dados.empresa,
      email,
      senha: senha ?? a.dados.senha,
    },
  });
}
const introspectar = (a: AlvoConformidade, token: string, tipo: 'painel' | 'aplicativo' = 'painel') =>
  a.chamar('POST', '/api/introspeccao', { corpo: { token, tipo } });

/** Cria uma conta descartável e devolve o que for preciso para usá-la. */
async function contaNova(
  a: AlvoConformidade,
  administrador: string,
  extra: Record<string, unknown> = {},
) {
  const unidades = (await a.chamar('GET', '/api/pessoas', { sessao: administrador })).dados.unidades;
  const criada = await a.chamar('POST', '/api/pessoas', {
    sessao: administrador,
    corpo: {
      nome: 'Pessoa de Conformidade',
      email: novoEmail(),
      papel: 'tecnico',
      unidade_ids: [unidades[0].id],
      ...extra,
    },
  });
  ok(
    criada.status < 300,
    'criar conta descartável deveria funcionar: ' + JSON.stringify(criada.dados),
  );
  return criada.dados as { id: string; email: string; senha_temporaria: string };
}

export const conformidadeIdentidade: VerificacaoConformidade[] = [
  {
    nome: 'nenhuma rota atende sem credencial de serviço, e a falha vem marcada',
    async rodar(a) {
      const sem = await a.chamarSemCredencial('/api/introspeccao', { token: 'qualquer' });
      igual(sem.status, 401, 'status sem credencial');
      // O marcador é o que impede o produto de repassar 401 ao navegador e
      // deslogar todo mundo por causa de um erro de configuração.
      igual(sem.dados?.codigo, 'credencial_servico', 'código da falha de credencial');
    },
  },
  {
    nome: 'entrar devolve token e contexto resolvido',
    async rodar(a) {
      const sessao = await entrar(a, a.dados.administrador);
      ok(sessao.status < 300, 'entrada do administrador deveria funcionar');
      ok(typeof sessao.dados.token === 'string' && sessao.dados.token.length >= 32, 'token opaco');
      igual(sessao.dados.contexto.email, a.dados.administrador, 'e-mail no contexto');
      igual(sessao.dados.contexto.papel, 'administrador', 'papel no contexto');
      ok(sessao.dados.contexto.unidade_nome, 'unidade resolvida');
      ok(Date.parse(sessao.dados.expira_em) > Date.now(), 'validade no futuro');
    },
  },
  {
    nome: 'senha errada e empresa errada dão a mesma recusa',
    async rodar(a) {
      const senha = await entrar(a, a.dados.administrador, 'senha-errada-de-proposito');
      igual(senha.status, 401, 'status da senha errada');
      const empresa = await entrar(a, a.dados.administrador, undefined, 'empresa-que-nao-existe');
      igual(empresa.status, 401, 'status da empresa errada');
      igual(empresa.dados.mensagem, senha.dados.mensagem, 'as duas mensagens precisam ser iguais');
    },
  },
  {
    nome: 'a unidade de entrada é a mesma em toda entrada',
    async rodar(a) {
      // Ordenar por uuid sorteava a unidade de quem tem mais de uma. O defeito só
      // aparece em repetição, então a verificação repete.
      const vistas = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const sessao = await entrar(a, a.dados.duasUnidades);
        ok(sessao.status < 300, 'entrada de quem tem duas unidades');
        vistas.add(sessao.dados.contexto.unidade_id);
      }
      igual(vistas.size, 1, 'unidades de entrada distintas em três entradas');
    },
  },
  {
    nome: 'introspecção devolve o contexto e nunca o token',
    async rodar(a) {
      const sessao = await entrar(a, a.dados.administrador);
      const resposta = await introspectar(a, sessao.dados.token);
      ok(resposta.status < 300, 'introspecção responde sucesso');
      igual(resposta.dados.ativa, true, 'sessão viva');
      igual(resposta.dados.contexto.id, sessao.dados.contexto.id, 'mesma pessoa');
      ok(!JSON.stringify(resposta.dados).includes(sessao.dados.token), 'o token não pode voltar');
    },
  },
  {
    nome: 'token inválido é ativa:false, não erro',
    async rodar(a) {
      for (const token of ['nao-e-um-token', 'a'.repeat(64), 'f'.repeat(64)]) {
        const resposta = await introspectar(a, token);
        ok(resposta.status < 400, `token ${JSON.stringify(token)} não pode virar erro`);
        igual(resposta.dados.ativa, false, 'token inválido');
        igual(resposta.dados.contexto, undefined, 'nada acompanha uma negativa');
      }
      // Token vazio é outra coisa: é corpo malformado, e o contrato exige min(1).
      // Tratá-lo como token inválido esconderia um produto que perdeu o token.
      igual((await introspectar(a, '')).status, 400, 'token vazio');
    },
  },
  {
    nome: 'sessão de painel não vale como aplicativo e vice-versa',
    async rodar(a) {
      const painel = await entrar(a, a.dados.tecnico);
      igual(
        (await introspectar(a, painel.dados.token, 'aplicativo')).dados.ativa,
        false,
        'painel como aplicativo',
      );
      const aplicativo = await a.chamar('POST', '/api/entrar/aplicativo', {
        corpo: {
          empresa: a.dados.empresa,
          email: a.dados.tecnico,
          senha: a.dados.senha,
          dispositivo_id: globalThis.crypto.randomUUID(),
        },
      });
      ok(aplicativo.status < 300, 'entrada do técnico pelo aplicativo');
      igual(
        (await introspectar(a, aplicativo.dados.token, 'painel')).dados.ativa,
        false,
        'aplicativo como painel',
      );
      igual(
        (await introspectar(a, aplicativo.dados.token, 'aplicativo')).dados.ativa,
        true,
        'aplicativo como aplicativo',
      );
    },
  },
  {
    nome: 'o aplicativo recusa perfis administrativos',
    async rodar(a) {
      const recusa = await a.chamar('POST', '/api/entrar/aplicativo', {
        corpo: {
          empresa: a.dados.empresa,
          email: a.dados.administrador,
          senha: a.dados.senha,
          dispositivo_id: globalThis.crypto.randomUUID(),
        },
      });
      igual(recusa.status, 403, 'administrador no aplicativo');
    },
  },
  {
    nome: 'sair revoga a sessão na hora',
    async rodar(a) {
      const sessao = await entrar(a, a.dados.administrador);
      igual((await introspectar(a, sessao.dados.token)).dados.ativa, true, 'antes de sair');
      await a.chamar('POST', '/api/sair', { sessao: sessao.dados.token, corpo: {} });
      igual((await introspectar(a, sessao.dados.token)).dados.ativa, false, 'depois de sair');
    },
  },
  {
    nome: 'a lista de unidades respeita o vínculo, não a empresa',
    async rodar(a) {
      const duas = await entrar(a, a.dados.duasUnidades);
      const tecnico = await entrar(a, a.dados.tecnico);
      const delas = (await a.chamar('GET', '/api/unidades', { sessao: duas.dados.token })).dados;
      const dele = (await a.chamar('GET', '/api/unidades', { sessao: tecnico.dados.token })).dados;
      ok(delas.length >= 2, 'quem tem duas unidades precisa ver duas');
      ok(dele.length < delas.length, 'quem tem uma não pode ver as da empresa inteira');
    },
  },
  {
    nome: 'trocar de unidade emite sessão nova e revoga a anterior',
    async rodar(a) {
      const sessao = await entrar(a, a.dados.duasUnidades);
      const unidades = (await a.chamar('GET', '/api/unidades', { sessao: sessao.dados.token }))
        .dados;
      const outra = unidades.find((u: any) => u.id !== sessao.dados.contexto.unidade_id);
      ok(outra, 'precisa haver outra unidade');
      const nova = await a.chamar('POST', '/api/unidade', {
        sessao: sessao.dados.token,
        corpo: { unidade_id: outra.id },
      });
      ok(nova.status < 300, 'troca de unidade');
      igual(nova.dados.contexto.unidade_id, outra.id, 'a unidade nova');
      ok(nova.dados.token !== sessao.dados.token, 'o token precisa ser outro');
      igual(
        (await introspectar(a, sessao.dados.token)).dados.ativa,
        false,
        'a anterior fica revogada',
      );
    },
  },
  {
    nome: 'unidade sem vínculo é recusada',
    async rodar(a) {
      const tecnico = await entrar(a, a.dados.tecnico);
      const duas = await entrar(a, a.dados.duasUnidades);
      const dele = (await a.chamar('GET', '/api/unidades', { sessao: tecnico.dados.token })).dados;
      const delas = (await a.chamar('GET', '/api/unidades', { sessao: duas.dados.token })).dados;
      const semVinculo = delas.find((u: any) => !dele.some((d: any) => d.id === u.id));
      ok(semVinculo, 'precisa haver unidade fora do vínculo do técnico');
      const recusa = await a.chamar('POST', '/api/unidade', {
        sessao: tecnico.dados.token,
        corpo: { unidade_id: semVinculo.id },
      });
      igual(recusa.status, 403, 'unidade fora do vínculo');
    },
  },
  {
    nome: 'trocar a senha encerra as outras sessões e preserva a atual',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const conta = await contaNova(a, administrador);
      const primeira = (await entrar(a, conta.email, conta.senha_temporaria)).dados.token;
      const segunda = (await entrar(a, conta.email, conta.senha_temporaria)).dados.token;
      const nova = 'Conformidade@2026!';
      const troca = await a.chamar('POST', '/api/senha', {
        sessao: segunda,
        corpo: { atual: conta.senha_temporaria, nova },
      });
      ok(troca.status < 300, 'troca de senha: ' + JSON.stringify(troca.dados));
      igual((await introspectar(a, primeira)).dados.ativa, false, 'a outra sessão cai');
      igual((await introspectar(a, segunda)).dados.ativa, true, 'a atual permanece');
      igual(
        (await introspectar(a, segunda)).dados.contexto.trocar_senha,
        false,
        'a exigência de troca some',
      );
      ok((await entrar(a, conta.email, nova)).status < 300, 'a senha nova entra');
      igual((await entrar(a, conta.email, conta.senha_temporaria)).status, 401, 'a antiga não');
    },
  },
  {
    nome: 'o quadro traz as pessoas e as unidades da empresa',
    async rodar(a) {
      const sessao = (await entrar(a, a.dados.administrador)).dados.token;
      const quadro = await a.chamar('GET', '/api/quadro', { sessao });
      ok(quadro.status < 300, 'quadro de pessoas');
      ok(Date.parse(quadro.dados.gerado_em) > 0, 'data de geração');
      ok(quadro.dados.unidades.length >= 2, 'as unidades da empresa, não as do vínculo');
      ok(
        quadro.dados.unidades.every((u: any) => u.fuso),
        'cada unidade precisa do fuso, que o produto projeta',
      );
      const eu = quadro.dados.pessoas.find((p: any) => p.email === a.dados.administrador);
      ok(eu, 'o administrador precisa aparecer no quadro');
      igual(eu.vinculo_ativo, true, 'vínculo ativo');
      ok(eu.unidade_ids.length >= 1, 'unidades do vínculo');
    },
  },
  {
    nome: 'o quadro conserva quem teve o vínculo desativado',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const conta = await contaNova(a, administrador);
      await a.chamar('POST', `/api/pessoas/${conta.id}`, {
        sessao: administrador,
        corpo: { ativo: false },
      });
      const quadro = await a.chamar('GET', '/api/quadro', { sessao: administrador });
      const pessoa = quadro.dados.pessoas.find((p: any) => p.id === conta.id);
      // Sumir com a linha quebraria o cruzamento de nome no histórico de quem saiu.
      ok(pessoa, 'quem saiu precisa continuar no quadro');
      igual(pessoa.vinculo_ativo, false, 'marcado como inativo');
    },
  },
  {
    nome: 'contas são do administrador',
    async rodar(a) {
      const tecnico = (await entrar(a, a.dados.tecnico)).dados.token;
      igual(
        (await a.chamar('GET', '/api/pessoas', { sessao: tecnico })).status,
        403,
        'técnico listando',
      );
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      ok(
        (await a.chamar('GET', '/api/pessoas', { sessao: administrador })).status < 300,
        'administrador listando',
      );
    },
  },
  {
    nome: 'a senha temporária vem uma vez e repetir o vínculo dá 409',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const unidades = (await a.chamar('GET', '/api/pessoas', { sessao: administrador })).dados
        .unidades;
      const corpo = {
        nome: 'Pessoa de Conformidade',
        email: novoEmail(),
        papel: 'tecnico',
        unidade_ids: [unidades[0].id],
      };
      const criada = await a.chamar('POST', '/api/pessoas', { sessao: administrador, corpo });
      ok(criada.status < 300, 'criação');
      ok(
        /^[A-HJ-NP-Z2-9]{10}\d{2}$/.test(criada.dados.senha_temporaria),
        'formato da senha temporária: ' + criada.dados.senha_temporaria,
      );
      igual(
        (await a.chamar('POST', '/api/pessoas', { sessao: administrador, corpo })).status,
        409,
        'vínculo repetido',
      );
      ok((await entrar(a, corpo.email, criada.dados.senha_temporaria)).status < 300, 'ela entra');
    },
  },
  {
    nome: 'senha temporária autentica mas não administra ninguém',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const conta = await contaNova(a, administrador, { papel: 'administrador' });
      const sessao = await entrar(a, conta.email, conta.senha_temporaria);
      igual(sessao.dados.contexto.trocar_senha, true, 'exigência de troca');
      igual(
        (await a.chamar('GET', '/api/pessoas', { sessao: sessao.dados.token })).status,
        403,
        'administrar com senha temporária',
      );
    },
  },
  {
    nome: 'mudar o vínculo encerra as sessões da pessoa alterada',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const conta = await contaNova(a, administrador);
      const dela = (await entrar(a, conta.email, conta.senha_temporaria)).dados.token;
      igual((await introspectar(a, dela)).dados.ativa, true, 'antes da mudança');
      const mudanca = await a.chamar('POST', `/api/pessoas/${conta.id}`, {
        sessao: administrador,
        corpo: { papel: 'solicitante' },
      });
      ok(mudanca.status < 300, 'mudança de papel');
      igual((await introspectar(a, dela)).dados.ativa, false, 'depois da mudança');
    },
  },
  {
    nome: 'redefinir a senha derruba as sessões e volta a exigir troca',
    async rodar(a) {
      const administrador = (await entrar(a, a.dados.administrador)).dados.token;
      const conta = await contaNova(a, administrador);
      const dela = (await entrar(a, conta.email, conta.senha_temporaria)).dados.token;
      const redefinida = await a.chamar('POST', `/api/pessoas/${conta.id}/senha`, {
        sessao: administrador,
        corpo: {},
      });
      ok(redefinida.status < 300, 'redefinição');
      ok(/^[A-HJ-NP-Z2-9]{10}\d{2}$/.test(redefinida.dados.senha_temporaria), 'formato');
      igual((await introspectar(a, dela)).dados.ativa, false, 'a sessão dela cai');
      const nova = await entrar(a, conta.email, redefinida.dados.senha_temporaria);
      igual(nova.dados.contexto.trocar_senha, true, 'volta a exigir troca');
    },
  },
  {
    nome: 'o administrador não remove o próprio acesso',
    async rodar(a) {
      const sessao = await entrar(a, a.dados.administrador);
      const eu = sessao.dados.contexto.id;
      for (const corpo of [{ ativo: false }, { papel: 'consulta' }]) {
        const tentativa = await a.chamar('POST', `/api/pessoas/${eu}`, {
          sessao: sessao.dados.token,
          corpo,
        });
        igual(tentativa.status, 400, 'auto-remoção com ' + JSON.stringify(corpo));
      }
      ok(
        (await a.chamar('GET', '/api/pessoas', { sessao: sessao.dados.token })).status < 300,
        'continua administrando',
      );
    },
  },
  {
    nome: 'corpo fora do contrato vira 400 com o campo apontado',
    async rodar(a) {
      const recusa = await a.chamar('POST', '/api/entrar', {
        corpo: { empresa: a.dados.empresa, email: 'nao-e-email', senha: 'x' },
      });
      igual(recusa.status, 400, 'corpo inválido');
      ok(Array.isArray(recusa.dados.campos), 'a recusa precisa apontar os campos');
      ok(
        recusa.dados.campos.some((c: any) => c.campo === 'email'),
        'o campo errado precisa estar na lista',
      );
    },
  },
  {
    /**
     * Acrescentada depois que o duplo recusou o quadro de pessoas pedido por uma
     * sessão de aplicativo. O cliente não informava o tipo, e o serviço trata
     * "sessão do tipo errado" como sessão inexistente — corretamente.
     */
    nome: 'uma sessão de aplicativo serve as rotas de sessão quando o tipo vai junto',
    async rodar(a) {
      const aplicativo = await a.chamar('POST', '/api/entrar/aplicativo', {
        corpo: {
          empresa: a.dados.empresa,
          email: a.dados.tecnico,
          senha: a.dados.senha,
          dispositivo_id: globalThis.crypto.randomUUID(),
        },
      });
      ok(aplicativo.status < 300, 'entrada pelo aplicativo');
      const token = aplicativo.dados.token;
      // Sem o tipo, a pergunta é sobre uma sessão de painel que não existe.
      igual((await a.chamar('GET', '/api/quadro', { sessao: token })).status, 401, 'quadro sem o tipo');
      const comTipo = await a.chamar('GET', '/api/quadro', { sessao: token, tipo: 'aplicativo' });
      ok(comTipo.status < 300, 'quadro com o tipo: ' + JSON.stringify(comTipo.dados));
      ok(comTipo.dados.pessoas.length > 0, 'o quadro precisa vir preenchido');
      const unidades = await a.chamar('GET', '/api/unidades', {
        sessao: token,
        tipo: 'aplicativo',
      });
      ok(unidades.status < 300, 'unidades com o tipo');
    },
  },
];
