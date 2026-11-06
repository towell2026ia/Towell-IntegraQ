import { NextResponse } from "next/server";
import { buildMatrixDashboard, matchesFilters } from "@/lib/rncp/analytics";
import { generateSupplierAlerts, semanticAlerts, validateAlertRules } from "@/lib/rncp/alerts";
import { emptyMatrixFilters, type MatrixFilters } from "@/lib/rncp/model";
import { loadMatrixReports, readRncpSettings, rncpContext, RncpError } from "@/lib/rncp/server";
import { configuredSemanticProvider } from "@/lib/rncp/semantic-provider";
import { signAlertReview } from "@/lib/rncp/review-signature";
import { exportMatrix } from "@/lib/rncp/export";
import { selectedAlertPeriod } from "@/lib/rncp/alert-period";

export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const context = await rncpContext();
    const query = new URL(request.url).searchParams;
    const filters = { ...emptyMatrixFilters };
    for (const key of Object.keys(filters) as Array<keyof MatrixFilters>) filters[key] = query.get(key) ?? "";
    if (filters.year && !/^20\d{2}$/.test(filters.year) || filters.month && !/^(0?[1-9]|1[012])$/.test(filters.month) || filters.day && !/^(0?[1-9]|[12]\d|3[01])$/.test(filters.day)) throw new RncpError("Segmentación de fecha inválida.");
    if ([filters.from, filters.to].some(value => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) || filters.from && filters.to && filters.from > filters.to) throw new RncpError("Rango de fechas inválido.");
    const [reports, configuration] = await Promise.all([loadMatrixReports(context), readRncpSettings(context)]);
    const now = new Date().toISOString();
    const dashboard = buildMatrixDashboard(reports, filters, now);
    if (context.profile.user_type === "administrator") dashboard.deletedReports = reports.filter(report => report.deletedAt);
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
    const inspector = await context.supabase.rpc("iq_rncp_is_inspector", { p_organization_id: context.organizationId });
    return NextResponse.json({ ...dashboard, settings: configuration.settings, settingsRevision: configuration.settingsRevision,
      reviewsRevision: configuration.reviewsRevision, isInspector: inspector.data === true,
      aiConfigured: Boolean(provider), notificationsEnabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible consultar RNCP." }, { status: error instanceof RncpError ? error.status : 500 }); }
}
