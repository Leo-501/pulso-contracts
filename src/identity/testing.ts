import {
  esquemaLogin,
  esquemaPessoa,
  esquemaSenha,
  esquemaUnidade,
  esquemaVinculo,
  type Papel,
} from '../index.js';
import { esquemaPedidoIntrospeccao } from './index.js';
import { esquemaLoginAplicativo } from '../mobile.js';

/**
 * Identidade de mentira, em memória, para a suíte de um produto.
 *
 * Ela é um `fetch`, não um cliente: quem estiver sendo testado usa o
 * `ClienteIdentidade` de verdade, com o cache, o envio compartilhado e a falha
 * fechada reais. Só o outro lado da rede é simulado.
 *
 * Existe porque a alternativa — cada produto subir o serviço de identidade na
 * própria suíte — obrigaria a depender do repositório dele, que é privado, e a
 * empilhar dependência git dentro de dependência git, o que o pnpm recusa.
 *
 * A fidelidade não é promessa: é verificada. A bateria `conformidadeIdentidade`
 * roda contra este duplo e contra o serviço de verdade, e uma divergência
 * derruba um dos dois.
 */

export * from './conformance.js';

const uuid = () => globalThis.crypto.randomUUID();
const SESSAO_MS = 8 * 3_600_000;

export type EmpresaDuplo = {
  apelido: string;
  nome: string;
  unidades: { nome: string; cidade?: string; fuso?: string }[];
};
export type PessoaDuplo = {
  email: string;
  nome: string;
  senha: string;
  ativo?: boolean;
  trocar_senha?: boolean;
  vinculos: { empresa: string; papel: Papel; unidades?: string[]; ativo?: boolean }[];
};
export type EspecificacaoDuplo = {
  cliente?: { id: string; segredo: string };
  empresas: EmpresaDuplo[];
  pessoas: PessoaDuplo[];
};

type Unidade = { id: string; nome: string; cidade: string; fuso: string; empresa_id: string };
type Empresa = { id: string; apelido: string; nome: string };
type Vinculo = { papel: Papel; ativo: boolean; unidades: Set<string> };
type Pessoa = {
  id: string;
  email: string;
  nome: string;
  senha: string;
  ativo: boolean;
  trocar_senha: boolean;
  vinculos: Map<string, Vinculo>;
};
type Sessao = {
  token: string;
  pessoa: string;
  empresa: string;
  unidade: string;
  tipo: 'painel' | 'aplicativo';
  expira: number;
};

export type IdentidadeDuplo = {
  /** Passe para `new ClienteIdentidade({ fetch })`. */
  fetch: typeof globalThis.fetch;
  cliente: { id: string; segredo: string };
  empresaId(apelido: string): string;
  unidadeId(apelido: string, unidade: string): string;
  pessoaId(email: string): string;
  /** Rotas pedidas, na ordem, para o teste conferir que o produto não fala demais. */
  chamadas: { metodo: string; caminho: string }[];
  /** Adianta o relógio das sessões, para exercitar expiração sem esperar. */
  expirarTudo(): void;
};

class ErroHttp extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export function criarIdentidadeDuplo(spec: EspecificacaoDuplo): IdentidadeDuplo {
  const cliente = spec.cliente ?? { id: 'produto', segredo: 'segredo-de-teste' };
  const empresas = new Map<string, Empresa>();
  const unidades = new Map<string, Unidade>();
  const pessoas = new Map<string, Pessoa>();
  const sessoes = new Map<string, Sessao>();
  const chamadas: { metodo: string; caminho: string }[] = [];
  // Mesmo limite do serviço: sem ele, o duplo seria mais permissivo que a
  // produção e um teste de força bruta passaria aqui e falharia lá.
  const tentativas = new Map<string, number>();

