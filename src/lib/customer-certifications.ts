export const certificationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Certification = {
  id: string; code: string; name: string; certification_type: string; reference_number: string | null;
  issuer: string; scope: string | null; valid_from: string; valid_until: string;
  workspace_id: string; external_organization_id: string | null; observations: string | null;
  responsible_id: string; active: boolean; customer_visible: boolean; revision: number;
  created_at: string; updated_at: string; created_by: string; updated_by: string | null;
  published_at: string | null; published_by: string | null; deletion_reason: string | null;
};
export type CertificationFile = {
  id: string; resource_id: string; original_name: string; size_bytes: number; mime_type: string;
  version: number; is_current: boolean; created_at: string; uploaded_by: string;
};
export type CertificationCatalog = {
  certifications: Certification[]; files: CertificationFile[];
  customers: { id: string; code: string; name: string; active: boolean }[];
  responsibleUsers: { id: string; full_name: string }[];
  history: { id: string; resource_id: string; action: string; actor_id: string; created_at: string; reason: string | null }[];
  administrator: boolean; today: string;
};
export function certificationToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)?.value).join("-");
}
export function certificationStatus(record: Pick<Certification, "valid_from" | "valid_until">, today: string) {
  if (record.valid_until < today) return "Vencida";
  if (record.valid_from > today) return "Pendiente de vigencia";
  const days = (Date.parse(`${record.valid_until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return days <= 30 ? "Próxima a vencer" : "Vigente";
}
export function certificationCanPublish(record: Pick<Certification, "active" | "valid_from" | "valid_until">, today: string) {
  return record.active && record.valid_from <= today && record.valid_until >= today;
}
export function certificationVisibleToCustomer(record: Pick<Certification, "active" | "valid_from" | "valid_until" | "customer_visible" | "workspace_id" | "external_organization_id">, workspaceId: string, customerId: string, today: string) {
  return record.workspace_id === workspaceId && record.customer_visible === true && certificationCanPublish(record, today) &&
    (!record.external_organization_id || record.external_organization_id === customerId);
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validateCertification(input: Record<string, unknown>) {
  if (!certificationUuid.test(String(input.id)) || !certificationUuid.test(String(input.responsibleId))) throw new Error("Selecciona un responsable interno válido.");
  for (const field of ["name", "type", "issuer"]) if (typeof input[field] !== "string" || !String(input[field]).trim() || String(input[field]).length > 250) throw new Error("Nombre, tipo y organismo emisor son obligatorios (máximo 250 caracteres).");
  if (!validDate(input.validFrom) || !validDate(input.validUntil) || input.validFrom > input.validUntil) throw new Error("Indica fechas reales de emisión y vencimiento, en orden válido.");
  if (input.customerId && !certificationUuid.test(String(input.customerId))) throw new Error("Selecciona un cliente real o General de Towell.");
  if (["reference", "scope", "observations"].some(field => input[field] != null && (typeof input[field] !== "string" || String(input[field]).length > 5000))) throw new Error("Referencia, alcance u observaciones exceden el límite permitido.");
}
