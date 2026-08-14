import { processCatalog } from "@/lib/configuration-data";
import {
  getDocumentPermissions,
  getWorkingVersion,
  type ControlledDocument,
  type ControlledDocumentStatus,
} from "@/lib/document-control-data";
import {
  daysBetween,
  getAssetDueStatus,
  isCorrectiveActionOverdue,
  toIsoDate,
} from "@/lib/domain";
import {
  evaluateConfiguredIndicator,
  quarters,
  type ConfiguredIndicator,
  type IndicatorResults,
  type IndicatorStatus,
  type Quarter,
} from "@/lib/indicator-data";
import type { WorkspaceModuleId } from "@/lib/navigation";
import type { ManagementReviewRecord } from "@/lib/management-review-data";
import type { SupplierAuditCalendarEvent } from "@/lib/quality-parties-data";
import type { ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";

export type HomePriority = "critical" | "attention" | "normal";
export type HomeTone = "danger" | "warning" | "success" | "neutral";

export interface HomeDashboardFilters {
  area: string;
  processId: string;
  responsible: string;
  status: string;
  module: string;
  from: string;
  to: string;
}

export const emptyHomeDashboardFilters: HomeDashboardFilters = {
  area: "all",
  processId: "all",
  responsible: "all",
  status: "all",
  module: "all",
  from: "",
  to: "",
};

export interface HomeDashboardSources {
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
  managementReview?: ManagementReviewRecord | null;
}

export interface HomeDocumentMetric {
  id: "reviewed" | "pending" | "validation" | "current" | "rejected";
  label: string;
  value: number;
  detail: string;
  tone: HomeTone;
}

export interface HomeWorkItem {
  id: string;
  title: string;
  detail: string;
  module: WorkspaceModuleId;
  moduleLabel: string;
  priority: HomePriority;
  dueDate?: string;
  area: string;
  processId?: string;
  responsible?: string;
  status: string;
  targetId?: string;
}

export interface HomeAlert extends HomeWorkItem {
  alertType: "Crítica" | "Atención" | "Informativa";
}

export interface HomeKpi {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: HomeTone;
  module: WorkspaceModuleId;
}

export interface HomeModuleStatus {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: HomeTone;
  module?: WorkspaceModuleId;
  sourceConnected: boolean;
}

export interface HomeTrend {
  id: string;
  label: string;
  detail: string;
  module: WorkspaceModuleId;
  series: Array<{ label: string; value: number; tone: HomeTone }>;
}

export interface HomeActivity {
  id: string;
  actor: string;
  description: string;
  occurredAt: string;
  module: WorkspaceModuleId;
  moduleLabel: string;
  targetId?: string;
}

export interface HomeUpcomingEvent {
  id: string;
  title: string;
  detail: string;
  date: string;
  module: WorkspaceModuleId;
  tone: HomeTone;
  targetId?: string;
}

export interface HomeSearchResult {
  id: string;
  title: string;
  meta: string;
  module: WorkspaceModuleId;
  searchText: string;
}

export interface HomeDashboardData {
  generatedAt: string;
  documentMetrics: HomeDocumentMetric[];
  pendingTasks: HomeWorkItem[];
  alerts: HomeAlert[];
  kpis: HomeKpi[];
  moduleStatus: HomeModuleStatus[];
  trends: HomeTrend[];
  recentActivity: HomeActivity[];
  upcomingEvents: HomeUpcomingEvent[];
  searchIndex: HomeSearchResult[];
  filterOptions: {
    areas: string[];
    processes: Array<{ id: string; name: string }>;
    responsibles: string[];
    statuses: string[];
  };
}

const priorityOrder: Record<HomePriority, number> = {
  critical: 0,
  attention: 1,
  normal: 2,
};

const documentStatusLabels: Record<ControlledDocumentStatus, string> = {
  draft: "Borrador",
  pending: "En validación",
  current: "Vigente",
  rejected: "Rechazado",
  obsolete: "Obsoleto",
};

const indicatorStatusLabels: Record<IndicatorStatus, string> = {
  compliant: "Cumple",
  marginal: "Marginal",
  noncompliant: "No cumple",
  not_uploaded: "No subido",
  pending: "Pendiente",
};

export function buildHomeDashboard(
  sources: HomeDashboardSources,
  filters: HomeDashboardFilters = emptyHomeDashboardFilters,
  now = new Date(),
): HomeDashboardData {
  const today = toIsoDate(now);
  const year = now.getFullYear();
  const currentQuarter = quarters[Math.floor(now.getMonth() / 3)] as Quarter;
  const isAdministrator = sources.session.userType === "Administrador";
  const processById = new Map(processCatalog.map((process) => [process.id, process]));

  const accessibleDocuments = sources.documents.filter((document) =>
    getDocumentPermissions(sources.session, document.processId).view,
  );
  const accessibleActions = sources.actions.filter(
    (action) =>
      isAdministrator ||
      action.owner === sources.session.name ||
      action.area === sources.session.department,
  );
  const accessibleAssets = sources.assets.filter(
    (asset) =>
      isAdministrator ||
      asset.owner === sources.session.name ||
      asset.location === sources.session.department,
  );
  const accessibleIndicators = sources.indicators.filter(
    (indicator) =>
      isAdministrator || sources.session.assignedProcessIds.includes(indicator.processId),
  );
  const canViewAudits =
    isAdministrator || ["Calidad", "Compras"].includes(sources.session.department);
  const accessibleSupplierAudits = canViewAudits ? sources.supplierAudits : [];
  const accessibleExternalAudits = canViewAudits ? sources.externalAudits : [];

  const documents = accessibleDocuments.filter((document) => {
    const version = getWorkingVersion(document);
    const process = processById.get(document.processId);
    return matchesFilters(filters, {
      area: process?.name ?? document.owner,
      processId: document.processId,
      responsible: version?.uploadedBy ?? document.owner,
      status: version?.status ?? "",
      module: "documents",
      date: version?.modifiedAt,
    });
  });
  const actions = accessibleActions.filter((action) =>
    matchesFilters(filters, {
      area: action.area,
      processId: processCatalog.find((process) => process.name === action.area)?.id,
      responsible: action.owner,
      status: action.status,
      module: "corrective-actions",
      date: action.createdAt,
    }),
  );
  const assets = accessibleAssets.filter((asset) =>
    matchesFilters(filters, {
      area: asset.location,
      responsible: asset.owner,
      status: getAssetDueStatus(asset, today),
      module: "calibrations",
      date: asset.nextDueDate,
    }),
  );
  const indicators = accessibleIndicators.filter((indicator) => {
    const record = getIndicatorRecord(
      sources.indicatorResults,
      indicator.id,
      year,
      currentQuarter,
    );
    const status = evaluateConfiguredIndicator(
      indicator,
      record?.value,
      year,
      currentQuarter,
      now,
    );
    return matchesFilters(filters, {
      area: indicator.area,
      processId: indicator.processId,
      responsible: indicator.leader,
      status,
      module: "indicators",
      date: indicator.schedule[String(year)]?.[currentQuarter],
    });
  });
  const supplierAudits = accessibleSupplierAudits.filter((audit) =>
    matchesFilters(filters, {
      area: "Compras",
      processId: "P-10",
      responsible: audit.supplierName,
      status: audit.status,
      module: "audits",
      date: audit.date,
    }),
  );

  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const reviewedThisWeek = documents.filter((document) =>
    document.versions.some((version) => {
      const modified = new Date(version.modifiedAt);
      return modified >= weekStart && modified < weekEnd;
    }),
  );
  const pendingValidation = documents.filter((document) => {
    const version = getWorkingVersion(document);
    return (
      version?.status === "pending" &&
      getDocumentPermissions(sources.session, document.processId).validate
    );
  });
  const inValidation = documents.filter(
    (document) => getWorkingVersion(document)?.status === "pending",
  );
  const currentDocuments = documents.filter((document) =>
    document.versions.some((version) => version.status === "current"),
  );
  const rejectedDocuments = documents.filter(
    (document) => getWorkingVersion(document)?.status === "rejected",
  );

  const documentMetrics: HomeDocumentMetric[] = [
    {
      id: "reviewed",
      label: "Revisados esta semana",
      value: reviewedThisWeek.length,
      detail: "Cambios registrados en la semana actual",
      tone: "neutral",
    },
    {
      id: "pending",
      label: "Pendientes de validar",
      value: pendingValidation.length,
      detail: "Requieren una decisión tuya",
      tone: pendingValidation.length > 0 ? "warning" : "success",
    },
    {
      id: "validation",
      label: "En validación",
      value: inValidation.length,
      detail: "Dentro del flujo de autorización",
      tone: "neutral",
    },
    {
      id: "current",
      label: "Validados y vigentes",
      value: currentDocuments.length,
      detail: "Versión autorizada disponible",
      tone: "success",
    },
    {
      id: "rejected",
      label: "Requieren corrección",
      value: rejectedDocuments.length,
      detail: "Rechazados con observación abierta",
      tone: rejectedDocuments.length > 0 ? "danger" : "success",
    },
  ];

  const pendingTasks = buildPendingTasks({
    sources,
    documents,
    pendingValidation,
    rejectedDocuments,
    actions,
    assets,
    indicators,
    supplierAudits,
    today,
    now,
  });

  const informativeAlerts: HomeAlert[] = reviewedThisWeek
    .filter((document) => getWorkingVersion(document)?.status === "current")
    .slice(0, 2)
    .map((document) => ({
      id: `info-${document.id}`,
      title: `${document.code} tiene una versión vigente actualizada`,
      detail: document.name,
      module: "documents",
      moduleLabel: "Documentos",
      priority: "normal",
      alertType: "Informativa",
      area: processById.get(document.processId)?.name ?? document.owner,
      processId: document.processId,
      responsible: getWorkingVersion(document)?.uploadedBy,
      status: "current",
    }));
  const alerts: HomeAlert[] = [
    ...pendingTasks
      .filter((item) => item.priority !== "normal")
      .map((item) => ({
        ...item,
        alertType: item.priority === "critical" ? "Crítica" as const : "Atención" as const,
      })),
    ...informativeAlerts,
  ];

  const submittedIndicatorStatuses = indicators
    .map((indicator) => {
      const record = getIndicatorRecord(
        sources.indicatorResults,
        indicator.id,
        year,
        currentQuarter,
      );
      return record
        ? evaluateConfiguredIndicator(
            indicator,
            record.value,
            year,
            currentQuarter,
            now,
          )
        : null;
    })
    .filter((status): status is IndicatorStatus => status !== null);
  const compliantIndicators = submittedIndicatorStatuses.filter(
    (status) => status === "compliant",
  ).length;
  const indicatorCompliance = submittedIndicatorStatuses.length
    ? `${Math.round((compliantIndicators / submittedIndicatorStatuses.length) * 100)}%`
    : "Sin captura";
  const openActions = actions.filter((action) => action.status !== "closed");
  const overdueActions = openActions.filter((action) =>
    isCorrectiveActionOverdue(action, today),
  );
  const completedAudits = supplierAudits.filter(
    (audit) => audit.status === "Realizada",
  );
  const upcomingAudits = supplierAudits.filter(
    (audit) =>
      ["Programada", "Pendiente"].includes(audit.status) && audit.date >= today,
  );
  const overdueAssets = assets.filter(
    (asset) => getAssetDueStatus(asset, today) === "overdue",
  );

  const kpis: HomeKpi[] = [
    {
      id: "indicator-compliance",
      label: "Cumplimiento de indicadores",
      value: indicatorCompliance,
      detail: `${submittedIndicatorStatuses.length} capturas evaluadas en ${currentQuarter}`,
      tone: indicatorCompliance === "Sin captura" ? "neutral" : "success",
      module: "indicators",
    },
    {
      id: "open-actions",
      label: "Acciones correctivas abiertas",
      value: String(openActions.length),
      detail: `${overdueActions.length} vencidas`,
      tone: overdueActions.length > 0 ? "danger" : "neutral",
      module: "corrective-actions",
    },
    {
      id: "completed-audits",
      label: "Auditorías ejecutadas",
      value: String(completedAudits.length),
      detail: `${upcomingAudits.length} próximas`,
      tone: "success",
      module: "audits",
    },
    {
      id: "current-documents",
      label: "Documentos vigentes",
      value: String(currentDocuments.length),
      detail: `${rejectedDocuments.length} requieren corrección`,
      tone: rejectedDocuments.length > 0 ? "warning" : "success",
      module: "documents",
    },
    {
      id: "overdue-assets",
      label: "Equipos fuera de vigencia",
      value: String(overdueAssets.length),
      detail: `${assets.length} equipos visibles`,
      tone: overdueAssets.length > 0 ? "danger" : "success",
      module: "calibrations",
    },
  ];

  const pendingIndicatorCaptures = pendingTasks.filter(
    (item) => item.module === "indicators",
  ).length;
  const moduleStatus: HomeModuleStatus[] = [
    {
      id: "documents",
      label: "Documentos",
      value: `${inValidation.length + rejectedDocuments.length} pendientes`,
      detail: `${currentDocuments.length} vigentes`,
      tone: rejectedDocuments.length > 0 ? "danger" : "neutral",
      module: "documents",
      sourceConnected: true,
    },
    {
      id: "risks",
      label: "Riesgos",
      value: "Fuente pendiente",
      detail: "Sin registros disponibles",
      tone: "neutral",
      module: "risks",
      sourceConnected: false,
    },
    {
      id: "corrective-actions",
      label: "Acciones correctivas",
      value: `${openActions.length} abiertas`,
      detail: `${overdueActions.length} vencidas`,
      tone: overdueActions.length > 0 ? "danger" : "warning",
      module: "corrective-actions",
      sourceConnected: true,
    },
    {
      id: "audits",
      label: "Auditorías",
      value: `${upcomingAudits.length} próximas`,
      detail: `${completedAudits.length} ejecutadas`,
      tone: "neutral",
      module: "audits",
      sourceConnected: true,
    },
    {
      id: "indicators",
      label: "Indicadores",
      value: `${pendingIndicatorCaptures} pendientes`,
      detail: indicatorCompliance === "Sin captura" ? "Sin resultados del trimestre" : `${indicatorCompliance} de cumplimiento`,
      tone: pendingIndicatorCaptures > 0 ? "warning" : "success",
      module: "indicators",
      sourceConnected: true,
    },
    {
      id: "management-review",
      label: "Revisión por la Dirección",
      value: sources.managementReview
        ? sources.managementReview.status === "operations_approved"
          ? "Autorizada"
          : sources.managementReview.status === "sgc_approved"
            ? "Pendiente de Operaciones"
            : "Borrador por autorizar"
        : "Lista para generar",
      detail: sources.managementReview
        ? `${sources.managementReview.id} · ${sources.managementReview.period.label}`
        : "Consolidación de 9 fuentes",
      tone: sources.managementReview?.status === "operations_approved"
        ? "success"
        : sources.managementReview
          ? "warning"
          : "neutral",
      module: "management-review",
      sourceConnected: true,
    },
    {
      id: "fcca",
      label: "FCCA",
      value: "Fuente pendiente",
      detail: "Sin registros disponibles",
      tone: "neutral",
      sourceConnected: false,
    },
  ];

  const documentTrend = countByStatus(
    documents.map((document) => getWorkingVersion(document)?.status ?? "draft"),
  );
  const indicatorTrend = countByStatus(
    indicators.map((indicator) => {
      const record = getIndicatorRecord(
        sources.indicatorResults,
        indicator.id,
        year,
        currentQuarter,
      );
      return evaluateConfiguredIndicator(
        indicator,
        record?.value,
        year,
        currentQuarter,
        now,
      );
    }),
  );
  const trends: HomeTrend[] = [
    {
      id: "indicator-trend",
      label: "Indicadores del trimestre",
      detail: currentQuarter,
      module: "indicators",
      series: [
        { label: "Cumple", value: indicatorTrend.compliant ?? 0, tone: "success" },
        { label: "Marginal", value: indicatorTrend.marginal ?? 0, tone: "warning" },
        { label: "No cumple", value: indicatorTrend.noncompliant ?? 0, tone: "danger" },
        { label: "Pendiente", value: (indicatorTrend.pending ?? 0) + (indicatorTrend.not_uploaded ?? 0), tone: "neutral" },
      ],
    },
    {
      id: "action-trend",
      label: "Acciones correctivas",
      detail: "Estado actual",
      module: "corrective-actions",
      series: [
        { label: "Abiertas", value: openActions.length, tone: "warning" },
        { label: "Cerradas", value: actions.filter((action) => action.status === "closed").length, tone: "success" },
        { label: "Vencidas", value: overdueActions.length, tone: "danger" },
      ],
    },
    {
      id: "audit-trend",
      label: "Auditorías a proveedores",
      detail: String(year),
      module: "audits",
      series: [
        { label: "Ejecutadas", value: completedAudits.length, tone: "success" },
        { label: "Programadas", value: supplierAudits.filter((audit) => audit.status === "Programada").length, tone: "neutral" },
        { label: "Pendientes", value: supplierAudits.filter((audit) => audit.status === "Pendiente").length, tone: "warning" },
      ],
    },
    {
      id: "document-trend",
      label: "Control documental",
      detail: "Versión de trabajo",
      module: "documents",
      series: [
        { label: "Vigentes", value: currentDocuments.length, tone: "success" },
        { label: "En validación", value: documentTrend.pending ?? 0, tone: "neutral" },
        { label: "Rechazados", value: documentTrend.rejected ?? 0, tone: "danger" },
        { label: "Borradores", value: documentTrend.draft ?? 0, tone: "warning" },
      ],
    },
  ];

  const recentActivity = buildRecentActivity(
    documents,
    actions,
    supplierAudits,
  ).slice(0, 8);
  const upcomingEvents = buildUpcomingEvents(
    actions,
    assets,
    supplierAudits,
    accessibleExternalAudits,
    today,
  ).slice(0, 10);
  const searchIndex = buildSearchIndex({
    documents: accessibleDocuments,
    actions: accessibleActions,
    assets: accessibleAssets,
    indicators: accessibleIndicators,
    supplierAudits: accessibleSupplierAudits,
    session: sources.session,
  });

  const filterOptions = buildFilterOptions({
    documents: accessibleDocuments,
    actions: accessibleActions,
    assets: accessibleAssets,
    indicators: accessibleIndicators,
    supplierAudits: accessibleSupplierAudits,
  });

  return {
    generatedAt: now.toISOString(),
    documentMetrics,
    pendingTasks,
    alerts,
    kpis,
    moduleStatus,
    trends,
    recentActivity,
    upcomingEvents,
    searchIndex,
    filterOptions,
  };
}

function buildPendingTasks({
  sources,
  pendingValidation,
  rejectedDocuments,
  actions,
  assets,
  indicators,
  supplierAudits,
  today,
  now,
}: {
  sources: HomeDashboardSources;
  documents: ControlledDocument[];
  pendingValidation: ControlledDocument[];
  rejectedDocuments: ControlledDocument[];
  actions: CorrectiveAction[];
  assets: MeasurementAsset[];
  indicators: ConfiguredIndicator[];
  supplierAudits: SupplierAuditCalendarEvent[];
  today: string;
  now: Date;
}) {
  const processById = new Map(processCatalog.map((process) => [process.id, process]));
  const tasks: HomeWorkItem[] = [];

  pendingValidation.forEach((document) => {
    const version = getWorkingVersion(document);
    tasks.push({
      id: `validate-${document.id}`,
      title: `Validar ${document.code}`,
      detail: document.name,
      module: "documents",
      moduleLabel: "Documentos",
      priority: "attention",
      area: processById.get(document.processId)?.name ?? document.owner,
      processId: document.processId,
      responsible: version?.validator,
      status: "pending",
      targetId: document.id,
    });
  });
  rejectedDocuments.forEach((document) => {
    const version = getWorkingVersion(document);
    tasks.push({
      id: `correct-${document.id}`,
      title: `Corregir ${document.code}`,
      detail: version?.rejectionReason ?? document.name,
      module: "documents",
      moduleLabel: "Documentos",
      priority: "critical",
      area: processById.get(document.processId)?.name ?? document.owner,
      processId: document.processId,
      responsible: version?.uploadedBy,
      status: "rejected",
      targetId: document.id,
    });
  });
  actions
    .filter((action) => action.status !== "closed")
    .forEach((action) => {
      const overdue = isCorrectiveActionOverdue(action, today);
      const remainingDays = daysBetween(today, action.dueDate);
      tasks.push({
        id: `action-${action.id}`,
        title: `${action.folio} · ${action.title}`,
        detail: overdue
          ? `Venció hace ${Math.abs(remainingDays)} días`
          : `${Math.max(remainingDays, 0)} días para el vencimiento`,
        module: "corrective-actions",
        moduleLabel: "Root2Cause",
        priority: overdue ? "critical" : remainingDays <= 14 ? "attention" : "normal",
        dueDate: action.dueDate,
        area: action.area,
        processId: processCatalog.find((process) => process.name === action.area)?.id,
        responsible: action.owner,
        status: action.status,
        targetId: action.id,
      });
    });
  assets
    .filter((asset) => getAssetDueStatus(asset, today) !== "current")
    .forEach((asset) => {
      const overdue = getAssetDueStatus(asset, today) === "overdue";
      tasks.push({
        id: `asset-${asset.id}`,
        title: `${asset.code} · ${asset.name}`,
        detail: overdue ? "Calibración o verificación vencida" : "Vigencia próxima a terminar",
        module: "calibrations",
        moduleLabel: "Calibraciones",
        priority: overdue ? "critical" : "attention",
        dueDate: asset.nextDueDate,
        area: asset.location,
        responsible: asset.owner,
        status: overdue ? "overdue" : "due_soon",
        targetId: asset.id,
      });
    });
  indicators.forEach((indicator) => {
    const overdueQuarter = [...quarters]
      .reverse()
      .find((quarter) => {
        const scheduledDate = indicator.schedule[String(now.getFullYear())]?.[quarter];
        return (
          scheduledDate &&
          scheduledDate <= today &&
          !getIndicatorRecord(
            sources.indicatorResults,
            indicator.id,
            now.getFullYear(),
            quarter,
          )
        );
      });
    if (!overdueQuarter) return;
    tasks.push({
      id: `indicator-${indicator.id}-${overdueQuarter}`,
      title: `Capturar ${indicator.id}`,
      detail: `${indicator.name} · ${overdueQuarter}`,
      module: "indicators",
      moduleLabel: "Indicadores",
      priority: "attention",
      dueDate: indicator.schedule[String(now.getFullYear())]?.[overdueQuarter],
      area: indicator.area,
      processId: indicator.processId,
      responsible: indicator.leader,
      status: "not_uploaded",
      targetId: indicator.id,
    });
  });
  supplierAudits
    .filter(
      (audit) =>
        ["Programada", "Pendiente"].includes(audit.status) && audit.date >= today,
    )
    .forEach((audit) => {
      const remainingDays = daysBetween(today, audit.date);
      tasks.push({
        id: `audit-${audit.id}`,
        title: `Auditoría · ${audit.supplierName}`,
        detail: `${audit.qualityLevel}% de nivel de calidad`,
        module: "audits",
        moduleLabel: "Auditorías",
        priority: remainingDays <= 14 ? "attention" : "normal",
        dueDate: audit.date,
        area: "Compras",
        processId: "P-10",
        responsible: audit.supplierName,
        status: audit.status,
        targetId: audit.id,
      });
    });

  return tasks.sort((left, right) => {
    const priorityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    if (!left.dueDate) return 1;
    if (!right.dueDate) return -1;
    return left.dueDate.localeCompare(right.dueDate);
  });
}

function buildRecentActivity(
  documents: ControlledDocument[],
  actions: CorrectiveAction[],
  audits: SupplierAuditCalendarEvent[],
) {
  const documentActivity: HomeActivity[] = documents.flatMap((document) =>
    document.versions.slice(0, 2).map((version) => ({
      id: `document-${version.id}`,
      actor: version.authorizedBy ?? version.uploadedBy,
      description: `${documentStatusAction(version.status)} ${document.code} revisión ${version.revision}`,
      occurredAt: version.modifiedAt,
      module: "documents" as const,
      moduleLabel: "Documentos",
      targetId: document.id,
    })),
  );
  const actionActivity: HomeActivity[] = actions.map((action) => ({
    id: `corrective-${action.id}`,
    actor: action.owner,
    description: `registró ${action.folio} · ${action.title}`,
    occurredAt: `${action.createdAt}T12:00:00.000Z`,
    module: "corrective-actions",
    moduleLabel: "Root2Cause",
    targetId: action.id,
  }));
  const auditActivity: HomeActivity[] = audits
    .filter((audit) => audit.status === "Realizada")
    .map((audit) => ({
      id: `audit-activity-${audit.id}`,
      actor: "Calidad Proveedores",
      description: `registró el resultado de auditoría de ${audit.supplierName}`,
      occurredAt: `${audit.date}T12:00:00.000Z`,
      module: "audits",
      moduleLabel: "Auditorías",
      targetId: audit.id,
    }));

  return [...documentActivity, ...actionActivity, ...auditActivity].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  );
}

