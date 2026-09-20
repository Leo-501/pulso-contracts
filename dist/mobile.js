import { z } from 'zod';
import { esquemaChecklist, esquemaId, esquemaLogin, esquemaSolicitacao, } from './index.js';
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
export const escopoAplicativo = (pessoa) => `${pessoa.empresa_id}:${pessoa.unidade_id}:${pessoa.id}`;
/**
 * Lê identificadores de QR e nada além disso. Uma etiqueta é um objeto físico
 * que qualquer pessoa pode colar na máquina: navegar para uma URL vinda dali
 * seria obedecer a quem imprimiu o adesivo.
 */
export function identificadorQr(valor) {
    const direto = esquemaId.safeParse(valor.trim());
    if (direto.success)
        return direto.data;
    try {
        const url = new URL(valor.trim());
        if (!['https:', 'http:'].includes(url.protocol))
            return null;
        const achado = /^\/qr\/([a-f0-9-]+)\/?$/i.exec(url.pathname);
        const lido = esquemaId.safeParse(achado?.[1]);
        return lido.success ? lido.data : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=mobile.js.map