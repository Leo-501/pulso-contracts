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
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
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

export class Projecao {
  /** Quem já foi projetado recentemente, para não escrever a cada requisição. */
  private recentes = new Map<string, number>();
  private static readonly RECENTE_MS = 60_000;

  /**
   * `aoAplicarQuadro` é o único ponto em que os dois produtos divergiam: o CMMS
   * registra quando o quadro chegou, o Campo não precisa. Um gancho opcional
   * custa menos que duas cópias da classe.
   */
  constructor(
    private db: BancoProjecao,
    private aoAplicarQuadro?: (
      tx: ConsultaProjecao,
      sessao: SessaoProjecao,
      quadro: Quadro,
    ) => Promise<void>,
  ) {}

  /**
   * Contexto de empresa inteira. Diferente do escopo de sessão, que prende na
   * unidade: escrever a projeção precisa alcançar as demais unidades da empresa.
   */
  private async projetando<T>(
    sessao: SessaoProjecao,
    fn: (tx: ConsultaProjecao) => Promise<T>,
  ): Promise<T> {
    return this.db.comPapel(
      {
        empresa_id: sessao.empresa_id,
        unidade_id: sessao.unidade_id,
        pessoa_id: sessao.id,
        projecao_empresa_id: sessao.empresa_id,
      },
      fn,
    );
  }

  /**
   * Garante que quem está agindo existe localmente antes de qualquer escrita.
   *
   * Sem isto, alguém criado na identidade por outro produto agiria e esbarraria
   * na chave estrangeira de `vinculos` — um erro interno no lugar de uma
   * operação normal. O quadro completo vem na entrada; isto é o cinto para o
   * caso de a pessoa chegar por outro caminho.
   */
  async garantir(contexto: Contexto) {
    const assinatura = [
      contexto.id,
      contexto.empresa_id,
      contexto.unidade_id,
      contexto.papel,
      contexto.nome,
    ].join('|');
    const ate = this.recentes.get(assinatura);
    if (ate && ate > Date.now()) return;
    await this.projetando(contexto, async (tx) => {
      await tx.query(
        `INSERT INTO empresas(id,apelido,nome) VALUES($1,$2,$3)
         ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome`,
        [contexto.empresa_id, apelidoDe(contexto.empresa_id), contexto.empresa_nome],
      );
      // A cidade só vem no quadro completo. Aqui o que importa é a linha existir
      // para as chaves estrangeiras de negócio; a entrada corrige o resto.
      await tx.query(
        `INSERT INTO unidades(id,empresa_id,nome,cidade,fuso) VALUES($1,$2,$3,'',$4)
         ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome,fuso=EXCLUDED.fuso`,
        [contexto.unidade_id, contexto.empresa_id, contexto.unidade_nome, contexto.fuso],
      );
      await this.pessoa(tx, {
        id: contexto.id,
        nome: contexto.nome,
        email: contexto.email,
        ativo: true,
        papel: contexto.papel,
        vinculo_ativo: true,
        unidade_ids: [contexto.unidade_id],
        empresa: contexto.empresa_id,
      });
    });
    this.recentes.set(assinatura, Date.now() + Projecao.RECENTE_MS);
  }

  /** Traz o quadro inteiro da empresa. Acontece na entrada. */
  async aplicar(sessao: SessaoProjecao, quadro: Quadro) {
    await this.projetando(sessao, async (tx) => {
      await tx.query(
        `INSERT INTO empresas(id,apelido,nome) VALUES($1,$2,$3)
         ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome`,
        [sessao.empresa_id, apelidoDe(sessao.empresa_id), sessao.empresa_nome],
      );
      for (const unidade of quadro.unidades)
        await tx.query(
          `INSERT INTO unidades(id,empresa_id,nome,cidade,fuso) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome,cidade=EXCLUDED.cidade,fuso=EXCLUDED.fuso`,
          [unidade.id, sessao.empresa_id, unidade.nome, unidade.cidade, unidade.fuso],
        );
      for (const pessoa of quadro.pessoas)
        await this.pessoa(tx, { ...pessoa, empresa: sessao.empresa_id });
      await this.aoAplicarQuadro?.(tx, sessao, quadro);
    });
    // O quadro acabou de chegar; o cinto de `garantir` não precisa reescrever.
    this.recentes.clear();
  }

  private async pessoa(
    tx: ConsultaProjecao,
    p: {
      id: string;
      nome: string;
      email: string;
      ativo: boolean;
      papel: string;
      vinculo_ativo: boolean;
      unidade_ids: string[];
      empresa: string;
    },
  ) {
    // Três comandos, e a ordem é o que os torna necessários. A política de
    // alteração de `pessoas` exige um vínculo desta empresa, e quem chega pela
    // segunda empresa ainda não tem o dela: um upsert num comando só falharia na
    // política ao tentar atualizar alguém que a primeira empresa já projetou.
    // Então a linha nasce sem atualizar, o vínculo é criado, e só depois o nome
    // muda — com a política já satisfeita.
    //
    // Isto não é precaução teórica: foi um 500 em produção, achado quando os
    // bancos passaram a ser populados só por projeção.
    //
    // O e-mail não é atualizado depois da primeira vez: ele identifica a pessoa
    // entre produtos, e a conta de negócio nem tem permissão para trocá-lo.
    await tx.query(
      'INSERT INTO pessoas(id,email,nome,ativo) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
      [p.id, p.email.toLowerCase(), p.nome, p.ativo],
    );
    await tx.query(
      `INSERT INTO vinculos(empresa_id,pessoa_id,papel,ativo) VALUES($1,$2,$3,$4)
       ON CONFLICT(empresa_id,pessoa_id) DO UPDATE SET papel=EXCLUDED.papel,ativo=EXCLUDED.ativo`,
      [p.empresa, p.id, p.papel, p.vinculo_ativo],
    );
    await tx.query('UPDATE pessoas SET nome=$2,ativo=$3 WHERE id=$1', [p.id, p.nome, p.ativo]);
    // Unidades saem quando o vínculo sai: aqui apagar é seguro, porque desde que
    // a identidade virou a fonte de verdade nada aponta para `vinculo_unidades`.
    await tx.query(
      'DELETE FROM vinculo_unidades WHERE empresa_id=$1 AND pessoa_id=$2 AND NOT (unidade_id = ANY($3::uuid[]))',
      [p.empresa, p.id, p.unidade_ids],
    );
    for (const unidade of p.unidade_ids)
      await tx.query(
        `INSERT INTO vinculo_unidades(empresa_id,pessoa_id,unidade_id) VALUES($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [p.empresa, p.id, unidade],
      );
  }
}

/**
 * `empresas.apelido` é único e obrigatório, e o contrato não o carrega — a
 * empresa vem resolvida na sessão. O identificador serve de valor estável e
 * único sem inventar um nome que pareceria oficial numa tela.
 */
const apelidoDe = (empresaId: string) => 'id:' + empresaId;
