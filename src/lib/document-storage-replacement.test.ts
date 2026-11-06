import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), insert: vi.fn(), range: vi.fn(), from: vi.fn(), single: vi.fn(), signedUrl: vi.fn() }));
vi.mock("./supabase/client", () => ({ createClient: () => ({ rpc: mock.rpc, auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) }, from: mock.from, storage: { from: () => ({ upload: mock.upload, createSignedUrl: mock.signedUrl }) } }) }));
import { getControlledDocumentDownloadUrl, uploadPendingControlledDocument } from "./document-storage";
import type { ActiveSession } from "./session-data";
const match = { id: "document", title: "Original identity", code: "AV-SGC-06", processId: "P-35", documentTypeId: "visual-aid", compatible: true, deleted: true, baseVersionId: "base", pending: false };
const input = () => ({ processId: "P-35", documentTypeId: "visual-aids", code: "AV-SGC-06", name: "New", file: new File(["original bytes"], "new.png", { type: "image/png" }), session: {} as ActiveSession });
beforeEach(() => {
  vi.clearAllMocks();
  mock.upload.mockResolvedValue({ error: null });
  mock.single.mockResolvedValue({ data: { id: "file" }, error: null });
  const query = { insert: mock.insert, select: vi.fn().mockReturnThis(), single: mock.single, order: vi.fn().mockReturnThis(), range: mock.range };
  mock.from.mockReturnValue(query); mock.insert.mockReturnValue(query);
  mock.range.mockResolvedValue({ data: [{ id: "document", process_id: "P-35", document_type_id: "visual-aid", code: "AV-SGC-06", title: "Original identity", lifecycle: { is_deleted: true, lifecycle_status: "deleted", delete_reason: "Historical reason" }, versions: [], activity: [] }], count: 1, error: null });
});
describe("real-catalog replacement upload", () => {
  it("rejects a duplicate without replacement before any upload or insert", async () => {
    mock.rpc.mockResolvedValue({ data: match, error: null });
    await expect(uploadPendingControlledDocument(input())).rejects.toThrow("Ya existe");
    expect(mock.upload).not.toHaveBeenCalled(); expect(mock.insert).not.toHaveBeenCalled();
  });
  it("propagates server authorization denial without uploading", async () => {
    mock.rpc.mockResolvedValue({ error: { message: "FORBIDDEN" } });
    await expect(uploadPendingControlledDocument(input())).rejects.toThrow("permisos");
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it.each(["version", "revision"] as const)("replaces retired identity using %s and server numbering", async kind => {
    mock.rpc.mockResolvedValueOnce({ data: match }).mockResolvedValueOnce({ data: "document" });
    const result = await uploadPendingControlledDocument({ ...input(), replacementKind: kind, expectedDocumentId: "document", expectedBaseVersionId: "base", changeReason: "Authorized correction" });
    expect(result.id).toBe("document"); expect(result.lifecycle?.isDeleted).toBe(true);
    expect(mock.rpc).toHaveBeenLastCalledWith("register_controlled_document_upload", expect.objectContaining({ p_kind: kind, p_document_id: "document", p_base_version_id: "base", p_title: "Original identity", p_file_id: "file" }));
    expect(mock.rpc.mock.lastCall?.[1]).not.toHaveProperty("p_revision");
    expect(mock.upload).toHaveBeenCalledWith(expect.stringMatching(/^actor\/documents\/.+\/new.png$/), expect.any(File), { contentType: "image/png", upsert: false });
  });
  it("rejects a stale identity or base before uploading", async () => {
    mock.rpc.mockResolvedValue({ data: { ...match, baseVersionId: "changed" } });
    await expect(uploadPendingControlledDocument({ ...input(), replacementKind: "revision", expectedDocumentId: "document", expectedBaseVersionId: "base", changeReason: "Correction" })).rejects.toThrow("expediente cambió");
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it("rejects mismatched process/type without reassignment", async () => {
    mock.rpc.mockResolvedValue({ data: { ...match, compatible: false } });
    await expect(uploadPendingControlledDocument({ ...input(), replacementKind: "version", expectedDocumentId: "document", expectedBaseVersionId: "base", changeReason: "Correction" })).rejects.toThrow("proceso");
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it("keeps query errors explicit", async () => {
    mock.rpc.mockResolvedValue({ error: { message: "Network unavailable" } });
    await expect(uploadPendingControlledDocument(input())).rejects.toThrow("Network unavailable");
  });
  it("requires a reason before uploading a replacement", async () => {
    mock.rpc.mockResolvedValue({ data: match });
    await expect(uploadPendingControlledDocument({ ...input(), replacementKind: "revision", expectedDocumentId: "document", expectedBaseVersionId: "base" })).rejects.toThrow("motivo");
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it("creates new identity only when no existing code is found", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: "document" });
    await uploadPendingControlledDocument(input());
    expect(mock.rpc).toHaveBeenLastCalledWith("register_controlled_document_upload", expect.objectContaining({ p_kind: "initial", p_document_id: null, p_base_version_id: null }));
  });
  it("does not report success when the transaction rejects concurrency", async () => {
    mock.rpc.mockResolvedValueOnce({ data: match }).mockResolvedValueOnce({ error: { message: "DOCUMENT_CHANGED" } });
    await expect(uploadPendingControlledDocument({ ...input(), replacementKind: "revision", expectedDocumentId: "document", expectedBaseVersionId: "base", changeReason: "Correction" })).rejects.toThrow("expediente cambió");
  });
  it("uses short-lived signed URLs for originals and historical previews", async () => {
    mock.signedUrl.mockResolvedValue({ data: { signedUrl: "https://private.example/temporary" }, error: null });
    const version = { storageBucket: "integraq-private", storageObjectPath: "actor/original.pdf", previewPath: "actor/preview.pdf" } as Parameters<typeof getControlledDocumentDownloadUrl>[0];
    await getControlledDocumentDownloadUrl(version); await getControlledDocumentDownloadUrl(version, "preview");
    expect(mock.signedUrl.mock.calls).toEqual([["actor/original.pdf", 60], ["actor/preview.pdf", 60]]);
  });
});
