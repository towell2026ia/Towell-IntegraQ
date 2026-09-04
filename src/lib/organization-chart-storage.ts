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
  const uploaded = await supabase.storage.from(privateBucket).upload(objectPath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
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
    category: `interpreted:${items.length}`,
    uploaded_by: userData.user.id,
  }).select("id").single();
  if (fileObject.error) {
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
    .select("id,process_id,original_name,mime_type,created_at,category")
    .eq("resource_type", "process_organization_chart")
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).flatMap((row) => row.process_id ? [{
    id: row.id,
    processId: row.process_id,
    fileName: row.original_name,
    mimeType: row.mime_type || "application/octet-stream",
    createdAt: row.created_at,
    interpretedCount: Number(String(row.category ?? "").split(":")[1] ?? 0) || 0,
  }] : []);
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140);
}

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
