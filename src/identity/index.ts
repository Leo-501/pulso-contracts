import { z } from 'zod';
import { esquemaId, papeis, type Papel } from '../index.js';

// Contrato entre o serviço de identidade (`pulso-identity`) e os produtos que
// dependem dele. O token da sessão é opaco de propósito: o produto não o
// interpreta, ele pergunta. É isso que preserva a revogação — uma sessão
// encerrada para de valer sem esperar prazo de expiração de token assinado.

/**
 * Tipo da sessão. O serviço separa sessão de painel de sessão de aplicativo, e
 * toda rota que recebe uma sessão precisa saber qual das duas está chegando:
 * perguntar pelo tipo errado é o mesmo que perguntar por uma sessão inexistente.
 */
export type TipoSessao = 'painel' | 'aplicativo';

export const esquemaPedidoIntrospeccao = z
  .object({
    token: z.string().min(1).max(512),
    tipo: z.enum(['painel', 'aplicativo']).default('painel'),
  })
  .strict();
export type PedidoIntrospeccao = z.infer<typeof esquemaPedidoIntrospeccao>;

/** Contexto resolvido de quem está chamando: empresa, unidade e papel. */
export type Contexto = {
  id: string;
  nome: string;
  email: string;
  empresa_id: string;
  empresa_nome: string;
  unidade_id: string;
  unidade_nome: string;
  fuso: string;
  papel: Papel;
  trocar_senha: boolean;
};

/**
 * Resposta sempre 200, mesmo para token inválido, no espírito da RFC 7662.
 * Distinguir "inválido" de "erro do serviço" por código HTTP transformaria a
 * rota em oráculo para quem tivesse a credencial de serviço.
 */
export type Introspeccao = { ativa: false } | { ativa: true; contexto: Contexto; expira_em: string };

const esquemaContexto = z.object({
  id: esquemaId,
  nome: z.string(),
  email: z.string(),
  empresa_id: esquemaId,
  empresa_nome: z.string(),
  unidade_id: esquemaId,
  unidade_nome: z.string(),
  fuso: z.string(),
  papel: z.enum(papeis),
  trocar_senha: z.boolean(),
});
export const esquemaIntrospeccao: z.ZodType<Introspeccao> = z.union([
  // Estrita: nada acompanha uma negativa. Contexto junto de `ativa:false`
  // indica serviço confuso, e aceitar isso seria aceitar um estado impossível.
  z.object({ ativa: z.literal(false) }).strict(),
  // Tolerante: campo novo aqui é mudança aditiva, e um consumidor antigo precisa
  // continuar funcionando quando a identidade for implantada antes dele.
  z.object({
    ativa: z.literal(true),
    contexto: esquemaContexto,
    expira_em: z.string(),
  }),
]);

/** Sessão emitida pela identidade. O produto guarda o token como preferir. */
export type SessaoEmitida = { token: string; expira_em: string; contexto: Contexto };
export const esquemaSessaoEmitida = z.object({
  token: z.string(),
  expira_em: z.string(),
  contexto: esquemaContexto,
});

/**
 * Quadro de pessoas de uma empresa, para o produto manter projeção local.
 *
 * A projeção existe para o produto cruzar nome de responsável e listar a equipe
 * sem um salto de rede por linha, e para as chaves estrangeiras de histórico
 * continuarem valendo. Ela **não é fonte de verdade de acesso**: quem decide se
 * alguém entra é a introspecção, a cada requisição. Projeção atrasada não abre
 * porta; ela apenas deixa de fechar uma que já está fechada.
 */
export const esquemaQuadro = z.object({
  gerado_em: z.string(),
  pessoas: z.array(
    z.object({
      id: esquemaId,
      nome: z.string(),
      email: z.string(),
      ativo: z.boolean(),
      papel: z.enum(papeis),
      vinculo_ativo: z.boolean(),
      unidade_ids: z.array(esquemaId),
    }),
  ),
  unidades: z.array(
    z.object({
      id: esquemaId,
      nome: z.string(),
      cidade: z.string(),
      fuso: z.string(),
    }),
  ),
});
export type Quadro = z.infer<typeof esquemaQuadro>;

