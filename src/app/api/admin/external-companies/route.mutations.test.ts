import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  responses: {} as Record<string, Array<{ data: unknown; error: { code?: string; message?: string } | null }>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

function query(table: string) {
  const next = () => state.responses[table]?.shift() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "update", "insert", "upsert"]) {
    chain[method] = (...args: unknown[]) => {
      state.calls.push({ table, method, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => table === "profiles" ? { data: state.profile, error: null } : next();
  chain.single = async () => next();
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(next()).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "admin-id" } } }) },
  from: query,
  rpc: async () => ({ data: false, error: null }),
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));

import { PATCH, POST } from "./route";

const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const company = { id: companyId, code: "ACME", name: "Acme", kind: "customer", active: true,
  owning_organization_id: organizationId, created_at: "2026-11-02T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" };

function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
  return new Request("https://integraq.test/api/admin/external-companies", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function respond(table: string, ...responses: Array<{ data: unknown; error?: { code?: string; message?: string } | null }>) {
  state.responses[table] = responses.map((response) => ({ error: null, ...response }));
}

beforeEach(() => {
  state.profile = { user_type: "administrator", status: "active", organization_id: organizationId,
    external_party_id: null, external_site_id: null };
  state.responses = { organizations: [{ data: { id: organizationId }, error: null }] };
  state.calls = [];
});

describe("external company tenant ownership and retirement", () => {
  it("rejects inactive and non-administrator actors before any write", async () => {
    for (const profile of [
      { user_type: "administrator", status: "disabled", organization_id: organizationId },
      { user_type: "internal", status: "active", organization_id: organizationId },
    ]) {
      state.profile = profile;
      const response = await POST(request("POST", { entity: "company", code: "A", name: "A", kind: "customer" }));
      expect(response.status).toBe(403);
    }
    expect(state.calls.filter((call) => ["insert", "update", "upsert"].includes(call.method))).toHaveLength(0);
  });

  it("assigns new customers and suppliers to the authenticated administrator's organization", async () => {
    for (const kind of ["customer", "supplier"]) {
      state.calls = [];
      const saved = { ...company, kind };
      respond("organizations", { data: { id: organizationId } }, { data: saved }, { data: { id: organizationId } }, { data: [saved] });
      respond("audit_log", { data: null });
      respond("organizations", { data: [saved] });
      respond("external_company_sites", { data: [] });
      respond("supplier_quality_profiles", { data: [] });
      const response = await POST(request("POST", { entity: "company", code: "ACME", name: "Acme", kind }));
      expect(response.status).toBe(200);
      const insert = state.calls.find((call) => call.table === "organizations" && call.method === "insert");
      expect(insert?.args[0]).toMatchObject({ kind, owning_organization_id: organizationId });
      state.responses = {};
    }
  });

  it("records actor, timestamp and required reason while deactivating only an owned company", async () => {
    const saved = { ...company, active: false };
    respond("organizations", { data: { id: organizationId } }, { data: company }, { data: saved }, { data: { id: organizationId } }, { data: [saved] });
    respond("audit_log", { data: null });
    respond("external_company_sites", { data: [] });
    respond("supplier_quality_profiles", { data: [] });
    const response = await PATCH(request("PATCH", { entity: "company", id: companyId, code: "ACME", name: "Acme",
      kind: "customer", active: false, reason: "Registro obsoleto" }));
    expect(response.status).toBe(200);
    const update = state.calls.find((call) => call.table === "organizations" && call.method === "update");
    expect(update?.args[0]).toMatchObject({ active: false, deleted_by: "admin-id", deletion_reason: "Registro obsoleto" });
    expect(typeof (update?.args[0] as Record<string, unknown>).deleted_at).toBe("string");
    expect(state.calls).toContainEqual({ table: "organizations", method: "eq", args: ["owning_organization_id", organizationId] });
  });

  it("does not reassign historical companies with unknown ownership or update another organization's company", async () => {
    respond("organizations", { data: { id: organizationId } }, { data: { ...company, owning_organization_id: null } });
    const unknownOwner = await PATCH(request("PATCH", { entity: "company", id: companyId, code: "ACME", name: "Acme",
      kind: "customer", active: false, reason: "Obsoleto" }));
    expect(unknownOwner.status).toBe(409);
    expect(state.calls.some((call) => call.table === "organizations" && call.method === "update")).toBe(false);

    state.calls = [];
    respond("organizations", { data: { id: organizationId } }, { data: { ...company, owning_organization_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } });
    const foreign = await PATCH(request("PATCH", { entity: "company", id: companyId, code: "ACME", name: "Acme",
      kind: "customer", active: false, reason: "Obsoleto" }));
    expect(foreign.status).toBe(403);
    expect(state.calls.some((call) => call.table === "organizations" && call.method === "update")).toBe(false);
  });

  it("requires a reason and fails closed while the ownership migration is unavailable", async () => {
    const noReason = await PATCH(request("PATCH", { entity: "company", id: companyId, code: "ACME", name: "Acme", kind: "customer", active: false }));
    expect(noReason.status).toBe(400);
    respond("organizations", { data: null, error: { code: "42703", message: "column owning_organization_id does not exist" } });
    const unavailable = await POST(request("POST", { entity: "company", code: "ACME", name: "Acme", kind: "customer" }));
    expect(unavailable.status).toBe(503);
    expect(state.calls.some((call) => call.table === "audit_log" && call.method === "insert")).toBe(false);
  });
});
