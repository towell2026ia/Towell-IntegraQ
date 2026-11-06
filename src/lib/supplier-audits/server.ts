import "server-only";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoSession } from "@/lib/session-data";
import { canPerformModuleAction } from "@/lib/module-permissions";
import type { AuditSettings, AuditSupplier, AuditWorkspace, SupplierAudit, SupplierAuditFile, AuditResult } from "./model";

export class SupplierAuditError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function auditRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (["PGRST202", "42P01", "42703", "PGRST204"].includes(error.code ?? "")) throw new SupplierAuditError("Calendario pendiente de activación: falta aplicar la migración específica autorizada. No se modificó ningún registro.", 503);
  const messages: Record<string, string> = {
    AUDIT_CONFLICT: "El expediente cambió. Actualiza los datos antes de guardar; tu captura permanece abierta.",
    AUDIT_INSPECTOR_REQUIRED: "Sólo el inspector asignado y con permiso vigente puede gestionar la agenda.",
    AUDIT_SUPPLIER_SCOPE_UNVERIFIED: "El alcance del proveedor no está verificado. Un administrador debe confirmarlo en Configuración de auditorías.",
    AUDIT_REASON_REQUIRED: "Indica un motivo de al menos cinco caracteres.",
    AUDIT_PDF_REQUIRED: "Selecciona el informe PDF vigente del mismo expediente.",
    AUDIT_SCORES_INVALID: "Captura todos los rubros F-CO-05 de 0 a 100.",
    AUDIT_ACTUAL_DATE_INVALID: "Comprueba la fecha real de auditoría; no se modifican las fechas históricas verificadas.",
    AUDIT_ACTUAL_DATE_AND_REPORT_REQUIRED: "Para marcar realizada se necesitan fecha real e informe PDF verificable.",
    AUDIT_INSPECTOR_PERMISSION_REQUIRED: "La cuenta asignada necesita permiso Proveedores → Editar vigente.",
    AUDIT_CANCELLED: "La auditoría está cancelada. Reprogámala con motivo antes de adjuntar resultados.",
  };
  const key = Object.keys(messages).find(k => error.message?.includes(k));
  throw new SupplierAuditError(key ? messages[key] : "La operación no se completó. Verifica permisos, estado, fechas y relaciones del expediente.", error.code === "42501" ? 403 : error.message?.includes("CONFLICT") ? 409 : 400);
}
export async function auditContext(mode: "view" | "manage" | "admin" = "view") {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new SupplierAuditError("Sesión no válida.", 401);
  if (isDemoSession(session) || !["Administrador", "Usuario interno"].includes(session.userType) || !canPerformModuleAction(session, "suppliers", "view")) throw new SupplierAuditError("No tienes acceso a las auditorías internas de proveedores.", 403);
  const supabase = await createClient();
  const result = await supabase.rpc("iq_supplier_audit_context");
  auditRpcError(result.error);
  const permissions = result.data as { organizationId: string; canManage: boolean; administrator: boolean } | null;
  if (!permissions?.organizationId || mode === "manage" && !permissions.canManage || mode === "admin" && !permissions.administrator) throw new SupplierAuditError(mode === "manage" ? "Sólo el inspector asignado puede gestionar auditorías." : "Operación no autorizada.", 403);
  return { ...permissions!, session, supabase, admin: createAdminClient() };
}
export type AuditContext = Awaited<ReturnType<typeof auditContext>>;
export async function auditPages<T extends { id: string }>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null; count: number | null }>) {
  const records: T[] = []; let expected: number | null = null;
  do {
    const result = await page(records.length, records.length + 499); auditRpcError(result.error);
    if (result.count === null || expected !== null && result.count !== expected) throw new SupplierAuditError("El catálogo cambió durante la consulta. Reintenta.", 409);
    expected = result.count;
    const data = (result.data ?? []) as T[];
    if (!data.length && records.length < expected || records.length + data.length > expected) throw new SupplierAuditError("La consulta está incompleta. Reintenta.", 503);
    records.push(...data);
    if (new Set(records.map(r => r.id)).size !== records.length) throw new SupplierAuditError("La paginación contiene registros repetidos. Reintenta.", 503);
  } while (records.length < expected);
  return records;
}
export async function auditSettings(context: AuditContext) {
  const result = await context.admin.from("workspace_data").select("payload,revision").eq("workspace_id", context.organizationId).eq("workspace_mode", "production").eq("area", "supplierAuditSettings").is("deleted_at", null).maybeSingle();
  auditRpcError(result.error);
  return { settings: { inspectorIds: [], legacySupplierIds: [], ...result.data?.payload } as AuditSettings, settingsRevision: result.data?.revision ?? 0 };
}
export async function auditSuppliers(context: AuditContext, settings: AuditSettings, includeCandidates = false) {
  const owner = await context.admin.from("organizations").select("id").eq("kind", "internal").eq("active", true);
  auditRpcError(owner.error);
  const legacyCandidates = includeCandidates && context.administrator && owner.data?.length === 1 && owner.data[0].id === context.organizationId;
  const suppliers = await auditPages<AuditSupplier>((from, to) => context.admin.from("organizations").select("id,code,name,active,owning_organization_id,contact_name,contact_email,metadata,updated_at", { count: "exact" }).eq("kind", "supplier").order("id").range(from, to));
  return suppliers.filter(s => s.owning_organization_id === context.organizationId || s.owning_organization_id === null && (legacyCandidates || settings.legacySupplierIds.includes(s.id)))
    .map(s => ({ ...s, metadata: { supplierQualityContacts: s.metadata?.supplierQualityContacts ?? null } }));
}
export async function auditEvent(context: AuditContext, id: string) {
  const result = await context.admin.from("supplier_audit_events").select("*").eq("id", id).eq("organization_id", context.organizationId).maybeSingle();
  auditRpcError(result.error); if (!result.data) throw new SupplierAuditError("Expediente no disponible en tu organización.", 404);
  return result.data as SupplierAudit;
}
export async function loadAuditWorkspace(context: AuditContext): Promise<AuditWorkspace> {
  const settings = await auditSettings(context);
  const events = await auditPages<SupplierAudit>((from, to) => context.admin.from("supplier_audit_events").select("*", { count: "exact" }).eq("organization_id", context.organizationId).order("id").range(from, to));
  const ids = events.map(e => e.id), results: AuditResult[] = [], files: SupplierAuditFile[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    results.push(...await auditPages<AuditResult>((from, to) => context.admin.from("supplier_assessments").select("id,audit_event_id,assessment_date,evaluator_name,score,classification,observations,questionnaire,rubric_scores,findings,audit_report_file_id,action_plan_file_id", { count: "exact" }).in("audit_event_id", batch).order("id").range(from, to)));
    files.push(...await auditPages<SupplierAuditFile>((from, to) => context.admin.from("file_objects").select("id,resource_id,resource_type,original_name,version,is_current,created_at,size_bytes", { count: "exact" }).in("resource_type", ["supplier_audit_report", "supplier_audit_action_plan"]).eq("workspace_id", context.organizationId).in("resource_id", batch).is("deleted_at", null).order("id").range(from, to)));
  }
  const history = await auditPages<AuditWorkspace["history"][number]>((from, to) => context.admin.from("audit_log").select("id,resource_id,action,created_at,reason,actor_id,user_name_snapshot", { count: "exact" }).eq("organization_id", context.organizationId).eq("resource_type", "supplier_audit_event").order("id").range(from, to));
  const actors = context.administrator ? await context.admin.from("profiles").select("id,full_name").eq("organization_id", context.organizationId).eq("status", "active").in("user_type", ["administrator", "internal"]).eq("workspace_mode", "production").order("full_name") : { data: [], error: null };
  auditRpcError(actors.error);
  return { events, results, files, suppliers: await auditSuppliers(context, settings.settings, true), ...settings, canManage: context.canManage, administrator: context.administrator, actors: actors.data ?? [], history };
}
export function auditFailure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "La operación de auditoría no se completó." }, { status: error instanceof SupplierAuditError ? error.status : 500 });
}
