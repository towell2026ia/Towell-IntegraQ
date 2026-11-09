import type { RncpReport } from "@/lib/rncp-data";

type Category = "historicalClosed" | "historicalLate" | "nativeClosed" | "nativeLate";
function timestamp(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function category(report: RncpReport, now: number): Category | null {
  if (report.status === "draft") return null;
  if (report.origin === "historical") {
    return report.historicalStatus === "Cerrado" ? "historicalClosed"
      : report.historicalStatus === "Tarde" ? "historicalLate" : null;
  }
  // A status or visual late flag does not prove when a complete response arrived.
  if (report.origin !== "native" || report.status !== "closed" || report.validationOutcome !== "accepted") return null;
  const notified = timestamp(report.notifiedAt), deadline = timestamp(report.responseDeadline);
  const response = timestamp(report.completeSubmittedAt), validated = timestamp(report.validatedAt);
  if (notified === null || deadline === null || response === null || validated === null
    || deadline <= notified || response < notified || validated < response || validated > now) return null;
  return response <= deadline ? "nativeClosed" : "nativeLate";
}
export function supplierRncpEffectiveness(reports: readonly RncpReport[], supplierId: string, now = Date.now()) {
  const result = { historicalClosed: 0, historicalLate: 0, nativeClosed: 0, nativeLate: 0, excluded: 0 };
  const groups = new Map<string, Set<Category | null>>();
  for (const report of reports) {
    if (report.deletedAt || report.supplierId !== supplierId) continue;
    const categories = groups.get(report.id) ?? new Set<Category | null>();
    categories.add(category(report, now));
    groups.set(report.id, categories);
  }
  for (const categories of groups.values()) {
    const value = categories.size === 1 ? [...categories][0] : null;
    if (value) result[value]++; else result.excluded++;
  }
  const closed = result.historicalClosed + result.nativeClosed;
  const late = result.historicalLate + result.nativeLate;
  const evaluable = closed + late;
  return { ...result, closed, late, evaluable, percent: evaluable ? closed / evaluable * 100 : null };
}
