import "server-only";
import { getVerifiedSessionContext } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/lib/access-policy";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { isDemoSession } from "@/lib/session-data";
import { defaultAlertRules, type MatrixReport, type OriginalFile, type RncpSettings } from "./model";

export class RncpError extends Error { constructor(message: string, public status = 400) { super(message); } }
function requireReadable(result: { error: { code?: string } | null }) {
  if (!result.error) return;
  if (result.error.code === "42501") throw new RncpError("Acceso RNCP no autorizado.", 403);
  throw new RncpError("No fue posible verificar el acceso a RNCP. Reintenta.", 503);
}
export async function rncpContext(action: "view" | "update" | "config" | "admin" = "view", allowSupplier = false, timing?: (phase: string, ms: number) => void) {
  const verified = await getVerifiedSessionContext(timing).catch(() => {
    throw new RncpError("No fue posible verificar el acceso a RNCP. Reintenta.", 503);
  });
  if (!verified) throw new RncpError("Sesión no válida.", 401);
  if (!verified.session) {
    if (verified.failure === "unavailable") throw new RncpError("No fue posible verificar la sesión. Reintenta.", 503);
    throw new RncpError("Acceso RNCP no autorizado.", 403);
  }
  const { session, supabase, profile } = verified;
  const scopeStart = performance.now();
  if (!profile || profile.status !== "active" || isDemoSession(session) || profile.workspace_mode === "demo") {
    throw new RncpError("Acceso RNCP no autorizado.", 403);
  }
  const supplier = profile.user_type === "supplier";
  if (supplier && !canAccessModule(session,"supplier-portal")) throw new RncpError("Acceso no autorizado.",403);
  if (supplier ? !allowSupplier || action === "admin" : !["administrator", "internal"].includes(profile.user_type) || !profile.organization_id || !canPerformModuleAction(session, "suppliers", action === "view" ? "view" : "update")) throw new RncpError("No tienes permiso para consultar o modificar RNCP.", 403);
  if (action === "admin" && profile.user_type !== "administrator") throw new RncpError("Operación exclusiva de administradores activos.", 403);
  if (action === "config" && profile.user_type !== "administrator" && session.specificPermissions?.["rncp.configurar_modulo"] !== true) throw new RncpError("Configuración no autorizada.",403);
  const admin = createAdminClient();
  const ownerRead = admin.from("organizations").select("kind,active").eq("id", supplier ? profile.external_party_id : profile.organization_id).maybeSingle();
  const [owner, scope] = await Promise.all([ownerRead, supplier ? supabase.rpc("iq_supplier_portal_tenant") : supabase.rpc("iq_rncp_actor_org", { p_admin: action === "admin" })]);
  requireReadable(owner);
  if (!owner.data?.active || owner.data.kind !== (supplier ? "supplier" : "internal")) throw new RncpError("Organización no autorizada o inactiva.", 403);
  {
    if (!scope) throw new RncpError("Permisos RNCP no autorizados.", 403);
    if (scope.error?.code === "PGRST202") throw new RncpError("Activación RNCP pendiente: falta la migración específica revisada.", 503);
    requireReadable(scope);
    if (!scope.data || (!supplier && scope.data !== profile.organization_id)) throw new RncpError("La organización no coincide con la sesión.", 403);
  }
  timing?.("scope", performance.now() - scopeStart);
  return { session, profile, supabase, admin, supplier, organizationId: supplier ? String(scope.data) : profile.organization_id! };
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
// A short page can also mean the REST row cap was reached. Check for one more
// authorized ID using the same predicates before accepting the first snapshot.
export async function reportListRows<T extends { id: string }>(
  first: () => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>,
  nextId: (lastId: string) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>,
  complete: () => Promise<T[]>,
): Promise<T[]> {
  const result = await first();
  requireReadable(result);
  if (!result.data) throw new RncpError("No se pudo consultar la lista de RNCP.", 503);
  const rows = result.data as T[];
  if (!rows.length) return [];
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new RncpError("El catálogo cambió. Reintenta.", 409);
  const tail = await nextId(rows[rows.length - 1].id);
  requireReadable(tail);
  if (!tail.data) throw new RncpError("No se pudo comprobar la lista completa.", 503);
  return tail.data.length ? complete() : rows;
}

export interface ReportRow {
  status?: MatrixReport["legacyStatus"];
  classification?: string | null;
  site_id?: string|null; id: string; folio: string; organization_id: string; supplier_id: string | null; report_date: string | null;
  material_or_service: string | null; description: string | null; finding_type: string | null;
  source_kind: MatrixReport["origin"] | null; source_row: number | null; source_sha256: string | null;
  historical_status: string | null; historical_supplier_name: string | null; historical_supplier_code: string | null;
  action_type: string | null; notified_at: string | null; response_deadline: string | null; first_valid_progress_at: string | null;
  complete_submitted_at: string | null; validated_at: string | null; closed_at: string | null; validation_outcome: MatrixReport["validationOutcome"];
  deleted_at: string | null;
}
interface FileRow { is_current: boolean; resource_key: string | null; id: string; original_name: string; sha256: string | null; size_bytes: number | null; created_at: string; version: number; resource_id: string | null; resource_type: string; deleted_at: string | null; }
// File metadata is private. Both projections use only IDs obtained through report RLS.
async function readOriginals(context: RncpContext, ids: string[], detail: boolean) {
  const counts = new Map<string, number>();
  const versions = new Map<string, OriginalFile[]>();
  async function batch(keys: string[]) {
    const fields = detail ? "id,is_current,resource_key,original_name,sha256,size_bytes,created_at,version,resource_id" : "id,resource_id";
    const files = await paginatedRows<FileRow>((from, to) => context.admin.from("file_objects").select(fields, { count: "exact" })
      .eq("resource_type", "supplier_rncp_original").in("resource_id", keys).is("deleted_at", null).order("id").range(from, to));
    for (const file of files) {
      if (!file.resource_id) continue;
      counts.set(file.resource_id, (counts.get(file.resource_id) ?? 0) + 1);
      if (detail) {
        const group = versions.get(file.resource_id) ?? [];
        group.push({ id: file.id, currentOfficial: file.is_current && file.resource_key?.startsWith("generated:") === true,
          fileName: file.original_name, sha256: file.sha256 ?? "", sizeBytes: file.size_bytes ?? 0, uploadedAt: file.created_at, version: file.version });
        versions.set(file.resource_id, group);
      }
    }
  }
  // Keep URLs bounded and allow at most three batches in flight.
  for (let i = 0; i < ids.length; i += 300) {
    const tasks = [];
    for (let j = i; j < Math.min(i + 300, ids.length); j += 100) tasks.push(batch(ids.slice(j, j + 100)));
    await Promise.all(tasks);
  }
  for (const files of versions.values()) files.sort((a, b) => b.version - a.version);
  return { counts, versions };
}

async function readSupplierNames(context: RncpContext, rows: ReportRow[]) {
  const supplierIds = [...new Set(rows.flatMap(r => r.supplier_id ? [r.supplier_id] : []))];
  const names = new Map<string, { code: string; name: string }>();
  for (let offset = 0; offset < supplierIds.length; offset += 100) {
    const result = await context.admin.from("organizations").select("id,code,name").in("id", supplierIds.slice(offset, offset + 100)).eq("kind", "supplier");
    if (result.error) throw new RncpError("No se pudo consultar la identidad de los proveedores.", 503);
    for (const row of result.data ?? []) names.set(row.id, row);
  }
  return names;
}

async function readRequirements(context: RncpContext, rows: ReportRow[], detail: boolean) {
  // Only a notified, submitted response can change the list's calculated lifecycle.
  // The open dossier always receives the full authoritative checklist.
  const ids = rows.filter(row => detail || (row.source_kind !== "historical" && row.notified_at
    && row.complete_submitted_at && row.validation_outcome !== "rejected")).map(row => row.id);
  const requirements = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const result = await context.supabase.rpc("iq_rncp_requirements_summary", { p_report_ids: batch });
    if (result.error) throw new RncpError("No se pudieron comprobar los requisitos documentales.", 503);
    for (const id of batch) {
      const missing = result.data?.[id];
      if (!Array.isArray(missing) || missing.some(item => typeof item !== "string")) throw new RncpError("La verificación documental quedó incompleta.", 503);
      requirements.set(id, missing);
    }
  }
  return requirements;
}

