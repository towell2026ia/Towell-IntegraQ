import "server-only";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { isDemoSession } from "@/lib/session-data";
import { missingResponseRequirements, type ResponseContent } from "./response";
import { defaultAlertRules, type MatrixReport, type OriginalFile, type RncpSettings } from "./model";

export class RncpError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function rncpContext(action: "view" | "update" | "admin" = "view", allowSupplier = false) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new RncpError("Sesión no válida.", 401);
  const supabase = await createClient();
  const live = await supabase.from("profiles").select("id,organization_id,user_type,status,external_party_id,workspace_mode").eq("id", session.authUserId).maybeSingle();
  if (live.error || !live.data || live.data.status !== "active" || isDemoSession(session) || live.data.workspace_mode === "demo") throw new RncpError("Acceso RNCP no autorizado.", 403);
  const profile = live.data as { id: string; organization_id: string | null; user_type: string; external_party_id: string | null };
  const supplier = profile.user_type === "supplier";
  if (supplier ? !allowSupplier || action === "admin" : !["administrator", "internal"].includes(profile.user_type) || !profile.organization_id || !canPerformModuleAction(session, "suppliers", action === "view" ? "view" : "update")) throw new RncpError("No tienes permiso para consultar o modificar RNCP.", 403);
  if (action === "admin" && profile.user_type !== "administrator") throw new RncpError("Operación exclusiva de administradores activos.", 403);
  const admin = createAdminClient();
  const owner = await admin.from("organizations").select("kind,active").eq("id", supplier ? profile.external_party_id : profile.organization_id).maybeSingle();
  if (owner.error || !owner.data?.active || owner.data.kind !== (supplier ? "supplier" : "internal")) throw new RncpError("Organización no autorizada o inactiva.", 403);
  if (!supplier) {
    const scope = await supabase.rpc("iq_rncp_actor_org", { p_admin: action === "admin" });
    if (scope.error) throw new RncpError(scope.error.code === "PGRST202" ? "Activación RNCP pendiente: falta la migración específica revisada." : "Permisos RNCP no autorizados.", scope.error.code === "PGRST202" ? 503 : 403);
    if (scope.data !== profile.organization_id) throw new RncpError("La organización no coincide con la sesión.", 403);
  }
  return { session, profile, supabase, admin, supplier, organizationId: profile.organization_id! };
}
export type RncpContext = Awaited<ReturnType<typeof rncpContext>>;

