import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown; count?: number }>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/access-policy", () => ({ canAccessModule: () => true }));
function client() {
  return { from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const next = () => state.responses[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "update", "insert", "upsert", "in"]) {
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));

import { DELETE, GET, PATCH, POST } from "./route";

const customerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const request = (method: string, body: unknown) => new Request("https://integraq.test/api/root2cause/published-actions", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const calls = (table: string, method: string) => state.calls.filter(call => call.table === table && call.method === method);
const customerAction = {
  id: actionId, folio: "AC-2026-015", source: "customer", relatedPartyId: customerA,
  title: "Reclamación", problem: "Desviación documentada", owner: "Responsable",
  dueDate: "2026-11-02", status: "action_plan", severity: "medium", progress: 55,
  a3: { plans: [] },
};

beforeEach(() => {
  state.calls = [];
  state.responses = {};
  state.session = { ...activeSession, authUserId: actionId, workspaceMode: "production" };
});

describe("Root2Cause portal authorization", () => {
  it("denies internal users before querying customer actions", async () => {
    expect((await GET()).status).toBe(403);
    expect(calls("corrective_actions", "from")).toHaveLength(0);
  });

  it("returns only the authenticated customer's explicitly published safe fields", async () => {
    state.session = { ...state.session!, userType: "Cliente", externalParty: { kind: "customer", companyId: customerA, companyName: "Cliente A" } };
    state.responses.profiles = [{ data: { user_type: "customer", status: "active", workspace_mode: "production", external_party_kind: "customer", external_party_id: customerA }, error: null }];
    state.responses.organizations = [{ data: { id: customerA, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }];
    const base = { id: actionId, folio: "AC-2026-015", title: "Caso", status: "open", progress: 20,
      due_date: "2026-11-02", source: "customer", portal_visible: true, deleted_at: null };
    state.responses.corrective_actions = [{ data: [
      { ...base, external_organization_id: customerA, problem: "Análisis interno" },
      { ...base, external_organization_id: customerB },
      { ...base, external_organization_id: customerA, portal_visible: false },
      { ...base, external_organization_id: customerA, deleted_at: "2026-11-02" },
      { ...base, external_organization_id: customerA, source: "internal" },
    ], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).actions).toEqual([{
      id: actionId, folio: "AC-2026-015", title: "Caso", status: "open", progress: 20, dueDate: "2026-11-02",
    }]);
    expect(calls("corrective_actions", "eq")).toContainEqual({ table: "corrective_actions", method: "eq", args: ["external_organization_id", customerA] });
    expect(calls("corrective_actions", "eq")).toContainEqual({ table: "corrective_actions", method: "eq", args: ["organization_id", organizationId] });
    expect(calls("corrective_actions", "eq")).toContainEqual({ table: "corrective_actions", method: "eq", args: ["portal_visible", true] });
  });

  it("scopes customer B to B and rejects a supplier even when portal access is otherwise granted", async () => {
    state.session = { ...state.session!, userType: "Cliente", externalParty: { kind: "customer", companyId: customerB, companyName: "Cliente B" } };
    state.responses.profiles = [{ data: { user_type: "customer", status: "active", workspace_mode: "production", external_party_kind: "customer", external_party_id: customerB }, error: null }];
    state.responses.organizations = [{ data: { id: customerB, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }];
    const base = { id: actionId, folio: "AC-2026-015", title: "Caso B", status: "open", progress: 10,
      due_date: "2026-11-02", source: "customer", portal_visible: true, deleted_at: null };
    state.responses.corrective_actions = [{ data: [
      { ...base, external_organization_id: customerA },
      { ...base, external_organization_id: customerB },
    ], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).actions).toHaveLength(1);
    expect(calls("corrective_actions", "eq")).toContainEqual({ table: "corrective_actions", method: "eq", args: ["external_organization_id", customerB] });

    state.calls = [];
    state.session = { ...state.session!, userType: "Proveedor", externalParty: { kind: "supplier", companyId: customerB, companyName: "Proveedor" } };
    expect((await GET()).status).toBe(403);
    expect(calls("corrective_actions", "from")).toHaveLength(0);
  });

  it("rejects publication without a real customer and does not write", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    const response = await POST(request("POST", { action: { id: actionId, source: "customer", relatedPartyId: "customer-001" } }));
    expect(response.status).toBe(400);
    expect(calls("corrective_actions", "insert")).toHaveLength(0);
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("blocks a foreign or unverified customer before creating or publishing an analysis", async () => {
    for (const owner of [customerB, null]) {
      state.calls = [];
      state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
      state.responses.organizations = [{ data: { id: customerA, owning_organization_id: owner }, error: null }];
      const response = await POST(request("POST", { action: customerAction, publish: true }));
      expect(response.status).toBe(403);
      expect(calls("organizations", "eq")).toContainEqual({ table: "organizations", method: "eq", args: ["owning_organization_id", organizationId] });
      expect(calls("corrective_actions", "insert")).toHaveLength(0);
      expect(calls("corrective_actions", "update")).toHaveLength(0);
    }
  });

  it("blocks an unverified customer schema or a claim from another organization", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.organizations = [{ data: null, error: { code: "42703" } }];
    expect((await POST(request("POST", { action: customerAction }))).status).toBe(409);
    state.calls = [];
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.organizations = [{ data: { id: customerA, owning_organization_id: organizationId }, error: null }];
    state.responses.quality_cases = [{ data: { id: customerB, external_organization_id: customerB }, error: null }];
    const response = await POST(request("POST", { action: { ...customerAction, qualityCaseId: customerB }, publish: true }));
    expect(response.status).toBe(403);
    expect(calls("quality_cases", "eq")).toContainEqual({ table: "quality_cases", method: "eq", args: ["external_organization_id", customerA] });
    expect(calls("corrective_actions", "insert")).toHaveLength(0);
  });

  it("does not publish merely because an administrator selects a real customer", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.organizations = [{ data: { id: customerA, owning_organization_id: organizationId }, error: null }];
    state.responses.corrective_actions = [{ data: null, error: null }, { data: null, error: null }];
    state.responses.corrective_action_a3 = [{ data: null, error: null }];
    state.responses.audit_log = [{ data: null, error: null }];
    const response = await POST(request("POST", { action: customerAction, publish: false }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ portalVisible: false });
    expect(calls("corrective_actions", "insert")[0].args[0]).toMatchObject({
      source: "customer", external_organization_id: customerA, portal_visible: false,
    });
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("retains an existing claim link when following up after cancellation",async()=>{
    state.responses.profiles=[{data:{organization_id:organizationId,user_type:"administrator",status:"active",workspace_mode:"production"},error:null}];
    state.responses.organizations=[{data:{id:customerA,owning_organization_id:organizationId},error:null}];
    state.responses.quality_cases=[{data:{id:customerB,external_organization_id:customerA,cancelled_at:"2026-11-06"},error:null}];
    state.responses.corrective_actions=[{data:{id:actionId,source:"customer",external_organization_id:customerA,organization_id:organizationId,quality_case_id:customerB,deleted_at:null},error:null},{data:null,error:null}];
    expect((await POST(request("POST",{action:{...customerAction,qualityCaseId:customerB},publish:false}))).status).toBe(200);
    expect(calls("quality_cases","is")).toHaveLength(0);
  });

  it("lets only a verified administrator explicitly publish and withdraw a customer analysis", async () => {
    state.responses.profiles = [
      { data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null },
      { data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null },
    ];
    state.responses.organizations = [{ data: { id: customerA, owning_organization_id: organizationId }, error: null }];
    state.responses.corrective_actions = [
      { data: null, error: null }, { data: null, error: null }, { data: { id: actionId }, error: null },
      { data: { id: actionId }, error: null },
    ];
    state.responses.corrective_action_a3 = [{ data: null, error: null }];
    state.responses.audit_log = [{ data: null, error: null }, { data: null, error: null }];
    const published = await POST(request("POST", { action: customerAction, publish: true }));
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ portalVisible: true });
    expect(calls("corrective_actions", "update")[0].args[0]).toEqual({ portal_visible: true });
    const withdrawn = await PATCH(request("PATCH", { id: actionId }));
    expect(withdrawn.status).toBe(200);
    expect(calls("corrective_actions", "update")[1].args[0]).toEqual({ portal_visible: false });
  });

  it("saves an SGC analysis without publishing it to any portal", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.corrective_actions = [{ data: null, error: null }, { data: null, error: null }];
    state.responses.corrective_action_plans = [{ data: [], error: null }, { data: null, error: null }];
    state.responses.corrective_action_a3 = [{ data: null, error: null }];
    state.responses.audit_log = [{ data: null, error: null }];
    const action = {
      id: actionId, folio: "AC-2026-015", source: "sgc", title: "Hallazgo", problem: "Desviación documentada",
      owner: "Responsable", dueDate: "2026-11-02", status: "action_plan", severity: "medium", progress: 55,
      a3: { plans: [{ id: customerB, description: "Corregir", owner: "Responsable", dueDate: "2026-11-15", status: "pending" }] },
    };
    const response = await POST(request("POST", { action, publish: false }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ portalVisible: false });
    expect(calls("corrective_actions", "insert")[0].args[0]).toMatchObject({
      source: "sgc", portal_visible: false, organization_id: organizationId, external_organization_id: null,
    });
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("requires a persisted administrator before any deletion", async () => {
    state.session = { ...state.session!, userType: "Cliente" };
    expect((await DELETE(request("DELETE", { id: actionId, reason: "Duplicado" }))).status).toBe(403);
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("rejects direct creation and edits from an internal account with historical write grants", async () => {
    state.session = { ...state.session!, userType: "Usuario interno", assignedModuleIds: ["corrective-actions"],
      moduleActionPermissions: [{ moduleId: "corrective-actions", action: "create" },
        { moduleId: "corrective-actions", action: "update" }] };
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "internal", status: "active", workspace_mode: "production" }, error: null }];
    expect((await POST(request("POST", { action: {} }))).status).toBe(403);
    expect((await POST(request("POST", { action: {}, publish: true }))).status).toBe(403);
    expect((await PATCH(request("PATCH", { id: actionId }))).status).toBe(403);
    expect((await DELETE(request("DELETE", { id: actionId, reason: "No autorizado" }))).status).toBe(403);
    expect(calls("corrective_actions", "insert")).toHaveLength(0);
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("rejects customer and supplier write requests", async () => {
    for (const userType of ["Cliente", "Proveedor"] as const) {
      state.session = { ...state.session!, userType };
      expect((await POST(request("POST", { action: {} }))).status).toBe(403);
      expect((await PATCH(request("PATCH", { id: actionId }))).status).toBe(403);
      expect((await DELETE(request("DELETE", { id: actionId, reason: "No autorizado" }))).status).toBe(403);
    }
    expect(calls("corrective_actions", "insert")).toHaveLength(0);
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("requires a deletion reason before changing a record", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    expect((await DELETE(request("DELETE", { id: actionId, reason: " " }))).status).toBe(400);
    expect(calls("corrective_actions", "update")).toHaveLength(0);
  });

  it("soft deletes within the administrator's organization and never deletes files or child rows", async () => {
    state.responses.profiles = [{ data: { organization_id: organizationId, user_type: "administrator", status: "active", workspace_mode: "production" }, error: null }];
    state.responses.corrective_actions = [
      { data: { id: actionId, quality_case_id: null, external_organization_id: customerA, deleted_at: null }, error: null },
      { data: { id: actionId }, error: null },
    ];
    state.responses.corrective_action_plans = [{ data: null, error: null, count: 2 }];
    state.responses.file_objects = [{ data: null, error: null, count: 1 }];
    const response = await DELETE(request("DELETE", { id: actionId, reason: "Duplicado confirmado" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preservedPlans: 2, preservedFiles: 1 });
    expect(calls("corrective_actions", "eq")).toContainEqual({ table: "corrective_actions", method: "eq", args: ["organization_id", organizationId] });
    expect(calls("corrective_actions", "update")[0].args[0]).toMatchObject({
      deletion_reason: "Duplicado confirmado", portal_visible: false, deleted_by: actionId,
    });
    expect(state.calls.filter(call => call.method === "delete")).toHaveLength(0);
  });
});
