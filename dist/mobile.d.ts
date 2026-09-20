import { z } from 'zod';
import { type Papel, type Situacao } from './index.js';
export declare const esquemaLoginAplicativo: z.ZodObject<{
    empresa: z.ZodString;
    email: z.ZodEmail;
    senha: z.ZodString;
    dispositivo_id: z.ZodString;
}, z.core.$strict>;
export declare const esquemaItemManifesto: z.ZodObject<{
    entidade: z.ZodEnum<{
        ativo: "ativo";
        ordem: "ordem";
    }>;
    id: z.ZodString;
    etag: z.ZodString;
}, z.core.$strict>;
export declare const esquemaDownload: z.ZodObject<{
    conhecidos: z.ZodArray<z.ZodObject<{
        entidade: z.ZodEnum<{
            ativo: "ativo";
            ordem: "ordem";
        }>;
        id: z.ZodString;
        etag: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const esquemaOperacaoAplicativo: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    tipo: z.ZodLiteral<"solicitacao.criar">;
    corpo: z.ZodObject<{
        ativo_id: z.ZodString;
        titulo: z.ZodString;
        descricao: z.ZodString;
        maquina_parada: z.ZodDefault<z.ZodBoolean>;
        observado_em: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    tipo: z.ZodLiteral<"ordem.checklist">;
    ordem_id: z.ZodString;
    corpo: z.ZodObject<{
        versao: z.ZodNumber;
        respostas: z.ZodRecord<z.ZodString, z.ZodEnum<{
            ok: "ok";
            nok: "nok";
            na: "na";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>], "tipo">;
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
    checklist: {
        id: string;
        rotulo: string;
        resposta?: 'ok' | 'nok' | 'na' | null;
    }[];
    resolucao: string;
};
export type RegistroLocal = ItemManifesto & {
    dados: AtivoAplicativo | OrdemAplicativo;
};
export type RespostaDownload = {
    protocolo: 1;
    escopo: string;
    pessoa: PessoaAplicativo;
    hora_servidor: string;
    gravar: RegistroLocal[];
    removidos: {
        entidade: 'ativo' | 'ordem';
        id: string;
    }[];
};
export declare const escopoAplicativo: (pessoa: Pick<PessoaAplicativo, "id" | "empresa_id" | "unidade_id">) => string;
/**
 * Lê identificadores de QR e nada além disso. Uma etiqueta é um objeto físico
 * que qualquer pessoa pode colar na máquina: navegar para uma URL vinda dali
 * seria obedecer a quem imprimiu o adesivo.
 */
export declare function identificadorQr(valor: string): string | null;
//# sourceMappingURL=mobile.d.ts.map