"use client";
import { createClient } from "./supabase/client";
import { fileSha256, mapAttachment } from "./attachment-storage";
import { validateHistoricalMinutes } from "./historical-minutes";

export const reviewMinutes = "management_review_minutes";
export const reviewDocuments = "management_review_document";
export type ReviewKind = typeof reviewMinutes | typeof reviewDocuments;
export const reviewCategories = {
  presentations: "Presentaciones de Dirección", inputs: "Información de entrada",
  reports: "Informes complementarios", support: "Documentos de soporte",
  improvements: "Proyectos de mejora", other: "Otros documentos",
} as const;
export type ReviewMetadata = { title: string; responsible: string; date: string; notes: string; category: string; section: string };
export type ReviewFile = ReturnType<typeof mapAttachment> & { responsible: string; section: string; updatedAt: string; reason: string };
const columns = "id,bucket_id,object_path,original_name,mime_type,size_bytes,module_id,resource_type,resource_key,category,version,is_current,replaces_file_id,preview_path,preview_status,uploaded_by,created_at,deleted_at,display_name,valid_from,description,observations,reference_type,updated_at,deletion_reason";

export async function readReviewPeriods() {
  const client = createClient();
  const { data, error } = await client.rpc("iq_review_periods");
  if (!error) return { years: data as number[], installed: true };
  if (error.code !== "PGRST202" && error.code !== "42883") throw new Error("No se pudieron consultar los períodos.");
  const legacy = await client.from("file_objects").select("resource_key").eq("module_id","management-review").eq("resource_type",reviewMinutes);
  if (legacy.error) throw new Error("No se pudieron consultar las actas.");
  return { years: [...new Set(legacy.data.map(row => Number(row.resource_key)))], installed: false };
}

export async function listReviewFiles(kind: ReviewKind, year: number, history: boolean) {
  const result: ReviewFile[] = [];
  for (let offset = 0; ; offset += 100) {
    let query = createClient().from("file_objects").select(columns).eq("module_id","management-review").eq("resource_type",kind);
    query = kind === reviewMinutes ? query.eq("resource_key", String(year)) : query.like("resource_key", year + ":%");
    if (!history) query = query.eq("is_current",true).is("deleted_at",null);
    const { data, error } = await query.order("created_at",{ascending:false}).order("id").range(offset,offset+99);
    if (error) throw new Error("No se pudo consultar el expediente del año.");
    result.push(...data.map(row => ({ ...mapAttachment(row), responsible: row.observations ?? (kind === reviewMinutes ? row.display_name : "") ?? "",
      section: row.reference_type ?? "", updatedAt: row.updated_at, reason: row.deletion_reason ?? "" })));
    if (data.length < 100) return result;
  }
}

type WriteInput = { kind: ReviewKind; year: number; action: "add"|"replace"|"edit"|"retire"; previous?: ReviewFile;
  documentId: string; uploadId: string; metadata: ReviewMetadata; file?: File; reason?: string };

