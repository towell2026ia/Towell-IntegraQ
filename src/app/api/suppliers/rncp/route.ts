import { NextResponse } from "next/server";

import type { RncpHistoryEvent, RncpReport, RncpResponseAction, RncpResponseStatus, RncpStatus } from "@/lib/rncp-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  id: string;
  folio: string;
  supplier_id: string | null;
  site_id: string | null;
  report_date: string | null;
  purchase_order: string | null;
  material_or_service: string | null;
  finding_type: string | null;
  rejected_quantity: number | null;
  description: string | null;
  immediate_disposition: string | null;
  response_due_date: string | null;
  responsible_name: string | null;
  status: RncpStatus;
  portal_visible: boolean;
  submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  delete_reason: string | null;
  supplier: { code: string; name: string } | Array<{ code: string; name: string }> | null;
  site: { code: string; name: string } | Array<{ code: string; name: string }> | null;
};

type AuditRow = {
  id: string;
  resource_id: string;
  action: string;
  user_name_snapshot: string | null;
  created_at: string;
  reason: string | null;
};

type ActionRow = {
  id: string;
  report_id: string;
  description: string;
  responsible_name: string | null;
  due_date: string;
  executed_at: string | null;
  supplier_comment: string | null;
  status: RncpResponseStatus;
  validation_comment: string | null;
  validated_at: string | null;
  created_at: string;
};

type EvidenceFileRow = { id: string; original_name: string; mime_type: string | null; size_bytes: number | null; uploaded_by: string; created_at: string };
type EvidenceLinkRow = { action_id: string; file: EvidenceFileRow | EvidenceFileRow[] | null };

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const supabase = await createClient();
  const result = await supabase
    .from("supplier_rncp_reports")
    .select("*,supplier:organizations!supplier_rncp_reports_supplier_id_fkey(code,name),site:external_company_sites!supplier_rncp_reports_site_id_fkey(code,name)")
    .order("report_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (result.error) {
    console.error("No fue posible consultar RNCP.", result.error);
    return NextResponse.json({ error: "No fue posible consultar los RNCP." }, { status: 500 });
  }
  const rows = (result.data ?? []) as unknown as ReportRow[];
  const ids = rows.map((row) => row.id);
  const actionsResult = ids.length
    ? await supabase.from("supplier_rncp_actions").select("id,report_id,description,responsible_name,due_date,executed_at,supplier_comment,status,validation_comment,validated_at,created_at").in("report_id", ids).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (actionsResult.error) return NextResponse.json({ error: "No fue posible consultar las acciones RNCP." }, { status: 500 });
  const actions = (actionsResult.data ?? []) as ActionRow[];
  const actionIds = actions.map((action) => action.id);
  const evidenceResult = actionIds.length
    ? await supabase.from("supplier_rncp_action_evidence").select("action_id,file:file_objects!supplier_rncp_action_evidence_file_id_fkey(id,original_name,mime_type,size_bytes,uploaded_by,created_at)").in("action_id", actionIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (evidenceResult.error) return NextResponse.json({ error: "No fue posible consultar las evidencias RNCP." }, { status: 500 });
  const evidenceLinks = (evidenceResult.data ?? []) as unknown as EvidenceLinkRow[];
  const admin = createAdminClient();
  const historyResult = ids.length
    ? await admin.from("audit_log").select("id,resource_id,action,user_name_snapshot,created_at,reason").eq("resource_type", "supplier_rncp_report").in("resource_id", ids).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (historyResult.error) {
    console.error("No fue posible consultar el historial RNCP.", historyResult.error);
    return NextResponse.json({ error: "No fue posible consultar el historial de los RNCP." }, { status: 500 });
  }
  const audits = (historyResult.data ?? []) as AuditRow[];
  return NextResponse.json({ reports: rows.map((row) => mapReport(
    row,
    audits.filter((audit) => audit.resource_id === row.id),
    actions.filter((action) => action.report_id === row.id).map((action) => mapAction(action, evidenceLinks.filter((link) => link.action_id === action.id))),
  )) });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string") return NextResponse.json({ error: "Solicitud RNCP no válida." }, { status: 400 });
  const supabase = await createClient();
  const result = await supabase.rpc("save_supplier_rncp", {
    requested_report_id: typeof payload.reportId === "string" ? payload.reportId : null,
    requested_action: payload.action,
    requested_payload: payload.values && typeof payload.values === "object" ? payload.values : {},
    requested_reason: typeof payload.reason === "string" ? payload.reason : null,
  });
  if (result.error) return rncpError(result.error.message);
  return NextResponse.json({ report: mutationIdentity(result.data) });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.reportId !== "string" || typeof payload.deleted !== "boolean") {
    return NextResponse.json({ error: "Solicitud RNCP no válida." }, { status: 400 });
  }
  const supabase = await createClient();
  const result = await supabase.rpc("set_supplier_rncp_deleted", {
    requested_report_id: payload.reportId,
    requested_deleted: payload.deleted,
    requested_reason: typeof payload.reason === "string" ? payload.reason : "",
  });
  if (result.error) return rncpError(result.error.message);
  return NextResponse.json({ report: mutationIdentity(result.data) });
}

