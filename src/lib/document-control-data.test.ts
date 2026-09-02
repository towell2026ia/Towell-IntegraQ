import { describe, expect, it } from "vitest";

import {
  approveDocumentVersion,
  buildBulkImportedDocuments,
  buildInitialControlledDocuments,
  createDocumentRevision,
  getDocumentPermissions,
  rejectDocumentVersion,
  synchronizeAppFormDocuments,
  submitDocumentVersion,
  type DocumentPermissionAssignment,
} from "@/lib/document-control-data";
import { appFormCatalog } from "@/lib/form-data";
import type { ActiveSession } from "@/lib/session-data";
import {
  buildSessionFromAccount,
  createUserAccessAccount,
} from "@/lib/user-access-data";

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
    const user = { ...baseSession, userId: "USR-001", userType: "Usuario interno" as const, assignedProcessIds: ["P-08"] };
    const assignments: DocumentPermissionAssignment[] = [{
      userId: user.userId,
      processId: "P-08",
      permissions: { view: true, upload: true, edit: true, submit: true, validate: false, download: true },
    }];
    expect(getDocumentPermissions(user, "P-08", assignments).validate).toBe(false);
    expect(getDocumentPermissions(user, "P-13", assignments).view).toBe(false);
  });

  it("inherits modifier permissions from a responsible organigram position", () => {
    const account = createUserAccessAccount({
      id: "USR-TEJ-001",
      fullName: "Jefatura de Tejido",
      email: "tejido@towell.test",
      userType: "Usuario interno",
      positionId: "PU-12",
      createdAt: "2026-08-17T12:00:00.000Z",
    });
    const permissions = getDocumentPermissions(
      buildSessionFromAccount(account!),
      "P-13",
      [],
    );
    expect(permissions.edit).toBe(true);
    expect(permissions.submit).toBe(true);
    expect(permissions.validate).toBe(false);
  });

  it("inherits authorizer permissions from an approving organigram position", () => {
    const account = createUserAccessAccount({
      id: "USR-OPS-001",
      fullName: "Dirección de Operaciones",
      email: "operaciones@towell.test",
      userType: "Usuario interno",
      positionId: "PU-02",
      createdAt: "2026-08-17T12:00:00.000Z",
    });
    const permissions = getDocumentPermissions(
      buildSessionFromAccount(account!),
      "P-13",
      [],
    );
    expect(permissions.view).toBe(true);
    expect(permissions.validate).toBe(true);
    expect(permissions.edit).toBe(false);
    expect(permissions.history).toBe(false);
  });
});

describe("document revision workflow", () => {
  it("submits and approves a revision while obsoleting the former current version", () => {
    const source = buildInitialControlledDocuments().find((item) => item.appFormId)!;
    const draft = createDocumentRevision(source, "Editor", "2026-08-14T10:00:00.000Z");
    const pending = submitDocumentVersion(draft, "2026-08-14T11:00:00.000Z");
    const approved = approveDocumentVersion(pending, "Validador", "2026-08-14T12:00:00.000Z");

    expect(approved.versions.filter((version) => version.status === "current")).toHaveLength(1);
    expect(approved.versions.find((version) => version.status === "current")?.authorizedBy).toBe("Validador");
    expect(approved.versions.some((version) => version.status === "obsolete")).toBe(true);
  });

  it("requires a rejection comment", () => {
    const pending = buildBulkImportedDocuments()[0];
    expect(rejectDocumentVersion(pending, "", "2026-08-14T12:00:00.000Z")).toEqual(pending);
    expect(rejectDocumentVersion(pending, "Corregir alcance", "2026-08-14T12:00:00.000Z").versions[0].rejectionReason).toBe("Corregir alcance");
  });

  it("loads every source document as pending area authorization", () => {
    const imported = buildBulkImportedDocuments();

    expect(imported).toHaveLength(528);
    expect(imported.every((document) =>
      document.versions.every((version) => version.status === "pending"),
    )).toBe(true);
    expect(new Set(imported.map((document) => document.id)).size).toBe(528);
    expect(imported.filter((document) =>
      document.processId === "P-08" && document.documentTypeId === "forms",
    )).toHaveLength(63);
  });

  it("reflects a form revision in information documented and preserves history", () => {
    const documents = buildInitialControlledDocuments();
    const form = appFormCatalog[0];
    const synchronized = synchronizeAppFormDocuments(documents, [
      { ...form, name: "Registro comercial actualizado", version: form.version + 1 },
      ...appFormCatalog.slice(1),
    ]);
    const document = synchronized.find((item) => item.appFormId === form.id)!;

    expect(document.name).toBe("Registro comercial actualizado");
    expect(document.versions[0].revision).toBe(form.version + 1);
    expect(document.versions[0].status).toBe("current");
    expect(document.versions.some((version) => version.status === "obsolete")).toBe(true);
  });
});