export async function saveReviewFile(input: WriteInput) {
  const { kind, year, file, metadata, action, previous } = input;
  const client = createClient();
  const key = previous?.resourceKey ?? (kind === reviewMinutes ? String(year) : year + ":" + input.documentId);
  const payload: Record<string,unknown> = { ...metadata, reason: input.reason };
  if (action === "add" || action === "replace") {
    if (!file?.size || file.size > 50*1024*1024) throw new Error("Selecciona un archivo de hasta 50 MB.");
    if (kind === reviewMinutes) {
      const error = validateHistoricalMinutes({ year: String(year), date: metadata.date, responsible: metadata.responsible, fileName: file.name, mimeType: file.type },new Date().getFullYear());
      if (error) throw new Error(error);
    }
    const mime = file.type || (kind === reviewMinutes
      ? (/\.pdf$/i.test(file.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      : "application/octet-stream");
    const sha = await fileSha256(file);
    const existing = await client.from("file_objects").select("id").eq("bucket_id","integraq-private")
      .eq("sha256",sha).neq("id",input.uploadId).limit(1);
    if (existing.error) throw new Error("No se pudo comprobar si el archivo ya está registrado.");
    if (existing.data.length) throw new Error("El archivo ya está registrado. Consulta el original en su expediente.");
    Object.assign(payload, { name: file.name, size: file.size, mime, sha });
    const reserved = await client.rpc("iq_review_reserve", {
      p_id: input.uploadId, p_type: kind, p_key: key, p_previous: previous?.id ?? null,
      p_expected: previous?.updatedAt ?? null, p_data: payload,
    });
    if (reserved.error || !reserved.data) throw new Error("No se confirmó la reserva. Consulta las cargas pendientes antes de reintentar.");
    const transfer = await getReviewTransfer(String(reserved.data));
    return resumeReviewTransfer(transfer, file);
  }
  const { data,error } = await client.rpc("iq_review_write",{ p_action: action,p_type:kind,p_key:key,p_previous:previous?.id ?? null,
    p_expected:previous?.updatedAt ?? null,p_data:payload });
  if (error || !data) throw new Error(error?.message.includes("REVIEW_CHANGED") ? "El expediente cambió. Actualiza la lista antes de continuar." : "El registro no se confirmó. Conserva tu selección y vuelve a intentar.");
  return String(data);
}

export interface ReviewTransfer {
  id: string;
  object_path: string;
  resource_key: string;
  uploaded: boolean;
  result_id: string | null;
  payload: ReviewMetadata & { name: string; size: number; mime: string; sha: string };
}

async function getReviewTransfer(id: string): Promise<ReviewTransfer> {
  const { data, error } = await createClient().rpc("iq_review_transfers").eq("id", id).single();
  if (error || !data) throw new Error("No se pudo consultar la reserva. Vuelve a abrir las cargas pendientes.");
  return data as ReviewTransfer;
}

export async function pendingReviewTransfers(kind: ReviewKind): Promise<ReviewTransfer[]> {
  const rows: ReviewTransfer[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await createClient().rpc("iq_review_transfers").eq("resource_type", kind)
      .is("result_id", null).order("id").range(offset, offset + 99);
    if (error) throw new Error("No se pudieron consultar las cargas pendientes.");
    rows.push(...data as ReviewTransfer[]);
    if (data.length < 100) return rows;
  }
}

export async function resumeReviewTransfer(transfer: ReviewTransfer, file?: File): Promise<string> {
  if (transfer.result_id) return transfer.result_id;
  if (!transfer.uploaded) {
    if (!file || file.name !== transfer.payload.name || file.size !== transfer.payload.size ||
        await fileSha256(file) !== transfer.payload.sha) {
      throw new Error("Selecciona el archivo original correspondiente a esta reserva.");
    }
    const { error } = await createClient().storage.from("integraq-private").upload(transfer.object_path, file,
      { contentType: transfer.payload.mime, upsert: false });
    if (error && String(error.statusCode) !== "409" && error.message !== "The resource already exists") {
      throw new Error("La reserva se conserva. Actualiza las cargas pendientes para comprobar la transferencia.");
    }
  }
  const response = await fetch("/api/management-review/transfers", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: transfer.id }),
  }).catch(() => null);
  if (!response) throw new Error("La conexión se interrumpió. Puedes recuperar la carga pendiente.");
  if (!response.ok) throw new Error(response.status === 409
    ? "No se confirmó el registro. Comprueba el archivo y la versión actual del expediente. La reserva se conserva."
    : "No se confirmó el registro. Puedes recuperarlo desde las cargas pendientes.");
  const id = (await response.json().catch(() => null))?.id;
  if (id !== transfer.id) throw new Error("No se confirmó la versión documental.");
  return id;
}

export async function downloadReviewFile(file: ReviewFile) {
  const {data,error} = await createClient().storage.from(file.bucketId).createSignedUrl(file.objectPath,120,{download:file.originalName});
  if (error || !data) throw new Error("No se pudo descargar el original.");
  const anchor = document.createElement("a");
  anchor.href=data.signedUrl; anchor.download=file.originalName; anchor.click();
}