/** Conta criada. A senha temporária vem uma única vez e não é recuperável. */
export const esquemaContaCriada = z.object({
  id: esquemaId,
  email: z.string(),
  nome: z.string(),
  papel: z.enum(papeis),
  senha_temporaria: z.string().nullable(),
});
export type ContaCriada = z.infer<typeof esquemaContaCriada>;

export const esquemaListaContas = z.object({
  pessoas: z.array(
    z.object({
      id: esquemaId,
      nome: z.string(),
      email: z.string(),
      trocar_senha: z.boolean(),
      papel: z.enum(papeis),
      ativo: z.boolean(),
      unidade_ids: z.array(esquemaId),
    }),
  ),
  unidades: z.array(z.object({ id: esquemaId, nome: z.string(), cidade: z.string() })),
});
export type ListaContas = z.infer<typeof esquemaListaContas>;

export const esquemaListaUnidades = z.array(
  z.object({ id: esquemaId, nome: z.string(), cidade: z.string() }),
);

export type OpcoesClienteIdentidade = {
  baseUrl: string;
  clienteId: string;
  clienteSegredo: string;
  /**
   * Janela em que uma introspecção positiva é reaproveitada. É o atraso máximo
   * da revogação por expiração: encerrar uma sessão só surte efeito no produto
   * depois disso. Zero desliga o cache e devolve revogação imediata ao custo de
   * um salto de rede por requisição.
   *
   * Revogação que alguém **pediu** não espera esta janela: as rotas que
   * derrubam sessão do outro lado chamam `esquecerTudo`.
   */
  cacheMs?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

const esquemaOk = z.object({ ok: z.boolean() });
const esquemaRedefinicao = z.object({ id: esquemaId, senha_temporaria: z.string() });

type Entrada = { ate: number; valor: Extract<Introspeccao, { ativa: true }> };

export class IdentidadeIndisponivel extends Error {
  constructor(causa: unknown) {
    super('O serviço de identidade não respondeu.');
    this.name = 'IdentidadeIndisponivel';
    this.cause = causa;
  }
}

/**
 * Recusa da identidade: credencial inválida, senha errada, papel insuficiente.
 * Carrega o código e a mensagem originais para o produto repassá-los sem
 * reescrever regra que não é dele.
 */
export class IdentidadeRecusou extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly campos?: { campo: string; mensagem: string }[],
  ) {
    super(mensagem);
    this.name = 'IdentidadeRecusou';
  }
}

/**
 * Cliente de introspecção com cache curto.
 *
 * Falha fechado: se a identidade não responde, `introspectar` lança em vez de
 * liberar o acesso. A consequência é que a identidade vira dependência dura de
 * disponibilidade de todo produto do portfólio — o preço de manter a revogação
 * síncrona em vez de usar token assinado.
 *
 * Só resposta positiva entra no cache. Negativa nunca: um token recém-emitido
 * que tenha sido perguntado cedo demais ficaria marcado como inválido.
 */
