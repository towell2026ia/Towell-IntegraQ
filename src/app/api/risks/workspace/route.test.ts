import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";
import { buildEmptyRiskWorkspace, buildInitialRiskWorkspace } from "@/lib/risk-opportunity-data";

const state = vi.hoisted(() => ({
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  session: null as ActiveSession | null,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: state.authUserId ? { id: state.authUserId } : null } }) },
    from(table: string) {
      state.calls.push({ table, method: "from", args: [] });
      const next = () => state.responses[table]?.shift() ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "update", "insert", "in"]) {
        chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => next();
      chain.single = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) => resolve(next());
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));

import { DELETE, PUT } from "./route";

const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspace = { ...buildEmptyRiskWorkspace(), risks: buildInitialRiskWorkspace().risks.slice(0, 1),
  actions: buildInitialRiskWorkspace().actions.slice(0, 1) };
const request = (id: string, reason: string) => new Request("https://integraq.test/api/risks/workspace", {
  method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }),
});
const calls = (table: string, method: string) => state.calls.filter((call) => call.table === table && call.method === method);

beforeEach(() => {
  state.authUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  state.session = { ...activeSession, authUserId: state.authUserId, userType: "Administrador", workspaceMode: "production" };
  state.calls = [];
  state.responses = {};
});

describe("risk administrative deletion", () => {
  it("rejects internal, customer and supplier profiles before any update", async () => {
    for (const user_type of ["internal", "customer", "supplier"]) {
      state.responses.profiles = [{ data: { user_type, status: "active" }, error: null }];
      expect((await DELETE(request(workspace.risks[0].id, "Duplicado"))).status).toBe(403);
    }
    expect(calls("form_records", "update")).toHaveLength(0);
  });

  it("rejects missing reason and another organization", async () => {
    state.responses.profiles = [{ data: { user_type: "administrator", status: "active" }, error: null }];
    expect((await DELETE(request(workspace.risks[0].id, " "))).status).toBe(400);
    state.responses.profiles = [
      { data: { user_type: "administrator", status: "active" }, error: null },
      { data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null },
    ];
    state.responses.processes = [{ data: { organization_id: "other-organization" }, error: null }];
    expect((await DELETE(request(workspace.risks[0].id, "Duplicado"))).status).toBe(403);
    expect(calls("form_records", "update")).toHaveLength(0);
  });

  it("preserves related actions and waits for the server update", async () => {
    state.responses.profiles = [
      { data: { user_type: "administrator", status: "active" }, error: null },
      { data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null },
    ];
    state.responses.processes = [
      { data: { organization_id: organizationId }, error: null },
      { data: { organization_id: organizationId }, error: null },
    ];
    state.responses.form_definitions = [{ data: { id: "form-id" }, error: null }];
    state.responses.form_records = [
      { data: { id: "record-id", values: workspace, updated_at: "2026-11-02T00:00:00Z" }, error: null },
      { data: { id: "record-id" }, error: null },
    ];
    state.responses.audit_log = [{ data: null, error: null }];
    const response = await DELETE(request(workspace.risks[0].id, "Duplicado confirmado"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.actions).toEqual(workspace.actions);
    expect(body.state.risks[0]).toMatchObject({ deletedBy: state.authUserId, deletionReason: "Duplicado confirmado" });
    expect(calls("form_records", "update")[0].args[0]).toMatchObject({ values: { actions: workspace.actions } });
    expect(calls("form_records", "eq")).toContainEqual({ table: "form_records", method: "eq", args: ["updated_at", "2026-11-02T00:00:00Z"] });
    expect(state.calls.filter((call) => call.method === "delete")).toHaveLength(0);
  });

  it("rejects an ordinary PUT that omits a historical risk", async () => {
    state.responses.profiles = [{ data: { user_type: "administrator", status: "active" }, error: null }];
    state.responses.form_definitions = [{ data: { id: "form-id" }, error: null }];
    state.responses.form_records = [{ data: { id: "record-id", values: workspace, updated_at: "2026-11-02T00:00:00Z" }, error: null }];
    const response = await PUT(new Request("https://integraq.test/api/risks/workspace", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { ...workspace, risks: [] } }) }));
    expect(response.status).toBe(409);
    expect(calls("form_records", "update")).toHaveLength(0);
  });
});
