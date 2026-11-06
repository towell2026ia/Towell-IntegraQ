import { emptyMatrixFilters, materialColors, statusColors, stateLabels, supplierKey, type MatrixDashboard, type MatrixFilters, type MatrixReport, type LifecycleResult } from "./model";

const dayMs = 86_400_000;
export function responseDeadline(notifiedAt: string | null) {
  if (!notifiedAt || !Number.isFinite(Date.parse(notifiedAt))) return null;
  // Mexico City has no DST during the supported RNCP period (2024 onwards).
  return new Date(Date.parse(notifiedAt) + 7 * dayMs).toISOString();
}
export function deriveLifecycle(report: MatrixReport, now: string): LifecycleResult {
  const historical = report.origin === "historical";
  if (historical || !report.notifiedAt) {
    const state = historical ? ({ Cerrado: "closed", Tarde: "late", "En Proceso": "in_process" } as const)[report.historicalStatus ?? ""] ?? "draft" : "draft";
    return { state, chartStatus: historical ? report.historicalStatus ?? "Sin estado histórico" : stateLabels.draft,
      timeliness: "unknown", deadline: null, remainingDays: null, historical,
      lateReason: historical && state === "late" ? "historical_category" : null };
  }
  const deadline = responseDeadline(report.notifiedAt);
  if (!deadline) throw new Error("Fecha de notificación RNCP inválida.");
  if (report.responseDeadline && Date.parse(report.responseDeadline) !== Date.parse(deadline)) throw new Error("El vencimiento no coincide con la notificación original.");
  const nowMs = Date.parse(now), deadlineMs = Date.parse(deadline), notifiedMs = Date.parse(report.notifiedAt);
  const complete = report.requirementsComplete && report.completeSubmittedAt && report.validationOutcome !== "rejected";
  const completedAt = complete ? Date.parse(report.completeSubmittedAt!) : null;
  const late = nowMs >= deadlineMs && (!completedAt || completedAt > deadlineMs);
  const timeliness = completedAt ? completedAt <= deadlineMs ? "within_deadline" : "late" : late ? "late" : "pending";
  const state = report.closedAt && report.validationOutcome === "accepted" ? "closed"
    : complete ? "validation" : late ? "late" : report.firstValidProgressAt ? "in_process"
    : nowMs > notifiedMs + dayMs ? "unattended" : "open";
  return { state, chartStatus: stateLabels[state], timeliness, deadline, historical: false,
    remainingDays: Math.ceil((deadlineMs - nowMs) / dayMs),
    lateReason: late && !complete ? report.firstValidProgressAt ? "incomplete" : "no_response" : null };
}
export function matchesFilters(report: MatrixReport, filters: MatrixFilters, now: string) {
  const date = report.reportDate;
  if ((filters.year || filters.month || filters.day || filters.from || filters.to) && !date) return false;
  if (filters.year && date?.slice(0, 4) !== filters.year) return false;
  if (filters.month && date?.slice(5, 7) !== filters.month.padStart(2, "0")) return false;
  if (filters.day && date?.slice(8, 10) !== filters.day.padStart(2, "0")) return false;
  if (filters.from && date! < filters.from) return false;
  if (filters.to && date! > filters.to) return false;
  if (filters.material && report.material !== filters.material) return false;
  if (filters.supplierId && supplierKey(report) !== filters.supplierId) return false;
  if (filters.state && deriveLifecycle(report, now).state !== filters.state) return false;
  const search = normalizeText(filters.search);
  return !search || normalizeText([report.folio, report.supplierName, report.supplierCode, report.defect].join(" ")).includes(search);
}
export function buildMatrixDashboard(all: MatrixReport[], filters = emptyMatrixFilters, now = new Date().toISOString()): MatrixDashboard {
  const available = all.filter(report => !report.deletedAt);
  const reports = available.filter(report => matchesFilters(report, filters, now));
  const metrics: MatrixDashboard["metrics"] = { total: reports.length, draft: 0, open: 0, unattended: 0, in_process: 0, late: 0, validation: 0, closed: 0,
    timely: 0, overdueNoResponse: 0, measurable: 0, responseCompliance: null, historical: 0 };
  const materials = new Map<string, number>(), statuses = new Map<string, number>(), dates = new Map<string, number>();
  const suppliers = new Map<string, MatrixDashboard["bySupplier"][number]>();
  for (const report of reports) {
    const life = deriveLifecycle(report, now); metrics[life.state]++;
    if (life.historical) metrics.historical++;
    // Only completed or overdue, verified notification cohorts have a measurable outcome.
    if (!life.historical && (life.timeliness === "within_deadline" || life.timeliness === "late")) metrics.measurable++;
    if (life.timeliness === "within_deadline") metrics.timely++;
    if (life.lateReason === "no_response") metrics.overdueNoResponse++;
    materials.set(report.material || "Sin materia prima", (materials.get(report.material || "Sin materia prima") ?? 0) + 1);
    statuses.set(life.chartStatus, (statuses.get(life.chartStatus) ?? 0) + 1);
    if (report.reportDate) dates.set(report.reportDate, (dates.get(report.reportDate) ?? 0) + 1);
    const key = supplierKey(report);
    const row = suppliers.get(key) ?? { key, supplierId: report.supplierId, label: report.supplierName, count: 0, statuses: {}, cumulativePercent: 0 };
    row.count++; row.statuses[life.chartStatus] = (row.statuses[life.chartStatus] ?? 0) + 1; suppliers.set(key, row);
  }
  metrics.responseCompliance = metrics.measurable ? metrics.timely / metrics.measurable * 100 : null;
  const bySupplier = [...suppliers.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
  let cumulative = 0;
  for (const supplier of bySupplier) { cumulative += supplier.count; supplier.cumulativePercent = reports.length ? cumulative / reports.length * 100 : 0; }
  return { reports, metrics, filters, now,
    byMaterial: [...materials].map(([label, count]) => ({ label, count })).sort((a, b) => legendPosition(a.label, materialColors) - legendPosition(b.label, materialColors) || a.label.localeCompare(b.label, "es")),
    byStatus: [...statuses].map(([label, count]) => ({ label, count })).sort((a, b) => legendPosition(a.label, statusColors) - legendPosition(b.label, statusColors)), bySupplier,
    byDate: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    options: { years: [...new Set(available.flatMap(r => r.reportDate ? [r.reportDate.slice(0, 4)] : []))].sort().reverse(),
      materials: [...new Set(available.map(r => r.material).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
      suppliers: [...new Map(available.map(r => [supplierKey(r), { key: supplierKey(r), label: r.supplierName }])).values()].sort((a, b) => a.label.localeCompare(b.label, "es")) },
    alerts: [], aiStatus: "disabled", schemaReady: true, sourceCount: available.length };
}
export function normalizeText(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim(); }
function legendPosition(label: string, palette: Record<string, string>) { const index = Object.keys(palette).indexOf(label); return index < 0 ? 999 : index; }
