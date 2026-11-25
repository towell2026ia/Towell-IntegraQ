import { NextResponse } from "next/server";
import { buildMatrixDashboard, matchesFilters } from "@/lib/rncp/analytics";
import { generateSupplierAlerts, semanticAlerts, validateAlertRules } from "@/lib/rncp/alerts";
import { emptyMatrixFilters, type MatrixFilters } from "@/lib/rncp/model";
import { loadMatrixOriginalCounts, loadMatrixReports, readRncpSettings, rncpContext, RncpError } from "@/lib/rncp/server";
import { configuredSemanticProvider } from "@/lib/rncp/semantic-provider";
import { signAlertReview } from "@/lib/rncp/review-signature";
import { exportMatrix } from "@/lib/rncp/export";
import { selectedAlertPeriod } from "@/lib/rncp/alert-period";

export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const started = performance.now();
    const phases: string[] = [];
    const record = (phase: string, ms: number) => { phases.push(phase + ";dur=" + ms.toFixed(1)); };
    const headers = () => ({ "Cache-Control": "private, no-store", "Server-Timing": [...phases, "total;dur=" + (performance.now() - started).toFixed(1)].join(", ") });
    const context = await rncpContext("view", false, record);
    const query = new URL(request.url).searchParams;
    if (query.get("part") === "pdfCounts") {
      return NextResponse.json({ counts: await loadMatrixOriginalCounts(context) }, { headers: headers() });
    }
    const reportId = query.get("reportId");
    if (reportId !== null) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reportId)) throw new RncpError("Selecciona un expediente válido.");
      const [report] = await loadMatrixReports(context, reportId, false, record);
      return NextResponse.json({ report }, { headers: headers() });
    }
    const filters = { ...emptyMatrixFilters };
    for (const key of Object.keys(filters) as Array<keyof MatrixFilters>) filters[key] = query.get(key) ?? "";
    if (filters.year && !/^20\d{2}$/.test(filters.year) || filters.month && !/^(0?[1-9]|1[012])$/.test(filters.month) || filters.day && !/^(0?[1-9]|[12]\d|3[01])$/.test(filters.day)) throw new RncpError("Segmentación de fecha inválida.");
    if ([filters.from, filters.to].some(value => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) || filters.from && filters.to && filters.from > filters.to) throw new RncpError("Rango de fechas inválido.");
    const [reports, configuration] = await Promise.all([loadMatrixReports(context, undefined, ["alerts", "list"].includes(query.get("part") ?? ""), record), readRncpSettings(context)]);
    const now = new Date().toISOString();
    const computation = performance.now();
    const dashboard = buildMatrixDashboard(reports, filters, now);
    if (context.profile.user_type === "administrator") dashboard.deletedReports = reports.filter(report => report.deletedAt);
    record("kpi", performance.now() - computation);
    const format = query.get("format");
    if (format === "csv" || format === "xlsx") {
      if (context.profile.user_type !== "administrator") throw new RncpError("Exportación exclusiva de administradores.", 403);
      return exportMatrix(dashboard, format);
    }
    const rules = validateAlertRules(configuration.settings.alertRules);
    const dateFree = { ...filters, year: "", month: "", day: "", from: "", to: "" };
    const candidates = reports.filter(r => matchesFilters(r, dateFree, now));
    const range = selectedAlertPeriod(filters, dashboard.reports, now);
    dashboard.alerts = generateSupplierAlerts(candidates, now, rules, configuration.reviews, range);
    const provider = configuredSemanticProvider();
    // No service call occurs unless both deployment configuration and recorded admin consent exist.
    const semantic = await semanticAlerts(dashboard.reports, provider, configuration.settings.semanticAiApproved,
      range ?? { from: new Date(Date.parse(now) - (rules.periodDays - 1) * 86_400_000).toISOString().slice(0, 10), to: now.slice(0, 10) });
    dashboard.aiStatus = semantic.status;
    dashboard.alerts.push(...semantic.alerts.map(alert => ({ ...alert, review: configuration.reviews[alert.key] })));
    dashboard.alerts = dashboard.alerts.map(alert => ({ ...alert, reviewToken: signAlertReview(context.organizationId, alert.key) }));
    if (query.get("part") === "alerts") return NextResponse.json({ alerts: dashboard.alerts, aiStatus: dashboard.aiStatus }, { headers: headers() });
    const inspector = await context.supabase.rpc("iq_rncp_is_inspector", { p_organization_id: context.organizationId });
    return NextResponse.json({ ...dashboard, settings: configuration.settings, settingsRevision: configuration.settingsRevision,
      reviewsRevision: configuration.reviewsRevision, isInspector: inspector.data === true,
      aiConfigured: Boolean(provider), notificationsEnabled: false }, { headers: headers() });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible consultar RNCP." }, { status: error instanceof RncpError ? error.status : 500 }); }
}
