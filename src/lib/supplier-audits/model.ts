export const AUDIT_PROGRAM_SHA = "28f5784c76c2cb077f9d0aae69c8de10175f2c66f7b1ad130c98e7261ff164df";
export const EVALUATION_TEMPLATE_SHA = "fa8dd9b090a9a2e5d210ab75531f44b717c46fa7ba1ec92144472c74ff6669c5";
export const auditStates = { scheduled: "Programada", confirmed: "Confirmada", rescheduled: "Reprogramada", pending: "Pendiente", cancelled: "Cancelada", performed: "Realizada", completed: "Finalizada" } as const;
export type AuditState = keyof typeof auditStates;
export const questionnaires = {
  manufacturers: ["Documentación y Control de Calidad", "Gestión de Cambios", "Control de Productos no Conformes", "Competencia del Personal", "Control de Procesos", "Gestión de Riesgos", "Producto Terminado", "Acciones Preventivas y Correctivas", "Responsabilidad Social y Medio Ambiente"],
  distributors: ["Política de Calidad", "Control de Documentos", "Competencia del Personal", "Control de Procesos", "Gestión de Subcontratistas", "Monitoreo y Medición", "Acciones Correctivas y Preventivas", "Responsabilidad Social y Medio Ambiente"],
} as const;
export type Questionnaire = keyof typeof questionnaires;
export interface AuditResult { id: string; audit_event_id: string; assessment_date: string; evaluator_name: string; score: number; classification: string | null; observations: string | null; questionnaire: Questionnaire; rubric_scores: Record<string, number>; findings: string | null; audit_report_file_id: string; action_plan_file_id: string | null; }
export interface SupplierAudit {
  id: string; organization_id: string; supplier_id: string | null; historical_supplier_name: string | null;
  calendar_year: number; calendar_month: number; date_precision: "date" | "week" | "month";
  planned_date: string | null; week_start: string | null; actual_date: string | null; state: AuditState;
  criteria: string; audit_method: string; responsible_names: string; observations: string;
  source_sha256: string | null; source_sheet: string | null; source_row: number | null; source_column: string | null;
  source_payload: Record<string, unknown> | null; source_status: string | null;
  revision: number; created_at: string; updated_at: string;
}
export interface SupplierAuditFile { id: string; resource_id: string; resource_type: "supplier_audit_report" | "supplier_audit_action_plan"; original_name: string; version: number; is_current: boolean; created_at: string; size_bytes: number; }
export interface SupplierContacts { qualityName: string; notificationName: string; email: string; emailVerified: boolean; emailVerifiedAt?: string | null; phone: string; alternateName: string; alternateEmail: string; alternatePhone: string; notes: string; }
export interface AuditSupplier { id: string; code: string; name: string; active: boolean; owning_organization_id: string | null; contact_name: string | null; contact_email: string | null; metadata: Record<string, unknown>; updated_at: string; }
export interface AuditWorkspace { events: SupplierAudit[]; results: AuditResult[]; files: SupplierAuditFile[]; suppliers: AuditSupplier[]; canManage: boolean; administrator: boolean; history: Array<{ id: string; resource_id: string; action: string; created_at: string; reason: string | null; actor_id: string | null; user_name_snapshot: string | null }>; }
export const emptyContacts: SupplierContacts = { qualityName: "", notificationName: "", email: "", emailVerified: false, phone: "", alternateName: "", alternateEmail: "", alternatePhone: "", notes: "" };
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function monthDays(year: number, month: number) {
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + last) / 7) * 7 }, (_, i) => i < offset || i >= last + offset ? null : `${year}-${String(month).padStart(2, "0")}-${String(i - offset + 1).padStart(2, "0")}`);
}
export function auditDayMatch(event: SupplierAudit, day: string) {
  if (event.date_precision === "week" && event.week_start) return day >= event.week_start && day <= new Date(Date.parse(`${event.week_start}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  return event.planned_date === day;
}
export function monthSummary(events: SupplierAudit[]) {
  return { scheduled: events.filter(e => ["scheduled", "confirmed", "rescheduled"].includes(e.state)).length,
    performed: events.filter(e => ["performed", "completed"].includes(e.state)).length,
    pending: events.filter(e => e.state === "pending").length, cancelled: events.filter(e => e.state === "cancelled").length };
}
export function validateSchedule(input: Record<string, unknown>) {
  const year = Number(input.year), month = Number(input.month), precision = input.precision;
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Selecciona un año y mes válidos.");
  if (!["date", "week", "month"].includes(String(precision))) throw new Error("Selecciona fecha tentativa, semana o mes.");
  const date = precision === "date" ? input.plannedDate : precision === "week" ? input.weekStart : null;
  if (precision !== "month" && (!validDate(date) || Number(date.slice(0, 4)) !== year || Number(date.slice(5, 7)) !== month)) throw new Error("La fecha o inicio de semana debe pertenecer al mes seleccionado.");
}
export function validateScores(questionnaire: unknown, scores: unknown, finalScore: unknown) {
  if (questionnaire !== "manufacturers" && questionnaire !== "distributors") throw new Error("Selecciona el cuestionario F-CO-05.");
  const values = scores as Record<string, unknown>;
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length !== questionnaires[questionnaire].length || questionnaires[questionnaire].some((_, i) => typeof values[String(i + 1)] !== "number" || !Number.isFinite(values[String(i + 1)]) || Number(values[String(i + 1)]) < 0 || Number(values[String(i + 1)]) > 100)) throw new Error("Captura todos los rubros entre 0 y 100; cero es una calificación válida.");
  if (typeof finalScore !== "number" || !Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) throw new Error("Captura la calificación final verificada del Excel, de 0 a 100.");
}
