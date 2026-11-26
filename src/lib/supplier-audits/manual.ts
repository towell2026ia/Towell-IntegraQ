import { validDate, type SupplierAuditFile } from "./model";

export const auditClassifications = { manufacturer: "Fabricante", distributor: "Distribuidor", service: "Servicio" } as const;
export const auditActionStates = { pending: "Pendiente", in_progress: "En proceso", closed: "Cerrada" } as const;
export type ManualClassification = keyof typeof auditClassifications;
export interface AuditCorrectiveAction {
  id: string; description: string; responsibleName: string; commitmentDate: string;
  status: keyof typeof auditActionStates; completedDate: string | null; evidenceFileIds: string[];
}
export interface ManualAuditRecord {
  classification: ManualClassification | null; discrepancy: string;
  methodology: "V1" | "V2" | "other" | null; auditDate: string | null; evaluatorName: string;
  score: { value: number; sourceFileId: string; reference: string; verified: boolean } | null;
  actions: AuditCorrectiveAction[]; approvedFileIds: string[]; portalVisible: boolean;
}
export interface ManualAuditSnapshot {
  version: 1; eventId: string; supplierId: string | null; revision: number; record: ManualAuditRecord;
  history: Array<{ id: string; at: string; actorName: string; reason: string; before: ManualAuditRecord | null; after: ManualAuditRecord }>;
}
export interface PortalAudit {
  eventId: string; supplierId: string; auditDate: string | null; plannedDate?:string|null; state?:string; classification: ManualClassification;
  methodology: ManualAuditRecord["methodology"]; score: number | null;
  actions: (AuditCorrectiveAction & {evidenceCount?:number})[]; files: SupplierAuditFile[];
}
export const emptyManualRecord = (): ManualAuditRecord => ({ classification: null, discrepancy: "", methodology: null, auditDate: null, evaluatorName: "", score: null, actions: [], approvedFileIds: [], portalVisible: false });
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Captura manual no válida."); return v as Record<string, unknown>; }
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error("La captura contiene campos no permitidos."); }
function text(v: unknown, max: number, required = false) { if (typeof v !== "string" || v.trim().length > max || required && !v.trim()) throw new Error("Completa los textos obligatorios y respeta su longitud máxima."); return v.trim(); }
function date(v: unknown, required = false): string | null { if (v === null && !required) return null; if (!validDate(v) || v < "2000-01-01" || v > "2200-12-31") throw new Error("Indica fechas reales válidas; deja vacías las que no estén confirmadas."); return v; }
function ids(v: unknown, max = 100): string[] { if (!Array.isArray(v) || v.length > max || v.some(i => !uuid(i)) || new Set(v.map(id => typeof id === "string" ? id.toLowerCase() : id)).size !== v.length) throw new Error("La lista de documentos o acciones contiene identificadores no válidos o duplicados."); return v.map(id => id.toLowerCase()); }
export function parseManualRecord(value: unknown): ManualAuditRecord {
  const v = object(value);
  keys(v, ["classification", "discrepancy", "methodology", "auditDate", "evaluatorName", "score", "actions", "approvedFileIds", "portalVisible"]);
  if (v.classification !== null && (typeof v.classification !== "string" || !Object.hasOwn(auditClassifications, v.classification))) throw new Error("Selecciona Fabricante, Distribuidor o Servicio; no se infiere la clasificación.");
  if (v.methodology !== null && (typeof v.methodology !== "string" || !["V1", "V2", "other"].includes(v.methodology))) throw new Error("Conserva la metodología documentada V1/V2 o indica otra.");
  if (typeof v.portalVisible !== "boolean") throw new Error("Confirma la visibilidad del expediente.");
  const approvedFileIds = ids(v.approvedFileIds);
  let score: ManualAuditRecord["score"] = null;
  if (v.score !== null) {
    const s = object(v.score); keys(s, ["value", "sourceFileId", "reference", "verified"]);
    if (typeof s.value !== "number" || !Number.isFinite(s.value) || s.value < 0 || s.value > 100 || s.verified !== true || !uuid(s.sourceFileId) || v.methodology === null) throw new Error("La calificación requiere metodología y confirmación documental, de 0 a 100.");
    score = { value: s.value, sourceFileId: s.sourceFileId.toLowerCase(), reference: text(s.reference, 1000, true), verified: true };
    if (v.portalVisible && !approvedFileIds.includes(score.sourceFileId)) throw new Error("Autoriza el documento que acredita la calificación antes de compartirla.");
  }
  if (!Array.isArray(v.actions) || v.actions.length > 100) throw new Error("Máximo 100 acciones por auditoría.");
  const actions = v.actions.map(value => {
    const a = object(value); keys(a, ["id", "description", "responsibleName", "commitmentDate", "status", "completedDate", "evidenceFileIds"]);
    if (!uuid(a.id) || typeof a.status !== "string" || !Object.hasOwn(auditActionStates, a.status)) throw new Error("Acción o estado no válido.");
    const completedDate = date(a.completedDate);
    if (a.status !== "closed" && completedDate !== null) throw new Error("Una fecha real de conclusión sólo corresponde a una acción cerrada; no se cierra automáticamente.");
    const evidenceFileIds = ids(a.evidenceFileIds, 30);
    if (v.portalVisible && evidenceFileIds.some(id => !approvedFileIds.includes(id))) throw new Error("Autoriza las evidencias vinculadas antes de compartir las acciones.");
    return { id: a.id.toLowerCase(), description: text(a.description, 5000, true), responsibleName: text(a.responsibleName, 300, true), commitmentDate: date(a.commitmentDate, true)!, status: a.status as AuditCorrectiveAction["status"], completedDate, evidenceFileIds };
  });
  if (new Set(actions.map(a => a.id)).size !== actions.length) throw new Error("No se permite duplicar una acción.");
  if (v.portalVisible && v.classification === null) throw new Error("Calidad debe seleccionar la clasificación antes de publicar.");
  return { classification: v.classification as ManualClassification | null, discrepancy: text(v.discrepancy, 2000), methodology: v.methodology as ManualAuditRecord["methodology"], auditDate: date(v.auditDate), evaluatorName: text(v.evaluatorName, 300), score, actions, approvedFileIds, portalVisible: v.portalVisible };
}
export function manualCommand(value: unknown) {
  const v = object(value); keys(v, ["revision", "requestId", "reason", "confirmed", "record"]);
  if (!Number.isInteger(v.revision) || Number(v.revision) < 1 || Number(v.revision) > 2147483646 || !uuid(v.requestId) || v.confirmed !== true) throw new Error("Confirma la operación sobre la revisión actual del expediente.");
  const reason = text(v.reason, 2000, true); if (reason.length < 5) throw new Error("Indica un motivo de al menos cinco caracteres.");
  return { revision: Number(v.revision), requestId: v.requestId.toLowerCase(), reason, record: parseManualRecord(v.record) };
}
export function checkManualReferences(record: ManualAuditRecord, files: SupplierAuditFile[]) {
  const ids = new Set(files.map(f => f.id));
  const refs = [...record.approvedFileIds, ...record.actions.flatMap(a => a.evidenceFileIds), ...(record.score ? [record.score.sourceFileId] : [])];
  if (refs.some(id => !ids.has(id))) throw new Error("Todos los documentos y evidencias deben pertenecer a esta auditoría.");
  if (record.score && !files.some(f => f.id === record.score?.sourceFileId && f.resource_type === "supplier_audit_report")) throw new Error("La calificación debe acreditarse con un informe del mismo expediente.");
}
