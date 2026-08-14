import { describe, expect, it } from "vitest";

import {
  approveDocumentVersion,
  buildInitialControlledDocuments,
  createDocumentRevision,
  getDocumentPermissions,
  rejectDocumentVersion,
  submitDocumentVersion,
  type DocumentPermissionAssignment,
} from "@/lib/document-control-data";
import type { ActiveSession } from "@/lib/session-data";

const baseSession: ActiveSession = {
  userId: "ADM-001",
  name: "Administrador",
  shortName: "Administrador",
  initials: "AD",
  position: "Gerencia",
  department: "Calidad",
  company: "Towell",
  userType: "Administrador",
  assignedProcessIds: [],
};

describe("document control permissions", () => {
  it("gives administrators every document permission and version history", () => {
    expect(getDocumentPermissions(baseSession, "P-01")).toEqual({
      view: true,
      upload: true,
      edit: true,
      submit: true,
      validate: true,
      download: true,
      history: true,
    });
  });

  it("keeps validation separate from upload and edit permissions", () => {
    const user = { ...baseSession, userId: "USR-001", userType: "Usuario" as const, assignedProcessIds: ["P-08"] };
    const assignments: DocumentPermissionAssignment[] = [{
      userId: user.userId,
      processId: "P-08",
      permissions: { view: true, upload: true, edit: true, submit: true, validate: false, download: true },
    }];
    expect(getDocumentPermissions(user, "P-08", assignments).validate).toBe(false);
    expect(getDocumentPermissions(user, "P-13", assignments).view).toBe(false);
  });
});

describe("document revision workflow", () => {
  it("submits and approves a revision while obsoleting the former current version", () => {
    const source = buildInitialControlledDocuments().find((item) => item.id === "DOC-P01-PRO-01")!;
    const draft = createDocumentRevision(source, "Editor", "2026-08-14T10:00:00.000Z");
    const pending = submitDocumentVersion(draft, "2026-08-14T11:00:00.000Z");
    const approved = approveDocumentVersion(pending, "Validador", "2026-08-14T12:00:00.000Z");

    expect(approved.versions.filter((version) => version.status === "current")).toHaveLength(1);
    expect(approved.versions.find((version) => version.status === "current")?.authorizedBy).toBe("Validador");
    expect(approved.versions.some((version) => version.status === "obsolete")).toBe(true);
  });

  it("requires a rejection comment", () => {
    const pending = buildInitialControlledDocuments().find((item) => item.id === "DOC-P01-PRC-01")!;
    expect(rejectDocumentVersion(pending, "", "2026-08-14T12:00:00.000Z")).toEqual(pending);
    expect(rejectDocumentVersion(pending, "Corregir alcance", "2026-08-14T12:00:00.000Z").versions[0].rejectionReason).toBe("Corregir alcance");
  });
});
