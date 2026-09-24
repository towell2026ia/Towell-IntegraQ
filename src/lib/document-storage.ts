"use client";

import type {
  ControlledDocument,
  ControlledDocumentVersion,
  DocumentAuditEvent,
  DocumentLifecycle,
} from "@/lib/document-control-data";
import {
  clientDocumentTypeIds,
  databaseDocumentTypeIds,
  documentValidatorByProcess,
} from "@/lib/document-data";
import type { ActiveSession } from "@/lib/session-data";
import { createClient } from "@/lib/supabase/client";

const privateBucket = "integraq-private";
const maximumDocumentSizeBytes = 50 * 1024 * 1024;

export interface ManualDocumentUploadInput {
  processId: string;
  documentTypeId: string;
  code: string;
  name: string;
  revision: number;
  file: File;
  session: ActiveSession;
}

export interface NewDocumentVersionInput {
  document: ControlledDocument;
  revision: number;
  file: File;
  changeReason: string;
  changeSummary: string;
  comments?: string;
  session: ActiveSession;
}

export interface EditDocumentMetadataInput {
  documentId: string;
  name: string;
  description?: string;
  processId: string;
  documentTypeId: string;
  ownerId?: string;
  code: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeObjectName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-140);
}

async function sha256For(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function errorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  if (message.includes("FORBIDDEN") || message.includes("permission")) {
    return "No cuentas con permisos para realizar esta acción.";
  }
  if (message.includes("VERSION_ALREADY_EXISTS") || message.includes("duplicate key")) {
    return "Esta versión ya existe. Ingresa una versión diferente.";
  }
  if (message.includes("REASON_REQUIRED")) return "El motivo es obligatorio.";
  if (message.includes("SUMMARY_REQUIRED")) return "El resumen de cambios es obligatorio.";
  if (message) return message;
  return "No fue posible almacenar el documento.";
}

