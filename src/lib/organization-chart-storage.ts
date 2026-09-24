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
  file,
  processId,
  items,
}: {
  file: File;
  processId: string;
  items: OrganizationImportItem[];
}) {
  if (!file.size || file.size > maximumSize) throw new Error("El organigrama debe pesar entre 1 byte y 15 MB.");
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  const objectPath = `${userData.user.id}/organization/${processId}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
  const sha256 = await fileSha256(file);
  const current = await supabase.from("file_objects")
    .select("id,version")
    .eq("resource_type", "process_organization_chart")
    .eq("resource_key", processId)
    .eq("is_current", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const uploaded = await supabase.storage.from(privateBucket).upload(objectPath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
  if (current.data) {
    const replaced = await supabase.from("file_objects").update({ is_current: false }).eq("id", current.data.id);
    if (replaced.error) {
      await supabase.storage.from(privateBucket).remove([objectPath]);
      throw new Error(replaced.error.message);
    }
  }
  const fileObject = await supabase.from("file_objects").insert({
    bucket_id: privateBucket,
    object_path: objectPath,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    sha256,
    process_id: processId,
    module_id: "documents",
    audience: "internal",
    resource_type: "process_organization_chart",
    resource_key: processId,
    category: `interpreted:${items.length}`,
    version: (current.data?.version ?? 0) + 1,
    is_current: true,
    replaces_file_id: current.data?.id ?? null,
    preview_status: file.type.startsWith("image/") ? "not_required" : "pending",
    uploaded_by: userData.user.id,
  }).select("id").single();
  if (fileObject.error) {
    if (current.data) await supabase.from("file_objects").update({ is_current: true }).eq("id", current.data.id);
    await supabase.storage.from(privateBucket).remove([objectPath]);
    throw new Error(fileObject.error.message);
  }
  if (!items.length) return { sourceId: fileObject.data.id, created: [], skipped: [] };
  const response = await fetch("/api/organization/positions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "process-import", processId, items }),
  });
  const payload = await response.json() as { created?: Array<{ id: string; name: string }>; skipped?: Array<{ name: string; reason: string }>; error?: string };
  if (!response.ok) throw new Error(payload.error || "El archivo se guardó, pero no fue posible integrar los puestos.");
  return { sourceId: fileObject.data.id, created: payload.created ?? [], skipped: payload.skipped ?? [] };
}

export async function loadProcessOrganizationSources(): Promise<ProcessOrganizationSource[]> {
  const result = await createClient().from("file_objects")
    .select("id,process_id,original_name,mime_type,created_at,category,bucket_id,object_path,size_bytes,version")
    .eq("resource_type", "process_organization_chart")
    .eq("is_current", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).flatMap((row) => row.process_id ? [{
    id: row.id,
    processId: row.process_id,
    fileName: row.original_name,
    mimeType: row.mime_type || "application/octet-stream",
    createdAt: row.created_at,
    interpretedCount: Number(String(row.category ?? "").split(":")[1] ?? 0) || 0,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    sizeBytes: row.size_bytes,
    version: row.version,
  }] : []);
}

export async function getProcessOrganizationChartUrl(source: ProcessOrganizationSource) {
  const { data, error } = await createClient().storage.from(source.bucketId || privateBucket).createSignedUrl(source.objectPath, 120);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function deleteProcessOrganizationChart(source: ProcessOrganizationSource) {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  const { error } = await supabase.from("file_objects").update({
    is_current: false,
    deleted_at: new Date().toISOString(),
    deleted_by: userData.user.id,
  }).eq("id", source.id).is("deleted_at", null);
  if (error) throw new Error(error.message);
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140);
}

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
