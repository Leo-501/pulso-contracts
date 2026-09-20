import { z } from 'zod';

// O vocabulário do domínio está em docs/VOCABULARIO.md. Um termo, uma palavra,
// em todo lugar: banco, API, contrato, painel e aplicativo. Não há tradução em
// camada nenhuma — o que se chama `ordens` no PostgreSQL chama-se `ordens` aqui.

export const papeis = [
  'administrador',
  'gestor',
  'tecnico',
  'solicitante',
  'almoxarife',
  'consulta',
] as const;
export type Papel = (typeof papeis)[number];

export const situacoes = [
  'aberta',
  'planejada',
  'em_execucao',
  'pausada',
  'validacao',
  'concluida',
  'cancelada',
] as const;
export type Situacao = (typeof situacoes)[number];

export const rotulosSituacao: Record<Situacao, string> = {
  aberta: 'Aberta',
  planejada: 'Planejada',
  em_execucao: 'Em execução',
  pausada: 'Pausada',
  validacao: 'Em validação',
  concluida: 'Encerrada',
  cancelada: 'Cancelada',
};
export const rotulosPrioridade: Record<string, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};
export const rotulosPapel: Record<Papel, string> = {
  administrador: 'Administrador',
  gestor: 'Gestor de manutenção',
  tecnico: 'Técnico',
  solicitante: 'Solicitante',
  almoxarife: 'Almoxarife',
  consulta: 'Consulta',
};

export const prioridade = z.enum(['critica', 'alta', 'media', 'baixa']);
export const esquemaId = z.string().uuid();
const obrigatorio = (max = 200) =>
  z.string().trim().min(2, 'Informe pelo menos 2 caracteres.').max(max);
