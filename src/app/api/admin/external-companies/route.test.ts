import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  rows: {} as Record<string, Array<{ data: unknown; error: { code?: string } | null }>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

function query(table: string) {
  state.calls.push({ table, method: "from", args: [] });
  const next = () => state.rows[table]?.shift() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
  }
  chain.maybeSingle = async () => table === "profiles" ? { data: state.profile, error: null } : next();
  chain.then = (resolve: (value: unknown) => unknown) => resolve(next());
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor-id" } } }) },
  from: query,
  rpc: async () => ({ data: false }),
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));

import { GET } from "./route";

const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherOrganizationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const customerA = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "A", name: "Cliente A", kind: "customer", active: true,
  owning_organization_id: organizationId, created_at: "2026-11-02", updated_at: "2026-11-02" };
const customerB = { ...customerA, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "B", name: "Cliente B", owning_organization_id: otherOrganizationId };
const supplier = { ...customerA, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", code: "S", name: "Proveedor", kind: "supplier" };

beforeEach(() => {
  state.calls = [];
  state.rows = {};
  state.profile = { user_type: "administrator", status: "active", organization_id: organizationId, external_party_id: null, external_site_id: null };
  state.rows.external_company_sites = [{ data: [], error: null }];
  state.rows.supplier_quality_profiles = [{ data: [], error: null }];
});

describe("external company directory separation", () => {
  it("returns owned customers but not a foreign customer to an internal administrator", async () => {
    state.rows.organizations = [{ data: [customerA, customerB], error: null }, { data: [supplier], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.companies.map((company: { id: string }) => company.id)).toEqual([customerA.id, supplier.id]);
    expect(state.calls).toContainEqual({ table: "organizations", method: "eq", args: ["owning_organization_id", organizationId] });
  });

  it("keeps suppliers available while customer ownership has not been migrated", async () => {
    state.rows.organizations = [{ data: null, error: { code: "42703" } }, { data: [supplier], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).companies.map((company: { id: string }) => company.id)).toEqual([supplier.id]);
  });

  it("lets an external supplier see only its own supplier company", async () => {
    state.profile = { user_type: "supplier", status: "active", organization_id: null,
      external_party_id: supplier.id, external_site_id: null };
    state.rows.organizations = [{ data: [supplier], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).companies.map((company: { id: string }) => company.id)).toEqual([supplier.id]);
    expect(state.calls).toContainEqual({ table: "organizations", method: "eq", args: ["id", supplier.id] });
  });
});
