import { isAdministrator, type ActiveSession } from "@/lib/session-data";

export type GeneralInformationReference = "internal" | "external";
export type GeneralInformationValidity = "current" | "not_current";

export interface GeneralInformationFolder {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  parentFolderId?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletionReason?: string;
}

export interface GeneralInformationDocument {
  id: string;
  folderId: string;
  name: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  referenceType: GeneralInformationReference;
  externalOrigin?: string;
  validityStatus: GeneralInformationValidity;
  validFrom?: string;
  validUntil?: string;
  description?: string;
  observations?: string;
  version: number;
  isCurrent: boolean;
  replacesFileId?: string;
  previewStatus: "pending" | "processing" | "ready" | "error" | "not_required";
  uploadedBy: string;
  uploadedByName?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletionReason?: string;
  batchId?: string;
  batchCode?: string;
}

export interface GeneralInformationAuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  createdAt: string;
  actorName?: string;
  metadata: Record<string, unknown>;
}

export interface GeneralInformationSnapshot {
  folders: GeneralInformationFolder[];
  documents: GeneralInformationDocument[];
  audit: GeneralInformationAuditEvent[];
}

export interface GeneralInformationDocumentInput {
  folderId: string;
  name: string;
  referenceType: GeneralInformationReference;
  externalOrigin?: string;
  validityStatus: GeneralInformationValidity;
  validFrom?: string;
  validUntil?: string;
  description?: string;
  observations?: string;
  allowDuplicate?: boolean;
}

export interface GeneralInformationUploadResult {
  batchId: string;
  batchCode: string;
  successCount: number;
  failureCount: number;
  results: Array<{
    index: number;
    ok: boolean;
    document?: GeneralInformationDocument;
    error?: string;
    existingDocumentId?: string;
  }>;
}

const allowedExtensions = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx",
  "png", "jpg", "jpeg", "webp", "gif", "txt",
]);

export const GENERAL_INFORMATION_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const GENERAL_INFORMATION_MAX_BATCH_FILES = 50;

export function canViewGeneralInformation(session: ActiveSession | null) {
  return Boolean(session);
}

export function canManageGeneralInformation(session: ActiveSession | null) {
  return Boolean(session && isAdministrator(session));
}

export function canDownloadGeneralInformation(session: ActiveSession | null) {
  return canManageGeneralInformation(session);
}

export function validateGeneralInformationFile(file: Pick<File, "name" | "size">) {
  const extension = file.name.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  if (!file.size || file.size > GENERAL_INFORMATION_MAX_FILE_SIZE) {
    return "El archivo debe pesar entre 1 byte y 50 MB.";
  }
  if (!allowedExtensions.has(extension)) {
    return "Formato no compatible. Usa PDF, Office, imagen o TXT.";
  }
  return null;
}

export function validateGeneralInformationMetadata(input: GeneralInformationDocumentInput) {
  if (!input.folderId || !input.name.trim()) return "Nombre y carpeta son obligatorios.";
  if (!(["internal", "external"] as string[]).includes(input.referenceType)) return "Referencia inválida.";
  if (!(["current", "not_current"] as string[]).includes(input.validityStatus)) return "Vigencia inválida.";
  if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
    return "La fecha final de vigencia no puede ser anterior a la inicial.";
  }
  return null;
}

export function buildFolderBreadcrumb(
  folders: GeneralInformationFolder[],
  folderId?: string,
) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: GeneralInformationFolder[] = [];
  const visited = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return result;
}

export function isDescendantFolder(
  folders: GeneralInformationFolder[],
  folderId: string,
  possibleAncestorId: string,
) {
  return buildFolderBreadcrumb(folders, folderId).some((folder) => folder.id === possibleAncestorId);
}
