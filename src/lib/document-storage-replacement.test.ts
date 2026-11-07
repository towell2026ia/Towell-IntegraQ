import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), download: vi.fn(), remove: vi.fn(), range: vi.fn(), from: vi.fn(), signedUrl: vi.fn() }));
vi.mock("./supabase/client", () => ({ createClient: () => ({ rpc: mock.rpc, auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) }, from: mock.from, storage: { from: () => ({ upload: mock.upload, download: mock.download, remove: mock.remove, createSignedUrl: mock.signedUrl }) } }) }));
import { getControlledDocumentDownloadUrl, uploadPendingControlledDocument } from "./document-storage";
import type { ActiveSession } from "./session-data";
const input = () => ({ processId: "P-35", documentTypeId: "visual-aids", code: "AV-SGC-06", name: "Política de seguridad e higiene", file: new File(["original bytes"], "new.png", { type: "image/png" }), session: {} as ActiveSession });
const reservation = { fileId: "file-1", objectPath: "actor/documents/P-35/file-1/new.png", state: "upload_pending", documentId: null };
beforeEach(() => {
 vi.clearAllMocks(); mock.upload.mockResolvedValue({ error: null }); mock.download.mockResolvedValue({ data: null, error: { message: "Not found" } });
 mock.rpc.mockImplementation(async name => ({ data: name === "reserve_controlled_document_upload" ? reservation : "document", error: null }));
 const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: mock.range };
 mock.from.mockReturnValue(query);
 mock.range.mockResolvedValue({ data: [{ id: "document", process_id: "P-35", document_type_id: "visual-aid", code: "AV-SGC-06", title: "Original identity", lifecycle: { is_deleted: true, lifecycle_status: "deleted", delete_reason: "Historical reason" }, versions: [], activity: [] }], count: 1, error: null });
});
describe("reserved controlled document upload", () => {
 it.each(["DOCUMENT_CODE_EXISTS", "FORBIDDEN", "DOCUMENT_PENDING_REVIEW", "DOCUMENT_SCOPE_MISMATCH", "DOCUMENT_CHANGED"])("%s is rejected before binary upload", async message => {
  mock.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  await expect(uploadPendingControlledDocument(input())).rejects.toThrow(); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled();
 });
 it.each(["version", "revision"] as const)("reserves and registers %s without INSERT RETURNING", async kind => {
  const source = { ...input(), replacementKind: kind, expectedDocumentId: "document", expectedBaseVersionId: "base", changeReason: "Authorized correction" };
  const result = await uploadPendingControlledDocument(source);
  expect(result.id).toBe("document"); expect(result.lifecycle?.isDeleted).toBe(true);
  expect(mock.rpc).toHaveBeenNthCalledWith(1, "reserve_controlled_document_upload", expect.objectContaining({ p_code: "AV-SGC-06", p_title: source.name, p_kind: kind, p_document_id: "document", p_base_version_id: "base", p_file: expect.objectContaining({ name: "new.png", size: source.file.size, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  expect(mock.rpc).toHaveBeenLastCalledWith("register_controlled_document_upload", expect.objectContaining({ p_kind: kind, p_file_id: "file-1", p_document_id: "document", p_base_version_id: "base" }));
  expect(mock.rpc.mock.lastCall?.[1]).not.toHaveProperty("p_revision");
  expect(mock.from.mock.calls.every(([table]) => table === "controlled_documents")).toBe(true);
  expect(mock.upload).toHaveBeenCalledWith(reservation.objectPath, source.file, { contentType: "image/png", upsert: false });
 });
 it("keeps code and title separate without deriving either from a filename", async () => {
  await uploadPendingControlledDocument({ ...input(), code: " av-sgc-04 ", name: "Objetivos de calidad", file: new File(["PDF"], "AV-SGC-04 Objetivos de calidad.pdf", { type: "application/pdf" }) });
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({ p_code: "AV-SGC-04", p_title: "Objetivos de calidad" });
 });
 it("rejects concatenated new codes without silently rewriting them", async () => {
  await expect(uploadPendingControlledDocument({ ...input(), code: "AV-SGC-04 Objetivos de calidad" })).rejects.toThrow("identificador"); expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("recovers a committed transaction after a lost response without another upload", async () => {
  mock.rpc.mockResolvedValueOnce({ data: { ...reservation, state: "upload_registered", documentId: "document" }, error: null });
  expect((await uploadPendingControlledDocument(input())).id).toBe("document"); expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled();
 });
 it("verifies previously uploaded bytes on retry without overwriting", async () => {
  mock.upload.mockResolvedValue({ error: { message: "The resource already exists" } }); mock.download.mockResolvedValue({ data: new Blob(["original bytes"]), error: null });
  await uploadPendingControlledDocument(input()); expect(mock.download).toHaveBeenCalledWith(reservation.objectPath); expect(mock.rpc).toHaveBeenCalledTimes(2); expect(mock.remove).not.toHaveBeenCalled();
 });
 it("does not register different bytes from an interrupted upload", async () => {
  mock.upload.mockResolvedValue({ error: { message: "Network interrupted" } }); mock.download.mockResolvedValue({ data: new Blob(["different bytes"]), error: null });
  await expect(uploadPendingControlledDocument(input())).rejects.toThrow("referencia pendiente"); expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.remove).not.toHaveBeenCalled();
 });
 it("retains a tracked reference after a transaction failure without false success", async () => {
  mock.rpc.mockResolvedValueOnce({ data: reservation, error: null }).mockResolvedValueOnce({ error: { message: "DOCUMENT_CHANGED" } });
  await expect(uploadPendingControlledDocument(input())).rejects.toThrow("carga permanece identificada"); expect(mock.remove).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled();
 });
 it("fails closed for another user's reservation path", async () => {
  mock.rpc.mockResolvedValueOnce({ data: { ...reservation, objectPath: "another/documents/P-35/file-1/new.png" } });
  await expect(uploadPendingControlledDocument(input())).rejects.toThrow("reserva"); expect(mock.upload).not.toHaveBeenCalled();
 });
 it("requires a replacement reason before reservation", async () => {
  await expect(uploadPendingControlledDocument({ ...input(), replacementKind: "revision" })).rejects.toThrow("motivo"); expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("creates a new identity only through initial atomic registration", async () => {
  await uploadPendingControlledDocument(input()); expect(mock.rpc.mock.lastCall?.[1]).toMatchObject({ p_kind: "initial", p_document_id: null, p_base_version_id: null });
 });
 it("keeps original and preview signed URLs short-lived", async () => {
  mock.signedUrl.mockResolvedValue({ data: { signedUrl: "https://private.example/temporary" }, error: null });
  const version = { storageBucket: "integraq-private", storageObjectPath: "actor/original.pdf", previewPath: "actor/preview.pdf" } as Parameters<typeof getControlledDocumentDownloadUrl>[0];
  await getControlledDocumentDownloadUrl(version); await getControlledDocumentDownloadUrl(version, "preview");
  expect(mock.signedUrl.mock.calls).toEqual([["actor/original.pdf",60],["actor/preview.pdf",60]]);
 });
});
