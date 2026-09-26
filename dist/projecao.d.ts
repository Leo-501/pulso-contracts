import type { Contexto, Quadro } from './identity/index.js';
/**
 * A projeção local do que a identidade sabe sobre pessoas, unidades e vínculos.
 *
 * Mora aqui porque os dois produtos que consomem a identidade precisam dela
 * palavra por palavra — as duas cópias diferiam em cinco linhas. Ela não conhece
 * driver de banco nem framework: pede só `comPapel`, e por isso o pacote
 * continua sem dependência nenhuma, o que importa porque o aplicativo React
 * Native também consome este pacote.
 *
 * **Ela não decide acesso.** Quem decide é a introspecção, a cada requisição.
 * Projeção atrasada não abre porta nenhuma: apenas deixa de fechar uma que a
 * introspecção já fechou. É por isso que estar velha é tolerável.
 *
 * Nada é apagado daqui. Vínculo virou inativo, não sumiu — as chaves
 * estrangeiras de histórico apontam para ele, e apagar ou falharia ou levaria o
 * histórico junto.
 */
export interface ConsultaProjecao {
    query(sql: string, params?: any[]): Promise<{
        rows: any[];
    }>;
}
/** O mínimo que a projeção precisa do banco do produto. */
export interface BancoProjecao {
    comPapel<T>(gucs: Record<string, string>, fn: (tx: ConsultaProjecao) => Promise<T>): Promise<T>;
}
export interface SessaoProjecao {
    id: string;
    empresa_id: string;
    unidade_id: string;
    empresa_nome: string;
}
export declare class Projecao {
    private db;
    private aoAplicarQuadro?;
    /** Quem já foi projetado recentemente, para não escrever a cada requisição. */
    private recentes;
    private static readonly RECENTE_MS;
    /**
     * `aoAplicarQuadro` é o único ponto em que os dois produtos divergiam: o CMMS
     * registra quando o quadro chegou, o Campo não precisa. Um gancho opcional
     * custa menos que duas cópias da classe.
     */
    constructor(db: BancoProjecao, aoAplicarQuadro?: ((tx: ConsultaProjecao, sessao: SessaoProjecao, quadro: Quadro) => Promise<void>) | undefined);
    /**
     * Contexto de empresa inteira. Diferente do escopo de sessão, que prende na
     * unidade: escrever a projeção precisa alcançar as demais unidades da empresa.
     */
    private projetando;
    /**
     * Garante que quem está agindo existe localmente antes de qualquer escrita.
     *
     * Sem isto, alguém criado na identidade por outro produto agiria e esbarraria
     * na chave estrangeira de `vinculos` — um erro interno no lugar de uma
     * operação normal. O quadro completo vem na entrada; isto é o cinto para o
     * caso de a pessoa chegar por outro caminho.
     */
    garantir(contexto: Contexto): Promise<void>;
    /** Traz o quadro inteiro da empresa. Acontece na entrada. */
    aplicar(sessao: SessaoProjecao, quadro: Quadro): Promise<void>;
    private pessoa;
}
//# sourceMappingURL=projecao.d.ts.map