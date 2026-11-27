import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { aggregateProcessHome, text, type HomeRecords, type HomeRow } from "@/lib/home-process-data";
import { emptyHomeDashboardFilters } from "@/lib/home-dashboard";
import { qualityPolicyDocumentId, findInstitutionalImages } from "@/lib/home-institutional-images";
import type { ControlledDocument } from "@/lib/document-control-data";

export async function GET(request: Request) {
  try {
    const started = performance.now();
    function recordTime(phase: string, start: number) {
      if (process.env.INTEGRAQ_HOME_TIMINGS === "1") console.info("HOME_TIMING", phase, Math.round(performance.now() - start));
    }
    const session = await getAuthenticatedSession();
    if (!session?.authUserId || !["Administrador", "Usuario interno"].includes(session.userType) || !canPerformModuleAction(session, "home", "view")) return NextResponse.json({ error: "Inicio no autorizado." }, { status: 403 });
    const client = await createClient();
    const url = new URL(request.url);
    const imagesOnly = url.searchParams.has("image") || url.searchParams.get("view") === "images";
    const configStarted = performance.now();
    const [profile, sectionRead, processRead] = await Promise.all([
      client.from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle(),
      client.from("home_sections").select("id,active,visible_to_administrators").eq("active", true),
      client.from("processes").select("id,name,organization_id,process_owner_user_id").eq("organization_id", session.organizationId ?? "").eq("active", true).order("id"),
    ]);
    recordTime(imagesOnly ? "image-scope" : "dashboard-scope", configStarted);
    if (profile.error || !profile.data?.organization_id || profile.data.organization_id !== session.organizationId || profile.data.status !== "active" || !["administrator","internal"].includes(profile.data.user_type) || profile.data.workspace_mode === "demo") return NextResponse.json({ error: "La cuenta no tiene un ámbito productivo válido." }, { status: 403 });
    if (sectionRead.error || processRead.error) throw new Error("HOME_SCOPE_UNAVAILABLE");
    const admin = imagesOnly && profile.data.user_type !== "administrator" ? createAdminClient() : client;
    type Filter = [string, "eq" | "in" | "is", unknown];
    async function read(table: string, columns: string, filters: Filter[] = [], order = "id", authenticated = false, periodRange?: { from: string; to: string }): Promise<HomeRow[]> {
      const rows: HomeRow[] = [];
      for (;;) {
        let query = (authenticated ? client : admin).from(table).select(columns);
        for (const [column, op, value] of filters) query = op === "in" ? query.in(column, value as string[]) : op === "is" ? query.is(column, value as null) : query.eq(column, value);
        if (periodRange?.from) query = query.gte("scheduled_date", periodRange.from);
        if (periodRange?.to) query = query.lte("scheduled_date", periodRange.to);
        query = query.order(order);
        if (table === "indicator_definition_processes") query = query.order("process_id");
        const page = await query.range(rows.length, rows.length + 499).abortSignal(request.signal);
        if (page.error) throw new Error("HOME_SOURCE_" + table + "_rows_" + (page.error?.code ?? "COUNT"));
        const data = (page.data ?? []) as unknown as HomeRow[];
        rows.push(...data);
        const keys = rows.map(r => r.id ?? `${r.indicator_id ?? ""}:${r.process_id ?? ""}:${r.document_id ?? ""}`);
        if (new Set(keys).size !== rows.length) throw new Error("HOME_CHANGED_DURING_PAGINATION");
        if (data.length < 500) return rows;
      }
    }
    async function children(table: string, columns: string, column: string, ids: string[], order = "id", authenticated = false, periodRange?: { from: string; to: string }) {
      const rows: HomeRow[] = [];
      const batchSize = column === "period.indicator_id" ? 50 : 100;
      for (let i = 0; i < ids.length; i += batchSize) rows.push(...await read(table, columns, [[column, "in", ids.slice(i, i + batchSize)]], order, authenticated, periodRange));
      return rows;
    }
    const org = profile.data.organization_id;
    const administrator = profile.data.user_type === "administrator";
    if (administrator !== (session.userType === "Administrador")) return NextResponse.json({ error: "Perfil actualizado. Inicia sesión nuevamente." }, { status: 403 });
    const homeSections = sectionRead.data ?? [];
    const visible = new Set(homeSections.filter(row => !administrator || row.visible_to_administrators === true).map(row => row.id));
    if (imagesOnly && !visible.has("quality-policy")) return NextResponse.json({ error: "Sección no disponible." }, { status: 403 });
    const allProcesses: HomeRow[] = processRead.data ?? [];
    const processes = allProcesses.filter(p => administrator || session.assignedProcessIds.includes(text(p, "id")));

    if (imagesOnly) {
      const metadataStarted = performance.now();
      const institutionalProcesses = administrator ? allProcesses : await read("processes", "id", [["organization_id", "eq", org], ["active", "eq", true]]);
      const scopedProcesses = institutionalProcesses.map(p => text(p, "id"));
      // Stable document identities. Their current revision, lifecycle and process scope are resolved on every read.
      const documentIds = [
        qualityPolicyDocumentId,
        "bb1c31b6-223f-4bcd-b123-050b542c3d86", // Política Ambiental
        "0290f0c0-10b3-49f7-b88a-1e544f654961", // Seguridad e Higiene
        "10146215-c8a7-4680-91d6-a920b0c5ce6f", // Objetivos de Calidad
      ];
      const fileFields = "id,bucket_id,object_path,mime_type,size_bytes,deleted_at";
      const [documents, versions, lifecycle] = await Promise.all([
        read("controlled_documents", "id,organization_id,process_id,code,title,document_type_id,active,deleted_at",
          [["id", "in", documentIds], ["process_id", "in", scopedProcesses], ["active", "eq", true], ["deleted_at", "is", null]]),
        read("controlled_document_versions", "id,document_id,revision,status,file_id,file_name,updated_at,file:file_objects!controlled_document_versions_file_id_fkey(" + fileFields + ")",
          [["document_id", "in", documentIds], ["status", "eq", "current"]]),
        children("document_lifecycle", "document_id,is_deleted,lifecycle_status", "document_id", documentIds, "document_id"),
      ]);
      const institutional = documents.filter(d => d.organization_id === org || d.organization_id === null);
      const imageDocuments: ControlledDocument[] = [];
      const imageUrls: Record<string, string> = {};
      const filesByVersion = new Map<string, HomeRow>();
      for (const d of institutional) {
        if (lifecycle.some(l => l.document_id === d.id && (l.is_deleted || l.lifecycle_status !== "active"))) continue;
        const current = versions.filter(v => v.document_id === d.id && v.status === "current");
        if (current.length !== 1) continue;
        const v = current[0];
        const file = v.file as HomeRow | null;
        if (!file || file.deleted_at) continue;
        const fileName = text(v, "file_name");
        const objectPath = file ? text(file, "object_path") : "";
        const imageExtension = /\.(png|jpe?g|webp|gif)$/i.test(fileName) && /\.(png|jpe?g|webp|gif)$/i.test(objectPath);
        if (!file || !(text(file, "mime_type").startsWith("image/") || (text(file, "mime_type") === "application/octet-stream" && imageExtension))) continue;
        filesByVersion.set(text(v, "id"), file);
        imageDocuments.push({ id: text(d, "id"), processId: text(d, "process_id"), code: text(d, "code"), name: text(d, "title"), documentTypeId: text(d, "document_type_id"), owner: "", versions: [{ id: text(v, "id"), revision: Number(v.revision), status: "current", fileName: text(v, "file_name"), sizeBytes: typeof file.size_bytes === "number" ? file.size_bytes : undefined, uploadedBy: "", validator: "", modifiedAt: text(v, "updated_at"), changeReason: "" }] });
      }
      // Only sign the unique, displayable approved version for each institutional slot.
      const slots = findInstitutionalImages(imageDocuments, session, true);
      const target = url.searchParams.get("image");
      const buckets = new Map<string, Map<string, string>>();
      for (const { version } of slots) {
        if (!version || (target && version.id !== target)) continue;
        const file = filesByVersion.get(version.id)!;
        const bucket = text(file, "bucket_id");
        const paths = buckets.get(bucket) ?? new Map<string, string>();
        paths.set(text(file, "object_path"), version.id);
        buckets.set(bucket, paths);
      }
      recordTime("image-metadata", metadataStarted);
      const signingStarted = performance.now();
      await Promise.all([...buckets].map(async ([bucket, paths]) => {
        const signed = await admin.storage.from(bucket).createSignedUrls([...paths.keys()], 300);
        if (signed.error) throw new Error("HOME_IMAGE_UNAVAILABLE");
        for (const item of signed.data) {
          if (!item.path || !item.signedUrl || item.error || !paths.has(item.path)) continue;
          imageUrls[paths.get(item.path)!] = item.signedUrl;
        }
      }));
      recordTime("image-sign", signingStarted);
      recordTime("images-total", started);
      const headers = { "Cache-Control": "private, no-store" };
      if (url.searchParams.has("image")) {
        const signedUrl = imageUrls[url.searchParams.get("image")!];
        return signedUrl ? NextResponse.json({ signedUrl }, { headers }) : NextResponse.json({ error: "Imagen institucional no disponible." }, { status: 404, headers });
      }
      return NextResponse.json({ imageDocuments, imageUrls }, { headers });
    }
    const filters = { ...emptyHomeDashboardFilters };
    for (const key of Object.keys(filters) as Array<keyof typeof filters>) if (url.searchParams.has(key)) filters[key] = url.searchParams.get(key)!;

    const records: HomeRecords = { processes, homeSections };
    const selectedIds = processes.filter(row => (filters.processId === "all" || row.id === filters.processId) && (filters.area === "all" || row.name === filters.area)).map(row => text(row, "id"));
    const processIds = selectedIds;
    type Loader = { module: string; run: () => Promise<HomeRecords> };
    const loaders: Loader[] = [
      { module: "indicators", run: async () => {
        const indicators = canPerformModuleAction(session, "indicators", "view") ? await read("indicator_definitions", "id,code,name,process_id,active,leader_id,leader_name,metric_label,periodicity,quality_objective,links:indicator_definition_processes(indicator_id,process_id),rule:indicator_evaluation_rules(indicator_id,compliant_rule,marginal_rule,noncompliant_rule)", [["organization_id", "eq", org], ["workspace_mode", "eq", "production"], ["active", "eq", true]], "id", true) : [];
        const relations = indicators.flatMap(d => Array.isArray(d.links) ? d.links as HomeRow[] : []);
        const rules = indicators.flatMap(d => !d.rule ? [] : Array.isArray(d.rule) ? d.rule as HomeRow[] : [d.rule as HomeRow]);
        const scopedIndicators = indicators.filter(d => processIds.includes(text(d, "process_id")) || relations.some(r => r.indicator_id === d.id && processIds.includes(text(r, "process_id"))));
        const indicatorIds = scopedIndicators.map(d => text(d, "id"));
        const periodsRequest = children("indicator_periods", "id,indicator_id,year,quarter,scheduled_date,opens_at,closes_at", "indicator_id", indicatorIds, "id", true, filters);

        const [periods, results] = await Promise.all([
          periodsRequest,
          children("indicator_results", "id,period_id,value,evaluation_status,submitted_by,submitted_at,period:indicator_periods!inner(indicator_id)", "period.indicator_id", indicatorIds),
        ]);
        return { indicators: scopedIndicators, indicatorProcesses: relations, periods, rules, results };
      } },
      { module: "corrective-actions", run: async () => {
        const actions = canPerformModuleAction(session, "corrective-actions", "view") && processIds.length ? await read("corrective_actions", "id,folio,title,process_id,owner_id,owner_name,status,deleted_at,due_date,created_at", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]], "id", true) : [];
        const actionPlans = await children("corrective_action_plans", "id,corrective_action_id,description,owner_id,status,completed_at,due_date", "corrective_action_id", actions.map(a => text(a, "id")));
        return { actions, actionPlans };
      } },
      { module: "documents", run: async () => {
        const documents = canPerformModuleAction(session, "documents", "view") ? (await children("controlled_documents", "id,process_id,organization_id,code,title,document_type_id,active,deleted_at", "process_id", processIds, "id", true)).filter(d => d.organization_id === org || d.organization_id === null) : [];
        const documentIds = [...new Set(documents.map(d => text(d, "id")))];
        const [lifecycle, versions, documentActivity] = await Promise.all([
          children("document_lifecycle", "document_id,is_deleted,lifecycle_status", "document_id", documentIds, "document_id"),
          children("controlled_document_versions", "id,document_id,revision,status,uploaded_by,validator_id,updated_at", "document_id", documentIds),
          children("document_audit_log", "id,document_id,event_type,performed_by,performed_at", "document_id", documentIds),
        ]);

        return { documents, lifecycle, versions, documentActivity };
      } },
      { module: "audits", run: async () => ({ audits: canPerformModuleAction(session, "audits", "view") && processIds.length ? await read("audits", "id,code,title,process_id,status,scheduled_date,completed_at,lead_auditor_id,responsible_user_id", [["organization_id", "eq", org], ["process_id", "in", processIds], ["deleted_at", "is", null]], "id", true) : [] }) },
      { module: "calibrations", run: async () => ({ assets: canPerformModuleAction(session, "calibrations", "view") && processIds.length ? await read("measurement_assets", "id,code,name,process_id,owner_id,owner_name,next_due_date,schedule_pending", [["organization_id", "eq", org], ["process_id", "in", processIds], ["active", "eq", true]], "id", true) : [] }) },
      { module: "activity", run: async () => ({ activity: await read("audit_log", "id,resource_type,resource_id,action,created_at,user_name_snapshot", [["organization_id", "eq", org]]) }) },
      { module: "approvals", run: async () => {
        const approvals = processIds.length ? await read("approval_requests", "id,module,entity_id,process_id,status,assigned_approver_id,assigned_role_id,approval_type,required_permission", [["organization_id", "eq", org], ["process_id", "in", processIds], ["status", "eq", "pending"]]) : [];
        const roles = approvals.some(a => a.assigned_role_id && !a.assigned_approver_id) ? await read("user_roles", "id,role_id,organization_id,process_id,starts_at,ends_at", [["user_id", "eq", session.authUserId], ["status", "eq", "active"]]) : [];
        const activeRoles = new Set((roles.length ? await read("roles", "id", [["id", "in", roles.map(r => text(r, "role_id"))], ["status", "eq", "active"]]) : []).map(r => r.id));
        const assignedApprovals: HomeRow[] = [];
        for (const approval of approvals) {
          const assigned = approval.assigned_approver_id === session.authUserId || (!approval.assigned_approver_id && approval.assigned_role_id && activeRoles.has(approval.assigned_role_id) && roles.some(r => r.role_id === approval.assigned_role_id && (!r.organization_id || r.organization_id === org) && (!r.process_id || r.process_id === approval.process_id) && Date.parse(text(r, "starts_at")) <= Date.now() && (!r.ends_at || Date.parse(text(r, "ends_at")) >= Date.now())));
          if (!assigned) continue;
          const permission = await client.rpc("has_permission", { requested_permission: approval.required_permission, requested_organization_id: org, requested_process_id: approval.process_id, is_assigned: true });
          if (permission.error) throw new Error("HOME_APPROVAL_PERMISSION_FAILED");
          if (permission.data === true) assignedApprovals.push({ ...approval, assigned_to_user: true, can_decide: true });
        }

        return { approvals: assignedApprovals };
      } },
    ];
    const summaries: Array<{ module: "customers" | "suppliers" | "risks" | "continuous-improvement" | "forms" | "calibrations"; label: string; unit: string; load: () => Promise<number> }> = [
      { module: "risks", label: "Riesgos", unit: "riesgos", load: async () => {
        const forms = await read("form_definitions", "id", [["registration_number", "eq", "SYS-RYO-WORKSPACE-2025"], ["process_id", "in", allProcesses.map(p => p.id)]]);
        const rows = await read("form_records", "id,risks:values->risks", [["form_id", "in", forms.map(f => f.id)], ["record_number", "eq", "RYO-WORKSPACE-2025"]]);
        if (rows.length !== 1 || !Array.isArray(rows[0].risks)) throw new Error("HOME_RISK_MATRIX_UNAVAILABLE");
        return rows[0].risks.filter(risk => risk && !risk.deletedAt && selectedIds.includes(risk.processId)).length;
      } },
      { module: "continuous-improvement", label: "Mejora continua", unit: "proyectos", load: () => count("improvement_projects", [["organization_id", "eq", org], ["process_id", "in", selectedIds], ["deleted_at", "is", null]]) },
      { module: "customers", label: "Clientes", unit: "reclamos", load: async () => {
        const customers = await read("organizations", "id", [["kind", "eq", "customer"], ["owning_organization_id", "eq", org]]);
        return count("quality_cases", [["kind", "eq", "claim"], ["external_organization_id", "in", customers.map(row => row.id)], ["process_id", "in", selectedIds], ["cancelled_at", "is", null]]);
      } },
      { module: "suppliers", label: "Proveedores", unit: "RNCP", load: () => count("supplier_rncp_reports", [["organization_id", "eq", org], ["deleted_at", "is", null]]) },
      { module: "forms", label: "Formularios", unit: "formularios", load: async () => {
        const forms = await read("form_definitions", "id", [["process_id", "in", selectedIds]]);
        const dashboards = await count("form_dashboard_definitions", [["form_id", "in", forms.map(row => row.id)], ["active", "eq", true]]);
        records.formDashboards = [{ count: dashboards }];
        return forms.length;
      } },
    ];
    async function count(table: string, constraints: Filter[]) {
      let query = client.from(table).select("id", { head: true, count: "exact" });
      for (const [key, op, value] of constraints) {
        if (op === "in" && !(value as unknown[]).length) return 0;
        query = op === "in" ? query.in(key, value as string[]) : op === "is" ? query.is(key, null) : query.eq(key, value);
      }
      const result = await query.abortSignal(request.signal);
      if (result.error || result.count === null) throw new Error("HOME_SOURCE_" + table);
      return result.count;
    }
    for (const item of summaries) {
      if (!visible.has("module-status") || !canPerformModuleAction(session, item.module, "view") || (filters.module !== "all" && filters.module !== item.module)) continue;
      // RNCP has no process column. A global count cannot represent a process-filtered view.
      if (item.module === "suppliers" && (!administrator || filters.processId !== "all" || filters.area !== "all")) continue;
      loaders.push({ module: item.module, run: async () => ({ [item.module]: [{ count: await item.load() }] }) });
    }
    const pending = new Set(loaders.map(loader => loader.module));
    const failed = new Set<string>();
    const snapshot = () => {
      const dashboard = aggregateProcessHome(session, records, filters);
      for (const item of summaries) {
        if (!loaders.some(loader => loader.module === item.module)) continue;
        const total = records[item.module]?.[0]?.count;
        const status = dashboard.moduleStatus.find(row => row.id === item.module) ?? { id: item.module, label: item.label, value: "", detail: "", tone: "neutral" as const, module: item.module, sourceConnected: false };
        if (typeof total === "number") {
          status.value = total + " " + item.unit;
          status.detail = item.module === "forms" ? String(records.formDashboards[0].count) + " dashboards activos" : "Dentro de tu alcance";
          status.sourceConnected = true;
        }
        if (!dashboard.moduleStatus.includes(status)) dashboard.moduleStatus.push(status);
      }
      dashboard.unavailableSources = [...failed];
      dashboard.pendingSources = [...pending];
      for (const kpi of dashboard.kpis) {
        if (kpi.value === "Sin acceso") continue;
        if (pending.has(kpi.module) || failed.has(kpi.module)) {
          kpi.value = failed.has(kpi.module) ? "No disponible" : "…";
          kpi.detail = "";
        }
      }
      for (const status of dashboard.moduleStatus) {
        if (!status.module || status.value === "Sin acceso") continue;
        if (pending.has(status.module) || failed.has(status.module)) {
          status.value = failed.has(status.module) ? "No disponible" : "…";
          status.detail = ""; status.sourceConnected = false;
        }
      }
      if (!visible.has("quality-objectives")) dashboard.qualityObjectives = [];
      if (!visible.has("trends")) dashboard.trends = [];
      if (!visible.has("document-status")) dashboard.documentMetrics = [];
      if (!visible.has("performance")) dashboard.kpis = [];
      if (!visible.has("pending-tasks")) dashboard.pendingTasks = [];
      if (!visible.has("alerts")) dashboard.alerts = [];
      if (!visible.has("recent-activity")) dashboard.recentActivity = [];
      if (!visible.has("upcoming-events")) dashboard.upcomingEvents = [];
      if (!visible.has("module-status")) dashboard.moduleStatus = [];
      return dashboard;
    }
    const streamRequested = request.headers.get("accept") === "application/x-ndjson";
    async function collect(publish?: () => void) {
      let next = 0;
      async function worker() {
        while (next < loaders.length && !request.signal.aborted) {
          const source = loaders[next++];
          const sourceStarted = performance.now();
          try { Object.assign(records, await source.run()); }
          catch (cause) {
            failed.add(source.module);
            console.warn("HOME_SOURCE_FAILED", source.module, cause instanceof Error ? cause.message.replace(/[^A-Za-z0-9_]/g, "").slice(0, 80) : "READ");
          }
          recordTime(source.module, sourceStarted);
          pending.delete(source.module);
          publish?.();
        }
      }
      await Promise.all([worker(), worker(), worker()]);
      recordTime("dashboard-total", started);
    }
    const headers = { "Cache-Control": "private, no-store" };
    if (!streamRequested) { await collect(); return NextResponse.json({ dashboard: snapshot() }, { headers }); }
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const previous = new Map<string, string>();
        const publish = () => {
          if (cancelled || request.signal.aborted) return;
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(snapshot())) {
            const serialized = JSON.stringify(value);
            if (previous.get(key) === serialized) continue;
            previous.set(key, serialized);
            patch[key] = value;
          }
          controller.enqueue(encoder.encode(JSON.stringify(patch) + "\n"));
        };
        publish();
        await collect(publish);
        if (!cancelled) controller.close();
      },
      cancel() { cancelled = true; },
    });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/x-ndjson" } });
  } catch (error) {
    if (error instanceof Error && /^HOME_[A-Za-z0-9_]+$/.test(error.message)) console.warn(error.message);
    return NextResponse.json({ error: "No fue posible consultar los datos autorizados de Inicio. Reintenta al actualizar la pantalla." }, { status: 503 }); }
}
