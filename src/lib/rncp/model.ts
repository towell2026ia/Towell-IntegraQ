export const RNCP_TIME_ZONE = "America/Mexico_City";
export const RNCP_RESPONSE_DAYS = 7;
export const RNCP_SOURCE_SHA256 = "92d6d355416f58042cc9ec4cce46721a94f054e48e1db390ac7920e87f30a1ca";
export const RNCP_SOURCE_COUNT = 226;

export type OperationalState = "draft" | "open" | "unattended" | "in_process" | "late" | "validation" | "closed";
export type Timeliness = "unknown" | "pending" | "within_deadline" | "late";
export interface MatrixReport {
  id: string; folio: string; organizationId: string; supplierId: string | null;
  supplierName: string; supplierCode: string; reportDate: string | null;
  material: string; defect: string; actionType: string; origin: "historical" | "native" | "legacy";
  historicalStatus: string | null; sourceRow?: number; sourceSha256?: string;
  sourceSupplierName?: string; sourceSupplierCode?: string;
  notifiedAt: string | null; responseDeadline: string | null; firstValidProgressAt: string | null;
  completeSubmittedAt: string | null; validatedAt: string | null; closedAt: string | null;
  validationOutcome: "pending" | "accepted" | "rejected" | null;
  requirementsComplete: boolean; missingRequirements: string[];
  deletedAt: string | null; originalFiles: OriginalFile[];
}
export interface OriginalFile { id: string; fileName: string; sha256: string; sizeBytes: number; uploadedAt: string; version: number; }
export interface LifecycleResult {
  state: OperationalState; timeliness: Timeliness; chartStatus: string;
  deadline: string | null; remainingDays: number | null;
  lateReason: "historical_category" | "no_response" | "incomplete" | null;
  historical: boolean;
}
export const stateLabels: Record<OperationalState, string> = {
  draft: "Pendiente de notificación", open: "Abierto", unattended: "Sin atención",
  in_process: "En proceso", late: "Tarde", validation: "En validación", closed: "Cerrado",
};
export const statusColors: Record<string, string> = {
  Cerrado: "#156082", Tarde: "#196B24", "En Proceso": "#A02B93", "En proceso": "#A02B93",
  Abierto: "#0F9ED5", "Sin atención": "#E97132", "En validación": "#4EA72E", "Pendiente de notificación": "#8497A0",
};
export const materialColors: Record<string, string> = {
  "Avíos": "#156082", Colorantes: "#E97132", Hilo: "#196B24", Auxiliar: "#0F9ED5", "Químico": "#A02B93",
};
export interface MatrixFilters { year: string; month: string; day: string; from: string; to: string; material: string; supplierId: string; state: string; search: string; }
export const emptyMatrixFilters: MatrixFilters = { year: "", month: "", day: "", from: "", to: "", material: "", supplierId: "", state: "", search: "" };
export interface AlertRuleConfig { recurrenceCount: number; increasePercent: number; minimumBaseline: number; overdueCount: number; criticalCount: number; periodDays: number; }
export const defaultAlertRules: AlertRuleConfig = { recurrenceCount: 3, increasePercent: 50, minimumBaseline: 3, overdueCount: 2, criticalCount: 5, periodDays: 30 };
export interface SupplierAlert {
  key: string; supplierId: string | null; supplierKey: string; supplierName: string;
  type: "recurrence" | "increase" | "deadline" | "post_closure" | "semantic";
  severity: "Crítica" | "Alta" | "Seguimiento"; certainty: "confirmed" | "suggested";
  title: string; explanation: string; reportIds: string[]; folios: string[];
  from: string; to: string; count: number; review?: AlertReview;
  reviewToken?: string;
}
export interface AlertReview { decision: "confirmed" | "dismissed"; reason: string; actorId: string; reviewedAt: string; }
export interface RncpSettings {
  alertRules: AlertRuleConfig; inspectorIds: string[]; emailEnabled: boolean;
  semanticAiApproved: boolean; followupEnabled: boolean;
}
export interface MatrixDashboard {
  reports: MatrixReport[]; filters: MatrixFilters; now: string;
  metrics: Record<OperationalState, number> & { total: number; timely: number; overdueNoResponse: number; measurable: number; responseCompliance: number | null; historical: number; };
  byMaterial: Array<{ label: string; count: number }>;
  byStatus: Array<{ label: string; count: number }>;
  bySupplier: Array<{ key: string; supplierId: string | null; label: string; count: number; statuses: Record<string, number>; cumulativePercent: number }>;
  byDate: Array<{ date: string; count: number }>;
  options: { years: string[]; materials: string[]; suppliers: Array<{ key: string; label: string }> };
  alerts: SupplierAlert[]; aiStatus: "disabled" | "available" | "unavailable";
  schemaReady: boolean; sourceCount: number;
  deletedReports?: MatrixReport[];
}

export function supplierKey(report: Pick<MatrixReport, "supplierId" | "supplierCode" | "supplierName">) {
  return report.supplierId ?? `historical:${report.supplierCode}:${report.supplierName}`;
}