function buildUpcomingEvents(
  actions: CorrectiveAction[],
  assets: MeasurementAsset[],
  supplierAudits: SupplierAuditCalendarEvent[],
  externalAudits: HomeDashboardSources["externalAudits"],
  today: string,
) {
  const events: HomeUpcomingEvent[] = [];
  actions
    .filter((action) => action.status !== "closed" && action.dueDate >= today)
    .forEach((action) => events.push({
      id: `event-action-${action.id}`,
      title: `Vencimiento ${action.folio}`,
      detail: action.title,
      date: action.dueDate,
      module: "corrective-actions",
      tone: daysBetween(today, action.dueDate) <= 14 ? "warning" : "neutral",
      targetId: action.id,
    }));
  assets
    .filter((asset) => asset.nextDueDate >= today)
    .forEach((asset) => events.push({
      id: `event-asset-${asset.id}`,
      title: `Vigencia ${asset.code}`,
      detail: asset.name,
      date: asset.nextDueDate,
      module: "calibrations",
      tone: getAssetDueStatus(asset, today) === "due_soon" ? "warning" : "neutral",
      targetId: asset.id,
    }));
  supplierAudits
    .filter((audit) => audit.date >= today && audit.status !== "Cancelada")
    .forEach((audit) => events.push({
      id: `event-supplier-audit-${audit.id}`,
      title: `Auditoría ${audit.supplierName}`,
      detail: `${audit.qualityLevel}% de nivel de calidad`,
      date: audit.date,
      module: "audits",
      tone: "neutral",
      targetId: audit.id,
    }));
  externalAudits
    .filter((audit) => audit.date >= today)
    .forEach((audit) => events.push({
      id: `event-external-audit-${audit.id}`,
      title: `Auditoría externa · ${audit.party}`,
      detail: audit.scope,
      date: audit.date,
      module: "customers",
      tone: "neutral",
      targetId: audit.id,
    }));
  return events.sort((left, right) => left.date.localeCompare(right.date));
}

