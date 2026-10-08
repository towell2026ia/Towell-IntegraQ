import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { canPerformModuleAction } from "@/lib/module-permissions";
import { isAdministrator } from "@/lib/session-data";
import type { SupplierDashboardFilters, SupplierDashboardMetrics, SupplierDashboardRow, SupplierTimelineEvent } from "@/lib/supplier-dashboard-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

type CompanyRow = { id: string; code: string; name: string; active: boolean };
type ProfileRow = { organization_id: string; category: string | null; active: boolean };
type SiteRow = { id: string; company_id: string; code: string; name: string; active: boolean };
type ReportRow = { id: string; folio: string; supplier_id: string | null; site_id: string | null; report_date: string | null; material_or_service: string | null; finding_type: string | null; description: string | null; response_due_date: string | null; responsible_name: string | null; status: SupplierDashboardRow["status"]; submitted_at: string | null; closed_at: string | null; created_at: string };
type ActionRow = { id: string; report_id: string; description: string; status: string; created_at: string; validated_at: string | null };
type AuditRow = { id: string; code: string; external_organization_id: string | null; external_site_id: string | null; scheduled_date: string; completed_at: string | null; status: string; score: number | null };
type EvaluationRow = { id: string; supplier_id: string; site_id: string | null; period_end: string; effectiveness: number; quality_level: number; created_at: string };
type AssessmentDashboardRow = { id: string; supplier_id: string; site_id: string | null; assessment_type: string; assessment_date: string; score: number | null; classification: string | null };
type HistoryRow = { id: string; resource_id: string; action: string; created_at: string; reason: string | null };

