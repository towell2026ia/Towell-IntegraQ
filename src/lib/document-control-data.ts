import { appFormCatalog } from "@/lib/form-data";
import type { ActiveSession } from "@/lib/session-data";

export type ControlledDocumentStatus =
  | "draft"
  | "pending"
  | "current"
  | "rejected"
  | "obsolete";

export interface ControlledDocumentVersion {
  id: string;
  revision: number;
  status: ControlledDocumentStatus;
  fileName: string;
  uploadedBy: string;
  validator: string;
  modifiedAt: string;
  changeReason: string;
  authorizedBy?: string;
  authorizedAt?: string;
  rejectionReason?: string;
}

export interface ControlledDocument {
  id: string;
  processId: string;
  documentTypeId: string;
  code: string;
  name: string;
  owner: string;
  appFormId?: string;
  versions: ControlledDocumentVersion[];
}

export interface DocumentPermissions {
  view: boolean;
  upload: boolean;
  edit: boolean;
  submit: boolean;
  validate: boolean;
  download: boolean;
  history: boolean;
}

export interface DocumentPermissionAssignment {
  userId: string;
  processId: string;
  permissions: Omit<DocumentPermissions, "history">;
}

const noPermissions: DocumentPermissions = {
  view: false,
  upload: false,
  edit: false,
  submit: false,
  validate: false,
  download: false,
  history: false,
};

const administratorPermissions: DocumentPermissions = {
  view: true,
  upload: true,
  edit: true,
  submit: true,
  validate: true,
  download: true,
  history: true,
};

export const documentPermissionAssignments: DocumentPermissionAssignment[] = [
  {
    userId: "USR-DOC-001",
    processId: "P-08",
    permissions: {
      view: true,
      upload: true,
      edit: true,
      submit: true,
      validate: false,
      download: true,
    },
  },
  {
    userId: "USR-VAL-001",
    processId: "P-08",
    permissions: {
      view: true,
      upload: false,
      edit: false,
      submit: false,
      validate: true,
      download: true,
    },
  },
];

export function getDocumentPermissions(
  session: ActiveSession,
  processId: string,
  assignments = documentPermissionAssignments,
): DocumentPermissions {
  if (session.userType === "Administrador") return administratorPermissions;
  if (!session.assignedProcessIds.includes(processId)) return noPermissions;

  const assignment = assignments.find(
    (item) => item.userId === session.userId && item.processId === processId,
  );
  return assignment ? { ...assignment.permissions, history: false } : noPermissions;
}

export function getWorkingVersion(document: ControlledDocument) {
  return (
    document.versions.find((version) => version.status === "pending") ??
    document.versions.find((version) => version.status === "rejected") ??
    document.versions.find((version) => version.status === "draft") ??
    document.versions.find((version) => version.status === "current") ??
    document.versions[0]
  );
}

export function createDocumentRevision(
  document: ControlledDocument,
  actor: string,
  modifiedAt: string,
): ControlledDocument {
  const source = getWorkingVersion(document);
  if (!source || source.status !== "current") return document;

  const nextRevision = Math.max(...document.versions.map((version) => version.revision)) + 1;
  return {
    ...document,
    versions: [
      {
        ...source,
        id: `${document.id}-R${nextRevision}`,
        revision: nextRevision,
        status: "draft",
        uploadedBy: actor,
        modifiedAt,
        changeReason: "Nueva revisión en preparación",
        authorizedBy: undefined,
        authorizedAt: undefined,
        rejectionReason: undefined,
      },
      ...document.versions,
    ],
  };
}

export function submitDocumentVersion(
  document: ControlledDocument,
  modifiedAt: string,
): ControlledDocument {
  const working = getWorkingVersion(document);
  if (!working || !["draft", "rejected"].includes(working.status)) return document;
  return updateVersion(document, working.id, {
    status: "pending",
    modifiedAt,
    rejectionReason: undefined,
  });
}

export function approveDocumentVersion(
  document: ControlledDocument,
  actor: string,
  authorizedAt: string,
): ControlledDocument {
  const pending = document.versions.find((version) => version.status === "pending");
  if (!pending) return document;

  return {
    ...document,
    versions: document.versions.map((version) => {
      if (version.id === pending.id) {
        return {
          ...version,
          status: "current" as const,
          authorizedBy: actor,
          authorizedAt,
          modifiedAt: authorizedAt,
          rejectionReason: undefined,
        };
      }
      return version.status === "current"
        ? { ...version, status: "obsolete" as const }
        : version;
    }),
  };
}

export function rejectDocumentVersion(
  document: ControlledDocument,
  reason: string,
  modifiedAt: string,
): ControlledDocument {
  const pending = document.versions.find((version) => version.status === "pending");
  if (!pending || !reason.trim()) return document;
  return updateVersion(document, pending.id, {
    status: "rejected",
    rejectionReason: reason.trim(),
    modifiedAt,
  });
}

function updateVersion(
  document: ControlledDocument,
  versionId: string,
  changes: Partial<ControlledDocumentVersion>,
) {
  return {
    ...document,
    versions: document.versions.map((version) =>
      version.id === versionId ? { ...version, ...changes } : version,
    ),
  };
}

