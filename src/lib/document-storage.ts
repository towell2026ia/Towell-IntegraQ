"use client";

import type { ControlledDocument, ControlledDocumentVersion } from "@/lib/document-control-data";
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
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
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

export async function getControlledDocumentDownloadUrl(
  version: ControlledDocumentVersion,
) {
  if (!version.storageObjectPath) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(version.storageBucket || privateBucket)
    .createSignedUrl(version.storageObjectPath, 60);
  if (error) throw new Error(errorMessage(error));
  return data.signedUrl;
}

export async function reviewStoredDocumentVersion(
  versionId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId)) {
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

type RelatedProfile = { full_name: string } | Array<{ full_name: string }> | null;
type RelatedFile = {
  id: string;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
} | Array<{
  id: string;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
}> | null;

type StoredDocumentRow = {
  id: string;
  process_id: string;
  document_type_id: string;
  code: string;
  title: string;
  owner: RelatedProfile;
  versions: Array<{
    id: string;
    revision: number;
    status: ControlledDocumentVersion["status"];
    file_name: string;
    change_reason: string;
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
      owner:profiles!controlled_documents_owner_id_fkey(full_name),
      versions:controlled_document_versions(
        id,
        revision,
        status,
        file_name,
        change_reason,
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
          sha256
        )
      )
    `);
  if (error) throw new Error(errorMessage(error));

  return ((data ?? []) as unknown as StoredDocumentRow[]).flatMap((row) => {
    const documentTypeId = clientDocumentTypeIds[row.document_type_id];
    if (!documentTypeId) return [];
    const defaultValidator = documentValidatorByProcess[row.process_id]?.name ?? "Jefatura del área";
    return [{
      id: row.id,
      processId: row.process_id,
      documentTypeId,
      code: row.code,
      name: row.title,
      owner: firstRelation(row.owner)?.full_name ?? defaultValidator,
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