const openActionStatuses = new Set(["pending", "in_progress", "submitted", "rejected"]);

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  if (!canPerformModuleAction(session, "suppliers", "view")) return NextResponse.json({ error: "No tienes permiso para consultar proveedores." }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const filters = readFilters(query);
  const admin = createAdminClient();
  const [companiesResult, profilesResult, sitesResult, reportsResult, actionsResult, auditsResult, evaluationsResult, assessmentsResult] = await Promise.all([
    admin.from("organizations").select("id,code,name,active").eq("kind", "supplier").order("name"),
    admin.from("supplier_quality_profiles").select("organization_id,category,active"),
    admin.from("external_company_sites").select("id,company_id,code,name,active").order("name"),
    admin.from("supplier_rncp_reports").select("id,folio,supplier_id,site_id,report_date,material_or_service,finding_type,description,response_due_date,responsible_name,status,submitted_at,closed_at,created_at").is("deleted_at", null).order("report_date", { ascending: false, nullsFirst: false }),
    admin.from("supplier_rncp_actions").select("id,report_id,description,status,created_at,validated_at").order("created_at", { ascending: false }),
    admin.from("audits").select("id,code,external_organization_id,external_site_id,scheduled_date,completed_at,status,score").eq("audit_type", "supplier").order("scheduled_date", { ascending: false }),
    admin.from("supplier_quality_evaluations").select("id,supplier_id,site_id,period_end,effectiveness,quality_level,created_at").order("period_end", { ascending: false }),
    admin.from("supplier_assessments").select("id,supplier_id,site_id,assessment_type,assessment_date,score,classification").order("assessment_date", { ascending: false }),
  ]);
  const failed = [companiesResult, profilesResult, sitesResult, reportsResult, actionsResult, auditsResult, evaluationsResult, assessmentsResult].find((result) => result.error);
  if (failed?.error) {
    console.error("No fue posible construir el dashboard de proveedores.", failed.error);
    return NextResponse.json({ error: "No fue posible consultar el dashboard de proveedores." }, { status: 500 });
  }

  const companies = (companiesResult.data ?? []) as CompanyRow[];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const sites = (sitesResult.data ?? []) as SiteRow[];
  const reports = (reportsResult.data ?? []) as ReportRow[];
  const actions = (actionsResult.data ?? []) as ActionRow[];
  const audits = (auditsResult.data ?? []) as AuditRow[];
  const evaluations = (evaluationsResult.data ?? []) as EvaluationRow[];
  const assessments = (assessmentsResult.data ?? []) as AssessmentDashboardRow[];
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const siteMap = new Map(sites.map((site) => [site.id, site]));
  const categoryMap = new Map(profiles.map((profile) => [profile.organization_id, profile.category ?? "Sin categoría"]));
  const supplierCompanyIds = new Set(companies.map((company) => company.id));
  const actionsByReport = new Map<string, ActionRow[]>();
  actions.forEach((action) => actionsByReport.set(action.report_id, [...(actionsByReport.get(action.report_id) ?? []), action]));

  const rows = reports.map((report) => toDashboardRow(report, companyMap, siteMap, categoryMap, actionsByReport)).filter((row) => matchesRow(row, filters));
  const rowIds = new Set(rows.map((row) => row.id));
  const scopedAudits = audits.filter((audit) => matchesRelated(audit.external_organization_id, audit.external_site_id, audit.completed_at?.slice(0, 10) ?? audit.scheduled_date, companyMap, categoryMap, filters));
  const scopedEvaluations = evaluations.filter((evaluation) => matchesRelated(evaluation.supplier_id, evaluation.site_id, evaluation.period_end, companyMap, categoryMap, filters));
  const scopedAssessments = assessments.filter((assessment) => matchesRelated(assessment.supplier_id, assessment.site_id, assessment.assessment_date, companyMap, categoryMap, filters));
  const filteredActions = actions.filter((action) => rowIds.has(action.report_id));
  const metrics = calculateMetrics(rows, filteredActions, scopedAudits, scopedEvaluations, scopedAssessments, reports);

  const historyResult = rowIds.size
    ? await admin.from("audit_log").select("id,resource_id,action,created_at,reason").eq("resource_type", "supplier_rncp_report").in("resource_id", [...rowIds]).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (historyResult.error) return NextResponse.json({ error: "No fue posible consultar el histórico de proveedores." }, { status: 500 });
  const timeline = buildTimeline(rows, filteredActions, scopedAudits, scopedEvaluations, scopedAssessments, (historyResult.data ?? []) as HistoryRow[], companyMap);
  const options = {
    suppliers: companies.filter((company) => company.active).map((company) => ({ id: company.id, label: `${company.code} · ${company.name}` })),
    sites: sites.filter((site) => site.active && supplierCompanyIds.has(site.company_id)).map((site) => ({ id: site.id, supplierId: site.company_id, label: `${site.code} · ${site.name}` })),
    categories: [...new Set(profiles.filter((profile) => profile.active && profile.category).map((profile) => profile.category!))].sort((left, right) => left.localeCompare(right, "es")),
  };

  const format = query.get("format");
  if (format === "csv" || format === "xlsx") {
    if (!isAdministrator(session)) return NextResponse.json({ error: "Sólo un administrador puede exportar el dashboard." }, { status: 403 });
    return format === "csv" ? csvResponse(rows) : xlsxResponse(rows, metrics);
  }
  return NextResponse.json({ metrics, rows, timeline, options });
}

function readFilters(query: URLSearchParams): SupplierDashboardFilters {
  return { search: query.get("search") ?? "", supplierId: query.get("supplierId") ?? "", siteId: query.get("siteId") ?? "", status: query.get("status") ?? "", dateFrom: query.get("dateFrom") ?? "", dateTo: query.get("dateTo") ?? "", category: query.get("category") ?? "", lateOnly: query.get("lateOnly") === "true", pendingActionsOnly: query.get("pendingActionsOnly") === "true" };
}

function toDashboardRow(report: ReportRow, companies: Map<string, CompanyRow>, sites: Map<string, SiteRow>, categories: Map<string, string>, actions: Map<string, ActionRow[]>): SupplierDashboardRow {
  const company = report.supplier_id ? companies.get(report.supplier_id) : undefined;
  const site = report.site_id ? sites.get(report.site_id) : undefined;
  return { id: report.id, folio: report.folio, supplierId: report.supplier_id ?? "", supplierCode: company?.code ?? "", supplierName: company?.name ?? "Proveedor pendiente", siteId: report.site_id ?? undefined, siteName: site?.name, reportDate: report.report_date ?? undefined, category: report.supplier_id ? categories.get(report.supplier_id) : undefined, status: report.status, late: Boolean(report.response_due_date && !["draft", "closed"].includes(report.status) && report.response_due_date < mexicoDate()), findingType: report.finding_type ?? undefined, materialOrService: report.material_or_service ?? undefined, responsibleName: report.responsible_name ?? undefined, responseDueDate: report.response_due_date ?? undefined, openActions: (actions.get(report.id) ?? []).filter((action) => openActionStatuses.has(action.status)).length };
}