const seedDocuments: ControlledDocument[] = [
  makeDocument("DOC-P01-PRO-01", "P-01", "processes", "P-01", "Caracterización del proceso de Ventas", "Gerencia de Ventas", "Francisco Javier Hernández Retana", "Dirección General", "2026-07-18T16:20:00.000Z", 2, "current", true),
  makeDocument("DOC-P01-MAN-01", "P-01", "manuals", "M-VE-01", "Manual comercial", "Gerencia de Ventas", "Ana Sofía Morales", "Dirección de Ventas", "2026-08-06T15:10:00.000Z", 1, "draft"),
  makeDocument("DOC-P01-PRC-01", "P-01", "procedures", "PR-VE-02", "Gestión y seguimiento de pedidos", "Gerencia de Ventas", "Laura Méndez", "Gerencia de Calidad", "2026-08-12T17:35:00.000Z", 3, "pending", true),
  makeDocument("DOC-P01-INS-01", "P-01", "instructions", "I-VE-03", "Alta y actualización de clientes", "Ejecutivos de Ventas", "Carlos Romero", "Gerencia de Ventas", "2026-06-28T14:05:00.000Z", 1, "current"),
  makeDocument("DOC-P01-FOR-01", "P-01", "forms", "F-VE-05", "Solicitud de alta de cliente", "Ejecutivos de Ventas", "Mariana Torres", "Gerencia de Ventas", "2026-05-20T18:40:00.000Z", 2, "current", true),
  makeDocument("DOC-P01-AV-01", "P-01", "visual-aids", "AV-VE-01", "Flujo de atención de pedidos", "Ejecutivos de Ventas", "Carlos Romero", "Gerencia de Ventas", "2026-04-16T13:25:00.000Z", 1, "rejected"),
  makeDocument("DOC-P08-PRO-01", "P-08", "processes", "P-08", "Caracterización del proceso de Calidad", "Gerencia de Calidad", "Francisco Javier Hernández Retana", "Dirección General", "2026-07-30T16:00:00.000Z", 3, "current", true),
  makeDocument("DOC-P08-MAN-01", "P-08", "manuals", "M-SGC-01", "Manual del Sistema de Gestión de Calidad", "Gerencia de Calidad", "Francisco Javier Hernández Retana", "Dirección General", "2026-08-09T16:45:00.000Z", 4, "pending", true),
  makeDocument("DOC-P16-HOE-01", "P-16", "standard-operation-sheets", "HOE-TE-14", "Arranque de telar", "Jefatura de Tejido", "Jorge Ramírez", "Gerencia de Producción", "2026-06-11T12:15:00.000Z", 2, "current", true),
];

export function buildInitialControlledDocuments(): ControlledDocument[] {
  const applicationForms = appFormCatalog.map((form) =>
    makeDocument(
      `DOC-${form.id}`,
      form.processId,
      "application-forms",
      form.registrationNumber,
      form.name,
      "Responsable del proceso",
      "Francisco Javier Hernández Retana",
      "Gerencia de Calidad",
      form.dashboard.generatedAt,
      form.version,
      form.status === "Activo" ? "current" : "draft",
      false,
      form.id,
    ),
  );
  return [...seedDocuments, ...applicationForms].map((document) => ({
    ...document,
    versions: document.versions.map((version) => ({ ...version })),
  }));
}

function makeDocument(
  id: string,
  processId: string,
  documentTypeId: string,
  code: string,
  name: string,
  owner: string,
  uploadedBy: string,
  validator: string,
  modifiedAt: string,
  revision: number,
  status: ControlledDocumentStatus,
  includePrevious = false,
  appFormId?: string,
): ControlledDocument {
  const activeVersion: ControlledDocumentVersion = {
    id: `${id}-R${revision}`,
    revision,
    status,
    fileName: `${code.replaceAll("/", "-")}_Rev${revision}.pdf`,
    uploadedBy,
    validator,
    modifiedAt,
    changeReason: revision === 0 ? "Emisión inicial" : "Actualización del documento",
    ...(status === "current"
      ? { authorizedBy: validator, authorizedAt: modifiedAt }
      : {}),
    ...(status === "rejected"
      ? { rejectionReason: "Se requiere precisar responsables y registros relacionados." }
      : {}),
  };
  const previous: ControlledDocumentVersion[] = includePrevious && revision > 0
    ? [{
        ...activeVersion,
        id: `${id}-R${revision - 1}`,
        revision: revision - 1,
        status: status === "current" ? "obsolete" : "current",
        fileName: `${code.replaceAll("/", "-")}_Rev${revision - 1}.pdf`,
        modifiedAt: "2026-02-14T16:00:00.000Z",
        changeReason: "Versión anterior controlada",
        authorizedBy: validator,
        authorizedAt: "2026-02-15T16:00:00.000Z",
        rejectionReason: undefined,
      }]
    : [];
  return { id, processId, documentTypeId, code, name, owner, appFormId, versions: [activeVersion, ...previous] };
}
