"use client";

import type { OrganizationChartDraft } from "@/lib/organization-chart-data";
import type { ProcessRelationship } from "@/lib/organization-data";
import { createClient } from "@/lib/supabase/client";

const privateBucket = "integraq-private";
const maximumSize = 15 * 1024 * 1024;

export interface ProcessOrganizationSource {
  id: string;
  processId: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  interpretedCount: number;
  bucketId: string;
  objectPath: string;
  sizeBytes: number | null;
  version: number;
  isCurrent?: boolean;
  deletedAt?: string;
}

export interface OrganizationImportItem {
  clientId: string;
  name: string;
  branch: string;
  parentId?: string;
  parentClientId?: string;
  processId: string;
  relationship: ProcessRelationship;
}

export async function interpretProcessOrganizationChart(file: File, processName: string): Promise<OrganizationChartDraft> {
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("processName", processName);
  const response = await fetch("/api/ai/organization-import", { method: "POST", body });
  const payload = await response.json() as { draft?: OrganizationChartDraft; error?: string };
  if (!response.ok || !payload.draft) throw new Error(payload.error || "No fue posible interpretar el organigrama.");
  return payload.draft;
}

export async function uploadProcessOrganizationChart({
  file, processId, items = [],
}: { file: File; processId: string; items?: OrganizationImportItem[] }) {
  if (!file.size || file.size > maximumSize) throw new Error("El organigrama debe pesar entre 1 byte y 15 MB.");
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  await assertOrganizationAdministrator(supabase, userData.user.id);
  const scoped = () => supabase.from("file_objects").select("id,version")
    .eq("resource_type", "process_organization_chart").eq("resource_key", processId).eq("process_id", processId);
  const [current, latest] = await Promise.all([
    scoped().eq("is_current", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    scoped().order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (current.error || latest.error) throw new Error("No fue posible consultar las versiones del organigrama.");
  const objectPath = [userData.user.id, "organization", processId, Date.now() + "-" + crypto.randomUUID() + "-" + safeName(file.name)].join("/");
  const sha256 = await fileSha256(file);
  const uploaded = await supabase.storage.from(privateBucket).upload(objectPath, file, {
    cacheControl: "3600", contentType: file.type || "application/octet-stream", upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
  if (current.data) {
    const replaced = await supabase.from("file_objects").update({ is_current: false })
      .eq("id", current.data.id).eq("is_current", true).is("deleted_at", null).select("id").maybeSingle();
    if (replaced.error || !replaced.data) throw new Error("El organigrama cambió durante la actualización. Recarga antes de reintentar; se conservan los archivos.");
  }
  const fileObject = await supabase.from("file_objects").insert({
    bucket_id: privateBucket, object_path: objectPath, original_name: file.name,
    mime_type: file.type || "application/octet-stream", size_bytes: file.size, sha256,
    process_id: processId, module_id: "documents", audience: "internal",
    resource_type: "process_organization_chart", resource_key: processId,
    category: "interpreted:" + items.length, version: Math.max(current.data?.version ?? 0, latest.data?.version ?? 0) + 1,
    is_current: true, replaces_file_id: current.data?.id ?? latest.data?.id ?? null,
    preview_status: /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name) || file.type.startsWith("image/") ? "not_required" : "pending",
    uploaded_by: userData.user.id,
  }).select("id").single();
  if (fileObject.error || !fileObject.data) {
    // A failed response may follow a committed insert. Never delete its binary.
    const registered = await supabase.from("file_objects").select("id").eq("object_path", objectPath).maybeSingle();
    if (!registered.error && !registered.data && current.data) {
      // The existing unique-current index prevents overwriting another current version.
      await supabase.from("file_objects").update({ is_current: true }).eq("id", current.data.id).eq("is_current", false).is("deleted_at", null);
    }
    throw new Error("No fue posible confirmar el guardado. Recarga; los archivos y versiones anteriores se conservan.");
  }
  if (!items.length) return { sourceId: fileObject.data.id, created: [], skipped: [] };
  const response = await fetch("/api/organization/positions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "process-import", processId, items }),
  });
  const payload = await response.json() as { created?: Array<{ id: string; name: string }>; skipped?: Array<{ name: string; reason: string }>; error?: string };
  if (!response.ok) throw new Error(payload.error || "El archivo se guardó, pero no fue posible integrar los puestos.");
  return { sourceId: fileObject.data.id, created: payload.created ?? [], skipped: payload.skipped ?? [] };
}

export async function loadProcessOrganizationSources(): Promise<ProcessOrganizationSource[]> {
  const result = await createClient().from("file_objects").select("*").eq("resource_type", "process_organization_chart")
    .eq("is_current", true).is("deleted_at", null).order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).flatMap((row) => row.process_id ? [mapOrganizationSource(row)] : []);
}

export async function loadProcessOrganizationHistory(processId: string): Promise<ProcessOrganizationSource[]> {
  const result = await createClient().from("file_objects").select("*").eq("resource_type", "process_organization_chart")
    .eq("resource_key", processId).eq("process_id", processId).order("version", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map(mapOrganizationSource);
}

function mapOrganizationSource(row: Record<string, unknown>): ProcessOrganizationSource {
  return {
    id: String(row.id), processId: String(row.process_id), fileName: String(row.original_name),
    mimeType: String(row.mime_type || "application/octet-stream"), createdAt: String(row.created_at),
    interpretedCount: Number(String(row.category ?? "").split(":")[1] ?? 0) || 0,
    bucketId: String(row.bucket_id), objectPath: String(row.object_path),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes), version: Number(row.version || 1),
    isCurrent: Boolean(row.is_current), deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
  };
}

export async function getProcessOrganizationChartUrl(source: ProcessOrganizationSource) {
  const { data, error } = await createClient().storage.from(source.bucketId || privateBucket).createSignedUrl(source.objectPath, 120);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function deleteProcessOrganizationChart(source: ProcessOrganizationSource, reason: string) {
  if (!reason.trim()) throw new Error("El motivo de eliminación es obligatorio.");
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  await assertOrganizationAdministrator(supabase, userData.user.id);
  const result = await supabase.from("file_objects").update({
    is_current: false, deleted_at: new Date().toISOString(), deleted_by: userData.user.id, deletion_reason: reason.trim(),
  }).eq("id", source.id).eq("resource_type", "process_organization_chart").eq("process_id", source.processId)
    .eq("is_current", true).is("deleted_at", null).select("id").maybeSingle();
  if (result.error || !result.data) throw new Error("No se confirmó la eliminación. Recarga el organigrama.");
}

async function assertOrganizationAdministrator(supabase: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await supabase.from("profiles").select("user_type,status").eq("id", id).maybeSingle();
  if (error || data?.user_type !== "administrator" || data.status !== "active") throw new Error("Solo el administrador activo puede actualizar o eliminar el organigrama.");
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140);
}

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
