import { z } from 'zod';
export declare const papeis: readonly ["administrador", "gestor", "tecnico", "solicitante", "almoxarife", "consulta"];
export type Papel = (typeof papeis)[number];
export declare const situacoes: readonly ["aberta", "planejada", "em_execucao", "pausada", "validacao", "concluida", "cancelada"];
export type Situacao = (typeof situacoes)[number];
export declare const rotulosSituacao: Record<Situacao, string>;
export declare const rotulosPrioridade: Record<string, string>;
export declare const rotulosPapel: Record<Papel, string>;
export declare const prioridade: z.ZodEnum<{
    critica: "critica";
    alta: "alta";
    media: "media";
    baixa: "baixa";
}>;
export declare const esquemaId: z.ZodString;
export declare const esquemaData: z.ZodString;
export declare const esquemaLogin: z.ZodObject<{
    empresa: z.ZodString;
    email: z.ZodEmail;
    senha: z.ZodString;
}, z.core.$strict>;
export declare const esquemaAtivo: z.ZodObject<{
    codigo: z.ZodString;
    nome: z.ZodString;
    local: z.ZodString;
    criticidade: z.ZodDefault<z.ZodEnum<{
        critica: "critica";
        alta: "alta";
        media: "media";
        baixa: "baixa";
    }>>;
    fabricante: z.ZodDefault<z.ZodString>;
    modelo: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const esquemaSolicitacao: z.ZodObject<{
    ativo_id: z.ZodString;
    titulo: z.ZodString;
    descricao: z.ZodString;
    maquina_parada: z.ZodDefault<z.ZodBoolean>;
    observado_em: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export declare const esquemaOrdem: z.ZodObject<{
    ativo_id: z.ZodString;
    titulo: z.ZodString;
    descricao: z.ZodDefault<z.ZodString>;
    prioridade: z.ZodEnum<{
        critica: "critica";
        alta: "alta";
        media: "media";
        baixa: "baixa";
    }>;
    prazo: z.ZodString;
    responsavel_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    tipo: z.ZodDefault<z.ZodEnum<{
        corretiva: "corretiva";
        preventiva: "preventiva";
    }>>;
}, z.core.$strict>;
export declare const esquemaTriagem: z.ZodObject<{
    acao: z.ZodEnum<{
        aprovar: "aprovar";
        rejeitar: "rejeitar";
    }>;
    prioridade: z.ZodDefault<z.ZodEnum<{
        critica: "critica";
        alta: "alta";
        media: "media";
        baixa: "baixa";
    }>>;
    prazo: z.ZodOptional<z.ZodString>;
    responsavel_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    motivo: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const esquemaTransicao: z.ZodObject<{
    situacao: z.ZodEnum<{
        aberta: "aberta";
        planejada: "planejada";
        em_execucao: "em_execucao";
        pausada: "pausada";
        validacao: "validacao";
        concluida: "concluida";
        cancelada: "cancelada";
    }>;
    versao: z.ZodNumber;
    observacao: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const esquemaPeca: z.ZodObject<{
    codigo: z.ZodString;
    nome: z.ZodString;
    unidade_medida: z.ZodDefault<z.ZodEnum<{
        un: "un";
        L: "L";
        kg: "kg";
        m: "m";
    }>>;
    minimo: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const esquemaMovimentacao: z.ZodObject<{
    tipo: z.ZodEnum<{
        entrada: "entrada";
        saida: "saida";
        devolucao: "devolucao";
        ajuste: "ajuste";
    }>;
    quantidade: z.ZodNumber;
    motivo: z.ZodString;
    ordem_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const esquemaPlano: z.ZodObject<{
    ativo_id: z.ZodString;
    nome: z.ZodString;
    frequencia: z.ZodEnum<{
        semanal: "semanal";
        mensal: "mensal";
    }>;
    intervalo: z.ZodDefault<z.ZodNumber>;
    data_base: z.ZodString;
    dias_antecedencia: z.ZodDefault<z.ZodNumber>;
    responsavel_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    checklist: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const esquemaChecklist: z.ZodObject<{
    versao: z.ZodNumber;
    respostas: z.ZodRecord<z.ZodString, z.ZodEnum<{
        ok: "ok";
        nok: "nok";
        na: "na";
    }>>;
}, z.core.$strict>;
export declare function transicoesPermitidas(situacao: Situacao, papel: Papel): Situacao[];
export declare function podeGerenciar(papel: Papel): papel is "administrador" | "gestor";
export declare function dataLocal(agora?: Date, fuso?: string): string;
export declare function somarDias(data: string, dias: number): string;
export declare function dataOcorrencia(base: string, frequencia: 'semanal' | 'mensal', intervalo: number, indice: number): string;
export declare const esquemaAtivoEdicao: z.ZodObject<{
    codigo: z.ZodOptional<z.ZodString>;
    nome: z.ZodOptional<z.ZodString>;
    local: z.ZodOptional<z.ZodString>;
    criticidade: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        critica: "critica";
        alta: "alta";
        media: "media";
        baixa: "baixa";
    }>>>;
    fabricante: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    modelo: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, z.core.$strict>;
export declare const esquemaPecaEdicao: z.ZodObject<{
    codigo: z.ZodOptional<z.ZodString>;
    nome: z.ZodOptional<z.ZodString>;
    unidade_medida: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        un: "un";
        L: "L";
        kg: "kg";
        m: "m";
    }>>>;
    minimo: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, z.core.$strict>;
export declare const esquemaPlanoEdicao: z.ZodObject<{
    nome: z.ZodOptional<z.ZodString>;
    dias_antecedencia: z.ZodOptional<z.ZodNumber>;
    responsavel_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const esquemaAtivacao: z.ZodObject<{
    ativo: z.ZodBoolean;
}, z.core.$strict>;
export declare const esquemaSenha: z.ZodObject<{
    atual: z.ZodString;
    nova: z.ZodString;
}, z.core.$strict>;
export declare const esquemaPessoa: z.ZodObject<{
    nome: z.ZodString;
    email: z.ZodEmail;
    papel: z.ZodEnum<{
        administrador: "administrador";
        gestor: "gestor";
        tecnico: "tecnico";
        solicitante: "solicitante";
        almoxarife: "almoxarife";
        consulta: "consulta";
    }>;
    unidade_ids: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const esquemaVinculo: z.ZodObject<{
    papel: z.ZodOptional<z.ZodEnum<{
        administrador: "administrador";
        gestor: "gestor";
        tecnico: "tecnico";
        solicitante: "solicitante";
        almoxarife: "almoxarife";
        consulta: "consulta";
    }>>;
    ativo: z.ZodOptional<z.ZodBoolean>;
    unidade_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const esquemaUnidade: z.ZodObject<{
    unidade_id: z.ZodString;
}, z.core.$strict>;
//# sourceMappingURL=index.d.ts.map