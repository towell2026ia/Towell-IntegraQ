import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), adminRpc: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc, storage: { from: () => ({ remove: mocks.remove, list: mocks.list }) } }) }));

import { DELETE } from "./route";

const id = "0f11a122-c777-45ba-8d43-dbc1c135ff11";
const path = "actor/attachments/corrective-actions/root2cause_evidence/0f11a122-c777-45ba-8d43-dbc1c135ff11_step_0/a1/photo.png";
const admin = { authUserId: "actor", userType: "Administrador", moduleActionPermissions: [{ moduleId: "corrective-actions", action: "manage", source: "direct" }] };
function request(body: unknown) { return new Request("https://integraq.invalid/api/root2cause/actions/" + id, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function call(body: unknown) { return DELETE(request(body), { params: Promise.resolve({ actionId: id }) }); }

describe("Root2Cause hard-delete API", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ROOT2CAUSE_HARD_DELETE_ENABLED", "true");
    mocks.session.mockResolvedValue(admin);
    mocks.rpc.mockResolvedValue({ data: { operationId: "operation-1", status: "storage_pending", paths: [path] }, error: null });
    mocks.adminRpc.mockResolvedValue({ data: { deleted: true }, error: null });
    mocks.remove.mockResolvedValue({ data: [{ name: path }], error: null });
    mocks.list.mockResolvedValue({ data: [], error: null });
  });

  it("fails closed by default before creating a deletion operation", async () => {
    vi.stubEnv("ROOT2CAUSE_HARD_DELETE_ENABLED", "false");
    const response = await call({ folio: "AC-2026-015", reason: "Motivo válido", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects without admin-plus-explicit-manage before any RPC", async () => {
    mocks.session.mockResolvedValue({ ...admin, moduleActionPermissions: [] });
    expect((await call({ folio: "AC-2026-015", reason: "Duplicado", folioConfirmation: "AC-2026-015" })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the exact folio and a reason before reserving deletion", async () => {
    const response = await call({ folio: "AC-2026-015", reason: "", folioConfirmation: "wrong" });
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("removes only server-returned private paths before finalizing the transaction", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { operationId: "operation-1", status: "storage_pending", paths: [path, path] }, error: null });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([path]);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["iq_root2cause_hard_delete_begin"]);
    expect(mocks.adminRpc).toHaveBeenCalledWith("iq_root2cause_hard_delete_complete", { p_operation_id: "operation-1", p_actor_id: "actor" });
  });

  it("keeps the deletion pending if Storage still lists a manifest object", async () => {
    mocks.list.mockResolvedValue({ data: [{ name: "photo.png" }], error: null });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(503);
    expect((await response.json()).cleanupPending).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "iq_root2cause_hard_delete_begin",
      "iq_root2cause_hard_delete_storage_failed",
      "iq_root2cause_hard_delete_begin",
    ]);
  });

  it("blocks an unsafe Storage manifest and leaves a logged pending operation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { operationId: "operation-1", status: "storage_pending", paths: ["../other-module/file.pdf"] }, error: null });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "iq_root2cause_hard_delete_begin",
      "iq_root2cause_hard_delete_storage_failed",
    ]);
  });

  it("does not report success after a Storage failure and leaves the operation retryable", async () => {
    mocks.remove.mockResolvedValue({ data: null, error: { message: "storage failed" } });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(503);
    expect((await response.json()).cleanupPending).toBe(true);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "iq_root2cause_hard_delete_begin",
      "iq_root2cause_hard_delete_storage_failed",
      "iq_root2cause_hard_delete_begin",
    ]);
  });

  it("does not claim completion if PostgreSQL finalization fails after Storage cleanup", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "commit failed" } });
    mocks.rpc.mockResolvedValueOnce({ data: { operationId: "operation-1", status: "storage_pending", paths: [path] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "commit failed" } });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(503);
    expect((await response.json()).deleted).not.toBe(true);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "iq_root2cause_hard_delete_begin",
      "iq_root2cause_hard_delete_storage_failed",
      "iq_root2cause_hard_delete_begin",
    ]);
  });

  it("recognizes a committed deletion when the finalize response was lost", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { operationId: "operation-1", status: "storage_pending", paths: [path] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "failure log saved" } })
      .mockResolvedValueOnce({ data: { operationId: "operation-1", status: "completed", paths: [] }, error: null });
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "connection lost" } });
    const response = await call({ folio: "AC-2026-015", reason: "Captura duplicada", folioConfirmation: "AC-2026-015" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, alreadyCompleted: true });
  });
});
