import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { aggregateProcessHome, text, type HomeRecords, type HomeRow } from "@/lib/home-process-data";
import { emptyHomeDashboardFilters } from "@/lib/home-dashboard";
import { institutionalImageTitles } from "@/lib/home-institutional-images";
import type { ControlledDocument } from "@/lib/document-control-data";

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession();
    if (!session?.authUserId || !["Administrador", "Usuario interno"].includes(session.userType) || !canPerformModuleAction(session, "home", "view")) return NextResponse.json({ error: "Inicio no autorizado." }, { status: 403 });
    const client = await createClient();
    const profile = await client.from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
    if (profile.error || !profile.data?.organization_id || profile.data.status !== "active" || !["administrator", "internal"].includes(profile.data.user_type) || profile.data.workspace_mode === "demo") return NextResponse.json({ error: "La cuenta no tiene un ámbito productivo válido." }, { status: 403 });
    const admin = createAdminClient();
    type Filter = [string, "eq" | "in" | "is", unknown];
    async function read(table: string, columns: string, filters: Filter[] = [], order = "id"): Promise<HomeRow[]> {
      const rows: HomeRow[] = []; let total: number | null = null;
      for (;;) {
        let query = admin.from(table).select(columns, { count: "exact" });
        for (const [column, op, value] of filters) query = op === "in" ? query.in(column, value as string[]) : op === "is" ? query.is(column, value as null) : query.eq(column, value);
        query = query.order(order);
        if (table === "indicator_definition_processes") query = query.order("process_id");
        const page = await query.range(rows.length, rows.length + 499);
        if (page.error || page.count === null || (total !== null && total !== page.count)) throw new Error(`HOME_SOURCE_${table}`);
        total = page.count; const data = (page.data ?? []) as unknown as HomeRow[];
        if (!data.length && rows.length < total) throw new Error("HOME_INCOMPLETE_PAGE");
        rows.push(...data);
        const keys = rows.map(r => r.id ?? `${r.indicator_id ?? ""}:${r.process_id ?? ""}:${r.document_id ?? ""}`);
        if (new Set(keys).size !== rows.length) throw new Error("HOME_CHANGED_DURING_PAGINATION");
        if (rows.length >= total) return rows;
      }
    }
    async function children(table: string, columns: string, column: string, ids: string[], order = "id") {
      const rows: HomeRow[] = [];
      for (let i = 0; i < ids.length; i += 100) rows.push(...await read(table, columns, [[column, "in", ids.slice(i, i + 100)]], order));
      return rows;
    }
    const org = profile.data.organization_id;
    const administrator = profile.data.user_type === "administrator";
    if (administrator !== (session.userType === "Administrador")) return NextResponse.json({ error: "Perfil actualizado. Inicia sesión nuevamente." }, { status: 403 });
    const allProcesses = await read("processes", "id,name,organization_id,process_owner_user_id", [["organization_id", "eq", org], ["active", "eq", true]]);
    const processes = allProcesses.filter(p => administrator || session.assignedProcessIds.includes(text(p, "id")));
    const processIds = processes.map(p => text(p, "id"));
    const allDocuments = await children("controlled_documents", "id,process_id,organization_id,code,title,document_type_id,active,deleted_at", "process_id", allProcesses.map(p => text(p, "id")));
    const ownedDocuments = allDocuments.filter(d => d.organization_id === org || d.organization_id === null);
    // Only exact institutional titles are shared; operational documents still require module/process access.
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.[^.]+$/, "").trim().toLocaleLowerCase("es");
    const versions = await children("controlled_document_versions", "id,document_id,revision,status,file_id,file_name,uploaded_by,validator_id,updated_at", "document_id", ownedDocuments.map(d => text(d, "id")));
    const institutional = ownedDocuments.filter(d => institutionalImageTitles.some(title => normalize(title) === normalize(text(d, "title")) || versions.some(v => v.document_id === d.id && normalize(title) === normalize(text(v, "file_name")))) && d.active === true && !d.deleted_at);
    const documents = ownedDocuments.filter(d => processIds.includes(text(d, "process_id")) && canPerformModuleAction(session, "documents", "view"));
    const documentIds = [...new Set([...documents, ...institutional].map(d => text(d, "id")))];
    const lifecycle = await children("document_lifecycle", "document_id,is_deleted,lifecycle_status", "document_id", documentIds, "document_id");
    const imageDocuments: ControlledDocument[] = [];
    const imageUrls: Record<string, string> = {};
    for (const d of institutional) {
      if (lifecycle.some(l => l.document_id === d.id && (l.is_deleted || l.lifecycle_status !== "active"))) continue;
      const current = versions.filter(v => v.document_id === d.id && v.status === "current");
      if (current.length !== 1) continue;
      const v = current[0];
      const files = await read("file_objects", "id,bucket_id,object_path,mime_type", [["id", "eq", v.file_id], ["deleted_at", "is", null]]);
      const file = files[0]; if (!file || !text(file, "mime_type").startsWith("image/")) continue;
      const signed = await admin.storage.from(text(file, "bucket_id")).createSignedUrl(text(file, "object_path"), 300);
      if (signed.error) throw new Error("HOME_IMAGE_UNAVAILABLE");
      imageUrls[text(v, "id")] = signed.data.signedUrl;
      imageDocuments.push({ id: text(d, "id"), processId: text(d, "process_id"), code: text(d, "code"), name: text(d, "title"), documentTypeId: text(d, "document_type_id"), owner: "", versions: [{ id: text(v, "id"), revision: Number(v.revision), status: "current", fileName: text(v, "file_name"), uploadedBy: "", validator: "", modifiedAt: text(v, "updated_at"), changeReason: "" }] });
    }
    const url = new URL(request.url);
    if (url.searchParams.has("image")) { const signedUrl = imageUrls[url.searchParams.get("image")!]; return signedUrl ? NextResponse.json({ signedUrl }, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Imagen institucional no disponible." }, { status: 404 }); }
    const indicators = canPerformModuleAction(session, "indicators", "view") ? await read("indicator_definitions", "id,code,name,process_id,active,leader_id,leader_name,metric_label,periodicity", [["organization_id", "eq", org], ["workspace_mode", "eq", "production"], ["active", "eq", true]]) : [];
    const relations = await children("indicator_definition_processes", "indicator_id,process_id", "indicator_id", indicators.map(d => text(d, "id")), "indicator_id");
    const scopedIndicators = indicators.filter(d => processIds.includes(text(d, "process_id")) || relations.some(r => r.indicator_id === d.id && processIds.includes(text(r, "process_id"))));
    const indicatorIds = scopedIndicators.map(d => text(d, "id"));
    const periods = await children("indicator_periods", "id,indicator_id,year,quarter,scheduled_date,opens_at,closes_at", "indicator_id", indicatorIds);
    const records: HomeRecords = { processes, documents, versions, lifecycle, indicators: scopedIndicators, indicatorProcesses: relations, periods,
      homeSections: await read("home_sections", "id,active,visible_to_administrators"),
      rules: await children("indicator_evaluation_rules", "indicator_id,compliant_rule,marginal_rule,noncompliant_rule", "indicator_id", indicatorIds, "indicator_id"),
      results: await children("indicator_results", "id,period_id,value,submitted_by,submitted_at", "period_id", periods.map(p => text(p, "id"))),
      actions: canPerformModuleAction(session, "corrective-actions", "view") && processIds.length ? await read("corrective_actions", "id,folio,title,process_id,owner_id,owner_name,status,deleted_at,due_date,created_at", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]]) : [],
      audits: canPerformModuleAction(session, "audits", "view") && processIds.length ? await read("audits", "id,code,title,process_id,status,scheduled_date,completed_at,lead_auditor_id,responsible_user_id", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]]) : [],
      assets: canPerformModuleAction(session, "calibrations", "view") && processIds.length ? await read("measurement_assets", "id,code,name,process_id,owner_id,owner_name,next_due_date,schedule_pending", [["organization_id", "eq", org], ["process_id", "in", processIds], ["active", "eq", true]]) : [],
      documentActivity: await children("document_audit_log", "id,document_id,event_type,performed_by,performed_at", "document_id", documents.map(d => text(d, "id"))),
      activity: await read("audit_log", "id,resource_type,resource_id,action,created_at,user_name_snapshot", [["organization_id", "eq", org]]),
      approvals: [],
    };
    records.actionPlans = await children("corrective_action_plans", "id,corrective_action_id,description,owner_id,status,completed_at,due_date", "corrective_action_id", records.actions.map(a => text(a, "id")));
    const approvals = processIds.length ? await read("approval_requests", "id,module,entity_id,process_id,status,assigned_approver_id,assigned_role_id,approval_type,required_permission", [["organization_id", "eq", org], ["process_id", "in", processIds], ["status", "eq", "pending"]]) : [];
    const roles = approvals.some(a => a.assigned_role_id && !a.assigned_approver_id) ? await read("user_roles", "id,role_id,organization_id,process_id,starts_at,ends_at", [["user_id", "eq", session.authUserId], ["status", "eq", "active"]]) : [];
    const activeRoles = new Set((roles.length ? await read("roles", "id", [["id", "in", roles.map(r => text(r, "role_id"))], ["status", "eq", "active"]]) : []).map(r => r.id));
    for (const approval of approvals) {
      const assigned = approval.assigned_approver_id === session.authUserId || (!approval.assigned_approver_id && approval.assigned_role_id && activeRoles.has(approval.assigned_role_id) && roles.some(r => r.role_id === approval.assigned_role_id && (!r.organization_id || r.organization_id === org) && (!r.process_id || r.process_id === approval.process_id) && Date.parse(text(r, "starts_at")) <= Date.now() && (!r.ends_at || Date.parse(text(r, "ends_at")) >= Date.now())));
      if (!assigned) continue;
      const permission = await client.rpc("has_permission", { requested_permission: approval.required_permission, requested_organization_id: org, requested_process_id: approval.process_id, is_assigned: true });
      if (permission.error) throw new Error("HOME_APPROVAL_PERMISSION_FAILED");
      if (permission.data === true) records.approvals.push({ ...approval, assigned_to_user: true, can_decide: true });
    }
    const filters = { ...emptyHomeDashboardFilters };
    for (const key of Object.keys(filters) as Array<keyof typeof filters>) if (url.searchParams.has(key)) filters[key] = url.searchParams.get(key)!;
    return NextResponse.json({ dashboard: aggregateProcessHome(session, records, filters), imageDocuments, imageUrls }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "No fue posible consultar los datos autorizados de Inicio. Reintenta al actualizar la pantalla." }, { status: 503 }); }
}
