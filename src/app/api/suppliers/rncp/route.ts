import { requireRncpFlow } from "@/lib/rncp/flow-server";
import { isRncpClassification } from "@/lib/rncp/flow";
import { compareRncpFolios } from "@/lib/rncp/folio";
import { NextResponse } from "next/server";
import { photoFailure, photoRpcError, requirePhotoV2 } from "@/lib/rncp/initial-photo-server";
import { paginatedRows, rncpContext, RncpError } from "@/lib/rncp/server";

import type { RncpHistoryEvent, RncpReport, RncpResponseAction, RncpResponseStatus, RncpStatus } from "@/lib/rncp-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  organization_id: string;
  classification?: string | null;
  first_valid_progress_at?: string | null;
  source_kind?: "native" | "historical" | "legacy" | null;
  historical_status?: string | null;
  notified_at?: string | null;
  response_deadline?: string | null;
  complete_submitted_at?: string | null;
  validated_at?: string | null;
  validation_outcome?: "pending" | "accepted" | "rejected" | null;
  response_requirements?: { containment?: boolean; documents?: string[] } | null;
  id: string;
  folio: string;
  supplier_id: string | null;
  site_id: string | null;
  report_date: string | null;
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
  created_by?: string;
  root_cause?: string | null;
  action_plan?: string | null;
  containment?: string | null;
  commitments?: string | null;
  document_types?: Record<string, string> | null;
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
type EvidenceLinkRow = { id: string; action_id: string; file: EvidenceFileRow | EvidenceFileRow[] | null };

