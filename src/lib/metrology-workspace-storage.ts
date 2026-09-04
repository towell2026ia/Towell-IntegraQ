import type { MetrologyWorkspaceState } from "@/lib/metrology-report-data";
import type { MetrologyAttachment } from "@/lib/metrology-report-data";
import type { MeasurementAsset } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación de metrología.");
  return body;
}

export async function loadMetrologyWorkspace() {
  return parseResponse<{ workspace: MetrologyWorkspaceState; updatedAt: string; storage: "supabase" }>(await fetch("/api/metrology/workspace", { cache: "no-store" }));
}

export async function saveMetrologyWorkspace(workspace: MetrologyWorkspaceState) {
  return parseResponse<{ workspace: MetrologyWorkspaceState; updatedAt: string }>(await fetch("/api/metrology/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) }));
}

export async function uploadCalibrationCertificates(files: File[], asset: MeasurementAsset): Promise<MetrologyAttachment[]> {
  if (!files.length) throw new Error("Adjunta al menos un certificado de calibración.");
  if (files.length > 10) throw new Error("Puedes adjuntar hasta 10 certificados por cierre.");
  const maximumFileSize = 20 * 1024 * 1024;
  if (files.some((file) => !file.size || file.size > maximumFileSize)) throw new Error("Cada certificado debe pesar entre 1 byte y 20 MB.");
  if (files.some((file) => !certificateMimeType(file))) throw new Error("Los certificados deben ser archivos PDF, PNG, JPG o WEBP.");
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  const candidates: Array<{ objectPath: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string }> = [];
  for (const file of files) {
    const mimeType = certificateMimeType(file);
    if (!mimeType) throw new Error("Tipo de certificado no permitido.");
    const objectPath = `${userData.user.id}/metrology/${safeObjectName(asset.code)}/${Date.now()}-${crypto.randomUUID()}-${safeObjectName(file.name)}`;
    const storage = await supabase.storage.from("integraq-private").upload(objectPath, file, { cacheControl: "3600", contentType: mimeType, upsert: false });
    if (storage.error) throw new Error(storage.error.message);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    candidates.push({ objectPath, fileName: file.name, mimeType, sizeBytes: file.size, sha256 });
  }
  const response = await parseResponse<{ attachments: MetrologyAttachment[] }>(await fetch("/api/metrology/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: asset.id, files: candidates }) }));
  return response.attachments;
}

function certificateMimeType(file: File) {
  if (["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) return file.type;
  const extension = file.name.toLocaleLowerCase("en-US").split(".").pop();
  return extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : ["jpg", "jpeg"].includes(extension ?? "") ? "image/jpeg" : extension === "webp" ? "image/webp" : "";
}

function safeObjectName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-140);
}