function matchesRow(row: SupplierDashboardRow, filters: SupplierDashboardFilters) {
  const search = filters.search.trim().toLocaleLowerCase("es");
  if (filters.supplierId && row.supplierId !== filters.supplierId) return false;
  if (filters.siteId && row.siteId !== filters.siteId) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.dateFrom && (!row.reportDate || row.reportDate < filters.dateFrom)) return false;
  if (filters.dateTo && (!row.reportDate || row.reportDate > filters.dateTo)) return false;
  if (filters.category && row.category !== filters.category) return false;
  if (filters.lateOnly && !row.late) return false;
  if (filters.pendingActionsOnly && row.openActions === 0) return false;
  return !search || [row.folio, row.supplierCode, row.supplierName, row.siteName, row.findingType, row.materialOrService, row.responsibleName].some((value) => value?.toLocaleLowerCase("es").includes(search));
}

function matchesRelated(supplierId: string | null, siteId: string | null, date: string, companies: Map<string, CompanyRow>, categories: Map<string, string>, filters: SupplierDashboardFilters) {
  if (!supplierId || !companies.has(supplierId)) return false;
  if (filters.supplierId && supplierId !== filters.supplierId) return false;
  if (filters.siteId && siteId !== filters.siteId) return false;
  if (filters.dateFrom && date < filters.dateFrom) return false;
  if (filters.dateTo && date > filters.dateTo) return false;
  if (filters.category && categories.get(supplierId) !== filters.category) return false;
  const search = filters.search.trim().toLocaleLowerCase("es");
  if (search && ![companies.get(supplierId)?.code, companies.get(supplierId)?.name].some((value) => value?.toLocaleLowerCase("es").includes(search))) return false;
  return true;
}

function calculateMetrics(rows: SupplierDashboardRow[], actions: ActionRow[], audits: AuditRow[], evaluations: EvaluationRow[], assessments: AssessmentDashboardRow[], rawReports: ReportRow[]): SupplierDashboardMetrics {
  const rawMap = new Map(rawReports.map((report) => [report.id, report]));
  const durations = rows.flatMap((row) => { const report = rawMap.get(row.id); if (!report?.closed_at) return []; const start = report.submitted_at ?? report.report_date ?? report.created_at; return [Math.max(0, (Date.parse(report.closed_at) - Date.parse(start)) / 86_400_000)]; });
  const latestLegacy = evaluations[0] ? { date: evaluations[0].period_end, score: evaluations[0].effectiveness } : null;
  const latestStructured = assessments.find((assessment) => assessment.assessment_type !== "supplier_audit" && assessment.score !== null);
  const latestEvaluation = !latestStructured ? latestLegacy?.score ?? null : !latestLegacy || latestStructured.assessment_date >= latestLegacy.date ? latestStructured.score : latestLegacy.score;
  return { total: rows.length, open: rows.filter((row) => row.status === "submitted" || row.status === "in_progress").length, late: rows.filter((row) => row.late).length, closed: rows.filter((row) => row.status === "closed").length, closureRate: rows.length ? Math.round(rows.filter((row) => row.status === "closed").length / rows.length * 1000) / 10 : 0, averageCloseDays: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length * 10) / 10 : null, openActions: actions.filter((action) => openActionStatuses.has(action.status)).length, completedAudits: audits.filter((audit) => audit.status === "completed").length + assessments.filter((assessment) => assessment.assessment_type === "supplier_audit").length, latestEvaluation };
}

