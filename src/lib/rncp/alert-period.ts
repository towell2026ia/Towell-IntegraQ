import type { MatrixFilters, MatrixReport } from "./model";

/** Calendar bounds, never the first/last incident as a proxy for a full month. */
export function selectedAlertPeriod(filters: MatrixFilters, reports: MatrixReport[], now: string) {
  if (![filters.year, filters.month, filters.day, filters.from, filters.to].some(Boolean)) return undefined;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const dates = reports.flatMap(r => r.reportDate ? [r.reportDate] : []).sort();
  let from = filters.from || dates[0] || today, to = filters.to || today;
  const year = filters.year, month = filters.month.padStart(2, "0"), day = filters.day.padStart(2, "0");
  if (year) {
    const lower = `${year}-${filters.month ? month : "01"}-${filters.day ? day : "01"}`;
    const last = filters.month ? String(new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()).padStart(2, "0") : "31";
    const upper = `${year}-${filters.month ? month : "12"}-${filters.day ? day : last}`;
    from = filters.from && filters.from > lower ? filters.from : lower;
    to = to < upper ? to : upper;
  }
  return { from, to, currentIds: reports.map(r => r.id), allowComparison: !(filters.month && !year) };
}
