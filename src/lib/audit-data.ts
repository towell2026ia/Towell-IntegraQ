export const auditTypeOptions = [
  ["internal", "Auditoría interna"],
  ["customer", "Auditoría de cliente"],
  ["certification", "Auditoría de certificación"],
  ["standard", "Auditoría de estándar"],
  ["follow_up", "Auditoría de seguimiento"],
  ["recertification", "Auditoría de recertificación"],
  ["other_external", "Otra auditoría externa"],
  ["other", "Otra"],
] as const;

export type AuditType = (typeof auditTypeOptions)[number][0];
export type AuditOrigin = "annual_plan" | "recurrence" | "notice";
export type AuditEntityKind =
  | "customer"
  | "certifier"
  | "auditor"
  | "internal"
  | "authority"
  | "other";
export type AuditScheduleType = "exact" | "periodic" | "window" | "pending" | "range";
export type AuditRecurrence = "yes" | "no" | "after_result";
export const auditPeriodOptions = [
  ["monthly", "Mensual", 1],
  ["bimonthly", "Bimestral", 2],
  ["quarterly", "Trimestral", 3],
  ["four_monthly", "Cuatrimestral", 4],
  ["semiannual", "Semestral", 6],
  ["annual", "Anual", 12],
  ["custom", "Personalizada", 0],
] as const;
export type AuditPeriodFrequency = (typeof auditPeriodOptions)[number][0];
export type AuditPeriodEndMode = "none" | "until" | "count";
export type AuditStatus =
  | "draft"
  | "scheduled"
  | "window_open"
  | "pending_schedule";

export interface AuditAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  version?: string;
  comment?: string;
}

export interface AuditDraft {
  title: string;
  description: string;
  auditType: AuditType | "";
  origin: AuditOrigin | "";
  entityKind: AuditEntityKind | "";
  customerId: string;
  customerName: string;
  organizationName: string;
  externalAuditor: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  noticeDate: string;
  noticeMedium: string;
  scope: string;
  processIds: string[];
  standards: string[];
  scheduleType: AuditScheduleType;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  windowStart: string;
  windowEnd: string;
  periodicFrequency: AuditPeriodFrequency;
  periodicIntervalMonths: number;
  periodicStart: string;
  periodicEndMode: AuditPeriodEndMode;
  periodicUntil: string;
  periodicCount: number;
  recurrence: AuditRecurrence;
  responsibleUserId: string;
  responsibleName: string;
  participantIds: string[];
  participantNames: string[];
  attachments: AuditAttachment[];
}

export interface AuditOccurrence extends AuditDraft {
  id: string;
  seriesId: string;
  code: string;
  status: AuditStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export const auditTypeLabels = Object.fromEntries(auditTypeOptions) as Record<AuditType, string>;

export const auditOriginLabels: Record<AuditOrigin, string> = {
  annual_plan: "Plan anual",
  recurrence: "Programación / recurrencia",
  notice: "Por aviso",
};

export const auditStatusLabels: Record<AuditStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  window_open: "Ventana abierta",
  pending_schedule: "Pendiente de programación",
};

export const auditPeriodLabels = Object.fromEntries(
  auditPeriodOptions.map(([value, label]) => [value, label]),
) as Record<AuditPeriodFrequency, string>;

export const auditStandardOptions = [
  "ISO 9001",
  "ISO 14001",
  "ISO 45001",
  "ISO 19011",
  "FCCA",
  "SMETA",
  "Requisitos Walmart",
  "Requisitos de cliente",
  "Manual interno",
  "Otro",
] as const;

export function emptyAuditDraft(): AuditDraft {
  return {
    title: "",
    description: "",
    auditType: "",
    origin: "",
    entityKind: "",
    customerId: "",
    customerName: "",
    organizationName: "",
    externalAuditor: "",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",
    noticeDate: "",
    noticeMedium: "",
    scope: "",
    processIds: [],
    standards: [],
    scheduleType: "exact",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    windowStart: "",
    windowEnd: "",
    periodicFrequency: "quarterly",
    periodicIntervalMonths: 3,
    periodicStart: "",
    periodicEndMode: "none",
    periodicUntil: "",
    periodicCount: 4,
    recurrence: "no",
    responsibleUserId: "",
    responsibleName: "",
    participantIds: [],
    participantNames: [],
    attachments: [],
  };
}

