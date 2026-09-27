import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  GENERAL_INFORMATION_MAX_BATCH_FILES,
  validateGeneralInformationFile,
  validateGeneralInformationMetadata,
  type GeneralInformationDocumentInput,
} from "@/lib/general-information";
import {
  GeneralInformationApiError,
  generalInformationErrorResponse,
  mapGeneralInformationDocument,
  mapGeneralInformationFolder,
  requireGeneralInformationActor,
  safeGeneralInformationObjectName,
} from "@/lib/general-information-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const documentSelect = "id,folder_id,display_name,original_name,mime_type,size_bytes,reference_type,external_origin,validity_status,valid_from,valid_until,description,observations,version,is_current,replaces_file_id,preview_status,uploaded_by,created_at,updated_at,deleted_at,deletion_reason,batch_id,uploader:profiles!file_objects_uploaded_by_fkey(full_name),batch:document_upload_batches(batch_code)";

export async function GET(request: Request) {
  try {
    const actor = await requireGeneralInformationActor();
    const parameters = new URL(request.url).searchParams;
    const view = parameters.get("view") || "active";
    if (["deleted", "history", "audit"].includes(view) && !actor.administrator) {
      throw new GeneralInformationApiError("La administración documental está reservada al administrador.", 403);
    }
    const admin = createAdminClient();
    let folderQuery = admin.from("document_folders")
      .select("id,workspace_id,name,description,parent_folder_id,archived_at,created_at,updated_at,deleted_at,deletion_reason")
      .eq("workspace_id", actor.workspaceId)
      .order("name");
    if (view === "deleted") folderQuery = folderQuery.not("deleted_at", "is", null);
    else if (view !== "history") folderQuery = folderQuery.is("deleted_at", null);

    let documentQuery = admin.from("file_objects")
      .select(documentSelect)
      .eq("workspace_id", actor.workspaceId)
      .eq("resource_type", "general_information_document");
    if (view === "deleted") documentQuery = documentQuery.not("deleted_at", "is", null);
    else if (view === "history") documentQuery = documentQuery.order("created_at", { ascending: false });
    else documentQuery = documentQuery.eq("is_current", true).is("deleted_at", null);
    const reference = parameters.get("reference");
    const validity = parameters.get("validity");
    if (reference === "internal" || reference === "external") documentQuery = documentQuery.eq("reference_type", reference);
    if (validity === "current" || validity === "not_current") documentQuery = documentQuery.eq("validity_status", validity);

    const [{ data: folderRows, error: folderError }, { data: documentRows, error: documentError }] = await Promise.all([
      folderQuery,
      documentQuery,
    ]);
    if (folderError) throw folderError;
    if (documentError) throw documentError;

    const query = (parameters.get("q") || "").trim().toLocaleLowerCase("es");
    const folderId = parameters.get("folderId");
    let documents = ((documentRows ?? []) as unknown as Record<string, unknown>[]).map(mapGeneralInformationDocument);
    if (query) {
      documents = documents.filter((document) => [document.name, document.description, document.externalOrigin]
        .some((value) => value?.toLocaleLowerCase("es").includes(query)));
    } else if (folderId && view === "active") {
      documents = documents.filter((document) => document.folderId === folderId);
    } else if (view === "active") {
      documents = [];
    }
    const sort = parameters.get("sort") || "name";
    documents.sort((left, right) => {
      if (sort === "date") return right.createdAt.localeCompare(left.createdAt);
      if (sort === "reference") return left.referenceType.localeCompare(right.referenceType);
      if (sort === "validity") return left.validityStatus.localeCompare(right.validityStatus);
      return left.name.localeCompare(right.name, "es");
    });

    let audit: Array<Record<string, unknown>> = [];
    if (view === "audit") {
      const result = await admin.from("audit_log")
        .select("id,action,resource_type,resource_id,created_at,metadata,actor:profiles!audit_log_actor_id_fkey(full_name)")
        .in("resource_type", ["document_folder", "general_information_document", "document_upload_batch"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (result.error) throw result.error;
      audit = (result.data ?? []).map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        createdAt: row.created_at,
        actorName: relationValue(row.actor, "full_name"),
        metadata: row.metadata ?? {},
      }));
    }

    return NextResponse.json({
      folders: ((folderRows ?? []) as unknown as Record<string, unknown>[]).map(mapGeneralInformationFolder),
      documents,
      audit,
    });
  } catch (error) {
    console.error("No fue posible consultar Información General.", error);
    const response = generalInformationErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireGeneralInformationActor(true);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadDocuments(request, actor);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || body.action !== "createFolder" || typeof body.name !== "string" || !body.name.trim()) {
      throw new GeneralInformationApiError("Datos de carpeta inválidos.", 400);
    }
    const admin = createAdminClient();
    const parentFolderId = typeof body.parentFolderId === "string" && body.parentFolderId ? body.parentFolderId : null;
    if (parentFolderId) await requireFolder(admin, parentFolderId, actor.workspaceId);
    const created = await admin.from("document_folders").insert({
      workspace_id: actor.workspaceId,
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      parent_folder_id: parentFolderId,
      created_by: actor.id,
      updated_by: actor.id,
    }).select("id").single();
    if (created.error) throw created.error;
    return NextResponse.json({ id: created.data.id }, { status: 201 });
  } catch (error) {
    console.error("No fue posible crear contenido de Información General.", error);
    const response = generalInformationErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireGeneralInformationActor(true);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string" || typeof body.id !== "string") {
      throw new GeneralInformationApiError("Solicitud inválida.", 400);
    }
    const admin = createAdminClient();
    if (body.entity === "folder") {
      const folder = await requireFolder(admin, body.id, actor.workspaceId, true);
      if (body.action === "delete") {
        const reason = requiredReason(body.reason);
        const [children, documents] = await Promise.all([
          admin.from("document_folders").select("id", { count: "exact", head: true }).eq("parent_folder_id", folder.id).is("deleted_at", null),
          admin.from("file_objects").select("id", { count: "exact", head: true }).eq("folder_id", folder.id).eq("resource_type", "general_information_document").is("deleted_at", null),
        ]);
        if ((children.count ?? 0) + (documents.count ?? 0) > 0) {
          throw new GeneralInformationApiError("Esta carpeta contiene documentos o subcarpetas. Mueve el contenido o archiva la carpeta.", 409);
        }
        await updateFolder(admin, String(folder.id), { deleted_at: new Date().toISOString(), deleted_by: actor.id, deletion_reason: reason, updated_by: actor.id });
      } else if (body.action === "restore") {
        if (folder.parent_folder_id) await requireFolder(admin, String(folder.parent_folder_id), actor.workspaceId);
        await updateFolder(admin, String(folder.id), { deleted_at: null, deleted_by: null, deletion_reason: null, updated_by: actor.id });
      } else if (body.action === "archive") {
        await updateFolder(admin, String(folder.id), { archived_at: new Date().toISOString(), archived_by: actor.id, updated_by: actor.id });
      } else if (body.action === "rename") {
        if (typeof body.name !== "string" || !body.name.trim()) throw new GeneralInformationApiError("Nombre inválido.", 400);
        await updateFolder(admin, String(folder.id), { name: body.name.trim(), description: typeof body.description === "string" ? body.description.trim() || null : folder.description, updated_by: actor.id });
      } else if (body.action === "move") {
        const parentId = typeof body.parentFolderId === "string" && body.parentFolderId ? body.parentFolderId : null;
        if (parentId) await requireFolder(admin, parentId, actor.workspaceId);
        await updateFolder(admin, String(folder.id), { parent_folder_id: parentId, updated_by: actor.id });
      } else {
        throw new GeneralInformationApiError("Acción de carpeta no reconocida.", 400);
      }
    } else if (body.entity === "document") {
      const document = await requireDocument(admin, body.id, actor.workspaceId, true);
      if (body.action === "delete") {
        await updateDocument(admin, String(document.id), { deleted_at: new Date().toISOString(), deleted_by: actor.id, deletion_reason: requiredReason(body.reason), is_current: false, updated_by: actor.id });
      } else if (body.action === "restore") {
        await requireFolder(admin, String(document.folder_id), actor.workspaceId);
        await updateDocument(admin, String(document.id), { deleted_at: null, deleted_by: null, deletion_reason: null, is_current: true, updated_by: actor.id });
      } else if (body.action === "update" || body.action === "move") {
        const folderId = typeof body.folderId === "string" ? body.folderId : String(document.folder_id);
        await requireFolder(admin, folderId, actor.workspaceId);
        const metadata = normalizeMetadata({
          folderId,
          name: typeof body.name === "string" ? body.name : String(document.display_name),
          referenceType: body.referenceType === "external" ? "external" : body.referenceType === "internal" ? "internal" : document.reference_type === "external" ? "external" : "internal",
          externalOrigin: typeof body.externalOrigin === "string" ? body.externalOrigin : document.external_origin ? String(document.external_origin) : undefined,
          validityStatus: body.validityStatus === "not_current" ? "not_current" : body.validityStatus === "current" ? "current" : document.validity_status === "not_current" ? "not_current" : "current",
          validFrom: typeof body.validFrom === "string" ? body.validFrom : document.valid_from ? String(document.valid_from) : undefined,
          validUntil: typeof body.validUntil === "string" ? body.validUntil : document.valid_until ? String(document.valid_until) : undefined,
          description: typeof body.description === "string" ? body.description : document.description ? String(document.description) : undefined,
          observations: typeof body.observations === "string" ? body.observations : document.observations ? String(document.observations) : undefined,
        });
        await updateDocument(admin, String(document.id), metadataToRow(metadata, actor.id));
      } else {
        throw new GeneralInformationApiError("Acción documental no reconocida.", 400);
      }
    } else {
      throw new GeneralInformationApiError("Entidad no reconocida.", 400);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("No fue posible actualizar Información General.", error);
    const response = generalInformationErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

async function uploadDocuments(request: Request, actor: { id: string; workspaceId: string }) {
  const form = await request.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length || files.length > GENERAL_INFORMATION_MAX_BATCH_FILES) {
    throw new GeneralInformationApiError(`Selecciona entre 1 y ${GENERAL_INFORMATION_MAX_BATCH_FILES} archivos.`, 400);
  }
  let manifest: GeneralInformationDocumentInput[];
  try {
    manifest = JSON.parse(String(form.get("manifest") || "[]")) as GeneralInformationDocumentInput[];
  } catch {
    throw new GeneralInformationApiError("La metadata del lote no es válida.", 400);
  }
  if (!Array.isArray(manifest) || manifest.length !== files.length) {
    throw new GeneralInformationApiError("Cada archivo requiere metadata.", 400);
  }
  const admin = createAdminClient();
  const folderIds = [...new Set(manifest.map((item) => item.folderId))];
  await Promise.all(folderIds.map((folderId) => requireFolder(admin, folderId, actor.workspaceId)));
  const replaceDocumentId = String(form.get("replaceDocumentId") || "") || null;
  if (replaceDocumentId && files.length !== 1) throw new GeneralInformationApiError("El reemplazo admite un archivo por operación.", 400);
  const batchCode = `${files.length > 1 ? "BULK" : "UPLOAD"}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 4).toUpperCase()}`;
  const batch = await admin.from("document_upload_batches").insert({
    batch_code: batchCode,
    workspace_id: actor.workspaceId,
    folder_id: manifest.every((item) => item.folderId === manifest[0].folderId) ? manifest[0].folderId : null,
    total_count: files.length,
    created_by: actor.id,
  }).select("id").single();
  if (batch.error) throw batch.error;

  const results: Array<{ index: number; ok: boolean; document?: ReturnType<typeof mapGeneralInformationDocument>; error?: string; existingDocumentId?: string }> = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const fileError = validateGeneralInformationFile(file);
      if (fileError) throw new GeneralInformationApiError(fileError, 400);
      const metadata = normalizeMetadata(manifest[index]);
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const candidates = await admin.from("file_objects")
        .select("id,sha256,original_name,size_bytes")
        .eq("workspace_id", actor.workspaceId)
        .eq("folder_id", metadata.folderId)
        .eq("resource_type", "general_information_document")
        .eq("is_current", true)
        .is("deleted_at", null);
      if (candidates.error) throw candidates.error;
      const duplicate = (candidates.data ?? []).find((candidate) =>
        candidate.sha256 === sha256 || (candidate.original_name === file.name && Number(candidate.size_bytes) === file.size));
      if (duplicate && !metadata.allowDuplicate && duplicate.id !== replaceDocumentId) {
        results.push({ index, ok: false, error: "DUPLICATE", existingDocumentId: duplicate.id });
        continue;
      }

      let previous: Record<string, unknown> | null = null;
      if (replaceDocumentId) previous = await requireDocument(admin, replaceDocumentId, actor.workspaceId);
      const documentId = randomUUID();
      const objectPath = `${actor.workspaceId}/information-general/${metadata.folderId}/${documentId}/${safeGeneralInformationObjectName(file.name)}`;
      const stored = await admin.storage.from("integraq-private").upload(objectPath, bytes, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (stored.error) throw stored.error;
      if (previous) {
        const previousUpdate = await admin.from("file_objects").update({ is_current: false, updated_by: actor.id }).eq("id", previous.id);
        if (previousUpdate.error) {
          await admin.storage.from("integraq-private").remove([objectPath]);
          throw previousUpdate.error;
        }
      }
      const inserted = await admin.from("file_objects").insert({
        id: documentId,
        bucket_id: "integraq-private",
        object_path: objectPath,
        original_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        sha256,
        module_id: "documents",
        audience: "internal",
        resource_type: "general_information_document",
        resource_id: documentId,
        resource_key: documentId,
        category: "information-general",
        uploaded_by: actor.id,
        workspace_id: actor.workspaceId,
        batch_id: batch.data.id,
        version: previous ? Number(previous.version || 1) + 1 : 1,
        is_current: true,
        replaces_file_id: previous?.id ?? null,
        preview_status: file.type === "application/pdf" || file.type.startsWith("image/") ? "not_required" : "pending",
        ...metadataToRow(metadata, actor.id),
      }).select(documentSelect).single();
      if (inserted.error) {
        if (previous) await admin.from("file_objects").update({ is_current: true, updated_by: actor.id }).eq("id", previous.id);
        await admin.storage.from("integraq-private").remove([objectPath]);
        throw inserted.error;
      }
      results.push({ index, ok: true, document: mapGeneralInformationDocument(inserted.data as unknown as Record<string, unknown>) });
    } catch (fileError) {
      results.push({ index, ok: false, error: fileError instanceof Error ? fileError.message : "UPLOAD_FAILED" });
    }
  }
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;
  const status = successCount === 0 ? "failed" : failureCount ? "partial" : "completed";
  const batchUpdate = await admin.from("document_upload_batches").update({
    success_count: successCount,
    failure_count: failureCount,
    status,
    failures: results.filter((result) => !result.ok).map(({ index, error, existingDocumentId }) => ({ index, error, existingDocumentId })),
    completed_at: new Date().toISOString(),
  }).eq("id", batch.data.id);
  if (batchUpdate.error) throw batchUpdate.error;
  if (files.length > 1) {
    await admin.from("audit_log").insert({
      actor_id: actor.id,
      action: "BULK_UPLOAD",
      resource_type: "document_upload_batch",
      resource_id: batch.data.id,
      metadata: { workspace_id: actor.workspaceId, batch_code: batchCode, total: files.length, success: successCount, failed: failureCount },
    });
  }
  return NextResponse.json({ batchId: batch.data.id, batchCode, successCount, failureCount, results }, { status: 201 });
}

