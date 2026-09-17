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
export type AuditScheduleType = "exact" | "range" | "window" | "pending";
export type AuditRecurrence = "yes" | "no" | "after_result";
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
  const recurrence = origin === "notice" ? "no" : draft.recurrence;
  return {
    ...draft,
    origin,
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

function scheduleBounds(audit: AuditDraft) {
  if (audit.scheduleType === "window") return [audit.windowStart, audit.windowEnd] as const;
  if (audit.scheduleType === "pending") return ["", ""] as const;
  return [audit.startDate, audit.scheduleType === "range" ? audit.endDate : audit.startDate] as const;
}

export function findPossibleDuplicates(draft: AuditDraft, existing: AuditOccurrence[]) {
  const [candidateStart, candidateEnd] = scheduleBounds(draft);
  if (!candidateStart) return [];
  return existing.filter((audit) => {
    if (audit.status === "draft" || audit.auditType !== draft.auditType) return false;
    const sameParty = draft.customerId
      ? audit.customerId === draft.customerId
      : Boolean(draft.organizationName && audit.organizationName === draft.organizationName);
    if (!sameParty && draft.entityKind !== "internal") return false;
    const sameStandard = !draft.standards.length || draft.standards.some((standard) => audit.standards.includes(standard));
    const [existingStart, existingEnd] = scheduleBounds(audit);
    return sameStandard && Boolean(existingStart) && candidateStart <= existingEnd && existingStart <= candidateEnd;
  });
}

export function auditDateLabel(audit: AuditDraft) {
  const format = (value: string) => value
    ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
    : "Sin fecha";
  if (audit.scheduleType === "pending") return "Por confirmar";
  if (audit.scheduleType === "window") return `${format(audit.windowStart)} — ${format(audit.windowEnd)}`;
  if (audit.scheduleType === "range") return `${format(audit.startDate)} — ${format(audit.endDate)}`;
  return format(audit.startDate);
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
