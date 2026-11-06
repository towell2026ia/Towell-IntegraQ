import type { AuditWorkspace } from "./model";
export async function auditRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/suppliers/audits${path}`, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload === null) throw new Error(payload?.error ?? "No se pudo completar la consulta de auditorías.");
  return payload as T;
}
export function auditCommand(body: Record<string, unknown>) { return auditRequest<{ saved: boolean; id: string }>("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
export function loadAuditData(signal?: AbortSignal) { return auditRequest<AuditWorkspace>("", { signal }); }
export async function auditFileUrl(eventId: string, fileId: string, download = false) {
  const result = await auditRequest<{ signedUrl: string }>(`/${encodeURIComponent(eventId)}/files/${encodeURIComponent(fileId)}${download ? "?download=true" : ""}`);
  return result.signedUrl;
}
