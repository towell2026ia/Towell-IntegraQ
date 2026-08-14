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
  alertType: "CrÃ­tica" | "AtenciÃ³n" | "Informativa";
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
  pending: "En validaciÃ³n",
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
      detail: "Requieren una decisiÃ³n tuya",
      tone: pendingValidation.length > 0 ? "warning" : "success",
    },
    {
      id: "validation",
      label: "En validaciÃ³n",
      value: inValidation.length,
      detail: "Dentro del flujo de autorizaciÃ³n",
      tone: "neutral",
    },
    {
      id: "current",
      label: "Validados y vigentes",
      value: currentDocuments.length,
      detail: "VersiÃ³n autorizada disponible",
      tone: "success",
    },
    {
      id: "rejected",
      label: "Requieren correcciÃ³n",
      value: rejectedDocuments.length,
      detail: "Rechazados con observaciÃ³n abierta",
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
      title: `${document.code} tiene una versiÃ³n vigente actualizada`,
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
        alertType: item.priority === "critical" ? "CrÃ­tica" as const : "AtenciÃ³n" as const,
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
      label: "AuditorÃ­as ejecutadas",
      value: String(completedAudits.length),
      detail: `${upcomingAudits.length} prÃ³ximas`,
      tone: "success",
      module: "audits",
    },
    {
      id: "current-documents",
      label: "Documentos vigentes",
      value: String(currentDocuments.length),
      detail: `${rejectedDocuments.length} requieren correcciÃ³n`,
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
      label: "AuditorÃ­as",
      value: `${upcomingAudits.length} prÃ³ximas`,
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
      tone: pendingIndicatorCaptures > 0 ? "warni×®8¶‰žËkºwµç@‰…ÑÑ•¹Ñ¥½¸ˆ°(€€€€€…É•„èÁÉ½•ÍÍ	å%¹•Ð¡‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%¤ü¹¹…µ”€üü‘½Õµ•¹Ð¹½Ý¹•È°(€€€€€ÁÉ½•ÍÍ%è‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%°(€€€€€É•ÍÁ½¹Í¥‰±”èÙ•ÉÍ¥½¸ü¹Ù…±¥‘…Ñ½È°(€€€€€ÍÑ…ÑÕÌè€‰Á•¹‘¥¹œˆ°(€€€€€Ñ…É•Ñ%è‘½Õµ•¹Ð¹¥°(€€€ô¤ì(€ô¤ì(€É•©•Ñ•‘½Õµ•¹ÑÌ¹™½É…  ¡‘½Õµ•¹Ð¤€ôøì(€€€½¹ÍÐÙ•ÉÍ¥½¸€ô•Ñ]½É­¥¹Y•ÉÍ¥½¸¡‘½Õµ•¹Ð¤ì(€€€Ñ…Í­Ì¹ÁÕÍ ¡ì(€€€€€¥è½ÉÉ•Ð´‘í‘½Õµ•¹Ð¹¥‘õ€°(€€€€€Ñ¥Ñ±”è½ÉÉ•¥È€‘í‘½Õµ•¹Ð¹½‘•õ€°(€€€€€‘•Ñ…¥°èÙ•ÉÍ¥½¸ü¹É•©•Ñ¥½¹I•…Í½¸€üü‘½Õµ•¹Ð¹¹…µ”°(€€€€€µ½‘Õ±”è€‰‘½Õµ•¹ÑÌˆ°(€€€€€µ½‘Õ±•1…‰•°è€‰½Õµ•¹Ñ½Ìˆ°(€€€€€ÁÉ¥½É¥Ñäè€‰É¥Ñ¥…°ˆ°(€€€€€…É•„èÁÉ½•ÍÍ	å%¹•Ð¡‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%¤ü¹¹…µ”€üü‘½Õµ•¹Ð¹½Ý¹•È°(€€€€€ÁÉ½•ÍÍ%è‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%°(€€€€€É•ÍÁ½¹Í¥‰±”èÙ•ÉÍ¥½¸ü¹ÕÁ±½…‘•‘	ä°(€€€€€ÍÑ…ÑÕÌè€‰É•©•Ñ•ˆ°(€€€€€Ñ…É•Ñ%è‘½Õµ•¹Ð¹¥°(€€€ô¤ì(€ô¤ì(€…Ñ¥½¹Ì(€€€€¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹ÍÑ…ÑÕÌ€„ôô€‰±½Í•ˆ¤(€€€€¹™½É…  ¡…Ñ¥½¸¤€ôøì(€€€€€½¹ÍÐ½Ù•É‘Õ”€ô¥Í½ÉÉ•Ñ¥Ù•Ñ¥½¹=Ù•É‘Õ”¡…Ñ¥½¸°Ñ½‘…ä¤ì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹…åÌ€ô‘…åÍ	•ÑÝ••¸¡Ñ½‘…ä°…Ñ¥½¸¹‘Õ•…Ñ”¤ì(€€€€€Ñ…Í­Ì¹ÁÕÍ ¡ì(€€€€€€€¥è…Ñ¥½¸´‘í…Ñ¥½¸¹¥‘õ€°(€€€€€€€Ñ¥Ñ±”è€‘í…Ñ¥½¸¹™½±¥½ôƒ
Ü€‘í…Ñ¥½¸¹Ñ¥Ñ±•õ€°(€€€€€€€‘•Ñ…¥°è½Ù•É‘Õ”(€€€€€€€€€€üY•¹§Ì¡…”€‘í5…Ñ ¹…‰Ì¡É•µ…¥¹¥¹…åÌ¥ô“µ…Í€(€€€€€€€€€€è€‘í5…Ñ ¹µ…à¡É•µ…¥¹¥¹…åÌ°€À¥ô“µ…ÌÁ…É„•°Ù•¹¥µ¥•¹Ñ½€°(€€€€€€€µ½‘Õ±”è€‰½ÉÉ•Ñ¥Ù”µ…Ñ¥½¹Ìˆ°(€€€€€€€µ½‘Õ±•1…‰•°è€‰I½½ÐÉ…ÕÍ”ˆ°(€€€€€€€ÁÉ¥½É¥Ñäè½Ù•É‘Õ”€ü€‰É¥Ñ¥…°ˆ€èÉ•µ…¥¹¥¹…åÌ€ðô€ÄÐ€ü€‰…ÑÑ•¹Ñ¥½¸ˆ€è€‰¹½Éµ…°ˆ°(€€€€€€€‘Õ•…Ñ”è…Ñ¥½¸¹‘Õ•…Ñ”°(€€€€€€€…É•„è…Ñ¥½¸¹…É•„°(€€€€€€€ÁÉ½•ÍÍ%èÁÉ½•ÍÍ…Ñ…±½œ¹™¥¹ ¡ÁÉ½•ÍÌ¤€ôøÁÉ½•ÍÌ¹¹…µ”€ôôô…Ñ¥½¸¹…É•„¤ü¹¥°(€€€€€€€É•ÍÁ½¹Í¥‰±”è…Ñ¥½¸¹½Ý¹•È°(€€€€€€€ÍÑ…ÑÕÌè…Ñ¥½¸¹ÍÑ…ÑÕÌ°(€€€€€€€Ñ…É•Ñ%è…Ñ¥½¸¹¥°(€€€€€ô¤ì(€€€ô¤ì(€…ÍÍ•ÑÌ(€€€€¹™¥±Ñ•È ¡…ÍÍ•Ð¤€ôø•ÑÍÍ•ÑÕ•MÑ…ÑÕÌ¡…ÍÍ•Ð°Ñ½‘…ä¤€„ôô€‰ÕÉÉ•¹Ðˆ¤(€€€€¹™½É…  ¡…ÍÍ•Ð¤€ôøì(€€€€€½¹ÍÐ½Ù•É‘Õ”€ô•ÑÍÍ•ÑÕ•MÑ…ÑÕÌ¡…ÍÍ•Ð°Ñ½‘…ä¤€ôôô€‰½Ù•É‘Õ”ˆì(€€€€€Ñ…Í­Ì¹ÁÕÍ ¡ì(€€€€€€€¥è…ÍÍ•Ð´‘í…ÍÍ•Ð¹¥‘õ€°(€€€€€€€Ñ¥Ñ±”è€‘í…ÍÍ•Ð¹½‘•ôƒ
Ü€‘í…ÍÍ•Ð¹¹…µ•õ€°(€€€€€€€‘•Ñ…¥°è½Ù•É‘Õ”€ü€‰…±¥‰É…§Í¸¼Ù•É¥™¥…§Í¸Ù•¹¥‘„ˆ€è€‰Y¥•¹¥„ÁËÍá¥µ„„Ñ•Éµ¥¹…Èˆ°(€€€€€€€µ½‘Õ±”è€‰…±¥‰É…Ñ¥½¹Ìˆ°(€€€€€€€µ½‘Õ±•1…‰•°è€‰…±¥‰É…¥½¹•Ìˆ°(€€€€€€€ÁÉ¥½É¥Ñäè½Ù•É‘Õ”€ü€‰É¥Ñ¥…°ˆ€è€‰…ÑÑ•¹Ñ¥½¸ˆ°(€€€€€€€‘Õ•…Ñ”è…ÍÍ•Ð¹¹•áÑÕ•…Ñ”°(€€€€€€€…É•„è…ÍÍ•Ð¹±½…Ñ¥½¸°(€€€€€€€É•ÍÁ½¹Í¥‰±”è…ÍÍ•Ð¹½Ý¹•È°(€€€€€€€ÍÑ…ÑÕÌè½Ù•É‘Õ”€ü€‰½Ù•É‘Õ”ˆ€è€‰‘Õ•}Í½½¸ˆ°(€€€€€€€Ñ…É•Ñ%è…ÍÍ•Ð¹¥°(€€€€€ô¤ì(€€€ô¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôøì(€€€½¹ÍÐ½Ù•É‘Õ•EÕ…ÉÑ•È€ôl¸¸¹ÅÕ…ÉÑ•ÉÍt(€€€€€€¹É•Ù•ÉÍ” ¤(€€€€€€¹™¥¹ ¡ÅÕ…ÉÑ•È¤€ôøì(€€€€€€€½¹ÍÐÍ¡•‘Õ±•‘…Ñ”€ô¥¹‘¥…Ñ½È¹Í¡•‘Õ±•mMÑÉ¥¹œ¡¹½Ü¹•ÑÕ±±e•…È ¤¥tü¹mÅÕ…ÉÑ•Étì(€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€Í¡•‘Õ±•‘…Ñ”€˜˜(€€€€€€€€€Í¡•‘Õ±•‘…Ñ”€ðôÑ½‘…ä€˜˜(€€€€€€€€€€…•Ñ%¹‘¥…Ñ½ÉI•½É (€€€€€€€€€€€Í½ÕÉ•Ì¹¥¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ°(€€€€€€€€€€€¥¹‘¥…Ñ½È¹¥°(€€€€€€€€€€€¹½Ü¹•ÑÕ±±e•…È ¤°(€€€€€€€€€€€ÅÕ…ÉÑ•È°(€€€€€€€€€€¤(€€€€€€€€¤ì(€€€€€ô¤ì(€€€¥˜€ …½Ù•É‘Õ•EÕ…ÉÑ•È¤É•ÑÕÉ¸ì(€€€Ñ…Í­Ì¹ÁÕÍ ¡ì(€€€€€¥è¥¹‘¥…Ñ½È´‘í¥¹‘¥…Ñ½È¹¥‘ô´‘í½Ù•É‘Õ•EÕ…ÉÑ•Éõ€°(€€€€€Ñ¥Ñ±”è…ÁÑÕÉ…È€‘í¥¹‘¥…Ñ½È¹¥‘õ€°(€€€€€‘•Ñ…¥°è€‘í¥¹‘¥…Ñ½È¹¹…µ•ôƒ
Ü€‘í½Ù•É‘Õ•EÕ…ÉÑ•Éõ€°(€€€€€µ½‘Õ±”è€‰¥¹‘¥…Ñ½ÉÌˆ°(€€€€€µ½‘Õ±•1…‰•°è€‰%¹‘¥…‘½É•Ìˆ°(€€€€€ÁÉ¥½É¥Ñäè€‰…ÑÑ•¹Ñ¥½¸ˆ°(€€€€€‘Õ•…Ñ”è¥¹‘¥…Ñ½È¹Í¡•‘Õ±•mMÑÉ¥¹œ¡¹½Ü¹•ÑÕ±±e•…È ¤¥tü¹m½Ù•É‘Õ•EÕ…ÉÑ•Ét°(€€€€€…É•„è¥¹‘¥…Ñ½È¹…É•„°(€€€€€ÁÉ½•ÍÍ%è¥¹‘¥…Ñ½È¹ÁÉ½•ÍÍ%°(€€€€€É•ÍÁ½¹Í¥‰±”è¥¹‘¥…Ñ½È¹±•…‘•È°(€€€€€ÍÑ…ÑÕÌè€‰¹½Ñ}ÕÁ±½…‘•ˆ°(€€€€€Ñ…É•Ñ%è¥¹‘¥…Ñ½È¹¥°(€€€ô¤ì(€ô¤ì(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ(€€€€¹™¥±Ñ•È (€€€€€€¡…Õ‘¥Ð¤€ôø(€€€€€€€l‰AÉ½É…µ…‘„ˆ°€‰A•¹‘¥•¹Ñ”‰t¹¥¹±Õ‘•Ì¡…Õ‘¥Ð¹ÍÑ…ÑÕÌ¤€˜˜…Õ‘¥Ð¹‘…Ñ”€øôÑ½‘…ä°(€€€€¤(€€€€¹™½É…  ¡…Õ‘¥Ð¤€ôøì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹…åÌ€ô‘…åÍ	•ÑÝ••¸¡Ñ½‘…ä°…Õ‘¥Ð¹‘…Ñ”¤ì(€€€€€Ñ…Í­Ì¹ÁÕÍ ¡ì(€€€€€€€¥è…Õ‘¥Ð´‘í…Õ‘¥Ð¹¥‘õ€°(€€€€€€€Ñ¥Ñ±”èÕ‘¥Ñ½Ëµ„ƒ
Ü€‘í…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ•õ€°(€€€€€€€‘•Ñ…¥°è€‘í…Õ‘¥Ð¹ÅÕ…±¥Ñå1•Ù•±ô”‘”¹¥Ù•°‘”…±¥‘…‘€°(€€€€€€€µ½‘Õ±”è€‰…Õ‘¥ÑÌˆ°(€€€€€€€µ½‘Õ±•1…‰•°è€‰Õ‘¥Ñ½Ëµ…Ìˆ°(€€€€€€€ÁÉ¥½É¥ÑäèÉ•µ…¥¹¥¹…åÌ€ðô€ÄÐ€ü€‰…ÑÑ•¹Ñ¥½¸ˆ€è€‰¹½Éµ…°ˆ°(€€€€€€€‘Õ•…Ñ”è…Õ‘¥Ð¹‘…Ñ”°(€€€€€€€…É•„è€‰½µÁÉ…Ìˆ°(€€€€€€€ÁÉ½•ÍÍ%è€‰@´ÄÀˆ°(€€€€€€€É•ÍÁ½¹Í¥‰±”è…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ”°(€€€€€€€ÍÑ…ÑÕÌè…Õ‘¥Ð¹ÍÑ…ÑÕÌ°(€€€€€€€Ñ…É•Ñ%è…Õ‘¥Ð¹¥°(€€€€€ô¤ì(€€€ô¤ì((€É•ÑÕÉ¸Ñ…Í­Ì¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€½¹ÍÐÁÉ¥½É¥Ñå¥™™•É•¹”€ôÁÉ¥½É¥Ñå=É‘•Ém±•™Ð¹ÁÉ¥½É¥Ñåt€´ÁÉ¥½É¥Ñå=É‘•ÉmÉ¥¡Ð¹ÁÉ¥½É¥Ñåtì(€€€¥˜€¡ÁÉ¥½É¥Ñå¥™™•É•¹”€„ôô€À¤É•ÑÕÉ¸ÁÉ¥½É¥Ñå¥™™•É•¹”ì(€€€¥˜€ …±•™Ð¹‘Õ•…Ñ”¤É•ÑÕÉ¸€Äì(€€€¥˜€ …É¥¡Ð¹‘Õ•…Ñ”¤É•ÑÕÉ¸€´Äì(€€€É•ÑÕÉ¸±•™Ð¹‘Õ•…Ñ”¹±½…±•½µÁ…É”¡É¥¡Ð¹‘Õ•…Ñ”¤ì(€ô¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘I••¹ÑÑ¥Ù¥Ñä (€‘½Õµ•¹ÑÌè½¹ÑÉ½±±•‘½Õµ•¹Ñmt°(€…Ñ¥½¹Ìè½ÉÉ•Ñ¥Ù•Ñ¥½¹mt°(€…Õ‘¥ÑÌèMÕÁÁ±¥•ÉÕ‘¥Ñ…±•¹‘…ÉÙ•¹Ñmt°(¤ì(€½¹ÍÐ‘½Õµ•¹ÑÑ¥Ù¥Ñäè!½µ•Ñ¥Ù¥Ñåmt€ô‘½Õµ•¹ÑÌ¹™±…Ñ5…À ¡‘½Õµ•¹Ð¤€ôø(€€€‘½Õµ•¹Ð¹Ù•ÉÍ¥½¹Ì¹Í±¥” À°€È¤¹µ…À ¡Ù•ÉÍ¥½¸¤€ôø€¡ì(€€€€€¥è‘½Õµ•¹Ð´‘íÙ•ÉÍ¥½¸¹¥‘õ€°(€€€€€…Ñ½ÈèÙ•ÉÍ¥½¸¹…ÕÑ¡½É¥é•‘	ä€üüÙ•ÉÍ¥½¸¹ÕÁ±½…‘•‘	ä°(€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‘í‘½Õµ•¹ÑMÑ…ÑÕÍÑ¥½¸¡Ù•ÉÍ¥½¸¹ÍÑ…ÑÕÌ¥ô€‘í‘½Õµ•¹Ð¹½‘•ôÉ•Ù¥Í§Í¸€‘íÙ•ÉÍ¥½¸¹É•Ù¥Í¥½¹õ€°(€€€€€½ÕÉÉ•‘ÐèÙ•ÉÍ¥½¸¹µ½‘¥™¥•‘Ð°(€€€€€µ½‘Õ±”è€‰‘½Õµ•¹ÑÌˆ…Ì½¹ÍÐ°(€€€€€µ½‘Õ±•1…‰•°è€‰½Õµ•¹Ñ½Ìˆ°(€€€€€Ñ…É•Ñ%è‘½Õµ•¹Ð¹¥°(€€€ô¤¤°(€€¤ì(€½¹ÍÐ…Ñ¥½¹Ñ¥Ù¥Ñäè!½µ•Ñ¥Ù¥Ñåmt€ô…Ñ¥½¹Ì¹µ…À ¡…Ñ¥½¸¤€ôø€¡ì(€€€¥è½ÉÉ•Ñ¥Ù”´‘í…Ñ¥½¸¹¥‘õ€°(€€€…Ñ½Èè…Ñ¥½¸¹½Ý¹•È°(€€€‘•ÍÉ¥ÁÑ¥½¸èÉ•¥ÍÑËÌ€‘í…Ñ¥½¸¹™½±¥½ôƒ
Ü€‘í…Ñ¥½¸¹Ñ¥Ñ±•õ€°(€€€½ÕÉÉ•‘Ðè€‘í…Ñ¥½¸¹É•…Ñ•‘ÑõPÄÈèÀÀèÀÀ¸ÀÀÁi€°(€€€µ½‘Õ±”è€‰½ÉÉ•Ñ¥Ù”µ…Ñ¥½¹Ìˆ°(€€€µ½‘Õ±•1…‰•°è€‰I½½ÐÉ…ÕÍ”ˆ°(€€€Ñ…É•Ñ%è…Ñ¥½¸¹¥°(€ô¤¤ì(€½¹ÍÐ…Õ‘¥ÑÑ¥Ù¥Ñäè!½µ•Ñ¥Ù¥Ñåmt€ô…Õ‘¥ÑÌ(€€€€¹™¥±Ñ•È ¡…Õ‘¥Ð¤€ôø…Õ‘¥Ð¹ÍÑ…ÑÕÌ€ôôô€‰I•…±¥é…‘„ˆ¤(€€€€¹µ…À ¡…Õ‘¥Ð¤€ôø€¡ì(€€€€€¥è…Õ‘¥Ðµ…Ñ¥Ù¥Ñä´‘í…Õ‘¥Ð¹¥‘õ€°(€€€€€…Ñ½Èè€‰…±¥‘…AÉ½Ù••‘½É•Ìˆ°(€€€€€‘•ÍÉ¥ÁÑ¥½¸èÉ•¥ÍÑËÌ•°É•ÍÕ±Ñ…‘¼‘”…Õ‘¥Ñ½Ëµ„‘”€‘í…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ•õ€°(€€€€€½ÕÉÉ•‘Ðè€‘í…Õ‘¥Ð¹‘…Ñ•õPÄÈèÀÀèÀÀ¸ÀÀÁi€°(€€€€€µ½‘Õ±”è€‰…Õ‘¥ÑÌˆ°(€€€€€µ½‘Õ±•1…‰•°è€‰Õ‘¥Ñ½Ëµ…Ìˆ°(€€€€€Ñ…É•Ñ%è…Õ‘¥Ð¹¥°(€€€ô¤¤ì((€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹ÑÑ¥Ù¥Ñä°€¸¸¹…Ñ¥½¹Ñ¥Ù¥Ñä°€¸¸¹…Õ‘¥ÑÑ¥Ù¥Ñåt¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø(€€€É¥¡Ð¹½ÕÉÉ•‘Ð¹±½…±•½µÁ…É”¡±•™Ð¹½ÕÉÉ•‘Ð¤°(€€¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘UÁ½µ¥¹Ù•¹ÑÌ (€…Ñ¥½¹Ìè½ÉÉ•Ñ¥Ù•Ñ¥½¹mt°(€…ÍÍ•ÑÌè5•…ÍÕÉ•µ•¹ÑÍÍ•Ñmt°(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌèMÕÁÁ±¥•ÉÕ‘¥Ñ…±•¹‘…ÉÙ•¹Ñmt°(€•áÑ•É¹…±Õ‘¥ÑÌè!½µ•…Í¡‰½…É‘M½ÕÉ•Íl‰•áÑ•É¹…±Õ‘¥ÑÌ‰t°(€Ñ½‘…äèÍÑÉ¥¹œ°(¤ì(€½¹ÍÐ•Ù•¹ÑÌè!½µ•UÁ½µ¥¹Ù•¹Ñmt€ômtì(€…Ñ¥½¹Ì(€€€€¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹ÍÑ…ÑÕÌ€„ôô€‰±½Í•ˆ€˜˜…Ñ¥½¸¹‘Õ•…Ñ”€øôÑ½‘…ä¤(€€€€¹™½É…  ¡…Ñ¥½¸¤€ôø•Ù•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€¥è•Ù•¹Ðµ…Ñ¥½¸´‘í…Ñ¥½¸¹¥‘õ€°(€€€€€Ñ¥Ñ±”èY•¹¥µ¥•¹Ñ¼€‘í…Ñ¥½¸¹™½±¥½õ€°(€€€€€‘•Ñ…¥°è…Ñ¥½¸¹Ñ¥Ñ±”°(€€€€€‘…Ñ”è…Ñ¥½¸¹‘Õ•…Ñ”°(€€€€€µ½‘Õ±”è€‰½ÉÉ•Ñ¥Ù”µ…Ñ¥½¹Ìˆ°(€€€€€Ñ½¹”è‘…åÍ	•ÑÝ••¸¡Ñ½‘…ä°…Ñ¥½¸¹‘Õ•…Ñ”¤€ðô€ÄÐ€ü€‰Ý…É¹¥¹œˆ€è€‰¹•ÕÑÉ…°ˆ°(€€€€€Ñ…É•Ñ%è…Ñ¥½¸¹¥°(€€€ô¤¤ì(€…ÍÍ•ÑÌ(€€€€¹™¥±Ñ•È ¡…ÍÍ•Ð¤€ôø…ÍÍ•Ð¹¹•áÑÕ•…Ñ”€øôÑ½‘…ä¤(€€€€¹™½É…  ¡…ÍÍ•Ð¤€ôø•Ù•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€¥è•Ù•¹Ðµ…ÍÍ•Ð´‘í…ÍÍ•Ð¹¥‘õ€°(€€€€€Ñ¥Ñ±”èY¥•¹¥„€‘í…ÍÍ•Ð¹½‘•õ€°(€€€€€‘•Ñ…¥°è…ÍÍ•Ð¹¹…µ”°(€€€€€‘…Ñ”è…ÍÍ•Ð¹¹•áÑÕ•…Ñ”°(€€€€€µ½‘Õ±”è€‰…±¥‰É…Ñ¥½¹Ìˆ°(€€€€€Ñ½¹”è•ÑÍÍ•ÑÕ•MÑ…ÑÕÌ¡…ÍÍ•Ð°Ñ½‘…ä¤€ôôô€‰‘Õ•}Í½½¸ˆ€ü€‰Ý…É¹¥¹œˆ€è€‰¹•ÕÑÉ…°ˆ°(€€€€€Ñ…É•Ñ%è…ÍÍ•Ð¹¥°(€€€ô¤¤ì(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ(€€€€¹™¥±Ñ•È ¡…Õ‘¥Ð¤€ôø…Õ‘¥Ð¹‘…Ñ”€øôÑ½‘…ä€˜˜…Õ‘¥Ð¹ÍÑ…ÑÕÌ€„ôô€‰…¹•±…‘„ˆ¤(€€€€¹™½É…  ¡…Õ‘¥Ð¤€ôø•Ù•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€¥è•Ù•¹ÐµÍÕÁÁ±¥•Èµ…Õ‘¥Ð´‘í…Õ‘¥Ð¹¥‘õ€°(€€€€€Ñ¥Ñ±”èÕ‘¥Ñ½Ëµ„€‘í…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ•õ€°(€€€€€‘•Ñ…¥°è€‘í…Õ‘¥Ð¹ÅÕ…±¥Ñå1•Ù•±ô”‘”¹¥Ù•°‘”…±¥‘…‘€°(€€€€€‘…Ñ”è…Õ‘¥Ð¹‘…Ñ”°(€€€€€µ½‘Õ±”è€‰…Õ‘¥ÑÌˆ°(€€€€€Ñ½¹”è€‰¹•ÕÑÉ…°ˆ°(€€€€€Ñ…É•Ñ%è…Õ‘¥Ð¹¥°(€€€ô¤¤ì(€•áÑ•É¹…±Õ‘¥ÑÌ(€€€€¹™¥±Ñ•È ¡…Õ‘¥Ð¤€ôø…Õ‘¥Ð¹‘…Ñ”€øôÑ½‘…ä¤(€€€€¹™½É…  ¡…Õ‘¥Ð¤€ôø•Ù•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€¥è•Ù•¹Ðµ•áÑ•É¹…°µ…Õ‘¥Ð´‘í…Õ‘¥Ð¹¥‘õ€°(€€€€€Ñ¥Ñ±”èÕ‘¥Ñ½Ëµ„•áÑ•É¹„ƒ
Ü€‘í…Õ‘¥Ð¹Á…ÉÑåõ€°(€€€€€‘•Ñ…¥°è…Õ‘¥Ð¹Í½Á”°(€€€€€‘…Ñ”è…Õ‘¥Ð¹‘…Ñ”°(€€€€€µ½‘Õ±”è€‰ÕÍÑ½µ•ÉÌˆ°(€€€€€Ñ½¹”è€‰¹•ÕÑÉ…°ˆ°(€€€€€Ñ…É•Ñ%è…Õ‘¥Ð¹¥°(€€€ô¤¤ì(€É•ÑÕÉ¸•Ù•¹ÑÌ¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹‘…Ñ”¹±½…±•½µÁ…É”¡É¥¡Ð¹‘…Ñ”¤¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘M•…É¡%¹‘•à¡ì(€‘½Õµ•¹ÑÌ°(€…Ñ¥½¹Ì°(€…ÍÍ•ÑÌ°(€¥¹‘¥…Ñ½ÉÌ°(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ°(€Í•ÍÍ¥½¸°)ôèì(€‘½Õµ•¹ÑÌè½¹ÑÉ½±±•‘½Õµ•¹Ñmtì(€…Ñ¥½¹Ìè½ÉÉ•Ñ¥Ù•Ñ¥½¹mtì(€…ÍÍ•ÑÌè5•…ÍÕÉ•µ•¹ÑÍÍ•Ñmtì(€¥¹‘¥…Ñ½ÉÌè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émtì(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌèMÕÁÁ±¥•ÉÕ‘¥Ñ…±•¹‘…ÉÙ•¹Ñmtì(€Í•ÍÍ¥½¸èÑ¥Ù•M•ÍÍ¥½¸ì)ô¤ì(€½¹ÍÐ¥Ñ•µÌè!½µ•M•…É¡I•ÍÕ±Ñmt€ômtì(€‘½Õµ•¹ÑÌ¹™½É…  ¡‘½Õµ•¹Ð¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥è‘½Õµ•¹Ð¹¥°(€€€Ñ¥Ñ±”è€‘í‘½Õµ•¹Ð¹½‘•ôƒ
Ü€‘í‘½Õµ•¹Ð¹¹…µ•õ€°(€€€µ•Ñ„è½Õµ•¹Ñ¼ƒ
Ü€‘íÁÉ½•ÍÍ…Ñ…±½œ¹™¥¹ ¡ÁÉ½•ÍÌ¤€ôøÁÉ½•ÍÌ¹¥€ôôô‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%¤ü¹¹…µ”€üü‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%‘õ€°(€€€µ½‘Õ±”è€‰‘½Õµ•¹ÑÌˆ°(€€€Í•…É¡Q•áÐèm‘½Õµ•¹Ð¹½‘”°‘½Õµ•¹Ð¹¹…µ”°‘½Õµ•¹Ð¹½Ý¹•È°‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%‘t¹©½¥¸ ˆ€ˆ¤°(€ô¤¤ì(€…Ñ¥½¹Ì¹™½É…  ¡…Ñ¥½¸¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥è…Ñ¥½¸¹¥°(€€€Ñ¥Ñ±”è€‘í…Ñ¥½¸¹™½±¥½ôƒ
Ü€‘í…Ñ¥½¸¹Ñ¥Ñ±•õ€°(€€€µ•Ñ„è§Í¸½ÉÉ•Ñ¥Ù„ƒ
Ü€‘í…Ñ¥½¸¹…É•…õ€°(€€€µ½‘Õ±”è€‰½ÉÉ•Ñ¥Ù”µ…Ñ¥½¹Ìˆ°(€€€Í•…É¡Q•áÐèm…Ñ¥½¸¹™½±¥¼°…Ñ¥½¸¹Ñ¥Ñ±”°…Ñ¥½¸¹ÁÉ½‰±•´°…Ñ¥½¸¹…É•„°…Ñ¥½¸¹½Ý¹•Ét¹©½¥¸ ˆ€ˆ¤°(€ô¤¤ì(€…ÍÍ•ÑÌ¹™½É…  ¡…ÍÍ•Ð¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥è…ÍÍ•Ð¹¥°(€€€Ñ¥Ñ±”è€‘í…ÍÍ•Ð¹½‘•ôƒ
Ü€‘í…ÍÍ•Ð¹¹…µ•õ€°(€€€µ•Ñ„è…±¥‰É…§Í¸ƒ
Ü€‘í…ÍÍ•Ð¹±½…Ñ¥½¹õ€°(€€€µ½‘Õ±”è€‰…±¥‰É…Ñ¥½¹Ìˆ°(€€€Í•…É¡Q•áÐèm…ÍÍ•Ð¹½‘”°…ÍÍ•Ð¹¹…µ”°…ÍÍ•Ð¹±½…Ñ¥½¸°…ÍÍ•Ð¹½Ý¹•Ét¹©½¥¸ ˆ€ˆ¤°(€ô¤¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥è¥¹‘¥…Ñ½È¹¥°(€€€Ñ¥Ñ±”è€‘í¥¹‘¥…Ñ½È¹¥‘ôƒ
Ü€‘í¥¹‘¥…Ñ½È¹¹…µ•õ€°(€€€µ•Ñ„è%¹‘¥…‘½Èƒ
Ü€‘í¥¹‘¥…Ñ½È¹…É•…õ€°(€€€µ½‘Õ±”è€‰¥¹‘¥…Ñ½ÉÌˆ°(€€€Í•…É¡Q•áÐèm¥¹‘¥…Ñ½È¹¥°¥¹‘¥…Ñ½È¹¹…µ”°¥¹‘¥…Ñ½È¹…É•„°¥¹‘¥…Ñ½È¹±•…‘•È°¥¹‘¥…Ñ½È¹µ•ÑÉ¥t¹©½¥¸ ˆ€ˆ¤°(€ô¤¤ì(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ¹™½É…  ¡…Õ‘¥Ð¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥è…Õ‘¥Ð¹¥°(€€€Ñ¥Ñ±”è€‘í…Õ‘¥Ð¹¥‘ôƒ
Ü€‘í…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ•õ€°(€€€µ•Ñ„èÕ‘¥Ñ½Ëµ„ƒ
Ü€‘í…Õ‘¥Ð¹‘…Ñ•õ€°(€€€µ½‘Õ±”è€‰…Õ‘¥ÑÌˆ°(€€€Í•…É¡Q•áÐèm…Õ‘¥Ð¹¥°…Õ‘¥Ð¹ÍÕÁÁ±¥•É½‘”°…Õ‘¥Ð¹ÍÕÁÁ±¥•É9…µ”°…Õ‘¥Ð¹ÍÑ…ÑÕÍt¹©½¥¸ ˆ€ˆ¤°(€ô¤¤ì(€ÁÉ½•ÍÍ…Ñ…±½œ(€€€€¹™¥±Ñ•È (€€€€€€¡ÁÉ½•ÍÌ¤€ôø(€€€€€€€Í•ÍÍ¥½¸¹ÕÍ•ÉQåÁ”€ôôô€‰‘µ¥¹¥ÍÑÉ…‘½Èˆñð(€€€€€€€Í•ÍÍ¥½¸¹…ÍÍ¥¹•‘AÉ½•ÍÍ%‘Ì¹¥¹±Õ‘•Ì¡ÁÉ½•ÍÌ¹¥¤ñð(€€€€€€€€¡ÁÉ½•ÍÌ¹Á…É•¹Ñ%€˜˜Í•ÍÍ¥½¸¹…ÍÍ¥¹•‘AÉ½•ÍÍ%‘Ì¹¥¹±Õ‘•Ì¡ÁÉ½•ÍÌ¹Á…É•¹Ñ%¤¤°(€€€€¤(€€€€¹™½É…  ¡ÁÉ½•ÍÌ¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€¥èÁÉ½•ÍÌ¹¥°(€€€€€Ñ¥Ñ±”è€‘íÁÉ½•ÍÌ¹¥‘ôƒ
Ü€‘íÁÉ½•ÍÌ¹¹…µ•õ€°(€€€€€µ•Ñ„èÁÉ½•ÍÌ¹±•Ù•°€ôôô€‰ÁÉ½•ÍÌˆ€ü€‰AÉ½•Í¼ˆ€è€‰MÕ‰ÁÉ½•Í¼ˆ°(€€€€€µ½‘Õ±”è€‰ÁÉ½•ÍÍ•Ìˆ°(€€€€€Í•…É¡Q•áÐèmÁÉ½•ÍÌ¹¥°ÁÉ½•ÍÌ¹¹…µ”°ÁÉ½•ÍÌ¹Í½ÕÉ•1…‰•±t¹©½¥¸ ˆ€ˆ¤°(€€€ô¤¤ì(€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€¥èÍ•ÍÍ¥½¸¹ÕÍ•É%°(€€€Ñ¥Ñ±”èÍ•ÍÍ¥½¸¹¹…µ”°(€€€µ•Ñ„è€‘íÍ•ÍÍ¥½¸¹Á½Í¥Ñ¥½¹ôƒ
Ü€‘íÍ•ÍÍ¥½¸¹‘•Á…ÉÑµ•¹Ñõ€°(€€€µ½‘Õ±”è€‰½É…¹¥é…Ñ¥½¸ˆ°(€€€Í•…É¡Q•áÐèmÍ•ÍÍ¥½¸¹¹…µ”°Í•ÍÍ¥½¸¹Á½Í¥Ñ¥½¸°Í•ÍÍ¥½¸¹‘•Á…ÉÑµ•¹Ñt¹©½¥¸ ˆ€ˆ¤°(€ô¤ì(€É•ÑÕÉ¸¥Ñ•µÌì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘¥±Ñ•É=ÁÑ¥½¹Ì¡ì(€‘½Õµ•¹ÑÌ°(€…Ñ¥½¹Ì°(€…ÍÍ•ÑÌ°(€¥¹‘¥…Ñ½ÉÌ°(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ°)ôèì(€‘½Õµ•¹ÑÌè½¹ÑÉ½±±•‘½Õµ•¹Ñmtì(€…Ñ¥½¹Ìè½ÉÉ•Ñ¥Ù•Ñ¥½¹mtì(€…ÍÍ•ÑÌè5•…ÍÕÉ•µ•¹ÑÍÍ•Ñmtì(€¥¹‘¥…Ñ½ÉÌè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émtì(€ÍÕÁÁ±¥•ÉÕ‘¥ÑÌèMÕÁÁ±¥•ÉÕ‘¥Ñ…±•¹‘…ÉÙ•¹Ñmtì)ô¤ì(€½¹ÍÐÁÉ½•ÍÍ%‘Ì€ô¹•ÜM•Ð¡‘½Õµ•¹ÑÌ¹µ…À ¡‘½Õµ•¹Ð¤€ôø‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%¤¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôøÁÉ½•ÍÍ%‘Ì¹…‘¡¥¹‘¥…Ñ½È¹ÁÉ½•ÍÍ%¤¤ì(€½¹ÍÐ…É•…Ì€ô¹•ÜM•ÐñÍÑÉ¥¹œø ¤ì(€‘½Õµ•¹ÑÌ¹™½É…  ¡‘½Õµ•¹Ð¤€ôøì(€€€½¹ÍÐÁÉ½•ÍÌ€ôÁÉ½•ÍÍ…Ñ…±½œ¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô‘½Õµ•¹Ð¹ÁÉ½•ÍÍ%¤ì(€€€¥˜€¡ÁÉ½•ÍÌ¤…É•…Ì¹…‘¡ÁÉ½•ÍÌ¹¹…µ”¤ì(€ô¤ì(€…Ñ¥½¹Ì¹™½É…  ¡…Ñ¥½¸¤€ôø…É•…Ì¹…‘¡…Ñ¥½¸¹…É•„¤¤ì(€…ÍÍ•ÑÌ¹™½É…  ¡…ÍÍ•Ð¤€ôø…É•…Ì¹…‘¡…ÍÍ•Ð¹±½…Ñ¥½¸¤¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôø…É•…Ì¹…‘¡¥¹‘¥…Ñ½È¹…É•„¤¤ì(€¥˜€¡ÍÕÁÁ±¥•ÉÕ‘¥ÑÌ¹±•¹Ñ ¤…É•…Ì¹…‘ ‰½µÁÉ…Ìˆ¤ì(€½¹ÍÐÉ•ÍÁ½¹Í¥‰±•Ì€ô¹•ÜM•ÐñÍÑÉ¥¹œø ¤ì(€‘½Õµ•¹ÑÌ¹™½É…  ¡‘½Õµ•¹Ð¤€ôøì(€€€½¹ÍÐÙ•ÉÍ¥½¸€ô•Ñ]½É­¥¹Y•ÉÍ¥½¸¡‘½Õµ•¹Ð¤ì(€€€¥˜€¡Ù•ÉÍ¥½¸ü¹ÕÁ±½…‘•‘	ä¤É•ÍÁ½¹Í¥‰±•Ì¹…‘¡Ù•ÉÍ¥½¸¹ÕÁ±½…‘•‘	ä¤ì(€€€¥˜€¡Ù•ÉÍ¥½¸ü¹Ù…±¥‘…Ñ½È¤É•ÍÁ½¹Í¥‰±•Ì¹…‘¡Ù•ÉÍ¥½¸¹Ù…±¥‘…Ñ½È¤ì(€ô¤ì(€…Ñ¥½¹Ì¹™½É…  ¡…Ñ¥½¸¤€ôøÉ•ÍÁ½¹Í¥‰±•Ì¹…‘¡…Ñ¥½¸¹½Ý¹•È¤¤ì(€…ÍÍ•ÑÌ¹™½É…  ¡…ÍÍ•Ð¤€ôøÉ•ÍÁ½¹Í¥‰±•Ì¹…‘¡…ÍÍ•Ð¹½Ý¹•È¤¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôøÉ•ÍÁ½¹Í¥‰±•Ì¹…‘¡¥¹‘¥…Ñ½È¹±•…‘•È¤¤ì((€É•ÑÕÉ¸ì(€€€…É•…Ìèl¸¸¹…É•…Ít¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹±½…±•½µÁ…É”¡É¥¡Ð°€‰•Ìˆ¤¤°(€€€ÁÉ½•ÍÍ•ÌèÁÉ½•ÍÍ…Ñ…±½œ(€€€€€€¹™¥±Ñ•È ¡ÁÉ½•ÍÌ¤€ôøÁÉ½•ÍÍ%‘Ì¹¡…Ì¡ÁÉ½•ÍÌ¹¥¤¤(€€€€€€¹µ…À ¡ÁÉ½•ÍÌ¤€ôø€¡ì¥èÁÉ½•ÍÌ¹¥°¹…µ”èÁÉ½•ÍÌ¹¹…µ”ô¤¤°(€€€É•ÍÁ½¹Í¥‰±•Ìèl¸¸¹É•ÍÁ½¹Í¥‰±•Ít¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹±½…±•½µÁ…É”¡É¥¡Ð°€‰•Ìˆ¤¤°(€€€ÍÑ…ÑÕÍ•Ìèl(€€€€€€¸¸¹=‰©•Ð¹•¹ÑÉ¥•Ì¡‘½Õµ•¹ÑMÑ…ÑÕÍ1…‰•±Ì¤¹µ…À ¡mÙ…±Õ”°±…‰•±t¤€ôø€‘íÙ…±Õ•õð‘í±…‰•±õ€¤°(€€€€€€¸¸¹=‰©•Ð¹•¹ÑÉ¥•Ì¡¥¹‘¥…Ñ½ÉMÑ…ÑÕÍ1…‰•±Ì¤¹µ…À ¡mÙ…±Õ”°±…‰•±t¤€ôø€‘íÙ…±Õ•õð‘í±…‰•±õ€¤°(€€€€€€‰½Ù•É‘Õ•ñY•¹¥‘¼ˆ°(€€€€€€‰‘Õ•}Í½½¹ñAËÍá¥µ¼„Ù•¹•Èˆ°(€€€€€€‰½Á•¹ñ‰¥•ÉÑ„ˆ°(€€€€€€‰±½Í•‘ñ•ÉÉ…‘„ˆ°(€€€€€€‰AÉ½É…µ…‘…ñAÉ½É…µ…‘„ˆ°(€€€€€€‰I•…±¥é…‘…ñI•…±¥é…‘„ˆ°(€€€€€€‰A•¹‘¥•¹Ñ•ñA•¹‘¥•¹Ñ”ˆ°(€€€t¹™¥±Ñ•È ¡Ù…±Õ”°¥¹‘•à°Ù…±Õ•Ì¤€ôøÙ…±Õ•Ì¹¥¹‘•á=˜¡Ù…±Õ”¤€ôôô¥¹‘•à¤°(€ôì)ô()™Õ¹Ñ¥½¸µ…Ñ¡•Í¥±Ñ•ÉÌ (€™¥±Ñ•ÉÌè!½µ•…Í¡‰½…É‘¥±Ñ•ÉÌ°(€É•½Éèì(€€€…É•„üèÍÑÉ¥¹œì(€€€ÁÉ½•ÍÍ%üèÍÑÉ¥¹œì(€€€É•ÍÁ½¹Í¥‰±”üèÍÑÉ¥¹œì(€€€ÍÑ…ÑÕÌüèÍÑÉ¥¹œì(€€€µ½‘Õ±”è]½É­ÍÁ…•5½‘Õ±•%ì(€€€‘…Ñ”üèÍÑÉ¥¹œì(€ô°(¤ì(€¥˜€¡™¥±Ñ•ÉÌ¹…É•„€„ôô€‰…±°ˆ€˜˜É•½É¹…É•„€„ôô™¥±Ñ•ÉÌ¹…É•„¤É•ÑÕÉ¸™…±Í”ì(€¥˜€¡™¥±Ñ•ÉÌ¹ÁÉ½•ÍÍ%€„ôô€‰…±°ˆ€˜˜É•½É¹ÁÉ½•ÍÍ%€„ôô™¥±Ñ•ÉÌ¹ÁÉ½•ÍÍ%¤É•ÑÕÉ¸™…±Í”ì(€¥˜€¡™¥±Ñ•ÉÌ¹É•ÍÁ½¹Í¥‰±”€„ôô€‰…±°ˆ€˜˜É•½É¹É•ÍÁ½¹Í¥‰±”€„ôô™¥±Ñ•ÉÌ¹É•ÍÁ½¹Í¥‰±”¤É•ÑÕÉ¸™…±Í”ì(€¥˜€¡™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ€„ôô€‰…±°ˆ€˜˜É•½É¹ÍÑ…ÑÕÌ€„ôô™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ¤É•ÑÕÉ¸™…±Í”ì(€¥˜€¡™¥±Ñ•ÉÌ¹µ½‘Õ±”€„ôô€‰…±°ˆ€˜˜É•½É¹µ½‘Õ±”€„ôô™¥±Ñ•ÉÌ¹µ½‘Õ±”¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐ‘…Ñ”€ôÉ•½É¹‘…Ñ”ü¹Í±¥” À°€ÄÀ¤ì(€¥˜€¡™¥±Ñ•ÉÌ¹™É½´€˜˜€ …‘…Ñ”ñð‘…Ñ”€ð™¥±Ñ•ÉÌ¹™É½´¤¤É•ÑÕÉ¸™…±Í”ì(€¥˜€¡™¥±Ñ•ÉÌ¹Ñ¼€˜˜€ …‘…Ñ”ñð‘…Ñ”€ø™¥±Ñ•ÉÌ¹Ñ¼¤¤É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸ÑÉÕ”ì)ô()™Õ¹Ñ¥½¸•Ñ%¹‘¥…Ñ½ÉI•½É (€É•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ°(€¥èÍÑÉ¥¹œ°(€å•…Èè¹Õµ‰•È°(€ÅÕ…ÉÑ•ÈèEÕ…ÉÑ•È°(¤ì(€É•ÑÕÉ¸É•ÍÕ±ÑÍm¥‘tü¹mMÑÉ¥¹œ¡å•…È¥tü¹mÅÕ…ÉÑ•Étì)ô()™Õ¹Ñ¥½¸ÍÑ…ÉÑ=™]••¬¡¹½Üè…Ñ”¤ì(€½¹ÍÐÙ…±Õ”€ô¹•Ü…Ñ”¡…Ñ”¹UQ¡¹½Ü¹•ÑÕ±±e•…È ¤°¹½Ü¹•Ñ5½¹Ñ  ¤°¹½Ü¹•Ñ…Ñ” ¤¤¤ì(€½¹ÍÐ‘…ä€ôÙ…±Õ”¹•ÑUQ…ä ¤ì(€½¹ÍÐ‘…åÍM¥¹•5½¹‘…ä€ô‘…ä€ôôô€À€ü€Ø€è‘…ä€´€Äì(€Ù…±Õ”¹Í•ÑUQ…Ñ”¡Ù…±Õ”¹•ÑUQ…Ñ” ¤€´‘…åÍM¥¹•5½¹‘…ä¤ì(€É•ÑÕÉ¸Ù…±Õ”ì)ô()™Õ¹Ñ¥½¸‘½Õµ•¹ÑMÑ…ÑÕÍÑ¥½¸¡ÍÑ…ÑÕÌè½¹ÑÉ½±±•‘½Õµ•¹ÑMÑ…ÑÕÌ¤ì(€½¹ÍÐ…Ñ¥½¹ÌèI•½Éñ½¹ÑÉ½±±•‘½Õµ•¹ÑMÑ…ÑÕÌ°ÍÑÉ¥¹œø€ôì(€€€‘É…™Ðè€‰…ÑÕ…±¥ëÌ•°‰½ÉÉ…‘½È‘”ˆ°(€€€Á•¹‘¥¹œè€‰•¹Ù§Ì„Ù…±¥‘…§Í¸ˆ°(€€€ÕÉÉ•¹Ðè€‰ÁÕ‰±¥Ìˆ°(€€€É•©•Ñ•è€‰É•¥ÍÑËÌÕ¹„½ÉÉ•§Í¸Á…É„ˆ°(€€€½‰Í½±•Ñ”è€‰ÍÕÍÑ¥ÑÕçÌ±„Ù•ÉÍ§Í¸‘”ˆ°(€ôì(€É•ÑÕÉ¸…Ñ¥½¹ÍmÍÑ…ÑÕÍtì)ô()™Õ¹Ñ¥½¸½Õ¹Ñ	åMÑ…ÑÕÌ¡Ù…±Õ•ÌèÍÑÉ¥¹mt¤ì(€É•ÑÕÉ¸Ù…±Õ•Ì¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°¹Õµ‰•Èøø ¡½Õ¹ÑÌ°Ù…±Õ”¤€ôøì(€€€½Õ¹ÑÍmÙ…±Õ•t€ô€¡½Õ¹ÑÍmÙ…±Õ•t€üü€À¤€¬€Äì(€€€É•ÑÕÉ¸½Õ¹ÑÌì(€ô°íô¤ì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸Í•…É¡!½µ•…Í¡‰½…É (€¥¹‘•àè!½µ•M•…É¡I•ÍÕ±Ñmt°(€ÅÕ•ÉäèÍÑÉ¥¹œ°(€±¥µ¥Ð€ô€à°(¤ì(€½¹ÍÐ¹½Éµ…±¥é•€ô¹½Éµ…±¥é•M•…É¡Q•áÐ¡ÅÕ•Éä¤ì(€¥˜€¡¹½Éµ…±¥é•¹±•¹Ñ €ð€È¤É•ÑÕÉ¸mtì(€É•ÑÕÉ¸¥¹‘•à(€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¹½Éµ…±¥é•M•…É¡Q•áÐ¡€‘í¥Ñ•´¹Ñ¥Ñ±•ô€‘í¥Ñ•´¹µ•Ñ…ô€‘í¥Ñ•´¹Í•…É¡Q•áÑõ€¤¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•¤¤(€€€€¹Í±¥” À°±¥µ¥Ð¤ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•M•…É¡Q•áÐ¡Ù…±Õ”èÍÑÉ¥¹œ¤ì(€É•ÑÕÉ¸Ù…±Õ”(€€€€¹¹½Éµ…±¥é” ‰9ˆ¤(€€€€¹É•Á±…” ½mqÔÀÌÀÀµqÔÀÌÙ™t½œ°€ˆˆ¤(€€€€¹Ñ½1½…±•1½Ý•É…Í” ‰•Ìˆ¤(€€€€¹ÑÉ¥´ ¤ì)ô(