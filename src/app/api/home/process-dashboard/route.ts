import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { aggregateProcessHome, text, type HomeRecords, type HomeRow } from "@/lib/home-process-data";
import { emptyHomeDashboardFilters } from "@/lib/home-dashboard";
import { findInstitutionalImages, institutionalImageTitles } from "@/lib/home-institutional-images";
import type { ControlledDocument } from "@/lib/document-control-data";

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession();
    if (!session?.authUserId || !["Administrador", "Usuario interno"].includes(session.userType) || !canPerformModuleAction(session, "home", "view")) return NextResponse.json({ error: "Inicio no autorizado." }, { status: 403 });
    const client = await createClient();
    const profile = await client.from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
    if (profile.error || !profile.data?.organization_id || profile.data.status !== "active" || !["administrator", "internal"].includes(profile.data.user_type) || profile.data.workspace_mode === "demo") return NextResponse.json({ error: "La cuenta no tiene un ámbito productivo válido." }, { status: 403 });
    const url = new URL(request.url);
    const imagesOnly = url.searchParams.has("image") || url.searchParams.get("view") === "images";
    const admin = imagesOnly && profile.data.user_type === "administrator" ? client : createAdminClient();
    type Filter = [string, "eq" | "in" | "is", unknown];
    async function read(table: string, columns: string, filters: Filter[] = [], order = "id", authenticated = false, match?: string): Promise<HomeRow[]> {
      const rows: HomeRow[] = []; let total: number | null = null;
      for (;;) {
        let query = (authenticated ? client : admin).from(table).select(columns, !match && rows.length === 0 ? { count: "exact" } : {});
        for (const [column, op, value] of filters) query = op === "in" ? query.in(column, value as string[]) : op === "is" ? query.is(column, value as null) : query.eq(column, value);
        if (match) query = query.or(match);
        query = query.order(order);
        if (table === "indicator_definition_processes") query = query.order("process_id");
        const page = await query.range(rows.length, rows.length + 499);
        if (page.error || (!match && rows.length === 0 && page.count === null)) throw new Error("HOME_SOURCE_" + table + (match ? "_lookup_" : "_rows_") + (page.error?.code ?? "COUNT"));
        total = total ?? page.count; const data = (page.data ?? []) as unknown as HomeRow[];
        if (!data.length && total !== null && rows.length < total) throw new Error("HOME_INCOMPLETE_PAGE");
        rows.push(...data);
        const keys = rows.map(r => r.id ?? `${r.indicator_id ?? ""}:${r.process_id ?? ""}:${r.document_id ?? ""}`);
        if (new Set(keys).size !== rows.length) throw new Error("HOME_CHANGED_DURING_PAGINATION");
        if ((total !== null && rows.length >= total) || !data.length) return rows;
      }
    }
    async function children(table: string, columns: string, column: string, ids: string[], order = "id", authenticated = false) {
      const rows: HomeRow[] = [];
      for (let i = 0; i < ids.length; i += 100) rows.push(...await read(table, columns, [[column, "in", ids.slice(i, i + 100)]], order, authenticated));
      return rows;
    }
    const org = profile.data.organization_id;
    const administrator = profile.data.user_type === "administrator";
    if (administrator !== (session.userType === "Administrador")) return NextResponse.json({ error: "Perfil actualizado. Inicia sesión nuevamente." }, { status: 403 });
    const allProcesses = await read("processes", "id,name,organization_id,process_owner_user_id", [["organization_id", "eq", org], ["active", "eq", true]]);
    const processes = allProcesses.filter(p => administrator || session.assignedProcessIds.includes(text(p, "id")));
    const processIds = processes.map(p => text(p, "id"));
    if (imagesOnly) {
      const scopedProcesses = allProcesses.map(p => text(p, "id"));
      const normalized = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.[^.]+$/, "").trim().toLocaleLowerCase("es");
      // SQL narrows candidates; exact normalized matching below retains the institutional allowlist.
      const possible = (column: string) => institutionalImageTitles.map(title =>
        column + ".ilike.*" + normalized(title).replace(/[aeiou]/g, "_") + "*").join(",");
      const projection = "id,organization_id,process_id,code,title,document_type_id,active,deleted_at";
      const byProcess: Filter[] = [["process_id", "in", scopedProcesses], ["active", "eq", true], ["deleted_at", "is", null]];
      // Page the organization scope before checking filenames. Embedding a filtered
      // versions relation in the entire organization can evaluate RLS for every version
      // in a single statement. The browser receives only the four institutional slots.
      const namedByVersion: HomeRow[] = [];
      const [scopeRows, namedDocs] = await Promise.all([
        read("controlled_documents", "id", byProcess),
        read("controlled_documents", projection, byProcess, "id", false, possible("title")),
      ]);
      const idsInScope = scopeRows.map(row => text(row, "id"));
      async function matchBatch(ids: string[]) {
        const filenames = await read("controlled_document_versions", "id,document_id,file_name", [["document_id", "in", ids]], "id", false, possible("file_name"));
        namedByVersion.push(...filenames);
      }
      for (let offset = 0; offset < idsInScope.length; offset += 200) {
        const batches = [idsInScope.slice(offset, offset + 100), idsInScope.slice(offset + 100, offset + 200)];
        await Promise.all(batches.filter(batch => batch.length).map(matchBatch));
      }
      const exactTitle = (value: string) => institutionalImageTitles.some(title => normalized(title) === normalized(value));
      const namedIds = new Set(namedDocs.map(d => d.id));
      const otherIds = [...new Set(namedByVersion.filter(v => exactTitle(text(v, "file_name")) && !namedIds.has(v.document_id)).map(v => text(v, "document_id")))];
      const matched = otherIds.length ? await children("controlled_documents", projection, "id", otherIds) : [];
      const institutional = [...new Map([...namedDocs.filter(d => exactTitle(text(d, "title"))), ...matched].map(d => [d.id, d])).values()]
        .filter(d => d.organization_id === org || d.organization_id === null);
      const ids = institutional.map(d => text(d, "id"));
      const [versions, lifecycle] = await Promise.all([
        children("controlled_document_versions", "id,document_id,revision,status,file_id,file_name,updated_at", "document_id", ids),
        children("document_lifecycle", "document_id,is_deleted,lifecycle_status", "document_id", ids, "document_id"),
      ]);
      const imageDocuments: ControlledDocument[] = [];
      const imageUrls: Record<string, string> = {};
      const eligibleFiles = await children("file_objects", "id,bucket_id,object_path,mime_type,size_bytes,deleted_at", "id", [...new Set(versions.map(v => text(v, "file_id")).filter(Boolean))]);
      const filesById = new Map(eligibleFiles.filter(f => !f.deleted_at).map(f => [f.id, f]));
      const filesByVersion = new Map<string, HomeRow>();
      for (const d of institutional) {
        if (lifecycle.some(l => l.document_id === d.id && (l.is_deleted || l.lifecycle_status !== "active"))) continue;
        // Institutional tiles are informational, not approval of the controlled document.
        // Show the unique pending image if no current version exists; preserve its real status.
        const current = versions.filter(v => v.document_id === d.id && v.status === "current");
        const pending = versions.filter(v => v.document_id === d.id && v.status === "pending");
        const candidates = current.length ? current : pending;
        if (candidates.length !== 1) continue;
        const v = candidates[0];
        const file = filesById.get(v.file_id);
        const fileName = text(v, "file_name");
        const objectPath = file ? text(file, "object_path") : "";
        const imageExtension = /\.(png|jpe?g|webp|gif)$/i.test(fileName) && /\.(png|jpe?g|webp|gif)$/i.test(objectPath);
        if (!file || !(text(file, "mime_type").startsWith("image/") || (text(file, "mime_type") === "application/octet-stream" && imageExtension))) continue;
        filesByVersion.set(text(v, "id"), file);
        imageDocuments.push({ id: text(d, "id"), processId: text(d, "process_id"), code: text(d, "code"), name: text(d, "title"), documentTypeId: text(d, "document_type_id"), owner: "", versions: [{ id: text(v, "id"), revision: Number(v.revision), status: v.status === "current" ? "current" : "pending", fileName: text(v, "file_name"), sizeBytes: typeof file.size_bytes === "number" ? file.size_bytes : undefined, uploadedBy: "", validator: "", modifiedAt: text(v, "updated_at"), changeReason: "" }] });
      }
      // Only sign the unique, displayable approved version for each institutional slot.
      const slots = findInstitutionalImages(imageDocuments, session, true);
      const target = url.searchParams.get("image");
      await Promise.all(slots.map(async ({ version }) => {
        if (!version || (target && version.id !== target)) return;
        const file = filesByVersion.get(version.id)!;
        const signed = await admin.storage.from(text(file, "bucket_id")).createSignedUrl(text(file, "object_path"), 300);
        if (signed.error) throw new Error("HOME_IMAGE_UNAVAILABLE");
        imageUrls[version.id] = signed.data.signedUrl;
      }));
      const headers = { "Cache-Control": "private, no-store" };
      if (url.searchParams.has("image")) {
        const signedUrl = imageUrls[url.searchParams.get("image")!];
        return signedUrl ? NextResponse.json({ signedUrl }, { headers }) : NextResponse.json({ error: "Imagen institucional no disponible." }, { status: 404, headers });
      }
      return NextResponse.json({ imageDocuments, imageUrls }, { headers });
    }
    const documents = canPerformModuleAction(session, "documents", "view") ? (await children("controlled_documents", "id,process_id,organization_id,code,title,document_type_id,active,deleted_at", "process_id", processIds, "id", true)).filter(d => d.organization_id === org || d.organization_id === null) : [];
    const documentIds = [...new Set(documents.map(d => text(d, "id")))];
    const lifecycle = await children("document_lifecycle", "document_id,is_deleted,lifecycle_status", "document_id", documentIds, "document_id");
    const versions = await children("controlled_document_versions", "id,document_id,revision,status,uploaded_by,validator_id,updated_at", "document_id", documentIds);
    const indicators = canPerformModuleAction(session, "indicators", "view") ? await read("indicator_definitions", "id,code,name,process_id,active,leader_id,leader_name,metric_label,periodicity", [["organization_id", "eq", org], ["workspace_mode", "eq", "production"], ["active", "eq", true]], "id", true) : [];
    const relations = await children("indicator_definition_processes", "indicator_id,process_id", "indicator_id", indicators.map(d => text(d, "id")), "indicator_id");
    const scopedIndicators = indicators.filter(d => processIds.includes(text(d, "process_id")) || relations.some(r => r.indicator_id === d.id && processIds.includes(text(r, "process_id"))));
    const indicatorIds = scopedIndicators.map(d => text(d, "id"));
    const periods = await children("indicator_periods", "id,indicator_id,year,quarter,scheduled_date,opens_at,closes_at", "indicator_id", indicatorIds);
    const records: HomeRecords = { processes, documents, versions, lifecycle, indicators: scopedIndicators, indicatorProcesses: relations, periods,
      homeSections: await read("home_sections", "id,active,visible_to_administrators"),
      rules: await children("indicator_evaluation_rules", "indicator_id,compliant_rule,marginal_rule,noncompliant_rule", "indicator_id", indicatorIds, "indicator_id"),
      results: await children("indicator_results", "id,period_id,value,evaluation_status,submitted_by,submitted_at", "period_id", periods.map(p => text(p, "id"))),
      actions: canPerformModuleAction(session, "corrective-actions", "view") && processIds.length ? await read("corrective_actions", "id,folio,title,process_id,owner_id,owner_name,status,deleted_at,due_date,created_at", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]], "id", true) : [],
      audits: canPerformModuleAction(session, "audits", "view") && processIds.length ? await read("audits", "id,code,title,process_id,status,scheduled_date,completed_at,lead_auditor_id,responsible_user_id", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]], "id", true) : [],
      assets: canPerformModuleAction(session, "calibrations", "view") && processIds.length ? await read("measurement_assets", "id,code,name,process_id,owner_id,owner_name,next_due_date,schedule_pending", [["organization_id", "eq", org], ["process_id", "in", processIds], ["active", "eq", true]], "id", true) : [],
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
    return NextResponse.json({ dashboard: aggregateProcessHome(session, records, filters) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && /^HOME_[A-Za-z0-9_]+$/.test(error.message)) console.warn(error.message);
    return NextResponse.json({ error: "No fue posible consultar los datos autorizados de Inicio. Reintenta al actualizar la pantalla." }, { status: 503 }); }
}
