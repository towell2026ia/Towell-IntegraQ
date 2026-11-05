export const claimStatuses = ["open", "under_review", "action_required", "closed"] as const;
export type ClaimStatus = typeof claimStatuses[number];
export const claimStatusLabels: Record<ClaimStatus, string> = { open: "Abierto", under_review: "En revisión", action_required: "Requiere acción", closed: "Cerrado" };
export interface CustomerClaim {
  id: string; folio: string; external_organization_id: string; received_at: string; title: string; description: string;
  status: ClaimStatus; external_reference: string | null; process_id: string | null; updated_at: string;
  cancelled_at: string | null; cancellation_reason: string | null;
}
export interface ClaimEvidence { id: string; resource_id: string; original_name: string; size_bytes: number; mime_type: string; version: number; is_current: boolean; created_at: string; uploaded_by: string; }
export interface ClaimAction { id: string; folio: string; title: string; external_organization_id: string; quality_case_id: string | null; status: string; }
export interface ClaimsCatalog { claims: CustomerClaim[]; findings: number; history: {id:string;resource_id:string;action:string;actor_id:string;created_at:string;reason:string|null}[]; evidence: ClaimEvidence[]; actions: ClaimAction[]; customers: { id: string; code: string; name: string; active: boolean }[]; processes: { id: string; name: string }[]; }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function claimMetrics(claims: CustomerClaim[], actions: ClaimAction[], filters: { customerId?: string; from?: string; to?: string } = {}) {
  const linked = new Set(actions.filter(a => claims.some(c => c.id === a.quality_case_id && c.external_organization_id === a.external_organization_id)).map(a => a.quality_case_id));
  const unique = [...new Map(claims.map(c => [c.id, c])).values()].filter(c => !c.cancelled_at && (!filters.customerId || c.external_organization_id === filters.customerId) && (!filters.from || c.received_at >= filters.from) && (!filters.to || c.received_at <= filters.to));
  return { received: unique.length, open: unique.filter(c => c.status !== "closed").length, closed: unique.filter(c => c.status === "closed").length, withoutA3: unique.filter(c => !linked.has(c.id)).length };
}
export function validateClaimInput(value: Record<string, unknown>) {
  if (!uuidPattern.test(String(value.id)) || !uuidPattern.test(String(value.customerId))) throw new Error("Selecciona un cliente real del catálogo.");
  const date = String(value.receivedAt ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("La fecha de recepción no es válida.");
  if (!String(value.title ?? "").trim() || !String(value.description ?? "").trim()) throw new Error("Asunto y descripción son obligatorios.");
  if (!claimStatuses.includes(value.status as ClaimStatus)) throw new Error("Estado no válido.");
  if (String(value.title).length > 500 || String(value.description).length > 20000 || String(value.externalReference ?? "").length > 500) throw new Error("El texto excede el límite permitido.");
}
export async function claimsRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/customers/claims${path}`, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No fue posible completar la operación del reclamo.");
  return body as T;
}