function buildSearchIndex({
  documents,
  actions,
  assets,
  indicators,
  supplierAudits,
  session,
}: {
  documents: ControlledDocument[];
  actions: CorrectiveAction[];
  assets: MeasurementAsset[];
  indicators: ConfiguredIndicator[];
  supplierAudits: SupplierAuditCalendarEvent[];
  session: ActiveSession;
}) {
  const items: HomeSearchResult[] = [];
  documents.forEach((document) => items.push({
    id: document.id,
    title: `${document.code} · ${document.name}`,
    meta: `Documento · ${processCatalog.find((process) => process.id === document.processId)?.name ?? document.processId}`,
    module: "documents",
    searchText: [document.code, document.name, document.owner, document.processId].join(" "),
  }));
  actions.forEach((action) => items.push({
    id: action.id,
    title: `${action.folio} · ${action.title}`,
    meta: `Acción correctiva · ${action.area}`,
    module: "corrective-actions",
    searchText: [action.folio, action.title, action.problem, action.area, action.owner].join(" "),
  }));
  assets.forEach((asset) => items.push({
    id: asset.id,
    title: `${asset.code} · ${asset.name}`,
    meta: `Calibración · ${asset.location}`,
    module: "calibrations",
    searchText: [asset.code, asset.name, asset.location, asset.owner].join(" "),
  }));
  indicators.forEach((indicator) => items.push({
    id: indicator.id,
    title: `${indicator.id} · ${indicator.name}`,
    meta: `Indicador · ${indicator.area}`,
    module: "indicators",
    searchText: [indicator.id, indicator.name, indicator.area, indicator.leader, indicator.metric].join(" "),
  }));
  supplierAudits.forEach((audit) => items.push({
    id: audit.id,
    title: `${audit.id} · ${audit.supplierName}`,
    meta: `Auditoría · ${audit.date}`,
    module: "audits",
    searchText: [audit.id, audit.supplierCode, audit.supplierName, audit.status].join(" "),
  }));
  processCatalog
    .filter(
      (process) =>
        session.userType === "Administrador" ||
        session.assignedProcessIds.includes(process.id) ||
        (process.parentId && session.assignedProcessIds.includes(process.parentId)),
    )
    .forEach((process) => items.push({
      id: process.id,
      title: `${process.id} · ${process.name}`,
      meta: process.level === "process" ? "Proceso" : "Subproceso",
      module: "processes",
      searchText: [process.id, process.name, process.sourceLabel].join(" "),
    }));
  items.push({
    id: session.userId,
    title: session.name,
    meta: `${session.position} · ${session.department}`,
    module: "organization",
    searchText: [session.name, session.position, session.department].join(" "),
  });
  return items;
}

