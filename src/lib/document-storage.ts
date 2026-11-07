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
  revision?: number;
  replacementKind?: "version" | "revision";
  expectedDocumentId?: string;
  expectedBaseVersionId?: string | null;
  changeReason?: string;
  file: File;
  session: ActiveSession;
}

export interface NewDocumentVersionInput {
  document: ControlledDocument;
  revision?: number;
  replacementKind?: "version" | "revision";
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

async function sha256For(file: Blob) {
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
    return "El expediente cambió durante la carga. Consulta el código e intenta nuevamente.";
  }
  if (message.includes("DOCUMENT_CODE_EXISTS")) return "Ya existe un documento con ese código. Selecciona reemplazo.";
  if (message.includes("DOCUMENT_CHANGED")) return "El expediente cambió durante la carga. Consulta el código nuevamente.";
  if (message.includes("DOCUMENT_PENDING_REVIEW")) return "Ya existe una versión pendiente de autorización.";
  if (message.includes("DOCUMENT_SCOPE_MISMATCH")) return "El código pertenece a otro proceso o tipo documental.";
  if (message.includes("REPLACEMENT_REQUIRED")) return "Es necesario cargar un reemplazo para recuperar este documento.";
  if (message.includes("REASON_REQUIRED")) return "El motivo es obligatorio.";
  if (message.includes("INVALID_DOCUMENT_CODE")) return "Código debe contener sólo el identificador documental, por ejemplo AV-SGC-04. Escribe el nombre en Nombre oficial.";
  if (message.includes("INVALID_UPLOAD_FILE")) return "Comprueba el nombre, formato y tamaño del archivo documental (máximo 50 MB).";
  if (message.includes("INVALID_UPLOAD_REFERENCE")) return "No se pudo verificar la referencia privada de esta carga. No se modificó el expediente.";
  if (message.includes("PGRST202") || message.includes("reserve_controlled_document_upload")) return "La reparación documental está pendiente de activación. No se subió ningún archivo.";
  if (message.includes("SUMMARY_REQUIRED")) return "El resumen de cambios es obligatorio.";
  if (message) return message;
  return "No fue posible almacenar el documento.";
}

export interface DocumentCodeMatch {
  id: string; code: string; title: string; processId: string; documentTypeId: string;
  deleted: boolean; compatible: boolean; baseVersionId: string | null; pending: boolean;
}

export async function inspectControlledDocumentCode(code: string, processId: string, documentTypeId: string): Promise<DocumentCodeMatch | null> {
  const { data, error } = await createClient().rpc("inspect_controlled_document_code", {
    p_code: code.trim().toUpperCase(), p_process_id: processId,
    p_document_type_id: databaseDocumentTypeIds[documentTypeId] ?? documentTypeId,
  });
  if (error) throw new Error(errorMessage(error));
  return data as DocumentCodeMatch | null;
}

export async function loadStoredControlledDocument(documentId: string) {
  const document = (await loadStoredControlledDocuments()).find(item => item.id === documentId);
  if (!document) throw new Error("La operación se completó, pero no se pudo recargar el expediente. Reintenta la consulta antes de volver a cargar un archivo.");
  return document;
}

export async function uploadPendingControlledDocument(input: ManualDocumentUploadInput): Promise<ControlledDocument> {
  if (input.file.size < 1 || input.file.size > maximumDocumentSizeBytes) throw new Error("Selecciona un archivo de hasta 50 MB.");
  if (!input.replacementKind && !/^[A-Z0-9]+([-._/][A-Z0-9]+)*_?$/.test(input.code.trim().toUpperCase())) throw new Error("Código debe contener sólo el identificador documental. Captura el nombre por separado en Nombre oficial.");
  const databaseType = databaseDocumentTypeIds[input.documentTypeId];
  if (!databaseType) throw new Error("El tipo documental no tiene configuración de almacenamiento.");
  if (input.replacementKind && !input.changeReason?.trim()) throw new Error("El motivo es obligatorio.");
  const supabase = createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  const sha256 = await sha256For(input.file);
  const parameters = {
    p_code: input.code.trim().toUpperCase(), p_title: input.name.trim(),
    p_process_id: input.processId, p_document_type_id: databaseType,
    p_kind: input.replacementKind ?? "initial", p_reason: input.changeReason?.trim() || "Carga inicial",
    p_document_id: input.expectedDocumentId ?? null, p_base_version_id: input.expectedBaseVersionId ?? null,
  };
  // Reserve before uploading: every binary has a tracked, private reference, even
  // if the network fails. Repeating the same capture resumes the same reservation.
  const { data: reserved, error: reservationError } = await supabase.rpc("reserve_controlled_document_upload", {
    ...parameters, p_file: { name: input.file.name, mime: input.file.type || "application/octet-stream", size: input.file.size, sha256 },
  });
  if (reservationError) throw new Error(errorMessage(reservationError));
  const file = reserved as { fileId?: string; objectPath?: string; documentId?: string; state?: string } | null;
  if (!file?.fileId || !file.objectPath || !file.objectPath.startsWith(`${auth.user.id}/documents/${input.processId}/`)) throw new Error("No se pudo verificar la reserva de carga. No se subió ningún archivo.");
  if (file.state === "upload_registered" && file.documentId) return loadStoredControlledDocument(file.documentId);
  const { error: uploadError } = await supabase.storage.from(privateBucket).upload(file.objectPath, input.file, {
    contentType: input.file.type || "application/octet-stream", upsert: false,
  });
  if (uploadError) {
    // An interrupted response or a retry can find the original already present.
    // Verify its bytes, never overwrite or remove it to compensate an error.
    const { data: existing, error: readError } = await supabase.storage.from(privateBucket).download(file.objectPath);
    if (readError || !existing || existing.size !== input.file.size || await sha256For(existing) !== sha256) {
      throw new Error(`${errorMessage(uploadError)} La carga conserva su referencia pendiente; reintenta con el mismo archivo.`);
    }
  }
  const { data: documentId, error } = await supabase.rpc("register_controlled_document_upload", {
    ...parameters, p_file_id: file.fileId,
  });
  if (error) throw new Error(`${errorMessage(error)} La carga permanece identificada; reintenta con el mismo archivo sin crear otro expediente.`);
  return loadStoredControlledDocument(String(documentId));
}

