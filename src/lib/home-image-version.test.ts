import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlledDocument } from "./document-control-data";
import { activeSession } from "./session-data";
const mocks = vi.hoisted(() => ({ url: vi.fn(), upload: vi.fn() }));
vi.mock("./document-storage", () => ({ getControlledDocumentDownloadUrl: mocks.url, uploadNewControlledDocumentVersion: mocks.upload }));
import { createInstitutionalImageVersion, imageMimeFromHeader } from "./home-image-version";
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const document: ControlledDocument = { id: "534cb9bb-aa93-4971-bcf9-df1903b90755", code: "IMG-01", name: "Política de Calidad", documentTypeId: "visual-aids", processId: "P-35", owner: "SGC", versions: [
  { id: "current", revision: 2, status: "current", fileName: "actual.png", uploadedBy: "A", validator: "B", modifiedAt: "2026-10-29", changeReason: "Actual", storageObjectPath: "actual.png" },
  { id: "old", revision: 1, status: "obsolete", fileName: "original.png", uploadedBy: "Otro usuario", validator: "B", modifiedAt: "2026-10-20", changeReason: "Original", storageObjectPath: "original.png" },
] };
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); mocks.url.mockResolvedValue("https://storage.test/original"); mocks.upload.mockResolvedValue({ id: "new", revision: 3, status: "draft" }); });
describe("institutional image revisions", () => {
  it("detects actual image signatures rather than trusting extensions", () => { expect(imageMimeFromHeader(png)).toBe("image/png"); expect(imageMimeFromHeader(new TextEncoder().encode("<svg></svg>"))).toBeNull(); });
  it("creates a new independent revision and preserves the original model", async () => {
    const before = JSON.stringify(document);
    await createInstitutionalImageVersion({ document, session: activeSession, reason: "Nueva política", file: new File([png], "politica.png", { type: "application/octet-stream" }) });
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ revision: 3, changeReason: "Nueva política" });
    expect(mocks.upload.mock.calls[0][0].file.type).toBe("image/png");
    expect(JSON.stringify(document)).toBe(before);
  });
  it("recovers the original bytes into a new revision without overwriting the old file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(png)); vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(document);
    const result = await createInstitutionalImageVersion({ document, session: activeSession, reason: "Recuperar versión aprobada", restoreVersionId: "old" });
    expect(result.status).toBe("draft"); expect(mocks.url).toHaveBeenCalledWith(document.versions[1]);
    const upload = mocks.upload.mock.calls[0][0]; expect(upload.revision).toBe(3); expect(upload.file.name).toBe("original.png");
    expect(new Uint8Array(await upload.file.arrayBuffer())).toEqual(png);
    expect(JSON.stringify(document)).toBe(before); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a version belonging to another document", async () => {
    await expect(createInstitutionalImageVersion({ document, session: activeSession, reason: "Restaurar", restoreVersionId: "foreign-version" })).rejects.toThrow("original recuperable"); expect(mocks.url).not.toHaveBeenCalled();
  });
  it("does not create another revision while validation is pending", async () => {
    await expect(createInstitutionalImageVersion({ document: { ...document, versions: [{ ...document.versions[0], status: "pending" }] }, session: activeSession, reason: "Sustituir", file: new File([png], "a.png") })).rejects.toThrow("validación"); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not grant image administration to an internal viewer", async () => {
    await expect(createInstitutionalImageVersion({ document, session: { ...activeSession, userType: "Usuario interno" }, reason: "Cambiar", file: new File([png], "a.png") })).rejects.toThrow("administrador"); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not create a replacement when the original cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(createInstitutionalImageVersion({ document, session: activeSession, reason: "Restaurar", restoreVersionId: "old" })).rejects.toThrow("recuperar"); expect(mocks.upload).not.toHaveBeenCalled();
  });
});