function buildTimeline(rows: SupplierDashboardRow[], actions: ActionRow[], audits: AuditRow[], evaluations: EvaluationRow[], assessments: AssessmentDashboardRow[], history: HistoryRow[], companies: Map<string, CompanyRow>): SupplierTimelineEvent[] {
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const events: SupplierTimelineEvent[] = [];
  history.forEach((event) => { const row = rowMap.get(event.resource_id); if (row) events.push(timelineEvent(event.id, row.supplierId, row.supplierName, event.created_at, "rncp", historyTitle(event.action), `${row.folio}${event.reason ? ` · ${event.reason}` : ""}`)); });
  actions.forEach((action) => { const row = rowMap.get(action.report_id); if (row) events.push(timelineEvent(action.id, row.supplierId, row.supplierName, action.validated_at ?? action.created_at, "action", action.status === "accepted" ? "Acción validada" : "Acción RNCP actualizada", `${row.folio} · ${action.description}`)); });
  audits.forEach((audit) => { const company = audit.external_organization_id ? companies.get(audit.external_organization_id) : undefined; if (company && audit.completed_at) events.push(timelineEvent(audit.id, company.id, company.name, audit.completed_at, "audit", `Auditoría ${audit.score ?? "sin calificación"}${audit.score === null ? "" : " %"}`, audit.code)); });
  evaluations.forEach((evaluation) => { const company = companies.get(evaluation.supplier_id); if (company) events.push(timelineEvent(evaluation.id, company.id, company.name, `${evaluation.period_end}T12:00:00Z`, "evaluation", `Evaluación ${evaluation.effectiveness} %`, `Nivel de calidad ${evaluation.quality_level} %`)); });
  assessments.forEach((assessment) => { const company = companies.get(assessment.supplier_id); if (company) events.push(timelineEvent(assessment.id, company.id, company.name, `${assessment.assessment_date}T12:00:00Z`, assessment.assessment_type === "supplier_audit" ? "audit" : "evaluation", `${assessment.assessment_type === "supplier_audit" ? "Auditoría" : "Evaluación"}${assessment.score === null ? " registrada" : ` ${assessment.score} %`}`, assessment.classification ?? "Sin clasificación")); });
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function timelineEvent(id: string, supplierId: string, supplierName: string, occurredAt: string, kind: SupplierTimelineEvent["kind"], title: string, detail: string): SupplierTimelineEvent { return { id: `${kind}-${id}`, supplierId, supplierName, occurredAt, year: Number(occurredAt.slice(0, 4)), kind, title, detail }; }
function historyTitle(action: string) { return ({ "rncp.submitted": "RNCP enviada", "rncp.closed": "RNCP cerrada", "rncp.reopened": "RNCP reabierta", "rncp.deleted": "RNCP eliminada", "rncp.restored": "RNCP restaurada" } as Record<string, string>)[action] ?? "RNCP actualizada"; }
function mexicoDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

const exportColumns = ["folio", "supplierCode", "supplierName", "siteName", "reportDate", "category", "status", "late", "findingType", "materialOrService", "responsibleName", "responseDueDate", "openActions"] as const;
function csvResponse(rows: SupplierDashboardRow[]) { const csv = [exportColumns.join(","), ...rows.map((row) => exportColumns.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n"); return new NextResponse(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=dashboard-proveedores.csv" } }); }
async function xlsxResponse(rows: SupplierDashboardRow[], metrics: SupplierDashboardMetrics) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("RNCP filtradas");
  sheet.columns = exportColumns.map((key) => ({ header: key, key, width: key.includes("Name") || key.includes("Type") || key.includes("Material") ? 30 : 18 })); sheet.addRows(rows); sheet.getRow(1).font = { bold: true }; sheet.autoFilter = `A1:M1`;
  const summary = workbook.addWorksheet("Métricas"); summary.columns = [{ header: "Métrica", key: "label", width: 28 }, { header: "Valor", key: "value", width: 18 }]; summary.addRows([{ label: "RNCP totales", value: metrics.total }, { label: "Abiertas", value: metrics.open }, { label: "Tardías", value: metrics.late }, { label: "Cerradas", value: metrics.closed }, { label: "% cierre", value: metrics.closureRate }, { label: "Promedio días cierre", value: metrics.averageCloseDays }, { label: "Acciones abiertas", value: metrics.openActions }, { label: "Auditorías realizadas", value: metrics.completedAudits }, { label: "Última evaluación", value: metrics.latestEvaluation }]); summary.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer(); return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=dashboard-proveedores.xlsx" } });
}