export function normalizeAuditRules(draft: AuditDraft): AuditDraft {
  const customerAudit = draft.auditType === "customer";
  const origin = customerAudit ? "notice" : draft.origin;
  const scheduleType = origin === "notice" && draft.scheduleType === "periodic" ? "exact" : draft.scheduleType;
  const recurrence = origin === "notice" ? "no" : scheduleType === "periodic" ? "yes" : draft.recurrence;
  return {
    ...draft,
    origin,
    scheduleType,
    recurrence,
    entityKind: customerAudit ? "customer" : draft.entityKind,
  };
}

export function validateAuditDraft(draft: AuditDraft, confirm: boolean) {
  if (!confirm) return {} as Record<string, string>;
  const value = normalizeAuditRules(draft);
  const errors: Record<string, string> = {};
  if (!value.auditType) errors.auditType = "Selecciona el tipo de auditoría.";
  if (!value.origin) errors.origin = "Selecciona cómo se origina.";
  if (!value.title.trim()) errors.title = "Captura el nombre de la auditoría.";
  if (!value.entityKind) errors.entityKind = "Selecciona la entidad relacionada.";
  if (value.auditType === "customer" && !value.customerId) errors.customerId = "Selecciona un cliente existente.";
  if (value.auditType === "customer" && !value.noticeDate) errors.noticeDate = "Captura la fecha de aviso.";
  if (!value.scope.trim()) errors.scope = "Describe el alcance de la auditoría.";
  if (!value.processIds.length) errors.processIds = "Selecciona al menos un proceso.";
  if (!value.standards.length) errors.standards = "Selecciona al menos una norma o requisito.";
  if (!value.responsibleUserId) errors.responsibleUserId = "Asigna un responsable interno.";
  if (value.scheduleType === "exact" && !value.startDate) errors.startDate = "Captura la fecha de auditoría.";
  if (value.scheduleType === "range") {
    if (!value.startDate) errors.startDate = "Captura la fecha inicial.";
    if (!value.endDate) errors.endDate = "Captura la fecha final.";
    if (value.startDate && value.endDate && value.endDate < value.startDate) errors.endDate = "La fecha final no puede ser anterior.";
  }
  if (value.scheduleType === "periodic") {
    if (!value.periodicStart) errors.periodicStart = "Selecciona el mes y año de inicio.";
    if (value.periodicFrequency === "custom" && (value.periodicIntervalMonths < 1 || value.periodicIntervalMonths > 60)) {
      errors.periodicIntervalMonths = "El intervalo debe ser de 1 a 60 meses.";
    }
    if (value.periodicEndMode === "until") {
      if (!value.periodicUntil) errors.periodicUntil = "Selecciona el periodo final.";
      if (value.periodicStart && value.periodicUntil && value.periodicUntil < value.periodicStart) errors.periodicUntil = "El periodo final no puede ser anterior al inicial.";
    }
    if (value.periodicEndMode === "count" && (value.periodicCount < 2 || value.periodicCount > 120)) {
      errors.periodicCount = "Captura entre 2 y 120 periodos.";
    }
  }
  if (value.scheduleType === "window") {
    if (!value.windowStart) errors.windowStart = "Captura el inicio de la ventana.";
    if (!value.windowEnd) errors.windowEnd = "Captura el fin de la ventana.";
    if (value.windowStart && value.windowEnd && value.windowEnd < value.windowStart) errors.windowEnd = "El fin de ventana no puede ser anterior.";
  }
  return errors;
}

export function determineInitialAuditStatus(
  draft: AuditDraft,
  confirmed: boolean,
  today = new Date().toISOString().slice(0, 10),
): AuditStatus {
  if (!confirmed) return "draft";
  if (draft.scheduleType === "pending") return "pending_schedule";
  if (
    draft.scheduleType === "window" &&
    draft.windowStart <= today &&
    today <= draft.windowEnd
  ) return "window_open";
  return "scheduled";
}