export const esquemaData = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .refine((valor) => {
    const d = new Date(valor + 'T12:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === valor;
  }, 'Data inválida.');

export const esquemaLogin = z
  .object({ empresa: obrigatorio(80), email: z.email(), senha: z.string().min(1).max(256) })
  .strict();

export const esquemaAtivo = z
  .object({
    codigo: obrigatorio(40),
    nome: obrigatorio(120),
    local: obrigatorio(120),
    criticidade: prioridade.default('media'),
    fabricante: z.string().trim().max(100).default(''),
    modelo: z.string().trim().max(100).default(''),
  })
  .strict();

export const esquemaSolicitacao = z
  .object({
    ativo_id: esquemaId,
    titulo: obrigatorio(160),
    descricao: obrigatorio(3000),
    maquina_parada: z.boolean().default(false),
    observado_em: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const esquemaOrdem = z
  .object({
    ativo_id: esquemaId,
    titulo: obrigatorio(160),
    descricao: z.string().trim().max(4000).default(''),
    prioridade,
    prazo: esquemaData,
    responsavel_id: esquemaId.nullable().default(null),
    tipo: z.enum(['corretiva', 'preventiva']).default('corretiva'),
  })
  .strict();

export const esquemaTriagem = z
  .object({
    acao: z.enum(['aprovar', 'rejeitar']),
    prioridade: prioridade.default('media'),
    prazo: esquemaData.optional(),
    responsavel_id: esquemaId.nullable().default(null),
    motivo: z.string().trim().max(2000).default(''),
  })
  .strict();

export const esquemaTransicao = z
  .object({
    situacao: z.enum(situacoes),
    versao: z.number().int().positive(),
    observacao: z.string().trim().max(4000).default(''),
  })
  .strict();

export const esquemaPeca = z
  .object({
    codigo: obrigatorio(40),
    nome: obrigatorio(160),
    // `unidade_medida`, e não `unidade`: unidade já é a filial da empresa, e as
    // duas com o mesmo nome trocariam um problema de idioma por um de
    // ambiguidade, que é pior.
    unidade_medida: z.enum(['un', 'L', 'kg', 'm']).default('un'),
    minimo: z.number().nonnegative().max(1000000).default(0),
  })
  .strict();

export const esquemaMovimentacao = z
  .object({
    tipo: z.enum(['entrada', 'saida', 'devolucao', 'ajuste']),
    quantidade: z
      .number()
      .finite()
      .refine((n) => n !== 0 && Math.abs(n) <= 1000000, 'Quantidade inválida.'),
    motivo: obrigatorio(1000),
    ordem_id: esquemaId.nullable().default(null),
  })
  .strict();

export const esquemaPlano = z
  .object({
    ativo_id: esquemaId,
    nome: obrigatorio(160),
    frequencia: z.enum(['semanal', 'mensal']),
    intervalo: z.number().int().min(1).max(52).default(1),
    data_base: esquemaData,
    dias_antecedencia: z.number().int().min(0).max(30).default(7),
    responsavel_id: esquemaId.nullable().default(null),
    checklist: z.array(obrigatorio(240)).min(1).max(30),
  })
  .strict();

export const esquemaChecklist = z
  .object({
    versao: z.number().int().positive(),
    respostas: z.record(z.string(), z.enum(['ok', 'nok', 'na'])),
  })
  .strict();

const transicoes: Record<Situacao, Situacao[]> = {
  aberta: ['planejada', 'em_execucao', 'cancelada'],
  planejada: ['em_execucao', 'cancelada'],
  em_execucao: ['pausada', 'validacao', 'cancelada'],
  pausada: ['em_execucao', 'cancelada'],
  validacao: ['concluida', 'em_execucao'],
  concluida: [],
  cancelada: [],
};
export function transicoesPermitidas(situacao: Situacao, papel: Papel): Situacao[] {
  if (papel === 'administrador' || papel === 'gestor') return transicoes[situacao];
  if (papel === 'tecnico')
    return transicoes[situacao].filter(
      (s) => ['em_execucao', 'pausada', 'validacao'].includes(s) && situacao !== 'validacao',
    );
  return [];
}
export function podeGerenciar(papel: Papel) {
  return papel === 'administrador' || papel === 'gestor';
}

export function dataLocal(agora = new Date(), fuso = 'America/Sao_Paulo') {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  return ['year', 'month', 'day']
    .map((chave) => partes.find((p) => p.type === chave)!.value)
    .join('-');
}
export function somarDias(data: string, dias: number) {
  const d = new Date(data + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export function dataOcorrencia(
  base: string,
  frequencia: 'semanal' | 'mensal',
  intervalo: number,
  indice: number,
) {
  if (frequencia === 'semanal') return somarDias(base, 7 * intervalo * indice);
  const [ano, mes, dia] = base.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + intervalo * indice, 1, 12));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
}

// --- Edição e inativação de cadastros -------------------------------------
// Atualização parcial: os campos ausentes preservam o valor atual.
export const esquemaAtivoEdicao = esquemaAtivo.partial().strict();
export const esquemaPecaEdicao = esquemaPeca.partial().strict();
// A recorrência não é editável neste incremento: mudar frequência, intervalo ou
// data base exige recalcular ocorrências já geradas, o que é versionamento de
// plano e continua no backlog. Só os campos sem efeito retroativo são aceitos.
export const esquemaPlanoEdicao = z
  .object({
    nome: obrigatorio(160).optional(),
    dias_antecedencia: z.number().int().min(0).max(30).optional(),
    responsavel_id: esquemaId.nullable().optional(),
  })
  .strict();
export const esquemaAtivacao = z.object({ ativo: z.boolean() }).strict();

// --- Gestão de contas ------------------------------------------------------
export const esquemaSenha = z
  .object({
    atual: z.string().min(1).max(256),
    nova: z
      .string()
      .min(10, 'Use pelo menos 10 caracteres.')
      .max(256)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Combine letras e números.'),
  })
  .strict()
  .refine((v) => v.atual !== v.nova, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['nova'],
  });
export const esquemaPessoa = z
  .object({
    nome: obrigatorio(120),
    email: z.email(),
    papel: z.enum(papeis),
    unidade_ids: z.array(esquemaId).min(1).max(50),
  })
  .strict();
export const esquemaVinculo = z
  .object({
    papel: z.enum(papeis).optional(),
    ativo: z.boolean().optional(),
    unidade_ids: z.array(esquemaId).min(1).max(50).optional(),
  })
  .strict();

// --- Seleção de unidade ----------------------------------------------------
export const esquemaUnidade = z.object({ unidade_id: esquemaId }).strict();
