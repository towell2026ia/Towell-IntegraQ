import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: { authUserId: "actor", userType: "Administrador", workspaceMode: "production", assignedProcessIds: [] },
  planCategory: "method",
  draftStatus: "draft",
  updates: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => mock.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const state: { select?: string; filters: Record<string, unknown>; values?: unknown } = { filters: {} };
  const builder = {
    select: (columns: string) => { state.select = columns; return builder; },
    eq: (key: string, value: unknown) => { state.filters[key] = value; return builder; },
    in: (key: string, value: unknown) => { state.filters[key] = value; return builder; },
    update: (values: unknown) => { state.values = values; mock.updates.push({ table, values }); return builder; },
    maybeSingle: async () => {
      if (table === "profiles" && state.select === "organization_id,user_type,status,workspace_mode") return { data: { organization_id: "org-a", user_type: "administrator", status: "active", workspace_mode: "production" }, error: null };
      if (table === "root2cause_drafts") return { data: draftRow(), error: null };
      if (table === "corrective_action_plans") return { data: { id: planId }, error: null };
      return { data: null, error: null };
    },
    then: (resolve: (value: unknown) => unknown) => {
      if (table === "profiles" && state.select === "id,user_type") return Promise.resolve({ data: [{ id: responsibleId, user_type: "internal" }], error: null }).then(resolve);
      if (table === "profiles" && state.select === "id,full_name") return Promise.resolve({ data: [{ id: responsibleId, full_name: "Responsable real" }], error: null }).then(resolve);
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return builder;
} }) }));

import { POST } from "./route";

const draftId = "c9d62a40-bbc9-48dc-9415-6020721261df";
const planId = "40fc1982-e13f-4d98-bac6-990a8791bbd0";
const causeId = "83cfccde-83d7-481c-9c8e-4fd4e7d605e4";
const responsibleId = "2a4b8c39-a6a2-47f2-9b2b-c8074f39b5d2";

function draftRow() {
  return { organization_id: "org-a", process_id: null, created_by: "actor", status: mock.draftStatus, finalized_action_id: mock.draftStatus === "finalized" ? draftId : null, payload: { draft: {
    causeItems: [{ id: causeId, text: "Falta de control de ajuste", category: mock.planCategory }],
    plans: [{ id: planId, description: "Acción", ownerUserId: responsibleId, causeId, causeCategory: "method", cause: "Falta de control de ajuste" }],
  } } };
}

function finalizeRequest() {
  return new Request("https://integraq.test/api/root2cause/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "finalize", id: draftId, expectedRevision: 2 }) });
}

beforeEach(() => {
  mock.planCategory = "method";
  mock.draftStatus = "draft";
  mock.updates = [];
  mock.rpc.mockReset().mockResolvedValue({ data: { id: draftId, folio: "AC-000001" }, error: null });
});

it("links the selected active internal profile to the persisted action after finalization", async () => {
  const response = await POST(finalizeRequest());
  expect(response.status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("iq_root2cause_finalize_draft", { p_draft_id: draftId, p_expected_revision: 2 });
  expect(mock.updates).toContainEqual({ table: "corrective_action_plans", values: { owner_id: responsibleId, owner_name: "Responsable real" } });
});

it("rejects a plan M that does not match its actual Ishikawa cause before finalizing", async () => {
  mock.planCategory = "material";
  const response = await POST(finalizeRequest());
  expect(response.status).toBe(422);
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(mock.updates).toHaveLength(0);
});

it("can safely retry owner linking after a finalized RPC response was lost", async () => {
  mock.draftStatus = "finalized";
  mock.rpc.mockResolvedValue({ data: { id: draftId, folio: "AC-000001", replayed: true }, error: null });
  const response = await POST(finalizeRequest());
  expect(response.status).toBe(200);
  expect(mock.updates).toContainEqual({ table: "corrective_action_plans", values: { owner_id: responsibleId, owner_name: "Responsable real" } });
});