export function nextAuditCode(existing: AuditOccurrence[], year: number) {
  const prefix = `AUD-${year}-`;
  const highest = existing.reduce((max, audit) => {
    if (!audit.code.startsWith(prefix)) return max;
    const sequence = Number(audit.code.slice(prefix.length));
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export function createAuditOccurrence(
  draft: AuditDraft,
  existing: AuditOccurrence[],
  actorName: string,
  confirmed: boolean,
  now = new Date(),
): AuditOccurrence {
  const value = normalizeAuditRules(draft);
  const timestamp = now.toISOString();
  const partyKey = value.customerId || value.organizationName || value.entityKind || "internal";
  const seriesKey = `${value.auditType || "other"}-${partyKey}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLocaleLowerCase("es");
  return {
    ...value,
    id: crypto.randomUUID(),
    seriesId: `series-${seriesKey}`,
    code: nextAuditCode(existing, now.getFullYear()),
    status: determineInitialAuditStatus(value, confirmed, timestamp.slice(0, 10)),
    createdAt: timestamp,
    createdBy: actorName,
    updatedAt: timestamp,
  };
}

export function auditScheduleBounds(audit: AuditDraft) {
  if (audit.scheduleType === "window") return [audit.windowStart, audit.windowEnd] as const;
  if (audit.scheduleType === "pending") return ["", ""] as const;
  if (audit.scheduleType === "periodic") {
    const start = audit.periodicStart ? `${audit.periodicStart}-01` : "";
    if (!start) return ["", ""] as const;
    if (audit.periodicEndMode === "until" && audit.periodicUntil) return [start, endOfMonth(audit.periodicUntil)] as const;
    if (audit.periodicEndMode === "count") {
      const count = Math.max(1, audit.periodicCount || 1);
      return [start, `${addMonths(audit.periodicStart, auditPeriodicIntervalMonths(audit) * (count - 1))}-01`] as const;
    }
    return [start, "9999-12-31"] as const;
  }
  return [audit.startDate, audit.scheduleType === "range" ? audit.endDate : audit.startDate] as const;
}

export function auditOccupiesDate(audit: AuditDraft, date: string) {
  if (audit.scheduleType === "periodic") return date.endsWith("-01") && auditOccursInPeriod(audit, date.slice(0, 7));
  const [start, end] = auditScheduleBounds(audit);
  return Boolean(start && end && start <= date && date <= end);
}

export function auditPeriodicIntervalMonths(audit: AuditDraft) {
  if (audit.periodicFrequency === "custom") return Math.max(1, audit.periodicIntervalMonths || 1);
  return auditPeriodOptions.find(([value]) => value === audit.periodicFrequency)?.[2] ?? 1;
}

export function auditOccursInPeriod(audit: AuditDraft, period: string) {
  if (audit.scheduleType !== "periodic" || !audit.periodicStart || period < audit.periodicStart) return false;
  const distance = monthDistance(audit.periodicStart, period);
  const interval = auditPeriodicIntervalMonths(audit);
  if (distance % interval !== 0) return false;
  if (audit.periodicEndMode === "until" && audit.periodicUntil && period > audit.periodicUntil) return false;
  if (audit.periodicEndMode === "count" && distance / interval >= Math.max(1, audit.periodicCount || 1)) return false;
  return true;
}

export function findPossibleDuplicates(draft: AuditDraft, existing: AuditOccurrence[]) {
  const [candidateStart, candidateEnd] = auditScheduleBounds(draft);
  if (!candidateStart) return [];
  return existing.filter((audit) => {
    if (audit.status === "draft" || audit.auditType !== draft.auditType) return false;
    const sameParty = draft.customerId
      ? audit.customerId === draft.customerId
      : Boolean(draft.organizationName && audit.organizationName === draft.organizationName);
    if (!sameParty && draft.entityKind !== "internal") return false;
    const sameStandard = !draft.standards.length || draft.standards.some((standard) => audit.standards.includes(standard));
    const [existingStart, existingEnd] = auditScheduleBounds(audit);
    return sameStandard && Boolean(existingStart) && candidateStart <= existingEnd && existingStart <= candidateEnd;
  });
}

export function auditDateLabel(audit: AuditDraft) {
  const format = (value: string) => value
    ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
    : "Sin fecha";
  if (audit.scheduleType === "pending") return "Por confirmar";
  if (audit.scheduleType === "periodic") return auditPeriodicLabel(audit);
  if (audit.scheduleType === "window") return `${format(audit.windowStart)} — ${format(audit.windowEnd)}`;
  if (audit.scheduleType === "range") return `${format(audit.startDate)} — ${format(audit.endDate)}`;
  return format(audit.startDate);
}

export function auditPeriodicLabel(audit: AuditDraft) {
  const formatMonth = (value: string) => value
    ? new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`))
    : "sin inicio";
  const frequency = audit.periodicFrequency === "custom"
    ? `Cada ${auditPeriodicIntervalMonths(audit)} meses`
    : auditPeriodLabels[audit.periodicFrequency] ?? "Periódica";
  const ending = audit.periodicEndMode === "until" && audit.periodicUntil
    ? ` · hasta ${formatMonth(audit.periodicUntil)}`
    : audit.periodicEndMode === "count"
      ? ` · ${audit.periodicCount || 1} periodos`
      : " · sin fecha final";
  return `${frequency} · desde ${formatMonth(audit.periodicStart)}${ending}`;
}

function monthDistance(start: string, end: string) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth;
}

