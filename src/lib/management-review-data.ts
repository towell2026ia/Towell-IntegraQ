import { getWorkingVersion, type ControlledDocument } from "@/lib/document-control-data";
import { getAssetDueStatus, isCorrectiveActionOverdue, toIsoDate } from "@/lib/domain";
import {
  evaluateConfiguredIndicator,
  quarters,
  type ConfiguredIndicator,
  type IndicatorResults,
  type Quarter,
} from "@/lib/indicator-data";
import type {
  CustomerQualityRecord,
  SupplierAuditCalendarEvent,
  SupplierQualityRecord,
} from "@/lib/quality-parties-data";
import type { ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";

export type ManagementReviewSourceStatus = "connected" | "pending";
export type ManagementReviewStatus = "draft" | "sgc_approved" | "operations_approved";

export interface ManagementReviewPeriod {
  id: string;
  label: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface ManagementReviewMetric {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface ManagementReviewSourceSnapshot {
  id:
    | "documents"
    | "risks"
    | "objectives"
    | "audits"
    | "root2cause"
    | "suppliers"
    | "customers"
    | "calibrations"
    | "continuous-improvement";
  label: string;
  status: ManagementReviewSourceStatus;
  recordCount: number;
  summary: string;
  metrics: ManagementReviewMetric[];
}

export interface ManagementReviewContext {
  period: ManagementReviewPeriod;
  capturedAt: string;
  preparedBy: string;
  preparedByPosition: string;
  company: string;
  fingerprint: string;
  sources: ManagementReviewSourceSnapshot[];
}

export interface ManagementReviewSection {
  id: string;
  title: string;
  content: string;
  sourceIds: ManagementReviewSourceSnapshot["id"][];
}

export interface ManagementReviewDecision {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  priority: "Alta" | "Media" | "Baja";
}

export interface ManagementReviewAiDraft {
  mode: "external" | "demo";
  executiveSummary: string;
  sections: ManagementReviewSection[];
  keyFindings: string[];
  decisions: ManagementReviewDecision[];
  warnings: string[];
}

export interface ManagementReviewApproval {
  stage: "sgc" | "operations";
  status: "pending" | "approved";
  requiredPosition: string;
  approverName?: string;
  approverPosition?: string;
  approvedAt?: string;
  comment?: string;
}

export interface ManagementReviewRecord {
  id: string;
  period: ManagementReviewPeriod;
  revision: number;
  status: ManagementReviewStatus;
  generatedAt: string;
  generatedBy: string;
  generatedByPosition: string;
  generatedOnce: true;
  contextFingerprint: string;
  sourceSnapshot: ManagementReviewSourceSnapshot[];
  draft: ManagementReviewAiDraft;
  approvals: [ManagementReviewApproval, ManagementReviewApproval];
  modifiedAt: string;
}

export interface ManagementReviewAiRequest {
  task: "management_review";
  context: ManagementReviewContext;
}

export interface ManagementReviewSources {
  session: ActiveSession;
  documents: ControlledDocument[];
  actions: CorrectiveAction[];
  assets: MeasurementAsset[];
  indicators: ConfiguredIndicator[];
  indicatorResults: IndicatorResults;
  supplierAudits: SupplierAuditCalendarEvent[];
  externalAudits: Array<{
    id: string;
    party: string;
    date: string;
    scope: string;
    status: string;
  }>;
  customers: CustomerQualityRecord[];
  suppliers: SupplierQualityRecord[];
  certifications: Array<{
    name: string;
    certificate: string;
    validUntil: string;
  }>;
  rncpSummary: {
    total: number;
    closed: number;
    late: number;
    inProcess: number;
  };
}

export function buildAnnualManagementReviewPeriod(year: number): ManagementReviewPeriod {
  return {
    id: `annual-${year}`,
    label: `Revisión anual ${year}`,
    year,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

export function buildManagementReviewContext(
  sources: ManagementReviewSources,
  period = buildAnnualManagementReviewPeriod(new Date().getFullYear()),
  now = new Date(),
): ManagementReviewContext {
  const today = toIsoDate(now);
  const documents = sources.documents.map((document) => ({
    document,
    version: getWorkingVersion(document),
  }));
  const currentDocuments = documents.filter(({ version }) => version?.status === "current");
  const documentIssues = documents.filter(({ version }) =>
    version ? ["pending", "rejected"].includes(version.status) : false,
  );
  const documentsModifiedInPeriod = documents.filter(({ version }) =>
    isInPeriod(version?.modifiedAt, period),
  );

  const openActions = sources.actions.filter((action) => action.status !== "closed");
  const overdueActions = openActions.filter((action) => isCorrectiveActionOverdue(action, today));
  const actionsInPeriod = sources.actions.filter((action) => isInPeriod(action.createdAt, period));

  const indicatorSummary = summarizeIndicators(sources, period, now);
  const auditsInPeriod = [
    ...sources.supplierAudits.filter((audit) => isInPeriod(audit.date, period)),
    ...sources.externalAudits.filter((audit) => isInPeriod(audit.date, period)),
  ];
  const completedAudits = auditsInPeriod.filter((audit) =>
    ["Realizada", "Completada", "Ejecutada"].includes(audit.status),
  );
  const scheduledAudits = auditsInPeriod.filter((audit) =>
    ["Programada", "Planeada", "Pendiente"].includes(audit.status),
  );

  const overdueAssets = sources.assets.filter(
    (asset) => getAssetDueStatus(asset, today) === "overdue",
  );
  const dueSoonAssets = sources.assets.filter(
    (asset) => getAssetDueStatus(asset, today) === "due_soon",
  );

  const customerClaims = sources.customers.reduce((total, customer) => total + customer.claims, 0);
  const customerFindings = sources.customers.reduce((total, customer) => total + customer.findings, 0);
  const openCustomerActions = sources.customers.reduce(
    (total, customer) => total + customer.openActions,
    0,
  );
  const auditedSuppliers = new Set(sources.supplierAudits.map((audit) => audit.supplierCode)).size;
  const measuredSuppliers = sources.suppliers.filter((supplier) => supplier.effectiveness !== null);
  const averageSupplierEffectiveness = measuredSuppliers.length
    ? measuredSuppliers.reduce((total, supplier) => total + (supplier.effectiveness ?? 0), 0) /
      measuredSuppliers.length
    : 0;

  const sourceSnapshot: ManagementReviewSourceSnapshot[] = [
    {
      id: "documents",
      label: "Información documentada",
      status: "connected",
      recordCount: documents.length,
      summary: `${currentDocuments.length} documentos vigentes; ${documentIssues.length} requieren validación o corrección y ${documentsModifiedInPeriod.length} tuvieron movimiento durante el periodo.`,
      metrics: [
        { label: "Vigentes", value: String(currentDocuments.length), tone: "success" },
        { label: "Por atender", value: String(documentIssues.length), tone: documentIssues.length ? "warning" : "success" },
        { label: "Modificados", value: String(documentsModifiedInPeriod.length), tone: "neutral" },
      ],
    },
    pendingSource("risks", "Riesgos y oportunidades", "El módulo todavía no cuenta con registros consolidados."),
    {
      id: "objectives",
      label: "Objetivos e indicadores",
      status: "connected",
      recordCount: sources.indicators.length,
      summary: `${indicatorSummary.submitted} de ${indicatorSummary.expected} resultados programados fueron capturados. ${indicatorSummary.noncompliant} no cumplen y ${indicatorSummary.missing} no fueron cargados.`,
      metrics: [
        { label: "Cumplen", value: String(indicatorSummary.compliant), tone: "success" },
        { label: "Marginales", value: String(indicatorSummary.marginal), tone: "warning" },
        { label: "No cumplen", value: String(indicatorSummary.noncompliant), tone: indicatorSummary.noncompliant ? "danger" : "success" },
        { label: "Sin captura", value: String(indicatorSummary.missing), tone: indicatorSummary.missing ? "danger" : "neutral" },
      ],
    },
    {
      id: "audits",
      label: "Auditorías",
      status: "connected",
      recordCount: auditsInPeriod.length,
      summary: `${completedAudits.length} auditorías ejecutadas y ${scheduledAudits.length} programadas o pendientes en el periodo.`,
      metrics: [
        { label: "Ejecutadas", value: String(completedAudits.length), tone: "success" },
        { label: "Programadas", value: String(scheduledAudits.length), tone: "neutral" },
      ],
    },
    {
      id: "root2cause",
      label: "Root2Cause, NC y CAPA",
      status: "connected",
      recordCount: actionsInPeriod.length,
      summary: `${openActions.length} acciones permanecen abiertas; ${overdueActions.length} están vencidas y ${sources.actions.length - openActions.length} fueron cerradas.`,
      metrics: [
        { label: "Abiertas", value: String(openActions.length), tone: openActions.length ? "warning" : "success" },
        { label: "Vencidas", value: String(overdueActions.length), tone: overdueActions.length ? "danger" : "success" },
        { label: "Cerradas", value: String(sources.actions.length - openActions.length), tone: "success" },
      ],
    },
    {
      id: "suppliers",
      label: "Calidad de proveedores",
      status: "connected",
      recordCount: sources.rncpSummary.total,
      summary: `${sources.rncpSummary.total} RNCP acumulados: ${sources.rncpSummary.closed} cerrados, ${sources.rncpSummary.late} tardíos y ${sources.rncpSummary.inProcess} en proceso. ${auditedSuppliers} proveedores figuran en el programa de auditoría.`,
      metrics: [
        { label: "RNCP", value: String(sources.rncpSummary.total), tone: "neutral" },
        { label: "Tardíos", value: String(sources.rncpSummary.late), tone: sources.rncpSummary.late ? "danger" : "success" },
        { label: "Efectividad media", value: `${averageSupplierEffectiveness.toFixed(1)}%`, tone: averageSupplierEffectiveness >= 95 ? "success" : "warning" },
      ],
    },
    {
      id: "customers",
      label: "Calidad de clientes",
      status: "connected",
      recordCount: sources.customers.length,
      summary: `${customerClaims} reclamos, ${customerFindings} hallazgos y ${openCustomerActions} acciones abiertas. ${sources.certifications.length} certificaciones vigentes registradas.`,
      metrics: [
        { label: "Reclamos", value: String(customerClaims), tone: customerClaims ? "warning" : "success" },
        { label: "Hallazgos", value: String(customerFindings), tone: customerFindings ? "warning" : "success" },
        { label: "Acciones abiertas", value: String(openCustomerActions), tone: openCustomerActions ? "warning" : "success" },
      ],
    },
    {
      id: "calibrations",
      label: "Calibración y verificación",
      status: "connected",
      recordCount: sources.assets.length,
      summary: `${sources.assets.length - overdueAssets.length} de ${sources.assets.length} equipos no están vencidos; ${overdueAssets.length} están fuera de vigencia y ${dueSoonAssets.length} próximos a vencer.`,
      metrics: [
        { label: "Controlados", value: String(sources.assets.length), tone: "neutral" },
        { label: "Vencidos", value: String(overdueAssets.length), tone: overdueAssets.length ? "danger" : "success" },
        { label: "Próximos", value: String(dueSoonAssets.length), tone: dueSoonAssets.length ? "warning" : "success" },
      ],
    },
    pendingSource(
      "continuous-improvement",
      "Mejora continua",
      "Fuente reservada para el futuro módulo de mejora continua.",
    ),
  ];

  return {
    period,
    capturedAt: now.toISOString(),
    preparedBy: sources.session.name,
    preparedByPosition: sources.session.position,
    company: sources.session.company,
    sources: sourceSnapshot,
    fingerprint: createFingerprint(sourceSnapshot),
  };
}

export function createManagementReviewRecord(
  context: ManagementReviewContext,
  draft: ManagementReviewAiDraft,
): ManagementReviewRecord {
  return {
    id: `RPD-${context.period.year}-01`,
    period: context.period,
    revision: 0,
    status: "draft",
    generatedAt: context.capturedAt,
    generatedBy: context.preparedBy,
    generatedByPosition: context.preparedByPosition,
    generatedOnce: true,
    contextFingerprint: context.fingerprint,
    sourceSnapshot: context.sources,
    draft,
    approvals: [
      {
        stage: "sgc",
        status: "pending",
        requiredPosition: "Responsable del Sistema de Gestión",
      },
      {
        stage: "operations",
        status: "pending",
        requiredPosition: "Dirección de Operaciones",
      },
    ],
    modifiedAt: context.capturedAt,
  };
}

export function buildDemoManagementReviewHistory(): ManagementReviewRecord[] {
  return [2025, 2024].map((year) => buildClosedDemoReview(year));
}

export function approveManagementReviewAsSgc(
  record: ManagementReviewRecord,
  session: ActiveSession,
  comment: string,
  approvedAt: string,
): ManagementReviewRecord {
  if (record.status !== "draft" || session.userType !== "Administrador") return record;
  return {
    ...record,
    status: "sgc_approved",
    modifiedAt: approvedAt,
    approvals: [
      {
        ...record.approvals[0],
        status: "approved",
        approverName: session.name,
        approverPosition: session.position,
        approvedAt,
        comment: comment.trim() || "Revisión autorizada para envío a Dirección de Operaciones.",
      },
      record.approvals[1],
    ],
  };
}

export function approveManagementReviewAsOperations(
  record: ManagementReviewRecord,
  session: ActiveSession,
  comment: string,
  approvedAt: string,
): ManagementReviewRecord {
  if (
    record.status !== "sgc_approved" ||
    normalize(session.position) !== normalize("Dirección de Operaciones")
  ) {
    return record;
  }
  return {
    ...record,
    status: "operations_approved",
    modifiedAt: approvedAt,
    approvals: [
      record.approvals[0],
      {
        ...record.approvals[1],
        status: "approved",
        approverName: session.name,
        approverPosition: session.position,
        approvedAt,
        comment: comment.trim() || "Revisión autorizada por Dirección de Operaciones.",
      },
    ],
  };
}

export function hasSourceChanges(
  record: ManagementReviewRecord,
  currentContext: ManagementReviewContext,
) {
  return record.contextFingerprint !== currentContext.fingerprint;
}

function pendingSource(
  id: ManagementReviewSourceSnapshot["id"],
  label: string,
  summary: string,
): ManagementReviewSourceSnapshot {
  return { id, label, status: "pending", recordCount: 0, summary, metrics: [] };
}

function buildClosedDemoReview(year: number): ManagementReviewRecord {
  const generatedAt = `${year}-12-08T16:00:00.000Z`;
  const approvedAt = `${year}-12-15T18:00:00.000Z`;
  const sourceIds: ManagementReviewSourceSnapshot["id"][] = [
    "documents",
    "risks",
    "objectives",
    "audits",
    "root2cause",
    "suppliers",
    "customers",
    "calibrations",
    "continuous-improvement",
  ];
  const sourceLabels = [
    "Información documentada",
    "Riesgos y oportunidades",
    "Objetivos e indicadores",
    "Auditorías",
    "Root2Cause, NC y CAPA",
    "Calidad de proveedores",
    "Calidad de clientes",
    "Calibración y verificación",
    "Mejora continua",
  ];
  const sourceSnapshot: ManagementReviewSourceSnapshot[] = sourceIds.map((id, index) => ({
    id,
    label: sourceLabels[index],
    status: id === "continuous-improvement" ? "pending" : "connected",
    recordCount: id === "continuous-improvement" ? 0 : 1,
    summary:
      id === "continuous-improvement"
        ? "El módulo no estaba disponible durante este periodo."
        : `Fuente incluida en el expediente histórico ${year}. Los datos definitivos se sustituirán al importar el acta autorizada.`,
    metrics: [],
  }));
  const period = buildAnnualManagementReviewPeriod(year);

  return {
    id: `RPD-${year}-01`,
    period,
    revision: 0,
    status: "operations_approved",
    generatedAt,
    generatedBy: "Responsable del Sistema de Gestión",
    generatedByPosition: "Administrador",
    generatedOnce: true,
    contextFingerprint: `ctx-historico-${year}`,
    sourceSnapshot,
    draft: {
      mode: "demo",
      executiveSummary: `Acta histórica de demostración correspondiente a ${year}. El expediente presenta la estructura autorizada y deberá sustituirse por el archivo oficial cuando sea incorporado a IntegraQ.`,
      sections: [
        "Seguimiento a acuerdos de revisiones anteriores",
        "Cambios internos y externos relevantes",
        "Desempeño y eficacia del Sistema de Gestión",
        "Clientes y proveedores",
        "Resultados de auditorías",
        "Seguimiento, medición y recursos de control",
        "Riesgos, oportunidades y adecuación de recursos",
        "Oportunidades de mejora y decisiones",
      ].map((title, index) => ({
        id: `historical-${year}-${index + 1}`,
        title: `${index + 1}. ${title}`,
        content: `Contenido del expediente autorizado ${year}. Pendiente de reemplazar con la información del acta oficial importada.`,
        sourceIds: index === 0 ? [] : [sourceIds[Math.min(index - 1, sourceIds.length - 1)]],
      })),
      keyFindings: [
        `El expediente ${year} fue validado por el responsable del SGC.`,
        "Las decisiones quedaron autorizadas por Dirección de Operaciones.",
        "El archivo se conserva bloqueado como antecedente anual.",
      ],
      decisions: [
        {
          id: `DEC-${year}-01`,
          description: "Dar seguimiento a los compromisos autorizados en la siguiente revisión anual.",
          owner: "Responsables de proceso",
          dueDate: `${year + 1}-03-31`,
          priority: "Media",
        },
      ],
      warnings: [
        "Registro histórico demostrativo; sustituir por el acta oficial y sus anexos cuando estén disponibles.",
      ],
    },
    approvals: [
      {
        stage: "sgc",
        status: "approved",
        requiredPosition: "Responsable del Sistema de Gestión",
        approverName: "Responsable del Sistema de Gestión",
        approverPosition: "Administrador",
        approvedAt: `${year}-12-11T17:00:00.000Z`,
        comment: "Acta validada para autorización de la Dirección.",
      },
      {
        stage: "operations",
        status: "approved",
        requiredPosition: "Dirección de Operaciones",
        approverName: "Dirección de Operaciones",
        approverPosition: "Usuario aprobador",
        approvedAt,
        comment: "Acta y decisiones autorizadas.",
      },
    ],
    modifiedAt: approvedAt,
  };
}

function summarizeIndicators(
  sources: Pick<ManagementReviewSources, "indicators" | "indicatorResults">,
  period: ManagementReviewPeriod,
  now: Date,
) {
  const latestQuarterIndex = period.year < now.getFullYear()
    ? 3
    : period.year > now.getFullYear()
      ? -1
      : Math.floor(now.getMonth() / 3);
  const summary = { expected: 0, submitted: 0, compliant: 0, marginal: 0, noncompliant: 0, missing: 0 };

  sources.indicators.forEach((indicator) => {
    quarters.forEach((quarter, quarterIndex) => {
      if (quarterIndex > latestQuarterIndex) return;
      summary.expected += 1;
      const record = sources.indicatorResults[indicator.id]?.[String(period.year)]?.[quarter as Quarter];
      if (!record) {
        summary.missing += 1;
        return;
      }
      summary.submitted += 1;
      const status = evaluateConfiguredIndicator(indicator, record.value, period.year, quarter, now);
      if (status === "compliant") summary.compliant += 1;
      if (status === "marginal") summary.marginal += 1;
      if (status === "noncompliant") summary.noncompliant += 1;
    });
  });
  return summary;
}

function isInPeriod(value: string | undefined, period: ManagementReviewPeriod) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= period.startDate && date <= period.endDate;
}

function createFingerprint(sources: ManagementReviewSourceSnapshot[]) {
  const input = JSON.stringify(
    sources.map((source) => [
      source.id,
      source.status,
      source.recordCount,
      source.summary,
      source.metrics.map((metric) => [metric.label, metric.value]),
    ]),
  );
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