function buildFilterOptions({
  documents,
  actions,
  assets,
  indicators,
  supplierAudits,
}: {
  documents: ControlledDocument[];
  actions: CorrectiveAction[];
  assets: MeasurementAsset[];
  indicators: ConfiguredIndicator[];
  supplierAudits: SupplierAuditCalendarEvent[];
}) {
  const processIds = new Set(documents.map((document) => document.processId));
  indicators.forEach((indicator) => processIds.add(indicator.processId));
  const areas = new Set<string>();
  documents.forEach((document) => {
    const process = processCatalog.find((item) => item.id === document.processId);
    if (process) areas.add(process.name);
  });
  actions.forEach((action) => areas.add(action.area));
  assets.forEach((asset) => areas.add(asset.location));
  indicators.forEach((indicator) => areas.add(indicator.area));
  if (supplierAudits.length) areas.add("Compras");
  const responsibles = new Set<string>();
  documents.forEach((document) => {
    const version = getWorkingVersion(document);
    if (version?.uploadedBy) responsibles.add(version.uploadedBy);
    if (version?.validator) responsibles.add(version.validator);
  });
  actions.forEach((action) => responsibles.add(action.owner));
  assets.forEach((asset) => responsibles.add(asset.owner));
  indicators.forEach((indicator) => responsibles.add(indicator.leader));

  return {
    areas: [...areas].sort((left, right) => left.localeCompare(right, "es")),
    processes: processCatalog
      .filter((process) => processIds.has(process.id))
      .map((process) => ({ id: process.id, name: process.name })),
    responsibles: [...responsibles].sort((left, right) => left.localeCompare(right, "es")),
    statuses: [
      ...Object.entries(documentStatusLabels).map(([value, label]) => `${value}|${label}`),
      ...Object.entries(indicatorStatusLabels).map(([value, label]) => `${value}|${label}`),
      "overdue|Vencido",
      "due_soon|Próximo a vencer",
      "open|Abierta",
      "closed|Cerrada",
      "Programada|Programada",
      "Realizada|Realizada",
      "Pendiente|Pendiente",
    ].filter((value, index, values) => values.indexOf(value) === index),
  };
}