export class ClienteIdentidade {
  private readonly cache = new Map<string, Entrada>();
  private readonly emCurso = new Map<string, Promise<Introspeccao>>();
  private readonly cacheMs: number;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly opcoes: OpcoesClienteIdentidade) {
    this.cacheMs = opcoes.cacheMs ?? 5_000;
    this.timeoutMs = opcoes.timeoutMs ?? 3_000;
    this.fetch = opcoes.fetch ?? globalThis.fetch;
  }

  async introspectar(token: string, tipo: TipoSessao = 'painel'): Promise<Introspeccao> {
    const chave = tipo + ':' + token;
    const agora = Date.now();
    const guardada = this.cache.get(chave);
    if (guardada && guardada.ate > agora) return guardada.valor;
    if (guardada) this.cache.delete(chave);
    // Requisições simultâneas com o mesmo token compartilham um único envio:
    // sem isso, uma rajada de chamadas do mesmo cliente vira uma rajada igual
    // contra a identidade.
    const jaIndo = this.emCurso.get(chave);
    if (jaIndo) return jaIndo;
    const promessa = this.perguntar(token, tipo)
      .then((resultado) => {
        if (resultado.ativa && this.cacheMs > 0)
          this.cache.set(chave, { ate: Date.now() + this.cacheMs, valor: resultado });
        return resultado;
      })
      .finally(() => this.emCurso.delete(chave));
    this.emCurso.set(chave, promessa);
    return promessa;
  }

  /** Descarta a entrada em cache. O produto chama isto ao encerrar a sessão. */
  esquecer(token: string) {
    for (const tipo of ['painel', 'aplicativo']) this.cache.delete(tipo + ':' + token);
  }

  /**
   * Descarta o cache inteiro.
   *
   * Existe para a revogação pedida por uma pessoa. O cache é indexado por token,
   * e um administrador que desativa um vínculo não conhece os tokens de quem ele
   * desativou — são opacos e vivem na identidade. Sem isto, quem acabou de
   * perder o acesso seguiria entrando pela janela inteira do cache.
   *
   * É grosseiro de propósito: custa uma introspecção a mais por sessão viva, e
   * mudança de acesso é rara. O contrário — deixar valer um acesso que alguém
   * mandou cortar — não é aceitável em nenhuma janela.
   */
  esquecerTudo() {
    this.cache.clear();
  }

  /**
   * Autentica e devolve a sessão. O produto guarda o token como preferir — o
   * painel em cookie próprio, o aplicativo em armazenamento seguro. A identidade
   * não emite cookie: cookie é preso a domínio, e produtos em hosts diferentes
   * não o compartilhariam.
   */
  entrar(corpo: unknown) {
    return this.chamar('/api/entrar', esquemaSessaoEmitida, { metodo: 'POST', corpo });
  }
  entrarAplicativo(corpo: unknown) {
    return this.chamar('/api/entrar/aplicativo', esquemaSessaoEmitida, { metodo: 'POST', corpo });
  }
  async sair(token: string, tipo: TipoSessao = 'painel') {
    this.esquecer(token);
    await this.chamar('/api/sair', esquemaOk, { metodo: 'POST', sessao: token, tipo });
  }
  unidades(token: string, tipo: TipoSessao = 'painel') {
    return this.chamar('/api/unidades', esquemaListaUnidades, {
      metodo: 'GET',
      sessao: token,
      tipo,
    });
  }
  async trocarUnidade(token: string, corpo: unknown) {
    const emitida = await this.chamar('/api/unidade', esquemaSessaoEmitida, {
      metodo: 'POST',
      corpo,
      sessao: token,
    });
    // A sessão anterior foi revogada do outro lado; manter a entrada em cache
    // deixaria o token morto valendo pela janela inteira.
    this.esquecer(token);
    return emitida;
  }
  async trocarSenha(token: string, corpo: unknown) {
    const resultado = await this.chamar('/api/senha', esquemaOk, {
      metodo: 'POST',
      corpo,
      sessao: token,
    });
    // A troca encerrou as outras sessões da pessoa e mudou `trocar_senha`. Os
    // dois efeitos alcançam entradas que este processo não sabe associar a ela.
    this.esquecerTudo();
    return resultado;
  }

  /** Quadro de pessoas da empresa da sessão, para o produto projetar. */
  quadro(token: string, tipo: TipoSessao = 'painel') {
    return this.chamar('/api/quadro', esquemaQuadro, { metodo: 'GET', sessao: token, tipo });
  }
  contas(token: string) {
    return this.chamar('/api/pessoas', esquemaListaContas, { metodo: 'GET', sessao: token });
  }
  criarConta(token: string, corpo: unknown) {
    return this.chamar('/api/pessoas', esquemaContaCriada, {
      metodo: 'POST',
      corpo,
      sessao: token,
    });
  }
  async alterarConta(token: string, id: string, corpo: unknown) {
    const resultado = await this.chamar('/api/pessoas/' + encodeURIComponent(id), esquemaOk, {
      metodo: 'POST',
      corpo,
      sessao: token,
    });
    // A identidade acabou de apagar as sessões da pessoa alterada. O cache aqui é
    // por token e não sabe quais eram dela, então descarta tudo.
    this.esquecerTudo();
    return resultado;
  }
  async redefinirSenha(token: string, id: string) {
    const resultado = await this.chamar(
      '/api/pessoas/' + encodeURIComponent(id) + '/senha',
      esquemaRedefinicao,
      { metodo: 'POST', sessao: token },
    );
    // Redefinir a senha derruba todas as sessões da pessoa, inclusive as que
    // estão em cache aqui sob tokens que este processo não sabe associar a ela.
    this.esquecerTudo();
    return resultado;
  }

  /**
   * A introspecção nunca recusa um token com 4xx — token inválido é
   * `ativa:false` em 200. Então qualquer 4xx aqui é problema do produto,
   * tipicamente credencial de serviço errada, e precisa falhar fechado.
   *
   * Deixar a recusa atravessar seria desastroso: o produto repassaria 401 ao
   * navegador e um erro de configuração no deploy deslogaria todo mundo de uma
   * vez, em vez de devolver indisponibilidade enquanto alguém conserta.
   */
  private async perguntar(token: string, tipo: TipoSessao): Promise<Introspeccao> {
    try {
      return await this.chamar('/api/introspeccao', esquemaIntrospeccao, {
        metodo: 'POST',
        corpo: { token, tipo },
      });
    } catch (erro) {
      if (erro instanceof IdentidadeRecusou) throw new IdentidadeIndisponivel(erro);
      throw erro;
    }
  }

  /**
   * Um único ponto de rede. A distinção que ele preserva é a que importa: 4xx é
   * recusa da identidade e atravessa com o código e a mensagem originais, que já
   * estão em português; qualquer outra coisa é indisponibilidade e falha fechado.
   * Tratar as duas igual deslogaria todo mundo durante uma queda do serviço.
   */
  private async chamar<T>(
    caminho: string,
    esquema: z.ZodType<T>,
    init: { metodo: 'GET' | 'POST'; corpo?: unknown; sessao?: string; tipo?: TipoSessao },
  ): Promise<T> {
    const cabecalhos: Record<string, string> = {
      'x-pulso-cliente': this.opcoes.clienteId,
      authorization: 'Bearer ' + this.opcoes.clienteSegredo,
    };
    if (init.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    if (init.sessao) cabecalhos['x-pulso-sessao'] = init.sessao;
    if (init.tipo) cabecalhos['x-pulso-tipo-sessao'] = init.tipo;
    let resposta: Response;
    try {
      resposta = await this.fetch(this.opcoes.baseUrl.replace(/\/+$/, '') + caminho, {
        method: init.metodo,
        headers: cabecalhos,
        body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (erro) {
      throw new IdentidadeIndisponivel(erro);
    }
    if (resposta.status >= 400 && resposta.status < 500) {
      const dados = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string;
        codigo?: string;
        campos?: { campo: string; mensagem: string }[];
      };
      // A identidade marca a falha da credencial do produto. Ela não é recusa do
      // usuário: ninguém acerta a senha se o produto não consegue nem perguntar.
      if (dados.codigo === 'credencial_servico')
        throw new IdentidadeIndisponivel(
          new Error(dados.mensagem ?? 'credencial de serviço'),
        );
      throw new IdentidadeRecusou(
        resposta.status,
        dados.mensagem ?? 'Não foi possível concluir a operação.',
        dados.campos,
      );
    }
    if (!resposta.ok) throw new IdentidadeIndisponivel(new Error('HTTP ' + resposta.status));
    return esquema.parse(await resposta.json());
  }
}