export async function paginatedRows<T extends { id: string }>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; count: number | null }>) {
  const rows: T[] = []; let expected: number | null = null;
  do {
    const result = await page(rows.length, rows.length + 499);
    if (result.error) throw new RncpError(result.error.code === "42703" || result.error.code === "PGRST204" ? "La migración específica RNCP todavía no está aplicada; el catálogo existente permanece intacto." : "No fue posible consultar el catálogo RNCP completo. Reintenta.", 503);
    if (result.count === null || expected !== null && expected !== result.count) throw new RncpError("El catálogo cambió durante la consulta. Reintenta.", 409);
    expected = result.count;
    const data = (result.data ?? []) as T[];
    if (data.length > 500 || rows.length + data.length > expected) throw new RncpError("La consulta RNCP devolvió un conteo inconsistente. Reintenta.", 409);
    if (!data.length && rows.length < expected) throw new RncpError("La consulta RNCP quedó incompleta. Reintenta.", 503);
    rows.push(...data);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new RncpError("La paginación RNCP contiene registros repetidos. Reintenta.", 409);
  } while (rows.length < expected);
  return rows;
}
export interface ReportRow {
  id: string; folio: string; organization_id: string; supplier_id: string | null; report_date: string | null;
  material_or_service: string | null; description: string | null; finding_type: string | null;
  source_kind: MatrixReport["origin"] | null; source_row: number | null; source_sha256: string | null;
  historical_status: string | null; historical_supplier_name: string | null; historical_supplier_code: string | null;
  action_type: string | null; notified_at: string | null; response_deadline: string | null; first_valid_progress_at: string | null;
  complete_submitted_at: string | null; validated_at: string | null; closed_at: string | null; validation_outcome: MatrixReport["validationOutcome"];
  response_requirements: { containment?: boolean; documents?: string[] } | null; deleted_at: string | null;
}
interface ActionRow { id: string; report_id: string; root_cause: string | null; action_plan: string | null; containment: string | null; commitments: string | null; document_types: Record<string, string> | null; status: string; updated_at: string; }
interface FileRow { id: string; original_name: string; sha256: string | null; size_bytes: number | null; created_at: string; version: number; resource_id: string | null; resource_type: string; deleted_at: string | null; }
export async function loadMatrixReports(context: RncpContext, requestedId?: string) {
  if (context.supplier && !requestedId) throw new RncpError("El portal sólo puede consultar un expediente autorizado.", 403);
  let allowedId: string | undefined;
  if (context.supplier) {
    const result = await context.supabase.from("supplier_rncp_reports").select("id,supplier_id,organization_id,portal_visible,deleted_at").eq("id", requestedId!).maybeSingle();
    if (result.error || !result.data || result.data.supplier_id !== context.profile.external_party_id || !result.data.portal_visible || result.data.deleted_at) throw new RncpError("Expediente no autorizado.", 403);
    allowedId = result.data.id;
  }
  const rows = await paginatedRows<ReportRow>((from, to) => {
    let query = context.admin.from("supplier_rncp_reports").select("*", { count: "exact" }).order("id");
    query = context.supplier ? query.eq("id", allowedId!) : query.eq("organization_id", context.organizationId);
    if (context.profile.user_type !== "administrator") query = query.is("deleted_at", null);
    if (requestedId) query = query.eq("id", requestedId);
    return query.range(from, to);
  });
  if (requestedId && rows.length !== 1) throw new RncpError("RNCP no localizado en tu organización.", 404);
  const ids = rows.map(row => row.id), actions: ActionRow[] = [], files: FileRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    actions.push(...await paginatedRows<ActionRow>((from, to) => context.admin.from("supplier_rncp_actions").select("id,report_id,root_cause,action_plan,containment,commitments,document_types,status,updated_at", { count: "exact" }).in("report_id", batch).order("id").range(from, to)));
    files.push(...await paginatedRows<FileRow>((from, to) => context.admin.from("file_objects").select("id,original_name,sha256,size_bytes,created_at,version,resource_id,resource_type,deleted_at", { count: "exact" }).eq("resource_type", "supplier_rncp_original").in("resource_id", batch).is("deleted_at", null).order("id").range(from, to)));
  }
  const evidenceFiles: FileRow[] = [];
  for (let offset = 0; offset < actions.length; offset += 100) evidenceFiles.push(...await paginatedRows<FileRow>((from, to) => context.admin.from("file_objects").select("id,original_name,sha256,size_bytes,created_at,version,resource_id,resource_type,deleted_at", { count: "exact" }).eq("resource_type", "supplier_rncp_action_evidence").in("resource_id", actions.slice(offset, offset + 100).map(a => a.id)).is("deleted_at", null).order("id").range(from, to)));
  const supplierIds = [...new Set(rows.flatMap(r => r.supplier_id ? [r.supplier_id] : []))];
  const names = new Map<string, { code: string; name: string }>();
  for (let offset = 0; offset < supplierIds.length; offset += 100) {
    const result = await context.admin.from("organizations").select("id,code,name").in("id", supplierIds.slice(offset, offset + 100)).eq("kind", "supplier");
    if (result.error) throw new RncpError("No se pudo consultar la identidad de los proveedores.", 503);
    for (const row of result.data ?? []) names.set(row.id, row);
  }
  const reports: MatrixReport[] = rows.map(row => {
    const related = actions.filter(a => a.report_id === row.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const response = related.find(a => ["submitted", "accepted"].includes(a.status)) ?? related[0];
    const content: ResponseContent = { reportId: row.id, actionId: response?.id ?? "", rootCause: response?.root_cause ?? "", actionPlan: response?.action_plan ?? "", containment: response?.containment ?? "", commitments: response?.commitments ?? "", documentTypes: response?.document_types ?? {},
      evidence: evidenceFiles.filter(f => f.resource_id === response?.id).map(f => ({ fileId: f.id, reportId: row.id, actionId: f.resource_id!, sizeBytes: f.size_bytes ?? 0, sha256: f.sha256 ?? "", deleted: Boolean(f.deleted_at) })) };
    const missing = missingResponseRequirements(content, { containment: row.response_requirements?.containment ?? false, documents: row.response_requirements?.documents ?? [] });
    const originalFiles: OriginalFile[] = files.filter(f => f.resource_id === row.id).sort((a, b) => b.version - a.version).map(f => ({ id: f.id, fileName: f.original_name, sha256: f.sha256 ?? "", sizeBytes: f.size_bytes ?? 0, uploadedAt: f.created_at, version: f.version }));
    return { id: row.id, folio: row.folio, organizationId: row.organization_id, supplierId: row.supplier_id,
      supplierName: names.get(row.supplier_id ?? "")?.name ?? row.historical_supplier_name ?? "Proveedor pendiente de conciliación",
      supplierCode: names.get(row.supplier_id ?? "")?.code ?? row.historical_supplier_code ?? "",
      reportDate: row.report_date, material: row.material_or_service ?? "", defect: row.description ?? row.finding_type ?? "", actionType: row.action_type ?? "",
      origin: row.source_kind ?? "legacy", historicalStatus: row.historical_status, sourceRow: row.source_row ?? undefined, sourceSha256: row.source_sha256 ?? undefined,
      sourceSupplierName: row.historical_supplier_name ?? undefined, sourceSupplierCode: row.historical_supplier_code ?? undefined,
      notifiedAt: row.notified_at, responseDeadline: row.response_deadline, firstValidProgressAt: row.first_valid_progress_at,
      completeSubmittedAt: row.complete_submitted_at, validatedAt: row.validated_at, closedAt: row.closed_at,
      validationOutcome: row.validation_outcome, requirementsComplete: missing.length === 0, missingRequirements: missing,
      deletedAt: row.deleted_at, originalFiles };
  });
  // Use the database's exact linked-file and physical-object checks, not a
  // visual approximation of completion that might accept an orphan upload.
  for (let offset = 0; offset < ids.length; offset += 500) {
    const result = await context.supabase.rpc("iq_rncp_requirements_summary", { p_report_ids: ids.slice(offset, offset + 500) });
    if (result.error) throw new RncpError("No se pudieron comprobar los requisitos documentales.", 503);
    for (const report of reports.slice(offset, offset + 500)) {
      const missing = result.data?.[report.id];
      if (!Array.isArray(missing) || missing.some(item => typeof item !== "string")) throw new RncpError("La verificación documental quedó incompleta.", 503);
      report.missingRequirements = missing; report.requirementsComplete = missing.length === 0;
    }
  }
  return reports;
}
export async function readRncpSettings(context: RncpContext) {
  if (context.supplier) throw new RncpError("Acceso no autorizado.", 403);
  const result = await context.admin.from("workspace_data").select("area,payload,revision").eq("workspace_id", context.organizationId).eq("workspace_mode", "production").in("area", ["rncpFollowupSettings", "rncpAlertReviews"]).is("deleted_at", null);
  if (result.error) throw new RncpError("No se pudo leer la configuración RNCP.", 503);
  const settingsRow = result.data?.find(r => r.area === "rncpFollowupSettings");
  const reviewsRow = result.data?.find(r => r.area === "rncpAlertReviews");
  const defaults: RncpSettings = { alertRules: defaultAlertRules, inspectorIds: [], emailEnabled: false, semanticAiApproved: false, followupEnabled: false };
  return { settings: { ...defaults, ...(settingsRow?.payload ?? {}), emailEnabled: false } as RncpSettings,
    settingsRevision: settingsRow?.revision ?? 0, reviews: reviewsRow?.payload ?? {}, reviewsRevision: reviewsRow?.revision ?? 0 };
}