function addMonths(period: string, months: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function endOfMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export const initialAuditOccurrences: AuditOccurrence[] = [
  {
    ...emptyAuditDraft(),
    id: "audit-demo-0037",
    seriesId: "series-customer-walmart",
    code: "AUD-2026-0037",
    title: "Auditoría Walmart FCCA 2026",
    description: "Auditoría solicitada por Walmart para revisión del sistema de cumplimiento social.",
    auditType: "customer",
    origin: "notice",
    entityKind: "customer",
    customerId: "walmart",
    customerName: "Walmart",
    noticeDate: "2026-10-05",
    noticeMedium: "Correo electrónico",
    scope: "Cumplimiento social y controles de calidad aplicables a producción.",
    processIds: ["P-08", "P-11", "P-13"],
    standards: ["FCCA", "Requisitos Walmart"],
    scheduleType: "range",
    startDate: "2026-11-12",
    endDate: "2026-11-13",
    responsibleUserId: "USR-FJHR-001",
    responsibleName: "Francisco Javier Hernández Retana",
    participantIds: ["team-quality", "team-production"],
    participantNames: ["Coordinación de Calidad", "Producción"],
    recurrence: "no",
    status: "scheduled",
    createdAt: "2026-10-05T16:35:00.000Z",
    createdBy: "Francisco Javier Hernández Retana",
    updatedAt: "2026-10-05T16:35:00.000Z",
  },
  {
    ...emptyAuditDraft(),
    id: "audit-demo-0032",
    seriesId: "series-standard-fcca",
    code: "AUD-2026-0032",
    title: "Revisión FCCA 2026",
    auditType: "standard",
    origin: "recurrence",
    entityKind: "auditor",
    organizationName: "Intertek",
    scope: "Evaluación FCCA en procesos productivos y de recursos humanos.",
    processIds: ["P-08", "P-11", "P-13"],
    standards: ["FCCA"],
    scheduleType: "window",
    windowStart: "2026-10-01",
    windowEnd: "2026-11-30",
    recurrence: "after_result",
    responsibleUserId: "USR-FJHR-001",
    responsibleName: "Francisco Javier Hernández Retana",
    status: "scheduled",
    createdAt: "2026-08-26T18:00:00.000Z",
    createdBy: "Francisco Javier Hernández Retana",
    updatedAt: "2026-08-26T18:00:00.000Z",
  },
  {
    ...emptyAuditDraft(),
    id: "audit-demo-draft",
    seriesId: "series-internal-sgc",
    code: "AUD-2026-0038",
    title: "Auditoría interna SGC Q4",
    auditType: "internal",
    origin: "annual_plan",
    entityKind: "internal",
    scope: "Revisión transversal del Sistema de Gestión de Calidad.",
    processIds: ["P-08", "P-35"],
    standards: ["ISO 9001"],
    scheduleType: "pending",
    recurrence: "yes",
    status: "draft",
    createdAt: "2026-09-12T14:20:00.000Z",
    createdBy: "Francisco Javier Hernández Retana",
    updatedAt: "2026-09-12T14:20:00.000Z",
  },
];
