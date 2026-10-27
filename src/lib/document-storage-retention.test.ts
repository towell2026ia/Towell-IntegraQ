import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
import { softDeleteStoredDocument, restoreStoredDocument } from "./document-storage";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockResolvedValue({ error: null }); mocks.client.mockReturnValue({ rpc: mocks.rpc }); });
describe("retained document lifecycle requests", () => {
  it("rejects an empty removal reason before calling the server", async () => {
    await expect(softDeleteStoredDocument(id, "  ")).rejects.toThrow("motivo");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requests logical deletion with the real ID and trimmed reason", async () => {
    await expect(softDeleteStoredDocument(id, "  Sustitución autorizada  ")).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("soft_delete_document", { p_document_id: id, p_reason: "Sustitución autorizada" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps the retained identity when requesting restoration", async () => {
    await expect(restoreStoredDocument(id)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("restore_document", { p_document_id: id });
  });
  it("reports a restore conflict instead of issuing an overwrite or retry", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "DOCUMENT_ACTIVE_CODE_CONFLICT", code: "23505" } });
    await expect(restoreStoredDocument(id)).rejects.toThrow("No se sobrescribió");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not report success when deletion is refused by authorization", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "FORBIDDEN", code: "42501" } });
    await expect(softDeleteStoredDocument(id, "Motivo explícito")).rejects.toThrow("permisos");
  });
});
