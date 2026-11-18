import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ session: null as unknown, rpc: vi.fn(), profile: { organization_id: "org", user_type: "administrator", status: "active", workspace_mode: "production" } }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => mock.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mock.profile, error: null }) }) }) }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mock.rpc }) }));

import { POST } from "./route";

const draftId = "c9d62a40-bbc9-48dc-9415-6020721261df";
const session = { authUserId: "actor", userType: "Administrador", workspaceMode: "production", moduleActionPermissions: [], assignedProcessIds: [] };

function saveRequest(overrides: Record<string, unknown> = {}) {
  const payload = { step: 2, draft: { evidenceId: draftId, origin: "internal", processId: null, problem: "Borrador parcial" } };
  return new Request("https://integraq.test/api/root2cause/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, revision: 0, currentStep: 2, payload, ...overrides }) });
}

describe("Root2Cause draft persistence API", () => {
  beforeEach(() => { mock.session = session; mock.rpc.mockReset().mockResolvedValue({ data: { id: draftId, revision: 1, updatedAt: "2026-11-18T10:00:00Z" }, error: null }); });

  it("persists only through the authenticated save RPC", async () => {
    const response = await POST(saveRequest());
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("iq_root2cause_save_draft", expect.objectContaining({ p_draft_id: draftId, p_expected_revision: 0, p_current_step: 2 }));
  });

  it("rejects a mismatched stage before calling the RPC", async () => {
    const response = await POST(saveRequest({ currentStep: 3 }));
    expect(response.status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("requires an authenticated internal actor", async () => {
    mock.session = null;
    const response = await POST(saveRequest());
    expect(response.status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("reports optimistic revision conflicts without claiming persistence", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "ROOT2CAUSE_DRAFT_REVISION_CONFLICT" } });
    const response = await POST(saveRequest({ revision: 4 }));
    expect(response.status).toBe(409);
  });
});
