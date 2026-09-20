import { z } from 'zod';
export const roles = [
    'admin',
    'manager',
    'technician',
    'operator',
    'storekeeper',
    'viewer',
];
export const statuses = [
    'open',
    'planned',
    'in_progress',
    'paused',
    'review',
    'closed',
    'cancelled',
];
export const statusLabels = {
    open: 'Aberta',
    planned: 'Planejada',
    in_progress: 'Em execução',
    paused: 'Pausada',
    review: 'Em validação',
    closed: 'Encerrada',
    cancelled: 'Cancelada',
};
export const priorityLabels = {
    critical: 'Crítica',
    high: 'Alta',
    medium: 'Média',
    low: 'Baixa',
};
export const roleLabels = {
    admin: 'Administrador',
    manager: 'Gestor de manutenção',
    technician: 'Técnico',
    operator: 'Solicitante',
    storekeeper: 'Almoxarife',
    viewer: 'Consulta',
};
export const priority = z.enum(['critical', 'high', 'medium', 'low']);
export const idSchema = z.string().uuid();
const required = (max = 200) => z.string().trim().min(2, 'Informe pelo menos 2 caracteres.').max(max);
export const dateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
    .refine((value) => {
    const d = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}, 'Data inválida.');
export const loginSchema = z
    .object({ company: required(80), email: z.email(), password: z.string().min(1).max(256) })
    .strict();
export const assetSchema = z
    .object({
    code: required(40),
    name: required(120),
    location: required(120),
    criticality: priority.default('medium'),
    manufacturer: z.string().trim().max(100).default(''),
    model: z.string().trim().max(100).default(''),
})
    .strict();
export const requestSchema = z
    .object({
    asset_id: idSchema,
    title: required(160),
    description: required(3000),
    machine_stopped: z.boolean().default(false),
    observed_at: z.iso.datetime({ offset: true }).optional(),
})
    .strict();
export const orderSchema = z
    .object({
    asset_id: idSchema,
    title: required(160),
    description: z.string().trim().max(4000).default(''),
    priority,
    due_date: dateSchema,
    assigned_to: idSchema.nullable().default(null),
    type: z.enum(['corrective', 'preventive']).default('corrective'),
})
    .strict();
export const triageSchema = z
    .object({
    action: z.enum(['approve', 'reject']),
    priority: priority.default('medium'),
    due_date: dateSchema.optional(),
    assigned_to: idSchema.nullable().default(null),
    reason: z.string().trim().max(2000).default(''),
})
    .strict();
export const transitionSchema = z
    .object({
    status: z.enum(statuses),
    version: z.number().int().positive(),
    note: z.string().trim().max(4000).default(''),
})
    .strict();
export const partSchema = z
    .object({
    code: required(40),
    name: required(160),
    unit: z.enum(['un', 'L', 'kg', 'm']).default('un'),
    minimum: z.number().nonnegative().max(1000000).default(0),
})
    .strict();
export const movementSchema = z
    .object({
    kind: z.enum(['receipt', 'issue', 'return', 'adjustment']),
    quantity: z
        .number()
        .finite()
        .refine((n) => n !== 0 && Math.abs(n) <= 1000000, 'Quantidade inválida.'),
    reason: required(1000),
    work_order_id: idSchema.nullable().default(null),
})
    .strict();
export const planSchema = z
    .object({
    asset_id: idSchema,
    name: required(160),
    frequency: z.enum(['weekly', 'monthly']),
    interval: z.number().int().min(1).max(52).default(1),
    anchor_date: dateSchema,
    lead_days: z.number().int().min(0).max(30).default(7),
    assigned_to: idSchema.nullable().default(null),
    checklist: z.array(required(240)).min(1).max(30),
})
    .strict();
export const checklistSchema = z
    .object({
    version: z.number().int().positive(),
    answers: z.record(z.string(), z.enum(['ok', 'nok', 'na'])),
})
    .strict();
const transitions = {
    open: ['planned', 'in_progress', 'cancelled'],
    planned: ['in_progress', 'cancelled'],
    in_progress: ['paused', 'review', 'cancelled'],
    paused: ['in_progress', 'cancelled'],
    review: ['closed', 'in_progress'],
    closed: [],
    cancelled: [],
};
export function allowedTransitions(status, role) {
    if (role === 'admin' || role === 'manager')
        return transitions[status];
    if (role === 'technician')
        return transitions[status].filter((s) => ['in_progress', 'paused', 'review'].includes(s) && status !== 'review');
    return [];
}
export function canManage(role) {
    return role === 'admin' || role === 'manager';
}
export function localDate(now = new Date(), timezone = 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key).value).join('-');
}
export function addDays(date, days) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
export function occurrenceDate(anchor, frequency, interval, index) {
    if (frequency === 'weekly')
        return addDays(anchor, 7 * interval * index);
    const [year, month, day] = anchor.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1 + interval * index, 1, 12));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
}
// --- Edição e inativação de cadastros -------------------------------------
// Atualização parcial: os campos ausentes preservam o valor atual.
export const assetUpdateSchema = assetSchema.partial().strict();
export const partUpdateSchema = partSchema.partial().strict();
// A recorrência não é editável neste incremento: mudar frequência, intervalo ou âncora
// exige recalcular ocorrências já geradas, o que é versionamento de plano e continua
// no backlog. Só os campos sem efeito retroativo são aceitos aqui.
export const planUpdateSchema = z
    .object({
    name: required(160).optional(),
    lead_days: z.number().int().min(0).max(30).optional(),
    assigned_to: idSchema.nullable().optional(),
})
    .strict();
export const activationSchema = z.object({ active: z.boolean() }).strict();
// --- Gestão de contas ------------------------------------------------------
export const passwordSchema = z
    .object({
    current: z.string().min(1).max(256),
    next: z
        .string()
        .min(10, 'Use pelo menos 10 caracteres.')
        .max(256)
        .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Combine letras e números.'),
})
    .strict()
    .refine((v) => v.current !== v.next, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['next'],
});
export const userSchema = z
    .object({
    name: required(120),
    email: z.email(),
    role: z.enum(roles),
    site_ids: z.array(idSchema).min(1).max(50),
})
    .strict();
export const membershipSchema = z
    .object({
    role: z.enum(roles).optional(),
    active: z.boolean().optional(),
    site_ids: z.array(idSchema).min(1).max(50).optional(),
})
    .strict();
// --- Seleção de unidade ----------------------------------------------------
export const siteSchema = z.object({ site_id: idSchema }).strict();
//# sourceMappingURL=index.js.map