import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));

vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
function client() {
  return { from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const next = () => state.responses[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "order"]) {
      chain[method] = (...args: unknown[]) => {
        if (table === "quality_cases" && String(args[0]).split(",").includes("organization_id")) throw new Error("42703: quality_cases.organization_id does not exist");
        state.calls.push({ table, method, args }); return chain;
      };
    }
    chain.maybeSingle = async () => next();
    chain.then = (resolve: (value: unknown) => unknown) => resolve(next());
    return chain;
  } };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));

import { GET } from "./route";

const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherOrganizationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const customerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  state.calls = [];
  state.responses = {};
  state.session = { ...activeSession, userType: "Administrador", authUserId: customerA, workspaceMode: "production" };
  state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
});

describe("Root2Cause customer catalog ownership", () => {
  it("returns only verified customers and claims of the administrator's organization", async () => {
    state.responses.organizations = [{ data: [{ id: customerA, code: "CLI-A", name: "Cliente A", owning_organization_id: organizationId }], error: null }];
    state.responses.quality_cases = [{ data: [{ id: customerB, folio: "R-01", title: "Reclamación", external_organization_id: customerA, organization_id: organizationId }], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customers: [{ id: customerA, code: "CLI-A", name: "Cliente A" }],
      claims: [{ id: customerB, folio: "R-01", title: "Reclamación", external_organization_id: customerA }],
    });
    expect(state.calls).toContainEqual({ table: "organizations", method: "eq", args: ["owning_organization_id", organizationId] });
    expect(state.calls).toContainEqual({ table: "quality_cases", method: "in", args: ["external_organization_id", [customerA]] });
  });

  it("keeps unowned customers out of the catalog without guessing their organization", async () => {
    state.responses.organizations = [{ data: [], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ customers: [], claims: [] });
    expect(state.calls.filter(call => call.table === "quality_cases")).toHaveLength(0);
  });

  it("fails closed if a privileged query returns a foreign customer or claim", async () => {
    state.responses.organizations = [{ data: [{ id: customerB, code: "CLI-B", name: "Cliente B", owning_organization_id: otherOrganizationId }], error: null }];
    expect((await GET()).status).toBe(409);
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.organizations = [{ data: [{ id: customerA, code: "CLI-A", name: "Cliente A", owning_organization_id: organizationId }], error: null }];
    state.responses.quality_cases = [{ data: [{ id: customerB, folio: "R-02", title: "Ajena", external_organization_id: customerB }], error: null }];
    expect((await GET()).status).toBe(409);
  });

  it("blocks the catalog when ownership cannot be checked in the current schema", async () => {
    state.responses.organizations = [{ data: null, error: { code: "42703" } }];
    expect((await GET()).status).toBe(409);
  });

  it("denies internal viewers, customers and suppliers before using privileged queries", async () => {
    for (const userType of ["Usuario interno", "Cliente", "Proveedor"] as const) {
      state.calls = [];
      state.session = { ...state.session!, userType };
      expect((await GET()).status).toBe(403);
      expect(state.calls).toHaveLength(0);
    }
  });
});
