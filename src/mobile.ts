import { z } from 'zod';
import {
  checklistSchema,
  idSchema,
  loginSchema,
  requestSchema,
  type Role,
  type Status,
} from './index.js';

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
export type MobileOperation = z.infer<typeof mobileOperationSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type MobileUser = {
  id: string;
  tenant_id: string;
  site_id: string;
  role: Role;
  name: string;
  email: string;
  tenant_name: string;
  site_name: string;
  timezone: string;
};
export type MobileSession = { token: string; expires_at: string; user: MobileUser };
export type MobileAsset = {
  id: string;
  code: string;
  name: string;
  location: string;
  criticality: string;
  manufacturer: string;
  model: string;
  qr_token: string;
};
export type MobileOrder = {
  id: string;
  number: number;
  asset_id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: Status;
  due_date: string;
  version: number;
  checklist: { id: string; label: string; answer?: 'ok' | 'nok' | 'na' | null }[];
  resolution: string;
};
export type CachedRecord = ManifestEntry & { data: MobileAsset | MobileOrder };
export type PullResponse = {
  protocol: 1;
  scope: string;
  user: MobileUser;
  server_time: string;
  upserts: CachedRecord[];
  removed: { entity: 'asset' | 'order'; id: string }[];
};
export const mobileScope = (user: Pick<MobileUser, 'id' | 'tenant_id' | 'site_id'>) =>
  `${user.tenant_id}:${user.site_id}:${user.id}`;

// Read QR identifiers only; never navigate to a URL obtained from a physical label.
export function qrIdentifier(value: string): string | null {
  const direct = idSchema.safeParse(value.trim());
  if (direct.success) return direct.data;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const match = /^\/qr\/([a-f0-9-]+)\/?$/i.exec(url.pathname);
    const parsed = idSchema.safeParse(match?.[1]);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
