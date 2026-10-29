import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/document-storage", () => ({}));
vi.mock("@/lib/organization-chart-storage", () => ({ loadProcessOrganizationSources: vi.fn() }));
vi.mock("@/components/modules/general-information-module", () => ({ GeneralInformationModule: () => null }));
vi.mock("@/components/modules/process-organization-chart", () => ({ ProcessOrganizationChart: () => null }));
vi.mock("@/components/modules/document-preview-viewer", () => ({ DocumentPreviewViewer: () => null }));
import { DocumentsModule } from "./documents-module";
import { DocumentTypeWorkspace } from "./document-type-workspace";
import { getDocumentPermissions, type ControlledDocument } from "@/lib/document-control-data";
import { getAuthorizedDocumentProcessIds, documentTypeCatalog } from "@/lib/document-data";
import { processCatalog } from "@/lib/configuration-data";
import { activeSession, canAccessProcess, type ActiveSession } from "@/lib/session-data";
const user: ActiveSession = { ...activeSession, userId: "area", authUserId: "auth-area", userType: "Usuario interno", assignedModuleIds: ["documents"], assignedProcessIds: ["P-19"], documentAccess: [{ processId: "P-19", role: "viewer", inheritedFromPositionId: "DIRECT" }] };
function doc(processId: string): ControlledDocument { return { id: `doc-${processId}`, processId, code: `code-${processId}`, name: `private-${processId}`, documentTypeId: "manuals", owner: "Área", versions: [{ id: `v-${processId}`, revision: 1, status: "pending", fileName: "file.pdf", uploadedBy: "Autor", validator: "Validador", modifiedAt: "2026-10-28T12:00:00Z", changeReason: "Prueba" }] }; }
const documents = [doc("P-13"), doc("P-19"), doc("P-18"), doc("P-01")];
const render = (session: ActiveSession, focusId?: string) => renderToStaticMarkup(createElement(DocumentsModule, { session, focusId, controlledDocuments: documents, forms: [], onControlledDocumentsChange: vi.fn() }));
describe("FIX-03A grouped document visibility", () => {
  it("shows both folders of shared P-19 without granting the parent or siblings", () => {
    const html = render(user);
    expect(html).toContain("P-13 ·"); expect(html).toContain("P-17 ·");
    expect(html).not.toContain("P-01 ·");
    expect(canAccessProcess(user, "P-13")).toBe(false);
    expect(getAuthorizedDocumentProcessIds("P-13", id => getDocumentPermissions(user, id).view)).toEqual(["P-19"]);
    expect(getAuthorizedDocumentProcessIds("P-17", id => getDocumentPermissions(user, id).view)).toEqual(["P-19"]);
  });
  it("opens an authorized focused document and excludes every sibling", () => {
    const html = render(user, "doc-P-19");
    expect(html).toContain("private-P-19");
    for (const id of ["P-13", "P-18", "P-01"]) expect(html).not.toContain(`private-${id}`);
    expect(html).not.toContain('aria-label="Aprobar y publicar"');
  });
  it("does not follow an unauthorized focus", () => { expect(render(user, "doc-P-18")).not.toContain("private-P-18"); });
  it("does not select P-01 when no authorized process exists", () => {
    const html = render({ ...user, assignedProcessIds: [], documentAccess: [] }, "doc-P-01");
    expect(html).toContain("No hay procesos autorizados"); expect(html).not.toContain("private-P-01");
    expect(html).not.toContain("P-01 ·");
  });
  it("retains administrator folder visibility", () => {
    const html = render(activeSession);
    expect(html).toContain("P-01 ·"); expect(html).toContain("P-13 ·"); expect(html).toContain("P-17 ·");
  });
  it("does not grant siblings to a parent-only assignment", () => {
    const parent = { ...user, assignedProcessIds: ["P-13"], documentAccess: [] };
    expect(getAuthorizedDocumentProcessIds("P-13", id => getDocumentPermissions(parent, id).view)).toEqual(["P-13"]);
  });
  it("allows a persisted process assignment to be consulted without a static position fallback", () => {
    expect(getDocumentPermissions({ ...user, documentAccess: [], positionId: "PU-02" }, "P-19")).toMatchObject({ view: true, validate: false, edit: false });
  });
  it("does not resurrect hard-coded user permissions in an authenticated session", () => {
    const persisted = { ...user, userId: "USR-VAL-001", assignedProcessIds: ["P-08"], documentAccess: [] };
    expect(getDocumentPermissions(persisted, "P-08").validate).toBe(false);
  });
  it("accepts the persisted module view action, but not an update action alone", () => {
    expect(render({ ...user, assignedModuleIds: [], moduleActionPermissions: [{ moduleId: "documents", action: "view" }] })).toContain("Documentos controlados");
    expect(render({ ...user, assignedModuleIds: [], moduleActionPermissions: [{ moduleId: "documents", action: "update" }] })).not.toContain("Documentos controlados");
  });
  it("blocks external accounts even with stale internal assignments", () => { expect(render({ ...user, userType: "Cliente" })).not.toContain("Documentos controlados"); });
  it("uses each document role rather than the enclosing folder role", () => {
    const mixed = { ...user, assignedProcessIds: ["P-13", "P-19"], documentAccess: [{ processId: "P-13", role: "authorizer" as const, inheritedFromPositionId: "DIRECT" }, ...user.documentAccess!] };
    const html = renderToStaticMarkup(createElement(DocumentTypeWorkspace, { process: processCatalog.find(p => p.id === "P-13")!, documentType: documentTypeCatalog[1], documents, session: mixed, permissions: getDocumentPermissions(mixed, "P-13"), onBack: vi.fn(), onOpenForm: vi.fn(), onChangeDocument: vi.fn(), onAddDocument: vi.fn() }));
    expect(html.match(/aria-label="Aprobar y publicar"/g)).toHaveLength(1);
    expect(html).not.toContain("private-P-18"); expect(html).toContain("private-P-19");
  });
});
