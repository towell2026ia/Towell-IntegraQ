import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  pages: [] as Array<{ data: unknown[] | null; error: unknown }>,
  calls: [] as Array<{ method: string; args: unknown[] }>,
}));

vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) {
    chain[method] = (...args: unknown[]) => { state.calls.push({ method, args }); return chain; };
  }
  chain.range = async (...args: unknown[]) => { state.calls.push({ method: "range", args }); return state.pages.shift() ?? { data: [], error: null }; };
  return chain;
} }) }));

import { GET } from "./route";
import { mapStoredAction } from "@/lib/corrective-action-storage";
import { matchesCorrectiveListScope } from "@/lib/corrective-action-list";

const org = "org-a";
const row = (id: string, process_id: string | null, organization_id = org) => ({ id, process_id, organization_id, iq_u08_case_visible: true });

beforeEach(() => {
  state.session = { ...activeSession, organizationId: org, workspaceMode: "production" };
  state.pages = [];
  state.calls = [];
});

describe("Root2Cause internal consultation", () => {
  it("lets administrators read their own organization and paginates", async () => {
    state.pages = [{ data: Array.from({ length: 500 }, (_, n) => row(String(n), "P-99")), error: null },
      { data: [row("last", null), row("foreign", null, "org-b")], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).actions).toHaveLength(501);
    expect(state.calls.filter((call) => call.method === "range").map((call) => call.args)).toEqual([[0, 499], [500, 999]]);
    expect(state.calls).toContainEqual({ method: "eq", args: ["organization_id", org] });
    expect(state.calls).toContainEqual({ method: "eq", args: ["iq_u08_case_visible", true] });
  });

  it("returns assigned processes and organization-wide records to a viewer without requiring participation", async () => {
    state.session = { ...state.session!, userType: "Usuario interno", assignedProcessIds: ["P-13"],
      assignedModuleIds: ["corrective-actions"], moduleActionPermissions: [{ moduleId: "corrective-actions", action: "view" }] };
    state.pages = [{ data: [row("assigned", "P-13"), row("unassigned", null), {...row("other-area", "P-99"),iq_u08_case_visible:false}, row("foreign", "P-13", "org-b")], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).actions.map((item: { id: string }) => item.id)).toEqual(["assigned", "unassigned"]);
  });

  it("denies internal accounts without view permission and both external roles before querying", async () => {
    for (const userType of ["Usuario interno", "Cliente", "Proveedor"] as const) {
      state.session = { ...state.session!, userType, assignedModuleIds: [], moduleActionPermissions: [] };
      expect((await GET()).status).toBe(403);
    }
    expect(state.calls).toHaveLength(0);
  });

  it("does not return a partial list after a database error", async () => {
    state.pages = [{ data: null, error: { message: "denied" } }];
    expect((await GET()).status).toBe(500);
  });
});

it("T-RCA-01-01 / 02 reloads the persisted AC in its own category and process exactly once", async () => {
  state.session = { ...state.session!, userType: "Usuario interno", assignedProcessIds: ["P-13"],
    assignedModuleIds: ["corrective-actions"], moduleActionPermissions: [{moduleId: "corrective-actions", action: "view"}] };
  const action = { ...row("case", "P-13"), folio: "AC-000071", source: "customer", quality_case_id: "claim",
    external_organization_id: "client", external_reference: "REF-47", corrective_action_a3: { workflow_metadata: {descriptiveTitle: "Análisis QA"} },
    corrective_action_plans: [{id:"plan", description:"Medir", owner_id:"responsible", owner_name:"Operador", cause_category:"method", due_date:"2026-12-03"}] };
  for (let attempt = 0; attempt < 2; attempt++) {
    state.pages = [{ data: [action, {...action, id:"hidden", process_id:"P-99",iq_u08_case_visible:false}, {...action, id:"retired", deleted_at:"2026-11-01"}], error:null }];
    const response = await GET();
    const actions = (await response.json()).actions.map(mapStoredAction) as ReturnType<typeof mapStoredAction>[];
    expect(actions.filter(item => matchesCorrectiveListScope(item,"customer"))).toHaveLength(1);
    expect(actions.filter(item => matchesCorrectiveListScope(item,"internal"))).toHaveLength(0);
    expect(actions).toMatchObject([{id:"case", folio:"AC-000071", relatedPartyId:"client", qualityCaseId:"claim",
      externalReference:"REF-47", a3:{descriptiveTitle:"Análisis QA", plans:[{id:"plan",ownerUserId:"responsible",causeCategory:"method"}]}}]);
  }
});
