"use client";

import type { WorkspaceModuleId } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

const privateBucket = "integraq-private";
const maximumSize = 50 * 1024 * 1024;

export type PreviewStatus = "pending" | "processing" | "ready" | "error" | "not_required";

export interface AttachmentRecord {
  id: string;
  bucketId: string;
  objectPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  moduleId: WorkspaceModuleId | null;
  processId: string | null;
  resourceType: string;
  resourceKey: string | null;
  category: string | null;
  version: number;
  isCurrent: boolean;
  replacesFileId: string | null;
  previewPath: string | null;
  previewStatus: PreviewStatus;
  previewGeneratedAt: string | null;
  previewError: string | null;
  uploadedBy: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

interface AttachmentScope {
  moduleId: WorkspaceModuleId;
  resourceType: string;
  resourceKey: string;
  processId?: string;
}

export async function listAttachments(scope: AttachmentScope, includeHistory = false) {
  let query = createClient()
    .from("file_objects")
    .select("id,bucket_id,object_path,original_name,mime_type,size_bytes,module_id,process_id,resource_type,resource_key,category,version,is_current,replaces_file_id,preview_path,preview_status,preview_generated_at,preview_error,uploaded_by,created_at,deleted_at,deleted_by")
    .eq("resource_type", scope.resourceType)
    .eq("resource_key", scope.resourceKey)
    .order("created_at", { ascending: false });
  if (!includeHistory) query = query.eq("is_current", true).is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAttachment);
}

export async function uploadAttachment(
  scope: AttachmentScope,
  file: File,
  replace?: AttachmentRecord,
) {
  if (!file.size || file.size > maximumSize) {
    throw new Error("El archivo debe pesar entre 1 byte y 50 MB.");
  }
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  await assertAdministrator(supabase, userData.user.id);

  const attachmentId = crypto.randomUUID();
  const objectPath = [
    userData.user.id,
    "attachments",
    scope.moduleId,
    safeName(scope.resourceType),
    safeName(scope.resourceKey),
    attachmentId,
    safeName(file.name),
  ].join("/");
  const sha256 = await fileSha256(file);
  const uploaded = await supabase.storage.from(privateBucket).upload(objectPath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);

  if (replace) {
    const previous = await supabase.from("file_objects")
      .update({ is_current: false })
      .eq("id", replace.id)
      .eq("is_current", true);
    if (previous.error) {
      await supabase.storage.from(privateBucket).remove([objectPath]);
      throw new Error(previous.error.message);
    }
  }

  const mimeType = file.type || "application/octet-stream";
  const previewStatus: PreviewStatus = mimeType === "application/pdf" || mimeType.startsWith("image/")
    ? "not_required"
    : "pending";
  const result = await supabase.from("file_objects").insert({
    id: attachmentId,
    bucket_id: privateBucket,
    object_path: objectPath,
    original_name: file.name,
    mime_type: mimeType,
    size_bytes: file.size,
    sha256,
    process_id: scope.processId ?? null,
    module_id: scope.moduleId,
    audience: "internal",
    resource_type: scope.resourceType,
    resource_key: scope.resourceKey,
    category: replace?.category ?? `evidence:${crypto.randomUUID()}`,
    version: replace ? replace.version + 1 : 1,
    is_current: true,
    replaces_file_id: replace?.id ?? null,
    preview_status: previewStatus,
    uploaded_by: userData.user.id,
  }).select("id").single();

  if (result.error) {
    if (replace) await supabase.from("file_objects").update({ is_current: true }).eq("id", replace.id);
    await supabase.storage.from(privateBucket).remove([objectPath]);
    throw new Error(result.error.message);
  }
  return result.data.id;
}

export async function softDeleteAttachment(attachment: AttachmentRecord) {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  await assertAdministrator(supabase, userData.user.id);
  const { error } = await supabase.from("file_objects").update({
    deleted_at: new Date().toISOString(),
    deleted_by: userData.user.id,
    is_current: false,
  }).eq("id", attachment.id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function getAttachmentSignedUrl(
  attachment: AttachmentRecord,
  target: "original" | "preview" = "original",
) {
  const path = target === "preview" ? attachment.previewPath : attachment.objectPath;
  if (!path) return null;
  const { data, error } = await createClient().storage
    .from(attachment.bucketId || privateBucket)
    .createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

function mapAttachment(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: String(row.id),
    bucketId: String(row.bucket_id),
    objectPath: String(row.object_path),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type || "application/octet-stream"),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    moduleId: (row.module_id || null) as WorkspaceModuleId | null,
    processId: row.process_id == null ? null : String(row.process_id),
    resourceType: String(row.resource_type),
    resourceKey: row.resource_key == null ? null : String(row.resource_key),
    category: row.category == null ? null : String(row.category),
    version: Number(row.version || 1),
    isCurrent: Boolean(row.is_current),
    replacesFileId: row.replaces_file_id == null ? null : String(row.replaces_file_id),
    previewPath: row.preview_path == null ? null : String(row.preview_path),
    previewStatus: String(row.preview_status || "pending") as PreviewStatus,
    previewGeneratedAt: row.preview_generated_at == null ? null : String(row.preview_generated_at),
    previewError: row.preview_error == null ? null : String(row.preview_error),
    uploadedBy: String(row.uploaded_by),
    createdAt: String(row.created_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    deletedBy: row.deleted_by == null ? null : String(row.deleted_by),
  };
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140);
}

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function assertAdministrator(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_type,status")
    .eq("id", userId)
    .maybeSingle();
  if (error || data?.status !== "active" || data.user_type !== "administrator") {
    throw new Error("Solo el administrador puede cargar, editar o eliminar documentos.");
  }
}