export async function loadMatrixOriginalCounts(context: RncpContext, ids?: string[]) {
  if (context.supplier) throw new RncpError("Acceso no autorizado.", 403);
  const rows = await paginatedRows<{ id: string }>((from, to) => {
    let query = context.supabase.from("supplier_rncp_reports").select("id", { count: "exact" }).eq("organization_id", context.organizationId);
    if (ids) query = query.in("id", ids);
    if (context.profile.user_type !== "administrator") query = query.is("deleted_at", null);
    return query.order("id").range(from, to);
  });
  const { counts } = await readOriginals(context, rows.map(row => row.id), false);
  return Object.fromEntries(rows.map(row => [row.id, counts.get(row.id) ?? 0]));
}

const reportFields = "site_id,portal_visible,id,folio,organization_id,supplier_id,report_date,material_or_service,description,finding_type,source_kind,source_row,source_sha256,historical_status,historical_supplier_name,historical_supplier_code,action_type,notified_at,response_deadline,first_valid_progress_at,complete_submitted_at,validated_at,closed_at,validation_outcome,deleted_at,status,classification";
function reportQuery<T extends string>(context: RncpContext, selection: T, withCount = false) {
  let query = context.supabase.from("supplier_rncp_reports").select(selection, withCount ? { count: "exact" } : {});
  if (context.supplier) {
    query = query.eq("organization_id",context.organizationId).eq("supplier_id", context.profile.external_party_id!).eq("portal_visible", true);
      if(context.profile.external_site_id)query=query.eq("site_id",context.profile.external_site_id);
  } else {
    query = query.eq("organization_id", context.organizationId);
  }
  if (context.profile.user_type !== "administrator") query = query.is("deleted_at", null);
  return query;
}

