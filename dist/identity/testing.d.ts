import { type Role } from '../index.js';
/**
 * Identidade de mentira, em memória, para a suíte de um produto.
 *
 * Ela é um `fetch`, não um cliente: quem estiver sendo testado usa o
 * `IdentityClient` de verdade, com o cache, o envio compartilhado e a falha
 * fechada reais. Só o outro lado da rede é simulado.
 *
 * Existe porque a alternativa — cada produto subir o serviço de identidade na
 * própria suíte — obrigaria a depender do repositório dele, que é privado, e a
 * empilhar dependência git dentro de dependência git, o que o pnpm recusa.
 *
 * A fidelidade não é promessa: é verificada. A bateria `identityConformance`
 * roda contra este duplo e contra o serviço de verdade, e uma divergência
 * derruba um dos dois.
 */
export * from './conformance.js';
export type StubTenantSpec = {
    slug: string;
    name: string;
    sites: {
        name: string;
        city?: string;
        timezone?: string;
    }[];
};
export type StubPersonSpec = {
    email: string;
    name: string;
    password: string;
    active?: boolean;
    must_change_password?: boolean;
    memberships: {
        tenant: string;
        role: Role;
        sites?: string[];
        active?: boolean;
    }[];
};
export type StubSpec = {
    client?: {
        id: string;
        secret: string;
    };
    tenants: StubTenantSpec[];
    people: StubPersonSpec[];
};
export type IdentityStub = {
    /** Passe para `new IdentityClient({ fetch })`. */
    fetch: typeof globalThis.fetch;
    client: {
        id: string;
        secret: string;
    };
    tenantId(slug: string): string;
    siteId(slug: string, site: string): string;
    userId(email: string): string;
    /** Rotas pedidas, na ordem, para o teste conferir que o produto não fala demais. */
    calls: {
        method: string;
        path: string;
    }[];
    /** Adianta o relógio das sessões, para exercitar expiração sem esperar. */
    expireAll(): void;
};
export declare function createIdentityStub(spec: StubSpec): IdentityStub;
//# sourceMappingURL=testing.d.ts.map