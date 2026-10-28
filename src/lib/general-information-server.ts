import "server-only";
import { canAccessModule } from "@/lib/access-policy";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { isAdministrator } from "@/lib/session-data";

export class GeneralInformationApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface GeneralInformationActor {
  id: string;
  workspaceId: string;
  administrator: boolean;
}

export async function requireGeneralInformationActor(requireAdministrator = false) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new GeneralInformationApiError("Sesión requerida.", 401);
  if (!canAccessModule(session, "documents") || session.workspaceMode === "demo") throw new GeneralInformationApiError("Sin permiso para Información General.", 403);
  const admin = createAdminClient();
  const profile = await admin.from("profiles")
    .select("organization_id,user_type,status,workspace_mode")
    .eq("id", session.authUserId)
    .maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" || !["administrator", "internal"].includes(profile.data.user_type)) {
    throw new GeneralInformationApiError("La cuenta no está activa.", 403);
  }
  const administrator = isAdministrator(session) && profile.data.user_type === "administrator";
  if (requireAdministrator && !administrator) {
    throw new GeneralInformationApiError("Acción exclusiva para administrador.", 403);
  }
  const workspaceId = profile.data.organization_id as string | null;
  if (!workspaceId) throw new GeneralInformationApiError("La cuenta requiere una organización asignada.", 403);
  const workspaceMode = profile.data.workspace_mode === "demo" ? "demo" : "production";
  return { id: session.authUserId, workspaceId, administrator, workspaceMode };

}

export function generalInformationErrorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "23505") return { status: 409, message: "El código o identidad documental ya está ocupado por un documento activo. No se sobrescribió ningún archivo." };
  if (code === "42501") return { status: 403, message: "No tienes autorización para este documento o workspace." };
  if (code === "22023" || code === "23503") return { status: 409, message: "El documento cambió de estado o su carpeta no está disponible. Actualiza la vista antes de continuar." };
  const status = error instanceof GeneralInformationApiError ? error.status : 500;
  const message = error instanceof GeneralInformationApiError
    ? error.message
    : "No fue posible completar la operación de Información General.";
  return { status, message };
}

export function safeGeneralInformationObjectName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").slice(-140) || "documento";
}

export function mapGeneralInformationFolder(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    parentFolderId: row.parent_folder_id ? String(row.parent_folder_id) : undefined,
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    deletionReason: row.deletion_reason ? String(row.deletion_reason) : undefined,
  };
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === "object" && "full_name" in relation
    ? String(relation.full_name)
    : undefined;
}

function relationBatchCode(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === "object" && "batch_code" in relation
    ? String(relation.batch_code)
    : undefined;
}

export function mapGeneralInformationDocument(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    folderId: String(row.folder_id),
    name: String(row.display_name || row.original_name),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type || "application/octet-stream"),
    sizeBytes: Number(row.size_bytes || 0),
    referenceType: row.reference_type === "external" ? "external" as const : "internal" as const,
    externalOrigin: row.external_origin ? String(row.external_origin) : undefined,
    validityStatus: row.validity_status === "not_current" ? "not_current" as const : "current" as const,
    validFrom: row.valid_from ? String(row.valid_from) : undefined,
    validUntil: row.valid_until ? String(row.valid_until) : undefined,
    description: row.description ? String(row.description) : undefined,
    observations: row.observations ? String(row.observations) : undefined,
    version: Number(row.version || 1),
    isCurrent: Boolean(row.is_current),
    replacesFileId: row.replaces_file_id ? String(row.replaces_file_id) : undefined,
    previewStatus: String(row.preview_status || "pending") as "pending" | "processing" | "ready" | "error" | "not_required",
    uploadedBy: String(row.uploaded_by),
    uploadedByName: relationName(row.uploader),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    deletionReason: row.deletion_reason ? String(row.deletion_reason) : undefined,
    batchId: row.batch_id ? String(row.batch_id) : undefined,
    batchCode: relationBatchCode(row.batch),
  };
}
