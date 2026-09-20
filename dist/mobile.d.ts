import { z } from 'zod';
import { type Role, type Status } from './index.js';
export declare const mobileLoginSchema: z.ZodObject<{
    company: z.ZodString;
    email: z.ZodEmail;
    password: z.ZodString;
    device_id: z.ZodString;
}, z.core.$strict>;
export declare const manifestEntrySchema: z.ZodObject<{
    entity: z.ZodEnum<{
        asset: "asset";
        order: "order";
    }>;
    id: z.ZodString;
    etag: z.ZodString;
}, z.core.$strict>;
export declare const pullSchema: z.ZodObject<{
    known: z.ZodArray<z.ZodObject<{
        entity: z.ZodEnum<{
            asset: "asset";
            order: "order";
        }>;
        id: z.ZodString;
        etag: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const mobileOperationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"request.create">;
    body: z.ZodObject<{
        asset_id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        machine_stopped: z.ZodDefault<z.ZodBoolean>;
        observed_at: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"order.checklist">;
    order_id: z.ZodString;
    body: z.ZodObject<{
        version: z.ZodNumber;
        answers: z.ZodRecord<z.ZodString, z.ZodEnum<{
            ok: "ok";
            nok: "nok";
            na: "na";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
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
export type MobileSession = {
    token: string;
    expires_at: string;
    user: MobileUser;
};
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
    checklist: {
        id: string;
        label: string;
        answer?: 'ok' | 'nok' | 'na' | null;
    }[];
    resolution: string;
};
export type CachedRecord = ManifestEntry & {
    data: MobileAsset | MobileOrder;
};
export type PullResponse = {
    protocol: 1;
    scope: string;
    user: MobileUser;
    server_time: string;
    upserts: CachedRecord[];
    removed: {
        entity: 'asset' | 'order';
        id: string;
    }[];
};
export declare const mobileScope: (user: Pick<MobileUser, "id" | "tenant_id" | "site_id">) => string;
export declare function qrIdentifier(value: string): string | null;
//# sourceMappingURL=mobile.d.ts.map