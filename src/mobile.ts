import { z } from 'zod';
import {
  esquemaChecklist,
  esquemaId,
  esquemaLogin,
  esquemaSolicitacao,
  type Papel,
  type Situacao,
} from './index.js';

export const esquemaLoginAplicativo = esquemaLogin.extend({ dispositivo_id: esquemaId });

export const esquemaItemManifesto = z
  .object({
    entidade: z.enum(['ativo', 'ordem']),
    id: esquemaId,
    etag: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const esquemaDownload = z
  .object({ conhecidos: z.array(esquemaItemManifesto).max(10_000) })
  .strict();

export const esquemaOperacaoAplicativo = z.discriminatedUnion('tipo', [
  z
    .object({ id: esquemaId, tipo: z.literal('solicitacao.criar'), corpo: esquemaSolicitacao })
    .strict(),
  z
    .object({
      id: esquemaId,
      tipo: z.literal('ordem.checklist'),
      ordem_id: esquemaId,
      corpo: esquemaChecklist,
    })
    .strict(),
]);
export type OperacaoAplicativo = z.infer<typeof esquemaOperacaoAplicativo>;
export type ItemManifesto = z.infer<typeof esquemaItemManifesto>;

export type PessoaAplicativo = {
  id: string;
  empresa_id: string;
  unidade_id: string;
  papel: Papel;
  nome: string;
  email: string;
  empresa_nome: string;
  unidade_nome: string;
  fuso: string;
};
export type SessaoAplicativo = {
  token: string;
  expira_em: string;
  pessoa: PessoaAplicativo;
};
export type AtivoAplicativo = {
  id: string;
  codigo: string;
  nome: string;
  local: string;
  criticidade: string;
  fabricante: string;
  modelo: string;
  token_qr: string;
};
export type OrdemAplicativo = {
  id: string;
  numero: number;
  ativo_id: string;
  titulo: string;
  descricao: string;
  tipo: string;
  prioridade: string;
  situacao: Situacao;
  prazo: string;
  versao: number;
  checklist: { id: string; rotulo: string; resposta?: 'ok' | 'nok' | 'na' | null }[];
  resolucao: string;
};
export type RegistroLocal = ItemManifesto & { dados: AtivoAplicativo | OrdemAplicativo };
export type RespostaDownload = {
  protocolo: 1;
  escopo: string;
  pessoa: PessoaAplicativo;
  hora_servidor: string;
  gravar: RegistroLocal[];
  removidos: { entidade: 'ativo' | 'ordem'; id: string }[];
};

export const escopoAplicativo = (
  pessoa: Pick<PessoaAplicativo, 'id' | 'empresa_id' | 'unidade_id'>,
) => `${pessoa.empresa_id}:${pessoa.unidade_id}:${pessoa.id}`;

/**
 * Lê identificadores de QR e nada além disso. Uma etiqueta é um objeto físico
 * que qualquer pessoa pode colar na máquina: navegar para uma URL vinda dali
 * seria obedecer a quem imprimiu o adesivo.
 */
export function identificadorQr(valor: string): string | null {
  const direto = esquemaId.safeParse(valor.trim());
  if (direto.success) return direto.data;
  try {
    const url = new URL(valor.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const achado = /^\/qr\/([a-f0-9-]+)\/?$/i.exec(url.pathname);
    const lido = esquemaId.safeParse(achado?.[1]);
    return lido.success ? lido.data : null;
  } catch {
    return null;
  }
}