export async function uploadPendingControlledDocument(
  input: ManualDocumentUploadInput,
): Promise<ControlledDocument> {
  if (input.file.size > maximumDocumentSizeBytes) {
    throw new Error("El archivo supera el límite de 50 MB.");
  }

  const databaseDocumentTypeId = databaseDocumentTypeIds[input.documentTypeId];
  if (!databaseDocumentTypeId) {
    throw new Error("El tipo documental no tiene configuración de almacenamiento.");
  }

  const validator = documentValidatorByProcess[input.processId] ?? {
    name: "Jefatura del área",
    positionId: "PU-01",
  };
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("La sesión expiró. Inicia sesión nuevamente para cargar el archivo.");
  }
  await assertDocumentAdministrator(supabase, userData.user.id);
  const normalizedCode = input.code.trim().toLocaleUpperCase("es-MX");
  const { data: existingDocument, error: existingDocumentError } = await supabase
    .from("controlled_documents")
    .select("id")
    .eq("code", normalizedCode)
    .maybeSingle();
  if (existingDocumentError) throw new Error(errorMessage(existingDocumentError));
  if (existingDocument) {
    throw new Error(`Ya existe un documento con el código ${normalizedCode}.`);
  }

  const uploadedAt = new Date().toISOString();
  const sha256 = await sha256For(input.file);
  const storageObjectPath = [
    userData.user.id,
    "documents",
    input.processId,
    databaseDocumentTypeId,
    `${Date.now()}-${crypto.randomUUID()}-${safeObjectName(input.file.name)}`,
  ].join("/");

  const { error: storageError } = await supabase.storage
    .from(privateBucket)
    .upload(storageObjectPath, input.file, {
      cacheControl: "3600",
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (storageError) throw new Error(errorMessage(storageError));

  const { data: validatorProfile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("position_id", validator.positionId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const { data: fileObject, error: fileObjectError } = await supabase
    .from("file_objects")
    .insert({
      bucket_id: privateBucket,
      object_path: storageObjectPath,
      original_name: input.file.name,
      mime_type: input.file.type || "application/octet-stream",
      size_bytes: input.file.size,
      sha256,
      process_id: input.processId,
      module_id: "documents",
      audience: "internal",
      resource_type: "controlled_document",
      category: databaseDocumentTypeId,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();
  if (fileObjectError || !fileObject) {
    await supabase.storage.from(privateBucket).remove([storageObjectPath]);
    throw new Error(errorMessage(fileObjectError));
  }

  const { data: storedDocument, error: documentError } = await supabase
    .from("controlled_documents")
    .insert({
      process_id: input.processId,
      document_type_id: databaseDocumentTypeId,
      code: normalizedCode,
      title: input.name.trim(),
      owner_id: validatorProfile?.id ?? userData.user.id,
      created_by: userData.user.id,
    })
    .select("id")
    .single();
  if (documentError || !storedDocument) {
    await supabase.storage.from(privateBucket).remove([storageObjectPath]);
    throw new Error(errorMessage(documentError));
  }

  await supabase
    .from("file_objects")
    .update({ resource_id: storedDocument.id })
    .eq("id", fileObject.id);
  const { data: storedVersion, error: versionError } = await supabase
    .from("controlled_document_versions")
    .insert({
      document_id: storedDocument.id,
      revision: input.revision,
      status: "draft",
      file_id: fileObject.id,
      file_name: input.file.name,
      change_reason: "Carga manual pendiente de autorización por la jefatura del área",
      uploaded_by: userData.user.id,
      validator_id: validatorProfile?.id ?? null,
    })
    .select("id")
    .single();
  if (versionError || !storedVersion) {
    await supabase.storage.from(privateBucket).remove([storageObjectPath]);
    throw new Error(errorMessage(versionError));
  }

  const { error: submitError } = await supabase.rpc("submit_document_version", {
    requested_version_id: storedVersion.id,
  });
  if (submitError) throw new Error(errorMessage(submitError));

  return {
    id: storedDocument.id,
    processId: input.processId,
    documentTypeId: input.documentTypeId,
    code: normalizedCode,
    name: input.name.trim(),
    owner: input.session.department,
    versions: [{
      id: storedVersion.id,
      revision: input.revision,
      status: "pending",
      fileName: input.file.name,
      uploadedBy: input.session.name,
      validator: validatorProfile?.full_name || validator.name,
      modifiedAt: uploadedAt,
      changeReason: "Carga manual pendiente de autorización por la jefatura del área",
      fileObjectId: fileObject.id,
      storageBucket: privateBucket,
      storageObjectPath,
      mimeType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      sha256,
    }],
  };
}

export async function uploadNewControlledDocumentVersion(
  input: NewDocumentVersionInput,
): Promise<ControlledDocumentVersion> {
  if (input.file.size > maximumDocumentSizeBytes) {
    throw new Error("El archivo supera el límite de 50 MB.");
  }
  if (!input.changeReason.trim() || !input.changeSummary.trim()) {
    throw new Error("El motivo y el resumen de cambios son obligatorios.");
  }
  if (!uuidPattern.test(input.document.id)) {
    return buildLocalVersion(input);
  }

  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  }
  await assertDocumentAdministrator(supabase, userData.user.id);
  const versionId = crypto.randomUUID();
  const sha256 = await sha256For(input.file);
  const storageObjectPath = [
    userData.user.id,
    "documents",
    input.document.id,
    versionId,
    safeObjectName(input.file.name),
  ].join("/");
  const { error: storageError } = await supabase.storage
    .from(privateBucket)
    .upload(storageObjectPath, input.file, {
      cacheControl: "3600",
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (storageError) throw new Error(errorMessage(storageError));

  const { data: fileObject, error: fileObjectError } = await supabase
    .from("file_objects")
    .insert({
      bucket_id: privateBucket,
      object_path: storageObjectPath,
      original_name: input.file.name,
      mime_type: input.file.type || "application/octet-stream",
      size_bytes: input.file.size,
      sha256,
      process_id: input.document.processId,
      module_id: "documents",
      audience: "internal",
      resource_type: "controlled_document",
      resource_id: input.document.id,
      category: databaseDocumentTypeIds[input.document.documentTypeId] ?? input.document.documentTypeId,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();
  if (fileObjectError || !fileObject) {
    await supabase.storage.from(privateBucket).remove([storageObjectPath]);
    throw new Error(errorMessage(fileObjectError));
  }

  const { error: versionError } = await supabase.rpc("create_document_version", {
    p_document_id: input.document.id,
    p_revision: input.revision,
    p_file_id: fileObject.id,
    p_file_name: input.file.name,
    p_change_reason: input.changeReason.trim(),
    p_change_summary: input.changeSummary.trim(),
    p_comments: input.comments?.trim() || null,
    p_version_id: versionId,
  });
  if (versionError) {
    await supabase.storage.from(privateBucket).remove([storageObjectPath]);
    if (String(versionError.message).includes("VERSION_ALREADY_EXISTS")) {
      throw new Error("Esta versión ya existe. Ingresa una versión diferente.");
    }
    throw new Error(errorMessage(versionError));
  }
  return {
    id: versionId,
    revision: input.revision,
    status: "draft",
    fileName: input.file.name,
    uploadedBy: input.session.name,
    validator: documentValidatorByProcess[input.document.processId]?.name ?? "Jefatura del área",
    modifiedAt: new Date().toISOString(),
    changeReason: input.changeReason.trim(),
    changeSummary: input.changeSummary.trim(),
    comments: input.comments?.trim() || undefined,
    fileObjectId: fileObject.id,
    storageBucket: privateBucket,
    storageObjectPath,
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size,
    sha256,
  };
}

function buildLocalVersion(input: NewDocumentVersionInput): ControlledDocumentVersion {
  if (input.session.userType !== "Administrador") {
    throw new Error("Solo el administrador puede crear nuevas versiones documentales.");
  }
  if (input.document.versions.some((version) => version.revision === input.revision)) {
    throw new Error("Esta versión ya existe. Ingresa una versión diferente.");
  }
  return {
    id: `${input.document.id}-R${input.revision}-${Date.now()}`,
    revision: input.revision,
    status: "draft",
    fileName: input.file.name,
    uploadedBy: input.session.name,
    validator: documentValidatorByProcess[input.document.processId]?.name ?? "Jefatura del área",
    modifiedAt: new Date().toISOString(),
    changeReason: input.changeReason.trim(),
    changeSummary: input.changeSummary.trim(),
    comments: input.comments?.trim() || undefined,
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size,
  };
}

async function assertDocumentAdministrator(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_type,status")
    .eq("id", userId)
    .maybeSingle();
  if (error || data?.status !== "active" || data.user_type !== "administrator") {
    throw new Error("Solo el administrador puede cargar o editar documentos.");
  }
}

export async function editStoredDocumentMetadata(input: EditDocumentMetadataInput) {
  if (!uuidPattern.test(input.documentId)) return false;
  const supabase = createClient();
  const { error } = await supabase.rpc("edit_document_metadata", {
    p_document_id: input.documentId,
    p_title: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_process_id: input.processId,
    p_document_type_id: databaseDocumentTypeIds[input.documentTypeId] ?? input.documentTypeId,
    p_owner_id: input.ownerId || null,
    p_code: input.code.trim(),
  });
  if (error) throw new Error(errorMessage(error));
  return true;
}

export async function obsoleteStoredDocument(documentId: string, reason: string, replacementDocumentId?: string) {
  return callLifecycleRpc(documentId, "obsolete_document", {
    p_document_id: documentId,
    p_reason: reason.trim(),
    p_replacement_document_id: replacementDocumentId && uuidPattern.test(replacementDocumentId) ? replacementDocumentId : null,
  });
}

export async function softDeleteStoredDocument(documentId: string, reason: string) {
  return callLifecycleRpc(documentId, "soft_delete_document", { p_document_id: documentId, p_reason: reason.trim() });
}

export async function restoreStoredDocument(documentId: string) {
  return callLifecycleRpc(documentId, "restore_document", { p_document_id: documentId });
}

async function callLifecycleRpc(documentId: string, name: string, parameters: Record<string, unknown>) {
  if (!uuidPattern.test(documentId)) return false;
  const supabase = createClient();
  const { error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(errorMessage(error));
  return true;
}

export async function getControlledDocumentDownloadUrl(
  version: ControlledDocumentVersion,
  target: "original" | "preview" = "original",
) {
  const path = target === "preview" ? version.previewPath : version.storageObjectPath;
  if (!path) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(version.storageBucket || privateBucket)
    .createSignedUrl(path, 60);
  if (error) throw new Error(errorMessage(error));
  return data.signedUrl;
}

export async function reviewStoredDocumentVersion(
  versionId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  if (!uuidPattern.test(versionId)) {
    return false;
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("review_document_version", {
    requested_version_id: versionId,
    decision,
    review_comment: comment?.trim() || null,
  });
  if (error) throw new Error(errorMessage(error));
  return true;
}

export async function submitStoredDocumentVersion(versionId: string) {
  if (!uuidPattern.test(versionId)) return false;
  const supabase = createClient();
  const { error } = await supabase.rpc("submit_document_version", {
    requested_version_id: versionId,
  });
  if (error) throw new Error(errorMessage(error));
  return true;
}

type RelatedProfile = { full_name: string } | Array<{ full_name: string }> | null;
type RelatedFile = {
  id: string;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  preview_path: string | null;
  preview_status: ControlledDocumentVersion["previewStatus"];
  preview_generated_at: string | null;
  preview_error: string | null;
} | Array<{
  id: string;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  preview_path: string | null;
  preview_status: ControlledDocumentVersion["previewStatus"];
  preview_generated_at: string | null;
  preview_error: string | null;
}> | null;

type StoredDocumentRow = {
  id: string;
  process_id: string;
  document_type_id: string;
  code: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  owner: RelatedProfile;
  lifecycle: Array<{
    lifecycle_status: DocumentLifecycle["status"];
    is_deleted: boolean;
    deleted_at: string | null;
    delete_reason: string | null;
    obsoleted_at: string | null;
    obsolete_reason: string | null;
    replacement_document_id: string | null;
    restored_at: string | null;
    deleter: RelatedProfile;
    obsoleter: RelatedProfile;
    restorer: RelatedProfile;
  }>;
  activity: Array<{
    id: string;
    event_type: DocumentAuditEvent["eventType"];
    performed_at: string;
    reason: string | null;
    document_version_id: string | null;
    metadata: Record<string, unknown>;
    performer: RelatedProfile;
  }>;
  versions: Array<{
    id: string;
    revision: number;
    status: ControlledDocumentVersion["status"];
    file_name: string;
    change_reason: string;
    change_summary: string | null;
    comments: string | null;
    updated_at: string;
    authorized_at: string | null;
    rejection_reason: string | null;
    uploader: RelatedProfile;
    validator: RelatedProfile;
    file: RelatedFile;
  }>;
};

function firstRelation<T>(relation: T | T[] | null) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

export async function loadStoredControlledDocuments(): Promise<ControlledDocument[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("controlled_documents")
    .select(`
      id,
      process_id,
      document_type_id,
      code,
      title,
      description,
      owner_id,
      owner:profiles!controlled_documents_owner_id_fkey(full_name),
      lifecycle:document_lifecycle(
        lifecycle_status,
        is_deleted,
        deleted_at,
        delete_reason,
        obsoleted_at,
        obsolete_reason,
        replacement_document_id,
        restored_at,
        deleter:profiles!document_lifecycle_deleted_by_fkey(full_name),
        obsoleter:profiles!document_lifecycle_obsoleted_by_fkey(full_name),
        restorer:profiles!document_lifecycle_restored_by_fkey(full_name)
      ),
      activity:document_audit_log(
        id,
        event_type,
        performed_at,
        reason,
        document_version_id,
        metadata,
        performer:profiles!document_audit_log_performed_by_fkey(full_name)
      ),
      versions:controlled_document_versions(
        id,
        revision,
        status,
        file_name,
        change_reason,
        change_summary,
        comments,
        updated_at,
        authorized_at,
        rejection_reason,
        uploader:profiles!controlled_document_versions_uploaded_by_fkey(full_name),
        validator:profiles!controlled_document_versions_validator_id_fkey(full_name),
        file:file_objects!controlled_document_versions_file_id_fkey(
          id,
          bucket_id,
          object_path,
          mime_type,
          size_bytes,
          sha256,
          preview_path,
          preview_status,
          preview_generated_at,
          preview_error
        )
      )
    `);
  if (error) throw new Error(errorMessage(error));

  return ((data ?? []) as unknown as StoredDocumentRow[]).flatMap((row) => {
    const documentTypeId = clientDocumentTypeIds[row.document_type_id];
    if (!documentTypeId) return [];
    const defaultValidator = documentValidatorByProcess[row.process_id]?.name ?? "Jefatura del área";
    const lifecycle = row.lifecycle[0];
    return [{
      id: row.id,
      processId: row.process_id,
      documentTypeId,
      code: row.code,
      name: row.title,
      description: row.description ?? undefined,
      owner: firstRelation(row.owner)?.full_name ?? defaultValidator,
      ownerId: row.owner_id ?? undefined,
      lifecycle: lifecycle ? {
        status: lifecycle.lifecycle_status,
        isDeleted: lifecycle.is_deleted,
        deletedAt: lifecycle.deleted_at ?? undefined,
        deletedBy: firstRelation(lifecycle.deleter)?.full_name,
        deleteReason: lifecycle.delete_reason ?? undefined,
        obsoletedAt: lifecycle.obsoleted_at ?? undefined,
        obsoletedBy: firstRelation(lifecycle.obsoleter)?.full_name,
        obsoleteReason: lifecycle.obsolete_reason ?? undefined,
        replacementDocumentId: lifecycle.replacement_document_id ?? undefined,
        restoredAt: lifecycle.restored_at ?? undefined,
        restoredBy: firstRelation(lifecycle.restorer)?.full_name,
      } : { status: "active", isDeleted: false },
      activity: row.activity.map((event) => ({
        id: event.id,
        eventType: event.event_type,
        performedBy: firstRelation(event.performer)?.full_name ?? "Sistema",
        performedAt: event.performed_at,
        reason: event.reason ?? undefined,
        versionId: event.document_version_id ?? undefined,
        metadata: event.metadata,
      })).sort((left, right) => right.performedAt.localeCompare(left.performedAt)),
      versions: row.versions
        .map((version) => {
          const file = firstRelation(version.file);
          const validatorName = firstRelation(version.validator)?.full_name ?? defaultValidator;
          return {
            id: version.id,
            revision: version.revision,
            status: version.status,
            fileName: version.file_name,
            uploadedBy: firstRelation(version.uploader)?.full_name ?? "Carga documental masiva",
            validator: validatorName,
            modifiedAt: version.updated_at,
            changeReason: version.change_reason,
            changeSummary: version.change_summary ?? undefined,
            comments: version.comments ?? undefined,
            ...(version.authorized_at
              ? { authorizedBy: validatorName, authorizedAt: version.authorized_at }
              : {}),
            ...(version.rejection_reason
              ? { rejectionReason: version.rejection_reason }
              : {}),
            ...(file
              ? {
                  fileObjectId: file.id,
                  storageBucket: file.bucket_id,
                  storageObjectPath: file.object_path,
                  mimeType: file.mime_type ?? undefined,
                  sizeBytes: file.size_bytes ?? undefined,
                  sha256: file.sha256 ?? undefined,
                  previewPath: file.preview_path ?? undefined,
                  previewStatus: file.preview_status ?? undefined,
                  previewGeneratedAt: file.preview_generated_at ?? undefined,
                  previewError: file.preview_error ?? undefined,
                }
              : {}),
          } satisfies ControlledDocumentVersion;
        })
        .sort((left, right) => right.revision - left.revision),
    } satisfies ControlledDocument];
  });
}

export function mergeStoredControlledDocuments(
  localDocuments: ControlledDocument[],
  storedDocuments: ControlledDocument[],
) {
  const localById = new Map(localDocuments.map((document) => [document.id, document]));
  const mergedStored = storedDocuments.map((storedDocument) => {
    const localDocument = localById.get(storedDocument.id);
    if (!localDocument) return storedDocument;
    const localVersionById = new Map(
      localDocument.versions.map((version) => [version.id, version]),
    );
    return {
      ...localDocument,
      ...storedDocument,
      versions: storedDocument.versions.map((storedVersion) => ({
        ...localVersionById.get(storedVersion.id),
        ...storedVersion,
      })),
    };
  });
  const storedIds = new Set(storedDocuments.map((document) => document.id));
  return [
    ...mergedStored,
    ...localDocuments.filter((document) => !storedIds.has(document.id)),
  ];
}