  for (const e of spec.empresas) {
    const empresa: Empresa = { id: uuid(), apelido: e.apelido, nome: e.nome };
    empresas.set(e.apelido, empresa);
    for (const u of e.unidades)
      unidades.set(e.apelido + '/' + u.nome, {
        id: uuid(),
        nome: u.nome,
        cidade: u.cidade ?? 'Cidade',
        fuso: u.fuso ?? 'America/Sao_Paulo',
        empresa_id: empresa.id,
      });
  }
  for (const p of spec.pessoas) {
    const pessoa: Pessoa = {
      id: uuid(),
      email: p.email.toLowerCase(),
      nome: p.nome,
      senha: p.senha,
      ativo: p.ativo ?? true,
      trocar_senha: p.trocar_senha ?? false,
      vinculos: new Map(),
    };
    for (const v of p.vinculos) {
      const empresa = empresas.get(v.empresa);
      if (!empresa) throw new Error(`empresa desconhecida no duplo: ${v.empresa}`);
      const nomes =
        v.unidades ?? spec.empresas.find((e) => e.apelido === v.empresa)!.unidades.map((u) => u.nome);
      pessoa.vinculos.set(empresa.id, {
        papel: v.papel,
        ativo: v.ativo ?? true,
        unidades: new Set(nomes.map((n) => unidades.get(v.empresa + '/' + n)!.id)),
      });
    }
    pessoas.set(pessoa.email, pessoa);
  }

  const porId = (id: string) => [...pessoas.values()].find((p) => p.id === id);
  const unidadePorId = (id: string) => [...unidades.values()].find((u) => u.id === id);
  const empresaPorId = (id: string) => [...empresas.values()].find((e) => e.id === id);