export async function uploadNewControlledDocumentVersion(input: NewDocumentVersionInput): Promise<ControlledDocumentVersion> {
  const source = [...input.document.versions].sort((a,b) => b.revision-a.revision)[0];
  const updated = await uploadPendingControlledDocument({
    processId: input.document.processId, documentTypeId: input.document.documentTypeId,
    code: input.document.code, name: input.document.name, file: input.file, session: input.session,
    replacementKind: input.replacementKind ?? "version", changeReason: input.changeReason,
    expectedDocumentId: input.document.id, expectedBaseVersionId: source?.id ?? null,
  });
  const candidate = updated.versions.find(v => v.status === "pending");
  if (!candidate) throw new Error("No se pudo comprobar el envío a autorización. Recarga el expediente.");
  return candidate;
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
  deleted_at: string | null;
  deletion_reason: string | null;
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
    version_number: number | null;
    revision_sequence: number | null;
    legacy_revision: number | null;
    replacement_kind: ControlledDocumentVersion["replacementKind"] | null;
    replaces_version_id: string | null;
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
  const rows: StoredDocumentRow[] = [];
  let total: number | null = null;
  do {
    const { data, error, count } = await supabase
      .from("controlled_documents")
      .select(`
        id,
        process_id,
        document_type_id,
        code,
        title,
        description,
        owner_id,
        deleted_at,
        deletion_reason,
        owner:profiles!controlled_documents_owner_id_fkey(full_name),
        lifecycle:document_lifecycle!document_lifecycle_document_id_fkey(
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
        activity:document_audit_log!document_audit_log_document_id_fkey(
          id,
          event_type,
          performed_at,
          reason,
          document_version_id,
          metadata,
          performer:profiles!document_audit_log_performed_by_fkey(full_name)
        ),
        versions:controlled_document_versions!controlled_document_versions_document_id_fkey(
          id,
          revision,
          version_number,
          revision_sequence,
          legacy_revision,
          replacement_kind,
          replaces_version_id,
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
      `, { count: "exact" })
      .order("id", { ascending: true })
      .range(rows.length, rows.length + 499);
    if (error) throw new Error(`No se pudo cargar Información Documentada (${error.code ?? "consulta"}): ${errorMessage(error)}`);
    if (count === null || (total !== null && total !== count)) throw new Error("El catálogo cambió durante la carga o no se pudo verificar su total. Reintenta.");
    total = count;
    const page = (data ?? []) as unknown as StoredDocumentRow[];
    if (page.length === 0 && rows.length < total) throw new Error("La consulta devolvió un catálogo incompleto. Reintenta.");
    rows.push(...page);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("El catálogo cambió durante la paginación. Reintenta.");
  } while (rows.length < total);

  return rows.flatMap((row) => {
    const documentTypeId = clientDocumentTypeIds[row.document_type_id];
    if (!documentTypeId) throw new Error(`Tipo documental no reconocido: ${row.document_type_id}. No se mostrará un catálogo incompleto.`);
    const defaultValidator = documentValidatorByProcess[row.process_id]?.name ?? "Jefatura del área";
    const lifecycle = firstRelation(row.lifecycle);
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
        isDeleted: lifecycle.is_deleted || Boolean(row.deleted_at),
        deletedAt: lifecycle.deleted_at ?? undefined,
        deletedBy: firstRelation(lifecycle.deleter)?.full_name,
        deleteReason: lifecycle.delete_reason ?? undefined,
        obsoletedAt: lifecycle.obsoleted_at ?? undefined,
        obsoletedBy: firstRelation(lifecycle.obsoleter)?.full_name,
        obsoleteReason: lifecycle.obsolete_reason ?? undefined,
        replacementDocumentId: lifecycle.replacement_document_id ?? undefined,
        restoredAt: lifecycle.restored_at ?? undefined,
        restoredBy: firstRelation(lifecycle.restorer)?.full_name,
      } : { status: row.deleted_at ? "deleted" : "active", isDeleted: Boolean(row.deleted_at), deletedAt: row.deleted_at ?? undefined, deleteReason: row.deletion_reason ?? undefined },
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
            versionNumber: version.version_number ?? undefined,
            revisionSequence: version.revision_sequence ?? undefined,
            legacyRevision: version.legacy_revision ?? undefined,
            replacementKind: version.replacement_kind ?? undefined,
            replacesVersionId: version.replaces_version_id ?? undefined,
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
