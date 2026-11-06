import { describe, expect, it } from "vitest";
import { documentVersionLabel, nextDocumentNumbering } from "./document-replacement";
import { approveDocumentVersion, rejectDocumentVersion, type ControlledDocumentVersion, type ControlledDocument } from "./document-control-data";

const legacy: ControlledDocumentVersion = { id: "original", revision: 0, status: "current", fileName: "original.pdf", uploadedBy: "Actor", validator: "Authorizer", modifiedAt: "2026-11-05", changeReason: "Historical" };
describe("explicit document numbering without rewriting history", () => {
  it("starts new documents at version zero", () => expect(nextDocumentNumbering([], "version")).toMatchObject({ revision: 0, versionNumber: 0, revisionSequence: 0 }));
  it("preserves the historical label", () => {
    expect(documentVersionLabel(legacy)).toBe("Rev. histórica 0");
    expect(legacy).not.toHaveProperty("versionNumber");
  });
  it("allocates version one after historical zero without changing the original", () => {
    expect(nextDocumentNumbering([legacy], "version")).toMatchObject({ revision: 1, versionNumber: 1, revisionSequence: 0 });
    expect(legacy.revision).toBe(0);
  });
  it("corrects a legacy row without interpreting its revision as a version", () => {
    const candidate = { ...legacy, ...nextDocumentNumbering([legacy], "revision") };
    expect(candidate.versionNumber).toBeUndefined();
    expect(documentVersionLabel(candidate)).toBe("Rev. histórica 0 · revisión 1");
  });
  it("keeps an explicit version number on correction", () => {
    const original = { ...legacy, versionNumber: 2, revisionSequence: 0, revision: 5 };
    expect(nextDocumentNumbering([original], "revision")).toMatchObject({ revision: 6, versionNumber: 2, revisionSequence: 1 });
  });
  it("does not inflate version numbering from technical correction sequence", () => {
    const original = { ...legacy, versionNumber: 1, revisionSequence: 8, revision: 9 };
    expect(nextDocumentNumbering([legacy, original], "version")).toMatchObject({ revision: 10, versionNumber: 2 });
  });
  it("uses the current version rather than a rejected proposal for a correction", () => {
    const proposal = { ...legacy, id: "rejected", revision: 3, status: "rejected" as const, versionNumber: 2 };
    const current = { ...legacy, versionNumber: 1, revisionSequence: 0 };
    expect(nextDocumentNumbering([proposal, current], "revision").versionNumber).toBe(1);
  });
  it("labels explicit versions and corrections separately", () => {
    expect(documentVersionLabel({ ...legacy, versionNumber: 2 })).toBe("Versión 2");
    expect(documentVersionLabel({ ...legacy, versionNumber: 2, revisionSequence: 3 })).toBe("Versión 2 · revisión 3");
  });
});
describe("existing approval and rejection preserve originals", () => {
  const document: ControlledDocument = { id: "document", processId: "P-35", documentTypeId: "visual-aids", code: "AV-TEST", name: "Original", owner: "Towell", versions: [legacy, { ...legacy, id: "pending", revision: 1, status: "pending", fileName: "new.pdf" }] };
  it("approval leaves exactly one current original and preserves both records", () => {
    const approved = approveDocumentVersion(document, "Authorizer", "2026-11-06");
    expect(approved.versions.filter(v => v.status === "current").map(v => v.fileName)).toEqual(["new.pdf"]);
    expect(approved.versions.find(v => v.id === "original")?.status).toBe("obsolete");
    expect(approved.versions).toHaveLength(2);
  });
  it("rejection retains the current original and rejected candidate", () => {
    const rejected = rejectDocumentVersion(document, "Correction required", "2026-11-06");
    expect(rejected.versions.find(v => v.id === "original")?.status).toBe("current");
    expect(rejected.versions.find(v => v.id === "pending")?.status).toBe("rejected");
  });
});