export async function readAuthorizedReport(context: RncpContext, id: string) {
  const result = await reportQuery(context, reportFields).eq("id", id).maybeSingle();
  requireReadable(result);
  const row = result.data;
  if (context.supplier && (!row || !context.profile.external_party_id || row.supplier_id !== context.profile.external_party_id || !row.portal_visible || row.deleted_at || (context.profile.external_site_id && context.profile.external_site_id!==row.site_id))) {
    throw new RncpError("Expediente no autorizado.", 403);
  }
  if (!row) throw new RncpError("RNCP no localizado en tu organización.", 404);
  if (row.id !== id || (!context.supplier && row.organization_id !== context.organizationId) ||
      (row.deleted_at && context.profile.user_type !== "administrator")) throw new RncpError("Expediente no autorizado.", 403);
  return row;
}

export async function loadMatrixReports(context: RncpContext, requestedId?: string, deferOriginalCounts = false, timing?: (phase: string, ms: number) => void, supplierId?: string) {
  if (!context.supplier && (context.session?.specificPermissions?.["rncp.consultar_rncp"] === false || requestedId && context.session?.specificPermissions?.["rncp.consultar_expedientes"] === false)) throw new RncpError("Consulta del expediente no autorizada.",403);
  if (context.supplier && !requestedId) throw new RncpError("El portal sólo puede consultar un expediente autorizado.", 403);
  const listStart = performance.now();
  let rows: ReportRow[];
  if (requestedId) {
    rows = [await readAuthorizedReport(context, requestedId)];
  } else {
    const scoped = <T extends string>(selection:T, count=false) => {
      const query=reportQuery(context, selection, count);
      return supplierId ? query.eq("supplier_id",supplierId).is("deleted_at",null) : query;
    };
    rows = await reportListRows<ReportRow>(
      () => scoped(reportFields).order("id").limit(500),
      last => scoped("id").gt("id", last).order("id").limit(1),
      () => paginatedRows<ReportRow>((from, to) => scoped(reportFields, true).order("id").range(from, to)),
    );
  }
  timing?.("reports", performance.now() - listStart);
  if (!requestedId && rows.some(row => row.organization_id !== context.organizationId || (supplierId && row.supplier_id!==supplierId))) {
    throw new RncpError("Expediente no autorizado.", 403);
  }
  const detail = Boolean(requestedId);
  const relatedStart = performance.now();
  const [originals, names, requirements] = await Promise.all([
    detail || !deferOriginalCounts ? readOriginals(context, rows.map(row => row.id), detail) : null,
    readSupplierNames(context, rows),
    readRequirements(context, rows, detail).then(result => { timing?.("requirements", performance.now() - relatedStart); return result; }),
  ]);
  timing?.("related", performance.now() - relatedStart);
  return rows.map((row): MatrixReport => {
    const missing = requirements.get(row.id);
    return { id: row.id, folio: row.folio, organizationId: row.organization_id, supplierId: row.supplier_id,
      supplierName: names.get(row.supplier_id ?? "")?.name ?? row.historical_supplier_name ?? "Proveedor pendiente de conciliación",
      supplierCode: names.get(row.supplier_id ?? "")?.code ?? row.historical_supplier_code ?? "",
      reportDate: row.report_date, material: row.classification ?? (row.source_kind === "historical" ? row.material_or_service ?? "" : "Sin clasificación"), defect: row.description ?? row.finding_type ?? "", actionType: row.action_type ?? "",
      legacyStatus: row.status, origin: row.source_kind ?? "legacy", historicalStatus: row.historical_status, sourceRow: row.source_row ?? undefined, sourceSha256: row.source_sha256 ?? undefined,
      sourceSupplierName: row.historical_supplier_name ?? undefined, sourceSupplierCode: row.historical_supplier_code ?? undefined,
      notifiedAt: row.notified_at, responseDeadline: row.response_deadline, firstValidProgressAt: row.first_valid_progress_at,
      completeSubmittedAt: row.complete_submitted_at, validatedAt: row.validated_at, closedAt: row.closed_at,
      validationOutcome: row.validation_outcome, requirementsComplete: missing?.length === 0, missingRequirements: missing ?? [],
      deletedAt: row.deleted_at, originalFileCount: originals ? (originals.counts.get(row.id) ?? 0) : undefined, originalFiles: originals?.versions.get(row.id) ?? [] };
  });
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


/** Summaries for authorized parent IDs only. File contents and private notes stay in the detail route. */
export async function portalActionSummaries(
  ctx: RncpContext,
  reportIds: string[],
) {
  type Row = {
    id: string;
    report_id: string;
    description: string;
    responsible_name: string | null;
    due_date: string | null;
    executed_at: string | null;
    status: string;
    evidence: { count: number }[];
  };
  const rows: Row[] = [];
  for (let i = 0; i < reportIds.length; i += 100) {
    const batch = reportIds.slice(i, i + 100);
    rows.push(
      ...await paginatedRows<Row>((from, to) =>
        ctx.supabase.from("supplier_rncp_actions")
          .select(
            "id,report_id,description,responsible_name,due_date,executed_at,status,evidence:supplier_rncp_action_evidence(count)",
            { count: "exact" },
          )
          .in("report_id", batch).order("id").range(from, to)
      ),
    );
  }
  return rows.map((a) => ({
    id: a.id,
    parent: a.report_id,
    description: a.description,
    owner: a.responsible_name,
    due: a.due_date,
    completed: a.executed_at,
    state: a.status,
    files: a.evidence?.[0]?.count ?? null,
  }));
}

/** Call only with audit events already authorized for this request. */
export async function auditEvidenceCounts(
  ctx: RncpContext,
  eventIds: string[],
) {
  const counts = new Map<string, Set<string>>();
  for (let i = 0; i < eventIds.length; i += 100) {
    const ids = eventIds.slice(i, i + 100);
    const files = await paginatedRows<
      { id: string; event_id: string; action_key: string }
    >((from, to) =>
      ctx.admin
        .from("supplier_audit_portal_evidence")
        .select(
          "id:file_id,event_id,action_key,file:file_objects!inner(workspace_id,resource_type,bucket_id,deleted_at)",
          { count: "exact" },
        )
        .in("event_id", ids).eq("file.workspace_id", ctx.organizationId).eq(
          "file.bucket_id",
          "integraq-private",
        )
        .eq("file.resource_type", "supplier_audit_portal_evidence").is(
          "file.deleted_at",
          null,
        )
        .order("file_id").range(from, to)
    );
    for (const f of files) {
      const key = f.event_id + ":" + f.action_key;
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(f.id);
    }
  }
  return counts;
}
