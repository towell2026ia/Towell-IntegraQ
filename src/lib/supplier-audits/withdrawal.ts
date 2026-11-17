import type { AuditWorkspace, SupplierAudit } from "./model";

export function isAuditWithdrawn(event: Pick<SupplierAudit, "withdrawn_at">) { return Boolean(event.withdrawn_at); }
export function canWithdrawAudit(data: Pick<AuditWorkspace, "administrator" | "canManage" | "withdrawalVersion">) {
  return data.administrator === true && data.canManage === true && data.withdrawalVersion === 1;
}
export function auditStateLabel(event: SupplierAudit) {
  return isAuditWithdrawn(event) ? "Retirada de programación" : null;
}
export function withdrawalReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (Array.from(reason).length < 5 || Array.from(reason).length > 2000) throw new Error("Indica un motivo de 5 a 2000 caracteres.");
  return reason;
}
export function withdrawalInput(body: Record<string, unknown>) {
  if (typeof body.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)
    || typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1 || body.revision > 2147483647
    || !["withdraw", "restore"].includes(String(body.command))) throw new Error("Selecciona un expediente y su revisión actual.");
  return { id: body.id, revision: body.revision, withdrawn: body.command === "withdraw", reason: withdrawalReason(body.reason) };
}
// Missing/inaccessible parent relations fail closed; legacy standalone assessments remain intact.
export function isOperationalAssessment(row: { audit_event_id: string | null; audit_event: { id: string; withdrawn_at?: string | null } | null }) {
  return row.audit_event_id === null || Boolean(row.audit_event?.id === row.audit_event_id && !isAuditWithdrawn(row.audit_event));
}
