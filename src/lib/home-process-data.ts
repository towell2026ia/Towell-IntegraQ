import { buildHomeDashboard, emptyHomeDashboardFilters, type HomeDashboardFilters, type HomeWorkItem } from "./home-dashboard";
import { evaluateConfiguredIndicator, type ConfiguredIndicator, type Quarter } from "./indicator-data";
import { canPerformModuleAction } from "./module-permissions";
import { isWorkspaceModuleId } from "./navigation";
import { homeSectionDefinitions } from "./home-visibility";
import type { ActiveSession } from "./session-data";
import { getDocumentPermissions } from "./document-control-data";

export type HomeRow = Record<string, unknown>;
export type HomeRecords = Record<string, HomeRow[]>;
export const text = (row: HomeRow, key: string) => typeof row[key] === "string" ? row[key] as string : "";
export function emptyOperationalHome(session: ActiveSession, now = new Date()) {
  const dashboard = buildHomeDashboard({ session, documents: [], actions: [], assets: [], indicators: [], indicatorResults: {}, supplierAudits: [], externalAudits: [] }, undefined, now);
  dashboard.qualityObjectives = [];
  dashboard.searchIndex = [];
  dashboard.upcomingEvents = [];
  dashboard.trends.forEach(trend => { trend.series = []; });
  dashboard.kpis.forEach(kpi => { kpi.value = "Sin datos"; kpi.detail = "Sin registros disponibles"; kpi.tone = "neutral"; });
  dashboard.moduleStatus.forEach(status => { status.value = "Sin datos"; status.detail = "Sin fuente conectada a Inicio"; status.sourceConnected = false; status.tone = "neutral"; });
  if (["Administrador", "Usuario interno"].includes(session.userType)) dashboard.visibleSections = homeSectionDefinitions.map(section => section.id);
  return dashboard;
}