export async function GET(request?: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const supabase = await createClient();
  try {
    const context = await rncpContext("view",true);
    const rows = await paginatedRows<ReportRow>((from,to) => supabase.from("supplier_rncp_reports")
      .select("*,supplier:organizations!supplier_rncp_reports_supplier_id_fkey(code,name),site:external_company_sites!supplier_rncp_reports_site_id_fkey(code,name)", { count: "exact" })
      .eq(context.supplier ? "supplier_id" : "organization_id", context.supplier ? context.profile.external_party_id! : context.organizationId)
      .order("report_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).order("id").range(from,to));
    if (rows.some(row => context.supplier ? row.supplier_id !== context.profile.external_party_id || !row.portal_visible || Boolean(row.deleted_at) : row.organization_id !== context.organizationId)) throw new RncpError("La consulta devolvió expedientes fuera del alcance autorizado.",403);
    const requirements: Record<string,boolean> = {};
    const nativeIds=rows.filter(r=>r.source_kind==="native").map(r=>r.id);
    for(let offset=0;offset<nativeIds.length;offset+=500){
      const ids=nativeIds.slice(offset,offset+500), result=await supabase.rpc("iq_rncp_requirements_summary",{p_report_ids:ids});
      if(result.error || ids.some(id=>!Array.isArray(result.data?.[id]))) throw new RncpError("No se pudo comprobar el seguimiento documental.",503);
      for(const id of ids)requirements[id]=result.data[id].length===0;
    }
    if (request && new URL(request.url).searchParams.get("view") === "directory" && !context.supplier) {
      let flowReady = false;
      if (process.env.RNCP_FLOW_ENABLED === "true") {
        try {
          await requireRncpFlow(context);
          flowReady = true;
        } catch {
          // Historical records remain available while the contract is unavailable.
        }
      }
      const reports = rows.sort(compareRncpFolios).map(row => ({
        ...mapReport(row, [], []),
        requirementsComplete: requirements[row.id] === true,
      }));
      return NextResponse.json({ reports, flowReady }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const actions: ActionRow[] = [], audits: AuditRow[] = [], evidenceLinks: EvidenceLinkRow[] = [];
    const admin = createAdminClient();
    for(let offset=0;offset<rows.length;offset+=100){
      const ids=rows.slice(offset,offset+100).map(row=>row.id);
      actions.push(...await paginatedRows<ActionRow>((from,to) => supabase.from("supplier_rncp_actions").select("*", { count: "exact" }).in("report_id",ids).order("id").range(from,to)));
      // Privileged audit reads are restricted to IDs already authorized by report RLS.
      audits.push(...await paginatedRows<AuditRow>((from,to) => admin.from("audit_log").select("id,resource_id,action,user_name_snapshot,created_at,reason", { count: "exact" }).eq("resource_type","supplier_rncp_report").in("resource_id",ids).order("id").range(from,to)));
    }
    for(let offset=0;offset<actions.length;offset+=100){
      const ids=actions.slice(offset,offset+100).map(action=>action.id);
      evidenceLinks.push(...await paginatedRows<EvidenceLinkRow>((from,to) => supabase.from("supplier_rncp_action_evidence").select("id,action_id,file:file_objects!supplier_rncp_action_evidence_file_id_fkey(id,original_name,mime_type,size_bytes,uploaded_by,created_at)",{count:"exact"}).in("action_id",ids).order("id").range(from,to)));
    }
    return NextResponse.json({ reports: rows.sort(compareRncpFolios).map(row => ({...mapReport(row,
      audits.filter(audit=>audit.resource_id===row.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)),
      actions.filter(action=>action.report_id===row.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(action=>mapAction(action,evidenceLinks.filter(link=>link.action_id===action.id)))) , requirementsComplete: requirements[row.id]===true })) }, {headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return NextResponse.json({ error: error instanceof RncpError ? error.message : "No fue posible consultar los RNCP completos. Reintenta." }, {status:error instanceof RncpError?error.status:503}); }

}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string") return NextResponse.json({ error: "Solicitud RNCP no válida." }, { status: 400 });
  const supabase = await createClient();
  const flowEnabled = process.env.RNCP_FLOW_ENABLED === "true";
  const keyedDraft = payload.action === "draft" && !payload.reportId && typeof payload.draftKey === "string";
  if (keyedDraft && !/^[a-f0-9-]{36}$/i.test(String(payload.draftKey))) return NextResponse.json({error:"Identificador de recuperación no válido."},{status:400});
  if (keyedDraft && flowEnabled) {
    try {await requirePhotoV2({supabase,admin:createAdminClient()});}catch(error){return photoFailure(error);}
  }
  const values: Record<string, unknown> = payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)
    ? { ...payload.values as Record<string, unknown> } : {};
  // Retired field: never accept changes from a client, including older clients.
  delete values.purchaseOrder;
  delete values.purchase_order;
  if (!flowEnabled && !payload.reportId) return NextResponse.json({error:"El alta de RNCP está pendiente de activación. Los reportes existentes siguen disponibles."},{status:503});
  if (flowEnabled && ((!payload.reportId && !isRncpClassification(values.classification)) || (values.classification !== undefined && !isRncpClassification(values.classification)))) return NextResponse.json({error:"Selecciona la clasificación QAC, Hilo o Avíos."},{status:400});
  if (flowEnabled) { try { await requireRncpFlow({supabase}); } catch(error) { return photoFailure(error); } }
  // Until the reviewed flow SQL is installed, retain the production RPC contract.
  if (!flowEnabled) delete values.classification;
  const result = keyedDraft ? await supabase.rpc("iq_rncp_initial_photo_draft", {p_request:payload.draftKey,p_payload:values}) : await supabase.rpc("save_supplier_rncp", {
    requested_report_id: typeof payload.reportId === "string" ? payload.reportId : null,
    requested_action: payload.action,
    requested_payload: values,
    requested_reason: typeof payload.reason === "string" ? payload.reason : null,
  });
  if (result.error) {
    if(keyedDraft){try{photoRpcError(result.error);}catch(error){return photoFailure(error);}}
    if (keyedDraft && result.error.code === "PGRST202") return NextResponse.json({error:"La recuperación de borradores con fotografías requiere la propuesta SQL específica revisada."},{status:503});
    return rncpError(result.error.message);
  }
  const report = mutationIdentity(result.data);
  if (!report) return NextResponse.json({ error: "No se pudo confirmar el folio y el estado guardados. Consulta el expediente antes de reintentar." }, { status: 502 });
  return NextResponse.json({ report, ...(keyedDraft?{requiresReload:true}:{}) });
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
  const report = mutationIdentity(result.data);
  if (!report) return NextResponse.json({ error: "No se pudo confirmar el cambio del expediente." }, { status: 502 });
  return NextResponse.json({ report });
}

function mapReport(row: ReportRow, audits: AuditRow[], actions: RncpResponseAction[]): RncpReport {
  const supplier = first(row.supplier);
  const site = first(row.site);
  const late = row.source_kind === "historical" ? row.historical_status === "Tarde" : Boolean(row.notified_at && row.response_deadline && row.status !== "closed" && Date.parse(row.response_deadline) <= Date.now() && (!row.complete_submitted_at || Date.parse(row.complete_submitted_at) > Date.parse(row.response_deadline)));
  const history: RncpHistoryEvent[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    actorName: audit.user_name_snapshot ?? "Sistema",
    createdAt: audit.created_at,
    reason: audit.reason ?? undefined,
  }));
  return {
    classification: isRncpClassification(row.classification) ? row.classification : undefined, firstValidProgressAt: row.first_valid_progress_at ?? undefined,
    historicalStatus: row.historical_status ?? undefined, completeSubmittedAt: row.complete_submitted_at ?? undefined,
    validatedAt: row.validated_at ?? undefined, validationOutcome: row.validation_outcome ?? undefined,
    origin: row.source_kind ?? "legacy", notifiedAt: row.notified_at ?? undefined,
    responseDeadline: row.response_deadline ?? undefined, responseRequirements: row.response_requirements ?? undefined,
    id: row.id, folio: row.folio, supplierId: row.supplier_id ?? undefined,
    supplierCode: supplier?.code, supplierName: supplier?.name,
    siteId: row.site_id ?? undefined, siteCode: site?.code, siteName: site?.name,
    reportDate: row.report_date ?? undefined,
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
    createdBy: row.created_by,
    rootCause: row.root_cause ?? undefined, actionPlan: row.action_plan ?? undefined, containment: row.containment ?? undefined,
    commitments: row.commitments ?? undefined, documentTypes: row.document_types ?? undefined,
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
  if (typeof record?.id !== "string" || !record.id.trim() || typeof record.folio !== "string" || !record.folio.trim() || typeof record.status !== "string" || !record.status.trim()) return null;
  return { id: record.id, folio: record.folio, status: record.status };
}

function rncpError(message: string) {
  const errors: Record<string, string> = {
    RNCP_INSPECTOR_VALIDATION_REQUIRED: "El cierre requiere la validación de Calidad desde el seguimiento del expediente.",
    RNCP_CLASSIFICATION_REQUIRED: "Selecciona la clasificación QAC, Hilo o Avíos.",
    RNCP_HISTORICAL_IMMUTABLE: "La clasificación histórica se conserva sin cambios.",
    RNCP_WRITE_FORBIDDEN: "No tienes permiso para modificar RNCP.",
    RNCP_REQUIRED_FIELDS_MISSING: "Completa proveedor, sucursal cuando aplique, fecha, problema, descripción, producto o material, responsable y fecha compromiso.",
    RNCP_SITE_REQUIRED: "Selecciona la sucursal del proveedor.",
    RNCP_SUPPLIER_INVALID: "El proveedor seleccionado no está activo.",
    RNCP_SITE_INVALID: "La sucursal seleccionada no pertenece al proveedor o está inactiva.",
    RNCP_DRAFT_LOCKED: "La RNCP ya fue registrada y no puede volver a borrador.",
    RNCP_ALREADY_SUBMITTED: "La RNCP ya fue registrada.",
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