function matchesFilters(
  filters: HomeDashboardFilters,
  record: {
    area?: string;
    processId?: string;
    responsible?: string;
    status?: string;
    module: WorkspaceModuleId;
    date?: string;
  },
) {
  if (filters.area !== "all" && record.area !== filters.area) return false;
  if (filters.processId !== "all" && record.processId !== filters.processId) return false;
  if (filters.responsible !== "all" && record.responsible !== filters.responsible) return false;
  if (filters.status !== "all" && record.status !== filters.status) return false;
  if (filters.module !== "all" && record.module !== filters.module) return false;
  const date = record.date?.slice(0, 10);
  if (filters.from && (!date || date < filters.from)) return false;
  if (filters.to && (!date || date > filters.to)) return false;
  return true;
}

function getIndicatorRecord(
  results: IndicatorResults,
  id: string,
  year: number,
  quarter: Quarter,
) {
  return results[id]?.[String(year)]?.[quarter];
}

function startOfWeek(now: Date) {
  const value = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = value.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value;
}

function documentStatusAction(status: ControlledDocumentStatus) {
  const actions: Record<ControlledDocumentStatus, string> = {
    draft: "actualizó el borrador de",
    pending: "envió a validación",
    current: "publicó",
    rejected: "registró una corrección para",
    obsolete: "sustituyó la versión de",
  };
  return actions[status];
}

function countByStatus(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function searchHomeDashboard(
  index: HomeSearchResult[],
  query: string,
  limit = 8,
) {
  const normalized = normalizeSearchText(query);
  if (normalized.length < 2) return [];
  return index
    .filter((item) => normalizeSearchText(`${item.title} ${item.meta} ${item.searchText}`).includes(normalized))
    .slice(0, limit);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

