import type { ItemManifesto, OperacaoAplicativo, RespostaDownload } from '../mobile.js';
import { BaseLocal } from './store.js';

export class ErroSincronizacao extends Error {
  constructor(
    mensagem: string,
    public status: number,
  ) {
    super(mensagem);
  }
}

export interface TransporteSincronizacao {
  baixar(conhecidos: ItemManifesto[]): Promise<RespostaDownload>;
  enviar(operacao: OperacaoAplicativo): Promise<unknown>;
}

export class MotorSincronizacao {
  private emCurso?: Promise<void>;
  constructor(
    private base: BaseLocal,
    private transporte: TransporteSincronizacao,
  ) {}

  /** Cliques simultâneos em sincronizar compartilham o mesmo envio. */
  sincronizar() {
    if (this.emCurso) return this.emCurso;
    this.emCurso = this.rodar().finally(() => {
      this.emCurso = undefined;
    });
    return this.emCurso;
  }

  private async rodar() {
    try {
      // Autorizações e remoções vêm antes de tentar escrever o que está na fila:
      // quem perdeu acesso não deve conseguir gravar com o escopo antigo.
      await this.base.aplicar(await this.transporte.baixar(await this.base.manifesto()));
      for (const item of await this.base.fila()) {
        if (item.situacao !== 'pendente') continue;
        try {
          const recibo = await this.transporte.enviar(JSON.parse(item.corpo));
          await this.base.marcar(item.id, 'confirmada', null, recibo);
        } catch (erro) {
          if (
            !(erro instanceof ErroSincronizacao) ||
            erro.status === 0 ||
            erro.status >= 500 ||
            erro.status === 429
          )
            throw erro;
          if (erro.status === 401) throw erro;
          await this.base.marcar(
            item.id,
            erro.status === 409 ? 'conflito' : 'rejeitada',
            erro.message,
          );
        }
      }
      await this.base.aplicar(await this.transporte.baixar(await this.base.manifesto()));
    } catch (erro) {
      if (erro instanceof ErroSincronizacao && erro.status === 401) {
        // Falha de disco ao limpar o cache não pode mascarar a revogação: quem
        // chama precisa bloquear a interface de qualquer jeito.
        await this.base.bloquearCache().catch(() => {});
      }
      throw erro;
    }
  }
}
