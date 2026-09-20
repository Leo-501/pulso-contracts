import { z } from 'zod';
import { checklistSchema, idSchema, loginSchema, requestSchema, } from './index.js';
export const mobileLoginSchema = loginSchema.extend({ device_id: idSchema });
export const manifestEntrySchema = z
    .object({
    entity: z.enum(['asset', 'order']),
    id: idSchema,
    etag: z.string().regex(/^[a-f0-9]{64}$/),
})
    .strict();
export const pullSchema = z.object({ known: z.array(manifestEntrySchema).max(10_000) }).strict();
export const mobileOperationSchema = z.discriminatedUnion('kind', [
    z.object({ id: idSchema, kind: z.literal('request.create'), body: requestSchema }).strict(),
    z
        .object({
        id: idSchema,
        kind: z.literal('order.checklist'),
        order_id: idSchema,
        body: checklistSchema,
    })
        .strict(),
]);
export const mobileScope = (user) => `${user.tenant_id}:${user.site_id}:${user.id}`;
// Read QR identifiers only; never navigate to a URL obtained from a physical label.
export function qrIdentifier(value) {
    const direct = idSchema.safeParse(value.trim());
    if (direct.success)
        return direct.data;
    try {
        const url = new URL(value.trim());
        if (!['https:', 'http:'].includes(url.protocol))
            return null;
        const match = /^\/qr\/([a-f0-9-]+)\/?$/i.exec(url.pathname);
        const parsed = idSchema.safeParse(match?.[1]);
        return parsed.success ? parsed.data : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=mobile.js.map