  /** Unidade de entrada: a primeira em ordem alfabética, nunca a de menor uuid. */
  const entrada = (vinculo: Vinculo) =>
    [...vinculo.unidades]
      .map((id) => unidadePorId(id)!)
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id))[0];

  const contextoDe = (sessao: Sessao) => {
    const pessoa = porId(sessao.pessoa)!;
    const vinculo = pessoa.vinculos.get(sessao.empresa)!;
    const unidade = unidadePorId(sessao.unidade)!;
    return {
      id: pessoa.id,
      nome: pessoa.nome,
      email: pessoa.email,
      empresa_id: sessao.empresa,
      empresa_nome: empresaPorId(sessao.empresa)!.nome,
      unidade_id: unidade.id,
      unidade_nome: unidade.nome,
      fuso: unidade.fuso,
      papel: vinculo.papel,
      trocar_senha: pessoa.trocar_senha,
    };
  };

  /** Mesma verificação que a resolução do serviço faz a cada pergunta. */
  const viva = (sessao: Sessao | undefined, tipo: 'painel' | 'aplicativo') => {
    if (!sessao || sessao.tipo !== tipo || sessao.expira <= Date.now()) return undefined;
    const pessoa = porId(sessao.pessoa);
    const vinculo = pessoa?.vinculos.get(sessao.empresa);
    if (!pessoa?.ativo || !vinculo?.ativo) return undefined;
    if (!vinculo.unidades.has(sessao.unidade)) return undefined;
    return sessao;
  };

  const emitir = (
    pessoa: Pessoa,
    empresa: string,
    unidade: string,
    tipo: 'painel' | 'aplicativo',
  ) => {
    const sessao: Sessao = {
      token: [...Array(8)]
        .map(() => uuid().replace(/-/g, ''))
        .join('')
        .slice(0, 64),
      pessoa: pessoa.id,
      empresa,
      unidade,
      tipo,
      expira: Date.now() + SESSAO_MS,
    };
    sessoes.set(sessao.token, sessao);
    return {
      token: sessao.token,
      expira_em: new Date(sessao.expira).toISOString(),
      contexto: contextoDe(sessao),
    };
  };

  function autenticar(corpo: unknown, aplicativo: boolean) {
    const dados = aplicativo ? esquemaLoginAplicativo.parse(corpo) : esquemaLogin.parse(corpo);
    const chave = `${dados.empresa}:${dados.email.toLowerCase()}`;
    const usadas = (tentativas.get(chave) ?? 0) + 1;
    tentativas.set(chave, usadas);
    if (usadas > 10) throw new ErroHttp(403, 'Muitas tentativas. Aguarde 15 minutos.');
    const empresa = empresas.get(dados.empresa);
    const pessoa = pessoas.get(dados.email.toLowerCase());
    const vinculo = empresa && pessoa?.vinculos.get(empresa.id);
    // Empresa errada e senha errada dão a mesma resposta: distinguir vazaria a
    // existência da conta.
    if (!empresa || !pessoa || !vinculo || !pessoa.ativo || !vinculo.ativo)
      throw new ErroHttp(401, 'Empresa, e-mail ou senha inválidos.');
    if (pessoa.senha !== dados.senha)
      throw new ErroHttp(401, 'Empresa, e-mail ou senha inválidos.');
    if (aplicativo && !['tecnico', 'solicitante'].includes(vinculo.papel))
      throw new ErroHttp(
        403,
        'Este aplicativo atende técnicos e solicitantes. Use o painel para os demais perfis.',
      );
    tentativas.delete(chave);
    return emitir(pessoa, empresa.id, entrada(vinculo).id, aplicativo ? 'aplicativo' : 'painel');
  }

  function sessaoDe(cabecalhos: Headers) {
    const token = cabecalhos.get('x-pulso-sessao') ?? '';
    const tipo = cabecalhos.get('x-pulso-tipo-sessao') === 'aplicativo' ? 'aplicativo' : 'painel';
    const sessao = viva(sessoes.get(token), tipo);
    if (!sessao) throw new ErroHttp(401, 'Sua sessão expirou. Entre novamente.');
    return sessao;
  }

  function administrador(sessao: Sessao) {
    const contexto = contextoDe(sessao);
    if (contexto.trocar_senha)
      throw new ErroHttp(403, 'Defina uma nova senha antes de continuar.');
    if (contexto.papel !== 'administrador')
      throw new ErroHttp(403, 'Esta ação exige um administrador da empresa.');
    return contexto;
  }

  /** Um administrador só concede as unidades em que ele próprio atua. */
  function unidadesPermitidas(sessao: Sessao, ids: string[]) {
    const minhas = porId(sessao.pessoa)!.vinculos.get(sessao.empresa)!.unidades;
    if (!ids.every((id) => minhas.has(id)))
      throw new ErroHttp(400, 'Só é possível conceder acesso às unidades em que você atua.');
  }

  const temporaria = () => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = [...Array(12)].map(() => Math.floor(Math.random() * 256));
    return (
      bytes
        .slice(0, 10)
        .map((b) => alfabeto[b % alfabeto.length])
        .join('') +
      String(bytes[10] % 10) +
      String(bytes[11] % 10)
    );
  };

  const derrubarSessoes = (pessoaId: string, empresa?: string, preservar?: string) => {
    for (const [token, s] of sessoes)
      if (s.pessoa === pessoaId && (empresa === undefined || s.empresa === empresa) && token !== preservar)
        sessoes.delete(token);
  };

  const pessoasDa = (empresaId: string) =>
    [...pessoas.values()]
      .filter((p) => p.vinculos.has(empresaId))
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id));

  function rotear(metodo: string, caminho: string, corpo: any, cabecalhos: Headers): unknown {
    if (metodo === 'POST' && caminho === '/api/introspeccao') {
      // Validar aqui não é zelo: token vazio é pedido malformado, não token
      // inválido, e o serviço devolve 400. Sem isto o duplo era mais tolerante
      // que a produção — foi o que a conformidade pegou na primeira execução.
      const pedido = esquemaPedidoIntrospeccao.parse(corpo);
      const sessao = viva(sessoes.get(pedido.token), pedido.tipo);
      // Sempre 200. Token inválido é `ativa:false`, nunca erro: distinguir por
      // código transformaria a rota em oráculo para quem tivesse a credencial.
      if (!sessao) return { ativa: false };
      return {
        ativa: true,
        contexto: contextoDe(sessao),
        expira_em: new Date(sessao.expira).toISOString(),
      };
    }
    if (metodo === 'POST' && caminho === '/api/entrar') return autenticar(corpo, false);
    if (metodo === 'POST' && caminho === '/api/entrar/aplicativo') return autenticar(corpo, true);
    if (metodo === 'POST' && caminho === '/api/sair') {
      sessoes.delete(cabecalhos.get('x-pulso-sessao') ?? '');
      return { ok: true };
    }

    const sessao = sessaoDe(cabecalhos);

    if (metodo === 'GET' && caminho === '/api/unidades') {
      const vinculo = porId(sessao.pessoa)!.vinculos.get(sessao.empresa)!;
      return [...vinculo.unidades]
        .map((id) => unidadePorId(id)!)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((u) => ({ id: u.id, nome: u.nome, cidade: u.cidade }));
    }
    if (metodo === 'POST' && caminho === '/api/unidade') {
      const { unidade_id } = esquemaUnidade.parse(corpo);
      const pessoa = porId(sessao.pessoa)!;
      if (!pessoa.vinculos.get(sessao.empresa)!.unidades.has(unidade_id))
        throw new ErroHttp(403, 'Você não tem acesso a esta unidade.');
      const emitida = emitir(pessoa, sessao.empresa, unidade_id, 'painel');
      // A anterior é revogada: um token antigo que continuasse valendo carregaria
      // o escopo da unidade de antes.
      sessoes.delete(sessao.token);
      return emitida;
    }
    if (metodo === 'POST' && caminho === '/api/senha') {
      const dados = esquemaSenha.parse(corpo);
      const pessoa = porId(sessao.pessoa)!;
      if (pessoa.senha !== dados.atual) throw new ErroHttp(401, 'Senha atual incorreta.');
      pessoa.senha = dados.nova;
      pessoa.trocar_senha = false;
      derrubarSessoes(pessoa.id, undefined, sessao.token);
      return { ok: true };
    }
    if (metodo === 'GET' && caminho === '/api/quadro') {
      return {
        gerado_em: new Date().toISOString(),
        // Quem tem vínculo inativo continua vindo: sumir com a linha quebraria o
        // cruzamento de nome no histórico de quem já saiu.
        pessoas: pessoasDa(sessao.empresa).map((p) => {
          const v = p.vinculos.get(sessao.empresa)!;
          return {
            id: p.id,
            nome: p.nome,
            email: p.email,
            ativo: p.ativo,
            papel: v.papel,
            vinculo_ativo: v.ativo,
            unidade_ids: [...v.unidades].sort(),
          };
        }),
        unidades: [...unidades.values()]
          .filter((u) => u.empresa_id === sessao.empresa)
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .map((u) => ({ id: u.id, nome: u.nome, cidade: u.cidade, fuso: u.fuso })),
      };
    }

    if (metodo === 'GET' && caminho === '/api/pessoas') {
      administrador(sessao);
      return {
        pessoas: pessoasDa(sessao.empresa)
          .filter((p) => p.ativo)
          .map((p) => {
            const v = p.vinculos.get(sessao.empresa)!;
            return {
              id: p.id,
              nome: p.nome,
              email: p.email,
              trocar_senha: p.trocar_senha,
              papel: v.papel,
              ativo: v.ativo,
              unidade_ids: [...v.unidades].sort(),
            };
          }),
        unidades: [...porId(sessao.pessoa)!.vinculos.get(sessao.empresa)!.unidades]
          .map((id) => unidadePorId(id)!)
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .map((u) => ({ id: u.id, nome: u.nome, cidade: u.cidade })),
      };
    }
    if (metodo === 'POST' && caminho === '/api/pessoas') {
      administrador(sessao);
      const dados = esquemaPessoa.parse(corpo);
      unidadesPermitidas(sessao, dados.unidade_ids);
      const email = dados.email.toLowerCase();
      const existente = pessoas.get(email);
      if (existente?.vinculos.has(sessao.empresa))
        throw new ErroHttp(409, 'Esta pessoa já tem acesso a esta empresa.');
      const senha = temporaria();
      // Quem já usa o portfólio noutra empresa mantém a senha que tem; devolver
      // uma temporária aqui invalidaria o acesso que ela já usa.
      const pessoa: Pessoa = existente ?? {
        id: uuid(),
        email,
        nome: dados.nome,
        senha,
        ativo: true,
        trocar_senha: true,
        vinculos: new Map(),
      };
      pessoa.vinculos.set(sessao.empresa, {
        papel: dados.papel,
        ativo: true,
        unidades: new Set(dados.unidade_ids),
      });
      pessoas.set(email, pessoa);
      return {
        id: pessoa.id,
        email,
        nome: pessoa.nome,
        papel: dados.papel,
        senha_temporaria: existente ? null : senha,
      };
    }
    const alvo = /^\/api\/pessoas\/([^/]+)(\/senha)?$/.exec(caminho);
    if (metodo === 'POST' && alvo) {
      administrador(sessao);
      const id = decodeURIComponent(alvo[1]);
      const pessoa = porId(id);
      const vinculo = pessoa?.vinculos.get(sessao.empresa);
      if (!pessoa || !vinculo) throw new ErroHttp(404, 'Vínculo não encontrado nesta empresa.');
      if (alvo[2]) {
        const senha = temporaria();
        pessoa.senha = senha;
        pessoa.trocar_senha = true;
        derrubarSessoes(pessoa.id);
        return { id, senha_temporaria: senha };
      }
      const dados = esquemaVinculo.parse(corpo);
      if (!Object.keys(dados).length) throw new ErroHttp(400, 'Informe o que deve mudar.');
      if (
        id === sessao.pessoa &&
        (dados.ativo === false || (dados.papel && dados.papel !== 'administrador'))
      )
        throw new ErroHttp(400, 'Você não pode remover o próprio acesso de administrador.');
      if (dados.papel !== undefined) vinculo.papel = dados.papel;
      if (dados.ativo !== undefined) vinculo.ativo = dados.ativo;
      if (dados.unidade_ids) {
        unidadesPermitidas(sessao, dados.unidade_ids);
        vinculo.unidades = new Set(dados.unidade_ids);
      }
      derrubarSessoes(pessoa.id, sessao.empresa);
      return { ok: true };
    }
    throw new ErroHttp(404, 'Rota inexistente na identidade de teste: ' + metodo + ' ' + caminho);
  }

  const fetchImpl = (async (entrada: any, init: any = {}) => {
    const url = new URL(String(entrada));
    const metodo = (init.method ?? 'GET').toUpperCase();
    const cabecalhos = new Headers(init.headers ?? {});
    chamadas.push({ metodo, caminho: url.pathname });
    // Nenhuma rota é anônima. Esta falha não é recusa do usuário: ninguém acerta a
    // senha se o produto não consegue nem perguntar, e por isso ela vem marcada.
    if (
      cabecalhos.get('x-pulso-cliente') !== cliente.id ||
      cabecalhos.get('authorization') !== 'Bearer ' + cliente.segredo
    )
      return json(401, {
        mensagem: 'Credencial de serviço inválida.',
        codigo: 'credencial_servico',
      });
    let corpo: any;
    if (init.body !== undefined) {
      try {
        corpo = JSON.parse(init.body);
      } catch {
        return json(400, { mensagem: 'Confira os campos informados.' });
      }
    }
    try {
      return json(metodo === 'POST' ? 201 : 200, rotear(metodo, url.pathname, corpo, cabecalhos));
    } catch (erro: any) {
      if (erro instanceof ErroHttp)
        return json(erro.status, { mensagem: erro.message, ...erro.extra });
      if (erro?.issues)
        return json(400, {
          mensagem: 'Confira os campos informados.',
          campos: erro.issues.map((i: any) => ({
            campo: i.path.join('.'),
            mensagem: i.message,
          })),
        });
      return json(500, { mensagem: 'Falha na identidade de teste: ' + erro?.message });
    }
  }) as unknown as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    cliente,
    chamadas,
    empresaId: (apelido) => empresas.get(apelido)!.id,
    unidadeId: (apelido, unidade) => unidades.get(apelido + '/' + unidade)!.id,
    pessoaId: (email) => pessoas.get(email.toLowerCase())!.id,
    expirarTudo: () => {
      for (const s of sessoes.values()) s.expira = Date.now() - 1;
    },
  };
}

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
