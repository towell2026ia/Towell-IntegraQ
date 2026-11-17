import "server-only";
import { assertAuditWritable, auditContext, auditEvent, auditRpcError, SupplierAuditError, type AuditContext } from "./server";
import { checkManualReferences, manualCommand, parseManualRecord, uuid, type ManualAuditSnapshot, type PortalAudit } from "./manual";
import type { SupplierAuditFile } from "./model";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoSession } from "@/lib/session-data";
export const manualHeaders = { "Cache-Control": "private, no-store" };
export function manualRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (["PGRST202", "42P01", "42703", "PGRST204"].includes(error.code ?? "")) throw new SupplierAuditError("Gestión manual pendiente de activación del contrato de base de datos. No se guardó ni publicó información.", 503);
  if (/MANUAL_CONFLICT|MANUAL_REPLAY_STALE/.test(error.message ?? "")) throw new SupplierAuditError("El expediente cambió. Consulta su estado antes de reintentar; no se sobrescribió la captura.", 409);
  const messages: Record<string, string> = {
    MANUAL_REQUEST_REUSED: "La solicitud ya fue usada con otro contenido. Consulta el expediente.",
    MANUAL_HISTORICAL_DATE: "La fecha vinculada a una evaluación histórica se conserva.",
    MANUAL_HISTORICAL_SCORE: "La calificación histórica verificada se conserva sin recálculo.",
    MANUAL_HISTORICAL_METHOD: "La metodología de la evaluación histórica se conserva.",
    MANUAL_EXISTING_ASSESSMENT: "Existe una evaluación histórica; no se puede sustituir desde la captura manual.",
    MANUAL_DOCUMENT_SCOPE: "El documento no pertenece a este expediente o ya no está disponible.",
    MANUAL_ACTION_PRESERVATION: "Conserva todas las acciones guardadas y su historial.",
    MANUAL_ACTUAL_DATE_FUTURE: "La fecha real de auditoría o conclusión no puede estar en el futuro.",
    MANUAL_PORTAL_ACCESS_DENIED: "El portal requiere una cuenta activa y autorizada para el proveedor completo; no se amplía el acceso de sucursal.",
    MANUAL_PORTAL_DOCUMENT_DENIED: "Documento no disponible para este proveedor.",
  };
  const key = Object.keys(messages).find(k => error.message?.includes(k));
  if (key) throw new SupplierAuditError(messages[key], error.code === "42501" ? 403 : /HISTORICAL|EXISTING|PRESERVATION|REQUEST_REUSED/.test(key) ? 409 : 400);
  auditRpcError(error);
}
export async function manualContext(eventId: string, manage = false) {
  if (!uuid(eventId)) throw new SupplierAuditError("Expediente no válido.");
  eventId = eventId.toLowerCase();
  const context = await auditContext(manage ? "manage" : "view");
  const event = await auditEvent(context, eventId);
  if (manage) { assertAuditWritable(event); if (event.state === "cancelled") throw new SupplierAuditError("La auditoría está cancelada.", 409); }
  return { context, event };
}
export async function manualFiles(context: AuditContext, eventId: string) {
  const result = await context.admin.from("file_objects").select("id,resource_id,resource_type,original_name,version,is_current,created_at,size_bytes").eq("workspace_id", context.organizationId).eq("resource_id", eventId).in("resource_type", ["supplier_audit_report", "supplier_audit_action_plan"]).is("deleted_at", null);
  auditRpcError(result.error); return (result.data ?? []) as SupplierAuditFile[];
}
export async function readManual(eventId: string) {
  const { context, event } = await manualContext(eventId);
  const result = await context.supabase.rpc("iq_supplier_audit_manual_read", { p_event: event.id }); manualRpcError(result.error);
  const data = result.data as ManualAuditSnapshot | null;
  if (!data || data.version !== 1 || data.eventId !== event.id || data.supplierId !== event.supplier_id || data.revision !== event.revision) throw new SupplierAuditError("No se pudo verificar la revisión de la captura manual. Actualiza el expediente.", 409);
  return { ...data, record: parseManualRecord(data.record) };
}
export async function saveManual(eventId: string, value: unknown) {
  const { context, event } = await manualContext(eventId, true);
  let command;
  try { command = manualCommand(value); } catch (error) { throw new SupplierAuditError((error as Error).message); }
  if (command.revision !== event.revision) throw new SupplierAuditError("El expediente cambió. Actualiza antes de guardar.", 409);
  if (command.record.portalVisible && !event.supplier_id) throw new SupplierAuditError("El proveedor no está conciliado. Conserva la auditoría internamente.", 409);
  if (event.source_sha256 && event.actual_date && command.record.auditDate !== event.actual_date) throw new SupplierAuditError("Conserva la fecha original de la auditoría histórica.", 409);
  const today = new Date().toISOString().slice(0, 10);
  if (command.record.auditDate && command.record.auditDate > today || command.record.actions.some(a => a.completedDate && a.completedDate > today)) throw new SupplierAuditError("Las fechas reales no pueden estar en el futuro.");
  // The versioned read is a capability check BEFORE any write RPC. No legacy fallback.
  const capability = await context.supabase.rpc("iq_supplier_audit_manual_read", { p_event: event.id }); manualRpcError(capability.error);
  if (capability.data?.version !== 1 || capability.data.eventId !== event.id || capability.data.revision !== event.revision) throw new SupplierAuditError("Gestión manual no disponible para esta revisión.", 503);
  const previous = parseManualRecord(capability.data.record);
  if (previous.actions.some(a => !command.record.actions.some(next => next.id === a.id))) throw new SupplierAuditError("Las acciones guardadas deben conservarse con su historial.", 409);
  if (previous.score && (JSON.stringify(command.record.score) !== JSON.stringify(previous.score) || command.record.methodology !== previous.methodology)) throw new SupplierAuditError("La calificación histórica verificada y su metodología se conservan sin sobrescritura.", 409);
  const assessment = await context.admin.from("supplier_assessments").select("id").eq("audit_event_id", event.id).maybeSingle(); auditRpcError(assessment.error);
  if (assessment.data && command.record.auditDate !== event.actual_date) throw new SupplierAuditError("Conserva la fecha vinculada a la evaluación histórica.", 409);
  if (assessment.data && previous.methodology && command.record.methodology !== previous.methodology) throw new SupplierAuditError("Conserva la metodología de la evaluación histórica.", 409);
  if (assessment.data && command.record.score) throw new SupplierAuditError("Existe una evaluación histórica. No se permite sustituirla con otra calificación manual.", 409);
  try { checkManualReferences(command.record, await manualFiles(context, event.id)); } catch (error) { throw new SupplierAuditError((error as Error).message); }
  const result = await context.supabase.rpc("iq_supplier_audit_manual_save", { p_event: event.id, p_expected_revision: command.revision, p_request_id: command.requestId, p_record: command.record, p_reason: command.reason });
  manualRpcError(result.error);
  if (result.data?.eventId !== event.id || result.data.revision !== event.revision + 1 || result.data.requestId !== command.requestId) throw new SupplierAuditError("Confirmación no verificable. Consulta el expediente antes de reintentar.", 503);
  return { saved: true, eventId: event.id, revision: result.data.revision };
}
export async function supplierAuditPortalContext() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new SupplierAuditError("Sesión no válida.", 401);
  if (isDemoSession(session) || session.userType !== "Proveedor" || session.externalParty?.kind !== "supplier" || !uuid(session.externalParty.companyId)) throw new SupplierAuditError("Consulta disponible únicamente para el proveedor autorizado.", 403);
  return { session, supplierId: session.externalParty.companyId, supabase: await createClient() };
}
export async function readSupplierAuditPortal() {
  const context = await supplierAuditPortalContext();
  // Supplier/org/site come from the active DB profile; never from query parameters.
  const result = await context.supabase.rpc("iq_supplier_audit_portal_list"); manualRpcError(result.error);
  if (result.data?.version !== 1 || !Array.isArray(result.data.audits)) throw new SupplierAuditError("Consulta de auditorías no disponible.", 503);
  const audits = result.data.audits as PortalAudit[];
  if (audits.some(a => a.supplierId !== context.supplierId || !uuid(a.eventId) || a.files.some(f => f.resource_id !== a.eventId))) throw new SupplierAuditError("No se pudo verificar el alcance del portal.", 403);
  // Explicit projection prevents source_payload, internal notes and audit logs leaking.
  return { audits: audits.map(a => ({ eventId: a.eventId, supplierId: a.supplierId, auditDate: a.auditDate, classification: a.classification, methodology: a.methodology, score: a.score, actions: a.actions.map(x => ({ id: x.id, description: x.description, responsibleName: x.responsibleName, commitmentDate: x.commitmentDate, status: x.status, completedDate: x.completedDate, evidenceFileIds: x.evidenceFileIds })), files: a.files.map(f => ({ id: f.id, resource_id: f.resource_id, resource_type: f.resource_type, original_name: f.original_name, version: f.version, is_current: f.is_current, created_at: f.created_at, size_bytes: f.size_bytes })) })) };
}
export async function supplierAuditPortalFile(eventId: string, fileId: string, download: boolean) {
  if (!uuid(eventId) || !uuid(fileId)) throw new SupplierAuditError("Documento no disponible.", 404);
  eventId = eventId.toLowerCase(); fileId = fileId.toLowerCase();
  const context = await supplierAuditPortalContext();
  const result = await context.supabase.rpc("iq_supplier_audit_portal_file", { p_event: eventId, p_file: fileId }); manualRpcError(result.error);
  const f = result.data;
  if (!f || f.eventId !== eventId || f.id !== fileId || f.supplierId !== context.supplierId || !uuid(f.organizationId) || f.bucket !== "integraq-private" || typeof f.path !== "string" || !f.path.includes(`/supplier-audits/${eventId}/`) || !f.authorized) throw new SupplierAuditError("Documento no disponible para este proveedor.", 404);
  const signed = await createAdminClient().storage.from("integraq-private").createSignedUrl(f.path, 60, download ? { download: f.name } : undefined);
  if (signed.error || !signed.data) throw new SupplierAuditError("El documento privado no está disponible.", 503);
  return { signedUrl: signed.data.signedUrl, expiresIn: 60 };
}
