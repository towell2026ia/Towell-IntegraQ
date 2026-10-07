import type { IndicatorCaptureWindow, Quarter } from "@/lib/indicator-data";

export const INDICATOR_BUSINESS_TIME_ZONE = "America/Mexico_City";
export const DEFAULT_CAPTURE_DAYS_AFTER_CLOSE = 15;

export type IndicatorWindowState = "scheduled" | "open" | "closed";

export function buildDefaultCaptureWindows(
  year: number,
  captureDays = DEFAULT_CAPTURE_DAYS_AFTER_CLOSE,
): Record<Quarter, IndicatorCaptureWindow> {
  const days = Math.min(90, Math.max(1, Math.trunc(captureDays)));
  return Object.fromEntries(indicatorQuarters.map((quarter) => {
    const opening = defaultOpeningDate(year, quarter);
    const closing = addCalendarDays(opening, days - 1);
    return [quarter, {
      opensAt: businessDateBoundary(opening, "start"),
      closesAt: businessDateBoundary(closing, "end"),
    }];
  })) as Record<Quarter, IndicatorCaptureWindow>;
}

export function getIndicatorWindowState(
  window: IndicatorCaptureWindow | undefined,
  now = new Date(),
): IndicatorWindowState {
  if (!window) return "scheduled";
  const opensAt = new Date(window.opensAt).getTime();
  const closesAt = new Date(window.closesAt).getTime();
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) return "scheduled";
  if (now.getTime() < opensAt) return "scheduled";
  if (now.getTime() > closesAt) return "closed";
  return "open";
}

export function businessDateBoundary(date: string, boundary: "start" | "end") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Fecha de captura inválida.");
  const values = boundary === "start" ? [0, 0, 0, 0] : [23, 59, 59, 999];
  return zonedDateTimeToIso(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    values[0],
    values[1],
    values[2],
    values[3],
  );
}

export function formatBusinessDateInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = businessDateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatBusinessDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin configurar";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: INDICATOR_BUSINESS_TIME_ZONE,
  }).format(date);
}

export function formatBusinessWindow(window: IndicatorCaptureWindow | undefined) {
  if (!window) return "Ventana sin configurar";
  return `${formatBusinessDate(window.opensAt)} – ${formatBusinessDate(window.closesAt)}`;
}

function defaultOpeningDate(year: number, quarter: Quarter) {
  if (quarter === "Q1") return `${year}-04-01`;
  if (quarter === "Q2") return `${year}-07-01`;
  if (quarter === "Q3") return `${year}-10-01`;
  return `${year + 1}-01-01`;
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zoneOffsetFormatter.formatToParts(new Date(instant));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
    const represented = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"), millisecond);
    instant += desired - represented;
  }
  return new Date(instant).toISOString();
}

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: INDICATOR_BUSINESS_TIME_ZONE,
});

const indicatorQuarters: readonly Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

const zoneOffsetFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: INDICATOR_BUSINESS_TIME_ZONE,
  year: "numeric",
});