function mapReport(row: ReportRow, audits: AuditRow[], actions: RncpResponseAction[]): RncpReport {
  const supplier = first(row.supplier);
  const site = first(row.site);
  const late = Boolean(row.response_due_date && row.status !== "closed" && row.status !== "draft" && row.response_due_date < mexicoDate());
  const history: RncpHistoryEvent[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    actorName: audit.user_name_snapshot ?? "Sistema",
    createdAt: audit.created_at,
    reason: audit.reason ?? undefined,
  }));
  if (late && row.response_due_date) {
    history.push({ id: `${row.id}-overdue`, action: "rncp.overdue", actorName: "Sistema", createdAt: `${nextDate(row.response_due_date)}T12:00:00.000Z`, system: true });
    history.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  return {
    id: row.id, folio: row.folio, supplierId: row.supplier_id ?? undefined,
    supplierCode: supplier?.code, supplierName: supplier?.name,
    siteId: row.site_id ?? undefined, siteCode: site?.code, siteName: site?.name,
    reportDate: row.report_date ?? undefined, purchaseOrder: row.purchase_order ?? undefined,
    materialOrService: row.material_or_service ?? undefined, findingType: row.finding_type ?? undefined,
    rejectedQuantity: row.rejected_quantity ?? undefined, description: row.description ?? undefined,
    immediateDisposition: row.immediate_disposition ?? undefined, responseDueDate: row.response_due_date ?? undefined,
    responsibleName: row.responsible_name ?? undefined, status: row.status, late,
    portalVisible: row.portal_visible, submittedAt: row.submitted_at ?? undefined,
    closedAt: row.closed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined, deleteReason: row.delete_reason ?? undefined, history, actions,
  };
}

function mapAction(row: ActionRow, evidenceLinks: EvidenceLinkRow[]): RncpResponseAction {
  return {
    id: row.id, reportId: row.report_id, description: row.description,
    responsibleName: row.responsible_name ?? "Sin responsable", dueDate: row.due_date,
    executedAt: row.executed_at ?? undefined, comment: row.supplier_comment ?? undefined,
    status: row.status, validationComment: row.validation_comment ?? undefined,
    validatedAt: row.validated_at ?? undefined, createdAt: row.created_at,
    evidences: evidenceLinks.flatMap((link) => {
      const file = first(link.file); if (!file) return [];
      return [{ id: file.id, fileName: file.original_name, mimeType: file.mime_type ?? "application/octet-stream", sizeBytes: file.size_bytes ?? 0, uploadedBy: file.uploaded_by, uploadedAt: file.created_at }];
    }),
  };
}

function first<T>(value: T | T[] | null) { return Array.isArray(value) ? value[0] : value; }
function mutationIdentity(value: unknown) {
  const record = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  return { id: String(record?.id ?? ""), folio: String(record?.folio ?? ""), status: String(record?.status ?? "draft") };
}
function mexicoDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function nextDate(value: string) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }

function rncpError(message: string) {
  const errors: Record<string, string> = {
    RNCP_WRITE_FORBIDDEN: "No tienes permiso para modificar RNCP.",
    RNCP_REQUIRED_FIELDS_MISSING: "Completa proveedor, sucursal cuando aplique, fecha, problema, descripción, producto o material, responsable y fecha compromiso.",
    RNCP_SITE_REQUIRED: "Selecciona la sucursal del proveedor.",
    RNCP_SUPPLIER_INVALID: "El proveedor seleccionado no está activo.",
    RNCP_SITE_INVALID: "La sucursal seleccionada no pertenece al proveedor o está inactiva.",
    RNCP_DRAFT_LOCKED: "La RNCP ya fue enviada y no puede volver a borrador.",
    RNCP_ALREADY_SUBMITTED: "La RNCP ya fue enviada.",
    RNCP_TRANSITION_INVALID: "El cambio de estado solicitado no está permitido.",
    RNCP_ADMIN_REASON_REQUIRED: "Indica el motivo de la corrección administrativa.",
    RNCP_DELETE_ADMIN_ONLY: "Sólo un administrador puede eliminar o restaurar RNCP.",
    RNCP_DELETE_REASON_REQUIRED: "El motivo de eliminación o restauración es obligatorio.",
    RNCP_DELETED: "La RNCP está eliminada. Restáurala antes de modificarla.",
    RNCP_NOT_FOUND: "La RNCP ya no está disponible.",
  };
  const key = Object.keys(errors).find((candidate) => message.includes(candidate));
  return NextResponse.json({ error: key ? errors[key] : "No fue posible actualizar la RNCP." }, { status: message.includes("FORBIDDEN") || message.includes("ADMIN_ONLY") ? 403 : 400 });
}
