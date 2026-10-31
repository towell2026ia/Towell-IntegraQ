import { describe, expect, it } from "vitest";
import { findInstitutionalImages, institutionalImageTitles } from "./home-institutional-images";
import type { ControlledDocument } from "./document-control-data";
import { activeSession } from "./session-data";
const admin = { ...activeSession, authUserId: "admin" };
const viewer = { ...admin, userType: "Usuario interno" as const, assignedProcessIds: ["P-35"], documentAccess: [] };
function document(title: string, status: "pending" | "current" = "current"): ControlledDocument {
  return { id: title, processId: "P-35", documentTypeId: "visual-aids", code: title, name: title, owner: "SGC", versions: [{ id: title + "-v1", revision: 1, status, fileName: title + ".png", uploadedBy: "Admin", validator: "SGC", modifiedAt: "2026-10-29", changeReason: "Original", storageObjectPath: "original.png" }] };
}
describe("institutional image recovery", () => {
  it("locates all four original documents regardless of document type", () => {
    const docs = institutionalImageTitles.map(title => document(title));
    const before = JSON.stringify(docs);
    expect(findInstitutionalImages(docs, viewer).every(slot => slot.version?.status === "current")).toBe(true);
    expect(JSON.stringify(docs)).toBe(before);
  });
  it("uses original filenames when the document title differs", () => {
    const doc = document("Política de Calidad"); doc.name = "Imagen institucional";
    expect(findInstitutionalImages([doc], viewer)[0].document?.id).toBe(doc.id);
  });
  it("does not publish pending versions to internal viewers", () => {
    const doc = document("Política de Calidad", "pending");
    expect(findInstitutionalImages([doc], viewer)[0].version).toBeUndefined();
    expect(findInstitutionalImages([doc], admin)[0].version?.status).toBe("pending");
  });
  it("retains the current version when a replacement is pending", () => {
    const doc = document("Política de Calidad");
    doc.versions.unshift({ ...doc.versions[0], id: "next", revision: 2, status: "pending" });
    expect(findInstitutionalImages([doc], admin)[0].version?.revision).toBe(1);
  });
  it("does not expose another process", () => {
    expect(findInstitutionalImages([document("Política de Calidad")], { ...viewer, assignedProcessIds: ["P-01"] })[0].document).toBeUndefined();
  });
  it("does not arbitrarily select between duplicate candidates", () => {
    const doc = document("Política de Calidad");
    const slot = findInstitutionalImages([doc, { ...doc, id: "other" }], admin)[0];
    expect(slot.ambiguous).toBe(true); expect(slot.version).toBeUndefined();
  });
});