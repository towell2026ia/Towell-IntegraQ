import { deriveLifecycle, normalizeText } from "./analytics";
import { defaultAlertRules, supplierKey, type AlertReview, type AlertRuleConfig, type MatrixReport, type SupplierAlert } from "./model";

const day = 86_400_000;
function dateMinus(date: string, days: number) { return new Date(Date.parse(`${date}T12:00:00Z`) - days * day).toISOString().slice(0, 10); }
function keyOf(type: string, supplier: string, ids: string[], from: string, to: string) {
  // Full input identity avoids hash collisions and makes dismissed cohorts stable.
  return JSON.stringify([type, supplier, [...ids].sort(), from, to]);
}
export function validateAlertRules(value: Partial<AlertRuleConfig>): AlertRuleConfig {
  const rules = { ...defaultAlertRules, ...value };
  for (const [key, count] of Object.entries(rules)) if (!Number.isFinite(count) || count < 1 || count > (key === "increasePercent" ? 10000 : 3650)) throw new Error("Reglas de alertas RNCP inválidas.");
  if (rules.criticalCount < rules.recurrenceCount || !Number.isInteger(rules.periodDays)) throw new Error("Umbrales de alertas RNCP inconsistentes.");
  return rules;
}
export function generateSupplierAlerts(all: MatrixReport[], now: string, rulesInput: Partial<AlertRuleConfig> = {}, reviews: Record<string, AlertReview> = {}, range?: { from: string; to: string; currentIds?: string[]; allowComparison?: boolean }): SupplierAlert[] {
  const rules = validateAlertRules(rulesInput), to = range?.to || now.slice(0, 10);
  const from = range?.from || dateMinus(to, rules.periodDays - 1);
  const length = Math.round((Date.parse(to) - Date.parse(from)) / day) + 1;
  if (length < 1) return [];
  const priorTo = dateMinus(from, 1), priorFrom = dateMinus(from, length);
  const scoped = all.filter(r => !r.deletedAt && r.reportDate);
  const current = scoped.filter(r => r.reportDate! >= from && r.reportDate! <= to && (!range?.currentIds || range.currentIds.includes(r.id)));
  const alerts: SupplierAlert[] = [];
  function add(type: SupplierAlert["type"], records: MatrixReport[], title: string, explanation: string, certainty: SupplierAlert["certainty"] = "confirmed") {
    if (!records.length) return;
    const first = records[0], key = keyOf(type, supplierKey(first), records.map(r => r.id), from, to);
    alerts.push({ key, type, supplierId: first.supplierId, supplierKey: supplierKey(first), supplierName: first.supplierName,
      severity: records.length >= rules.criticalCount ? "Crítica" : type === "deadline" || type === "increase" ? "Alta" : "Seguimiento",
      certainty, title, explanation, reportIds: records.map(r => r.id), folios: records.map(r => r.folio), from, to, count: records.length, review: reviews[key] });
  }
  const suppliers = new Set(current.map(supplierKey));
  for (const supplier of suppliers) {
    const rows = current.filter(r => supplierKey(r) === supplier);
    const groups = new Map<string, MatrixReport[]>();
    for (const row of rows) {
      const defect = normalizeText(row.defect);
      if (!defect) continue;
      const key = `${row.material}\u0000${defect}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const records of groups.values()) {
      if (records.length >= rules.recurrenceCount) add("recurrence", records, records[0].defect,
        `${records.length} RNCP del mismo proveedor y materia prima con descripción coincidente normalizada; umbral ${rules.recurrenceCount}. La causa raíz no se infiere.`);
      const previous = scoped.filter(r => supplierKey(r) === supplier && r.material === records[0].material && r.closedAt && r.validationOutcome === "accepted" && normalizeText(r.defect) === normalizeText(records[0].defect));
      const recurring = records.filter(r => previous.some(p => p.id !== r.id && r.reportDate! > p.closedAt!.slice(0, 10)));
      if (recurring.length) add("post_closure", recurring, "Posible reincidencia posterior a cierre validado",
        "La misma descripción reaparece después de un cierre con fecha y validación registradas. Requiere revisión de Calidad.", "suggested");
    }
    const baseline = scoped.filter(r => supplierKey(r) === supplier && r.reportDate! >= priorFrom && r.reportDate! <= priorTo);
    if (range?.allowComparison !== false && baseline.length >= rules.minimumBaseline && rows.length > baseline.length) {
      const increase = (rows.length - baseline.length) / baseline.length * 100;
      if (increase >= rules.increasePercent) add("increase", rows, "Incremento de RNCP en periodos comparables",
        `${rows.length} frente a ${baseline.length} RNCP en los ${length} días anteriores (${priorFrom} a ${priorTo}): +${increase.toFixed(1)}%; umbral ${rules.increasePercent}%.`);
    }
    const overdue = rows.filter(r => r.origin !== "historical" && deriveLifecycle(r, now).timeliness === "late");
    if (overdue.length >= rules.overdueCount) add("deadline", overdue, "Incumplimientos reiterados del plazo de siete días",
      `${overdue.length} RNCP con notificación verificable y entrega completa tardía o todavía incompleta. Se excluyen históricos sin fechas; umbral ${rules.overdueCount}.`);
  }
  return alerts.sort((a, b) => ({ Crítica: 0, Alta: 1, Seguimiento: 2 })[a.severity] - ({ Crítica: 0, Alta: 1, Seguimiento: 2 })[b.severity] || b.count - a.count);
}

export interface SemanticGroup { ids: string[]; explanation: string; }
export interface SemanticProvider { group(items: Array<{ id: string; text: string }>): Promise<SemanticGroup[]>; }
export async function semanticAlerts(reports: MatrixReport[], provider: SemanticProvider | null, approved: boolean, period: { from: string; to: string }) {
  if (!approved || !provider) return { status: "disabled" as const, alerts: [] as SupplierAlert[] };
  const alerts: SupplierAlert[] = [];
  try {
    for (const partition of new Set(reports.map(r => JSON.stringify([supplierKey(r), r.material])))) {
      const rows = reports.filter(r => !r.deletedAt && JSON.stringify([supplierKey(r), r.material]) === partition && r.reportDate && r.reportDate >= period.from && r.reportDate <= period.to && r.defect.trim());
      if (rows.length < 2) continue;
      const key = supplierKey(rows[0]);
      // External service receives no names, folios, PDFs, contacts, or stable record IDs.
      const items = rows.map((r, index) => ({ id: `r${index}`, text: minimizeDefectText(r.defect, [r.supplierName, r.sourceSupplierName ?? "", r.supplierCode, r.sourceSupplierCode ?? "", r.folio]) }));
      const groups = await provider.group(items);
      const seen = new Set<string>();
      for (const group of groups) {
        const ids = [...new Set(group.ids)];
        if (ids.length < 2 || ids.some(id => !items.some(i => i.id === id))) continue;
        const records = ids.map(id => rows[items.findIndex(i => i.id === id)]);
        const alertKey = keyOf("semantic", key, records.map(r => r.id), period.from, period.to);
        if (seen.has(alertKey)) continue; seen.add(alertKey);
        alerts.push({ key: alertKey, type: "semantic", supplierId: records[0].supplierId, supplierKey: key, supplierName: records[0].supplierName,
          severity: "Seguimiento", certainty: "suggested", title: "Descripciones posiblemente equivalentes",
          // A provider explanation can invent facts; only a grounded application explanation is displayed.
          explanation: "La IA sugiere similitud entre estas descripciones originales del mismo proveedor. No confirma una reincidencia; Calidad debe revisar los folios y descartar falsos positivos.",
          reportIds: records.map(r => r.id), folios: records.map(r => r.folio), from: period.from, to: period.to, count: records.length });
      }
    }
    return { status: "available" as const, alerts };
  } catch { return { status: "unavailable" as const, alerts: [] as SupplierAlert[] }; }
}
export function minimizeDefectText(value: string, identifiers: string[] = []) {
  let text = value;
  for (const identifier of identifiers.filter(id => id.trim().length >= 3)) text = text.replace(new RegExp(identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[identificación omitida]");
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[correo omitido]")
    .replace(/\+?\d[\d ()-]{8,}\d/g, "[referencia numérica omitida]").slice(0, 600);
}