function normalizeMetadata(input: GeneralInformationDocumentInput) {
  const error = validateGeneralInformationMetadata(input);
  if (error) throw new GeneralInformationApiError(error, 400);
  return {
    folderId: input.folderId,
    name: input.name.trim(),
    referenceType: input.referenceType,
    externalOrigin: input.referenceType === "external" ? input.externalOrigin?.trim() || null : null,
    validityStatus: input.validityStatus,
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
    description: input.description?.trim() || null,
    observations: input.observations?.trim() || null,
    allowDuplicate: Boolean(input.allowDuplicate),
  };
}

function metadataToRow(metadata: ReturnType<typeof normalizeMetadata>, actorId: string) {
  return {
    folder_id: metadata.folderId,
    display_name: metadata.name,
    reference_type: metadata.referenceType,
    external_origin: metadata.externalOrigin,
    validity_status: metadata.validityStatus,
    valid_from: metadata.validFrom,
    valid_until: metadata.validUntil,
    description: metadata.description,
    observations: metadata.observations,
    updated_by: actorId,
  };
}

async function requireFolder(admin: ReturnType<typeof createAdminClient>, id: string, workspaceId: string, includeDeleted = false) {
  let query = admin.from("document_folders").select("*").eq("id", id).eq("workspace_id", workspaceId);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new GeneralInformationApiError("La carpeta no existe o no pertenece al espacio actual.", 404);
  return result.data as unknown as Record<string, unknown>;
}

async function requireDocument(admin: ReturnType<typeof createAdminClient>, id: string, workspaceId: string, includeDeleted = false) {
  let query = admin.from("file_objects").select("*").eq("id", id).eq("workspace_id", workspaceId).eq("resource_type", "general_information_document");
  if (!includeDeleted) query = query.is("deleted_at", null);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new GeneralInformationApiError("El documento no existe o no pertenece al espacio actual.", 404);
  return result.data as unknown as Record<string, unknown>;
}

async function updateFolder(admin: ReturnType<typeof createAdminClient>, id: string, changes: Record<string, unknown>) {
  const result = await admin.from("document_folders").update(changes).eq("id", id);
  if (result.error) throw result.error;
}

async function updateDocument(admin: ReturnType<typeof createAdminClient>, id: string, changes: Record<string, unknown>) {
  const result = await admin.from("file_objects").update(changes).eq("id", id);
  if (result.error) throw result.error;
}

function requiredReason(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new GeneralInformationApiError("La eliminación lógica requiere un motivo.", 400);
  return value.trim();
}

function relationValue(value: unknown, key: string) {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === "object" && key in relation
    ? String((relation as Record<string, unknown>)[key])
    : undefined;
}