/** Inputs have already been scoped in the server. No local or demonstration source is accepted. */
export function aggregateProcessHome(session: ActiveSession, records: HomeRecords, filters: HomeDashboardFilters = emptyHomeDashboardFilters, now = new Date()) {
  const dashboard = emptyOperationalHome(session, now);
  if (records.homeSections?.length) dashboard.visibleSections = homeSectionDefinitions.filter(s => ["quality-policy", "quality-objectives"].includes(s.id) || records.homeSections.some(r => r.id === s.id && r.active === true && r.visible_to_administrators === true)).map(s => s.id);
  const allProcesses = records.processes ?? [];
  const processes = allProcesses.filter(p => (filters.processId === "all" || p.id === filters.processId) && (filters.area === "all" || p.name === filters.area));
  const ids = new Set(processes.map(p => text(p, "id")));
  const inScope = (row: HomeRow) => ids.has(text(row, "process_id"));
  const moduleVisible = (module: Parameters<typeof canPerformModuleAction>[1]) => canPerformModuleAction(session, module, "view") && (filters.module === "all" || filters.module === module);
  dashboard.processScope = { ids: [...ids], label: processes.map(p => text(p, "name")).join(" · ") || "Sin procesos asignados" };
  dashboard.filterOptions.processes = allProcesses.map(p => ({ id: text(p, "id"), name: text(p, "name") }));
  dashboard.filterOptions.areas = allProcesses.map(p => text(p, "name"));
  const responsibleMatches = (row: HomeRow) => filters.responsible === "all" || [row.owner_id, row.owner_name, row.leader_id, row.leader_name, row.validator_id, row.uploaded_by, row.responsible_user_id, row.lead_auditor_id].includes(filters.responsible);
  const statusMatches = (row: HomeRow) => filters.status === "all" || row.status === filters.status;
  const dateMatches = (value: string) => (!filters.from || value.slice(0,10) >= filters.from) && (!filters.to || (Boolean(value) && value.slice(0,10) <= filters.to));
  const lifecycle = new Map((records.lifecycle ?? []).map(r => [r.document_id, r]));
  const documents = (records.documents ?? []).filter(d => {
    const version = (records.versions ?? []).filter(v => v.document_id === d.id).sort((a,b) => Number(b.revision) - Number(a.revision))[0] ?? {};
    return inScope(d) && moduleVisible("documents") && d.active === true && !d.deleted_at && !lifecycle.get(d.id)?.is_deleted && lifecycle.get(d.id)?.lifecycle_status !== "obsolete" && responsibleMatches(version) && statusMatches(version) && dateMatches(text(version, "updated_at"));
  });
  const documentIds = new Set(documents.map(d => d.id));
  const versions = (records.versions ?? []).filter(v => documentIds.has(v.document_id));
  const latest = new Map<string, HomeRow>();
  for (const v of versions) if (!latest.has(text(v, "document_id")) || Number(v.revision) > Number(latest.get(text(v, "document_id"))!.revision)) latest.set(text(v, "document_id"), v);
  const tasks: HomeWorkItem[] = [];
  const addTask = (row: HomeRow, module: HomeWorkItem["module"], title: string, targetId: string, detail: string) => tasks.push({ id: `${module}-${row.id}`, title, targetId, detail, module, moduleLabel: module, priority: "attention", area: "", processId: text(row, "process_id"), responsible: text(row, "owner_name") || text(row, "leader_name"), dueDate: text(row, "due_date") || undefined, status: "pending" });
  for (const d of documents) {
    const version = latest.get(text(d, "id"));
    if (version?.status === "pending" && version.validator_id === session.authUserId && getDocumentPermissions(session, text(d, "process_id")).validate) addTask(d, "documents", `Validar ${d.code}`, text(d, "id"), text(d, "title"));
    if (version?.status === "rejected" && version.uploaded_by === session.authUserId && getDocumentPermissions(session, text(d, "process_id")).edit) addTask(d, "documents", `Corregir ${d.code}`, text(d, "id"), text(d, "title"));
  }
  for (const metric of dashboard.documentMetrics) {
    metric.value = documents.filter(d => {
      const v = latest.get(text(d, "id"));
      if (metric.id === "pending") return v?.status === "pending" && v.validator_id === session.authUserId;
      if (metric.id === "validation") return v?.status === "pending";
      if (metric.id === "current") return versions.some(v => v.document_id === d.id && v.status === "current");
      if (metric.id === "rejected") return v?.status === "rejected";
      const start = new Date(now); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      return (records.documentActivity ?? []).some(e => e.document_id === d.id && Date.parse(text(e, "performed_at")) >= start.getTime() && Date.parse(text(e, "performed_at")) <= now.getTime());
    }).length;
  }
  const actions = (records.actions ?? []).filter(a => inScope(a) && moduleVisible("corrective-actions") && !a.deleted_at && responsibleMatches(a) && statusMatches(a) && dateMatches(text(a, "created_at")));
  for (const a of actions) if (a.status !== "closed" && a.owner_id === session.authUserId && canPerformModuleAction(session, "corrective-actions", "update")) addTask(a, "corrective-actions", `${a.folio} · ${a.title}`, text(a, "id"), text(a, "status"));
  for (const plan of records.actionPlans ?? []) {
    const action = actions.find(a => a.id === plan.corrective_action_id && a.status !== "closed");
    if (action && plan.owner_id === session.authUserId && !plan.completed_at && !["completed", "closed", "cancelled"].includes(text(plan, "status")) && canPerformModuleAction(session, "corrective-actions", "update")) addTask({ ...plan, process_id: action.process_id }, "corrective-actions", text(plan, "description"), text(action, "id"), `${action.folio} · Acción asignada`);
  }
  const audits = (records.audits ?? []).filter(a => inScope(a) && moduleVisible("audits") && responsibleMatches(a) && statusMatches(a) && dateMatches(text(a, "scheduled_date")));
  const assets = (records.assets ?? []).filter(a => inScope(a) && moduleVisible("calibrations") && responsibleMatches(a) && dateMatches(text(a, "next_due_date")));
  for (const a of audits) if (!a.completed_at && !["cancelled", "closed", "completed"].includes(text(a, "status")) && (a.responsible_user_id === session.authUserId || a.lead_auditor_id === session.authUserId) && canPerformModuleAction(session, "audits", "update")) addTask(a, "audits", text(a, "title"), text(a, "id"), text(a, "code"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  for (const a of assets) if (!a.schedule_pending && text(a, "next_due_date") && text(a, "next_due_date") <= today && a.owner_id === session.authUserId && canPerformModuleAction(session, "calibrations", "update")) addTask(a, "calibrations", text(a, "name"), text(a, "id"), `${a.code} · ${a.next_due_date}`);
  for (const a of records.approvals ?? []) {
    const moduleId = text(a, "module");
    if (isWorkspaceModuleId(moduleId) && moduleVisible(moduleId) && inScope(a) && a.status === "pending" && (a.assigned_approver_id === session.authUserId || a.assigned_to_user === true) && a.can_decide === true) addTask(a, moduleId, `Aprobar ${a.entity_id}`, text(a, "entity_id"), text(a, "approval_type"));
  }
  const relations = records.indicatorProcesses ?? [];
  const definitions = (records.indicators ?? []).filter(d => moduleVisible("indicators") && responsibleMatches(d) && d.active === true && (inScope(d) || relations.some(r => r.indicator_id === d.id && ids.has(text(r, "process_id")))));
  const definitionIds = new Set(definitions.map(d => d.id));
  const periods = (records.periods ?? []).filter(p => definitionIds.has(p.indicator_id) && dateMatches(text(p, "scheduled_date")));
  const results = new Map((records.results ?? []).filter(r => r.value !== null && r.value !== undefined && String(r.value).trim() !== "" && Number.isFinite(Number(r.value)) && Number.isFinite(Date.parse(text(r, "submitted_at"))) && Date.parse(text(r, "submitted_at")) <= now.getTime()).map(r => [r.period_id, r]));
  const rules = new Map((records.rules ?? []).map(r => [r.indicator_id, r]));
  const history = new Map<string, { passed: number; total: number }>();
  for (const definition of definitions) {
    const rule = rules.get(definition.id);
    for (const period of periods.filter(p => p.indicator_id === definition.id)) {
      const result = results.get(period.id);
      // Do not reinterpret monthly/annual periods as quarters or guess evaluation rules.
      if (definition.periodicity !== "quarterly" || !rule || !text(rule, "compliant_rule") || !text(rule, "marginal_rule") || !text(rule, "noncompliant_rule") || !["Q1", "Q2", "Q3", "Q4"].includes(text(period, "quarter"))) continue;
      const windowOpen = Date.parse(text(period, "opens_at")) <= now.getTime() && Date.parse(text(period, "closes_at")) >= now.getTime();
      if (!result && windowOpen && canPerformModuleAction(session, "indicators", "update") && (definition.leader_id === session.authUserId || processes.some(p => p.process_owner_user_id === session.authUserId && (p.id === definition.process_id || relations.some(r => r.indicator_id === definition.id && r.process_id === p.id))))) addTask({ ...definition, id: period.id }, "indicators", `Capturar ${definition.code}`, text(definition, "code"), `${definition.name} · ${period.year} ${period.quarter}`);
      if (!result || Date.parse(text(result, "submitted_at")) > now.getTime()) continue;
      const indicator = { metric: text(definition, "metric_label"), evaluationRules: { compliant: text(rule, "compliant_rule"), marginal: text(rule, "marginal_rule"), noncompliant: text(rule, "noncompliant_rule") } } as ConfiguredIndicator;
      const recordedStatus = text(result, "evaluation_status");
      const status = ["compliant", "marginal", "noncompliant"].includes(recordedStatus) ? recordedStatus : evaluateConfiguredIndicator(indicator, Number(result.value), Number(period.year), text(period, "quarter") as Quarter, now);
      const key = `${period.year} ${period.quarter}`;
      const total = history.get(key) ?? { passed: 0, total: 0 };
      total.total++; if (status === "compliant") total.passed++; history.set(key, total);
    }
  }
  const series = [...history].sort(([a], [b]) => a.localeCompare(b));
  dashboard.trends[0].series = series.map(([label, counts]) => ({ label, value: Math.round(100 * counts.passed / counts.total), tone: "neutral" }));
  dashboard.trends[0].detail = "Cumplimiento por periodo (%) · sólo capturas reales";
  const latestPeriod = series.at(-1);
  const compliance = dashboard.kpis.find(k => k.id === "indicator-compliance")!;
  if (latestPeriod) { compliance.value = `${Math.round(100 * latestPeriod[1].passed / latestPeriod[1].total)}%`; compliance.detail = `${latestPeriod[0]} · ${latestPeriod[1].total} capturas evaluadas`; }
  const open = dashboard.kpis.find(k => k.id === "open-actions")!; open.value = String(actions.filter(a => a.status !== "closed").length); open.detail = "Expedientes reales autorizados";
  const current = dashboard.kpis.find(k => k.id === "current-documents")!; current.value = String(dashboard.documentMetrics.find(m => m.id === "current")!.value); current.detail = "Documentos vigentes autorizados";
  const completed = dashboard.kpis.find(k => k.id === "completed-audits")!; completed.value = String(audits.filter(a => a.completed_at).length); completed.detail = "Auditorías con fecha real de conclusión";
  const overdue = dashboard.kpis.find(k => k.id === "overdue-assets")!; overdue.value = String(assets.filter(a => !a.schedule_pending && text(a, "next_due_date") && text(a, "next_due_date") < today).length); overdue.detail = "Vencimientos registrados";
  dashboard.pendingTasks = [...new Map(tasks.map(t => [`${t.module}:${t.targetId}:${t.detail}`, t])).values()];
  dashboard.alerts = dashboard.pendingTasks.map(t => ({ ...t, alertType: "Atención" }));
  const targets = new Map<string, { module: "documents" | "corrective-actions" | "indicators"; target: string }>();
  documents.forEach(d => targets.set(`controlled_document:${d.id}`, { module: "documents", target: text(d, "id") }));
  actions.forEach(a => targets.set(`corrective_action:${a.id}`, { module: "corrective-actions", target: text(a, "id") }));
  definitions.forEach(d => targets.set(`indicator_definition:${d.id}`, { module: "indicators", target: text(d, "code") }));
  dashboard.recentActivity = (records.activity ?? []).flatMap(e => {
    const target = targets.get(`${e.resource_type}:${e.resource_id}`);
    if (!target || !Number.isFinite(Date.parse(text(e, "created_at")))) return [];
    return [{ id: text(e, "id"), actor: text(e, "user_name_snapshot") || "Usuario registrado", description: text(e, "action"), occurredAt: text(e, "created_at"), module: target.module, moduleLabel: target.module, targetId: target.target }];
  });
  for (const e of records.documentActivity ?? []) if (documentIds.has(e.document_id) && Number.isFinite(Date.parse(text(e, "performed_at")))) dashboard.recentActivity.push({ id: `doc-${e.id}`, actor: text(e, "performed_by"), description: text(e, "event_type"), occurredAt: text(e, "performed_at"), module: "documents", moduleLabel: "Documentos", targetId: text(e, "document_id") });
  for (const p of periods) { const r = results.get(p.id); const d = definitions.find(d => d.id === p.indicator_id); if (r && d && Number.isFinite(Date.parse(text(r, "submitted_at")))) dashboard.recentActivity.push({ id: `kpi-${r.id}`, actor: text(r, "submitted_by"), description: `Captura ${d.code} · ${p.year} ${p.quarter}`, occurredAt: text(r, "submitted_at"), module: "indicators", moduleLabel: "Indicadores", targetId: text(d, "code") }); }
  dashboard.recentActivity.sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  dashboard.recentActivity = dashboard.recentActivity.filter(a => dateMatches(a.occurredAt));
  dashboard.filterOptions.responsibles = [...new Set([...(records.actions ?? []), ...(records.indicators ?? []), ...(records.versions ?? [])].flatMap(r => [text(r, "owner_name"), text(r, "leader_name"), text(r, "validator_id"), text(r, "uploaded_by")]).filter(Boolean))];
  dashboard.filterOptions.statuses = [...new Set([...(records.actions ?? []), ...(records.versions ?? [])].map(r => text(r, "status")).filter(Boolean))].map(s => `${s}|${s}`);
  for (const status of dashboard.moduleStatus) if (["documents", "indicators", "corrective-actions", "audits"].includes(status.id)) { status.sourceConnected = true; status.value = `${dashboard.pendingTasks.filter(t => t.module === status.id).length} pendientes`; status.detail = "Registros autorizados de Supabase"; }
  dashboard.searchIndex = [
    ...documents.map(d => ({ id: text(d, "id"), title: `${d.code} · ${d.title}`, meta: "Documentos", module: "documents" as const, searchText: `${d.code} ${d.title} ${d.process_id}` })),
    ...actions.map(a => ({ id: text(a, "id"), title: `${a.folio} · ${a.title}`, meta: "Root2Cause", module: "corrective-actions" as const, searchText: `${a.folio} ${a.title} ${a.process_id}` })),
    ...definitions.map(d => ({ id: text(d, "code"), title: `${d.code} · ${d.name}`, meta: "Indicadores", module: "indicators" as const, searchText: `${d.code} ${d.name} ${d.process_id}` })),
  ];
  dashboard.upcomingEvents = audits.filter(a => text(a, "scheduled_date") >= today && !a.completed_at && a.status !== "cancelled").map(a => ({ id: text(a, "id"), title: text(a, "title"), detail: text(a, "code"), date: text(a, "scheduled_date"), module: "audits", tone: "neutral", targetId: text(a, "id") }));
  for (const kpi of dashboard.kpis) if (!canPerformModuleAction(session, kpi.module, "view")) { kpi.value = "Sin acceso"; kpi.detail = "Fuera de los permisos de consulta"; }
  for (const status of dashboard.moduleStatus) if (status.module && !canPerformModuleAction(session, status.module, "view")) { status.sourceConnected = false; status.value = "Sin acceso"; status.detail = "Fuera de los permisos de consulta"; }
  return dashboard;
}
