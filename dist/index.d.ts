import { z } from 'zod';
export declare const roles: readonly ["admin", "manager", "technician", "operator", "storekeeper", "viewer"];
export type Role = (typeof roles)[number];
export declare const statuses: readonly ["open", "planned", "in_progress", "paused", "review", "closed", "cancelled"];
export type Status = (typeof statuses)[number];
export declare const statusLabels: Record<Status, string>;
export declare const priorityLabels: Record<string, string>;
export declare const roleLabels: Record<Role, string>;
export declare const priority: z.ZodEnum<{
    critical: "critical";
    high: "high";
    medium: "medium";
    low: "low";
}>;
export declare const idSchema: z.ZodString;
export declare const dateSchema: z.ZodString;
export declare const loginSchema: z.ZodObject<{
    company: z.ZodString;
    email: z.ZodEmail;
    password: z.ZodString;
}, z.core.$strict>;
export declare const assetSchema: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodString;
    location: z.ZodString;
    criticality: z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>>;
    manufacturer: z.ZodDefault<z.ZodString>;
    model: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const requestSchema: z.ZodObject<{
    asset_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    machine_stopped: z.ZodDefault<z.ZodBoolean>;
    observed_at: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export declare const orderSchema: z.ZodObject<{
    asset_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    priority: z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    due_date: z.ZodString;
    assigned_to: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    type: z.ZodDefault<z.ZodEnum<{
        corrective: "corrective";
        preventive: "preventive";
    }>>;
}, z.core.$strict>;
export declare const triageSchema: z.ZodObject<{
    action: z.ZodEnum<{
        approve: "approve";
        reject: "reject";
    }>;
    priority: z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>>;
    due_date: z.ZodOptional<z.ZodString>;
    assigned_to: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    reason: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const transitionSchema: z.ZodObject<{
    status: z.ZodEnum<{
        open: "open";
        planned: "planned";
        in_progress: "in_progress";
        paused: "paused";
        review: "review";
        closed: "closed";
        cancelled: "cancelled";
    }>;
    version: z.ZodNumber;
    note: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const partSchema: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodString;
    unit: z.ZodDefault<z.ZodEnum<{
        un: "un";
        L: "L";
        kg: "kg";
        m: "m";
    }>>;
    minimum: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const movementSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        receipt: "receipt";
        issue: "issue";
        return: "return";
        adjustment: "adjustment";
    }>;
    quantity: z.ZodNumber;
    reason: z.ZodString;
    work_order_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const planSchema: z.ZodObject<{
    asset_id: z.ZodString;
    name: z.ZodString;
    frequency: z.ZodEnum<{
        weekly: "weekly";
        monthly: "monthly";
    }>;
    interval: z.ZodDefault<z.ZodNumber>;
    anchor_date: z.ZodString;
    lead_days: z.ZodDefault<z.ZodNumber>;
    assigned_to: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    checklist: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const checklistSchema: z.ZodObject<{
    version: z.ZodNumber;
    answers: z.ZodRecord<z.ZodString, z.ZodEnum<{
        ok: "ok";
        nok: "nok";
        na: "na";
    }>>;
}, z.core.$strict>;
export declare function allowedTransitions(status: Status, role: Role): Status[];
export declare function canManage(role: Role): role is "admin" | "manager";
export declare function localDate(now?: Date, timezone?: string): string;
export declare function addDays(date: string, days: number): string;
export declare function occurrenceDate(anchor: string, frequency: 'weekly' | 'monthly', interval: number, index: number): string;
export declare const assetUpdateSchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    location: z.ZodOptional<z.ZodString>;
    criticality: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>>>;
    manufacturer: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    model: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, z.core.$strict>;
export declare const partUpdateSchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    unit: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        un: "un";
        L: "L";
        kg: "kg";
        m: "m";
    }>>>;
    minimum: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, z.core.$strict>;
export declare const planUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    lead_days: z.ZodOptional<z.ZodNumber>;
    assigned_to: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const activationSchema: z.ZodObject<{
    active: z.ZodBoolean;
}, z.core.$strict>;
export declare const passwordSchema: z.ZodObject<{
    current: z.ZodString;
    next: z.ZodString;
}, z.core.$strict>;
export declare const userSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodEmail;
    role: z.ZodEnum<{
        admin: "admin";
        manager: "manager";
        technician: "technician";
        operator: "operator";
        storekeeper: "storekeeper";
        viewer: "viewer";
    }>;
    site_ids: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const membershipSchema: z.ZodObject<{
    role: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        manager: "manager";
        technician: "technician";
        operator: "operator";
        storekeeper: "storekeeper";
        viewer: "viewer";
    }>>;
    active: z.ZodOptional<z.ZodBoolean>;
    site_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const siteSchema: z.ZodObject<{
    site_id: z.ZodString;
}, z.core.$strict>;
//# sourceMappingURL=index.d.ts.map