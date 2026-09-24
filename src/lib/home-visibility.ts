import { processCatalog } from "@/lib/configuration-data";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";

export type HomeSectionId =
  | "quality-policy"
  | "quality-objectives"
  | "alerts"
  | "pending-tasks"
  | "document-status"
  | "upcoming-events"
  | "performance"
  | "module-status"
  | "trends"
  | "recent-activity"
  | "quick-actions";

export type HomeSectionScope =
  | "all-processes"
  | "selected-processes"
  | "specific-users";

export interface HomeSectionConfiguration {
  id: HomeSectionId;
  label: string;
  description: string;
  scope: HomeSectionScope;
  visibleToAdministrators: boolean;
  active: boolean;
  processIds: string[];
  userIds: string[];
}

export const homeSectionDefinitions: ReadonlyArray<
  Pick<HomeSectionConfiguration, "id" | "label" | "description">
> = [
  { id: "quality-policy", label: "Política de Calidad", description: "Política general del Sistema de Gestión de Calidad." },
  { id: "quality-objectives", label: "Objetivos de Calidad", description: "Objetivos e indicadores vinculados con los procesos autorizados." },
  { id: "alerts", label: "Alertas", description: "Situaciones críticas o que requieren atención." },
  { id: "pending-tasks", label: "Pendientes", description: "Actividades bajo responsabilidad del usuario o de sus procesos." },
  { id: "document-status", label: "Estado documental", description: "Documentos revisados, en validación, vigentes y por corregir." },
  { id: "upcoming-events", label: "Próximos eventos", description: "Vencimientos, auditorías y compromisos programados." },
  { id: "performance", label: "Indicadores clave", description: "Resumen de desempeño calculado dentro del alcance autorizado." },
  { id: "module-status", label: "Estado de módulos", description: "Resumen operativo de los módulos conectados." },
  { id: "trends", label: "Tendencias", description: "Distribución de estados y evolución operativa." },
  { id: "recent-activity", label: "Actividad reciente", description: "Movimientos recientes de registros autorizados." },
  { id: "quick-actions", label: "Acciones rápidas", description: "Atajos disponibles de acuerdo con el rol del usuario." },
];

export const defaultHomeSectionConfigurations: HomeSectionConfiguration[] =
  homeSectionDefinitions.map((section) => ({
    ...section,
    scope: "all-processes",
    visibleToAdministrators: true,
    active: true,
    processIds: [],
    userIds: [],
  }));

export function normalizeHomeSectionConfigurations(
  configurations?: HomeSectionConfiguration[],
) {
  const configured = new Map(
    (configurations ?? []).map((configuration) => [configuration.id, configuration]),
  );
  return defaultHomeSectionConfigurations.map((fallback) => {
    const value = configured.get(fallback.id);
    if (!value) return fallback;
    return {
      ...fallback,
      ...value,
      processIds: uniqueKnownProcessIds(value.processIds),
      userIds: [...new Set(value.userIds.filter(Boolean))],
    };
  });
}

export function getAuthorizedProcessIds(session: ActiveSession) {
  if (isAdministrator(session)) {
    return processCatalog.map((process) => process.id);
  }
  if (session.userType !== "Usuario interno") return [];
  return uniqueKnownProcessIds(session.assignedProcessIds);
}

export function getEffectiveHomeProcessIds(
  session: ActiveSession,
  requestedProcessId = "all",
) {
  const authorized = getAuthorizedProcessIds(session);
  if (!isAdministrator(session) || requestedProcessId === "all") return authorized;
  return authorized.includes(requestedProcessId) ? [requestedProcessId] : [];
}

export function getVisibleHomeSectionIds(
  session: ActiveSession,
  configurations?: HomeSectionConfiguration[],
) {
  const authorizedProcessIds = new Set(getAuthorizedProcessIds(session));
  const sessionIds = new Set([session.userId, session.authUserId].filter(Boolean));
  return new Set(
    normalizeHomeSectionConfigurations(configurations)
      .filter((configuration) => {
        if (!configuration.active) return false;
        if (isAdministrator(session)) return configuration.visibleToAdministrators;
        if (session.userType !== "Usuario interno") return false;
        if (configuration.scope === "all-processes") return authorizedProcessIds.size > 0;
        if (configuration.scope === "specific-users") {
          return configuration.userIds.some((userId) => sessionIds.has(userId));
        }
        return configuration.processIds.some((processId) =>
          authorizedProcessIds.has(processId),
        );
      })
      .map((configuration) => configuration.id),
  );
}

function uniqueKnownProcessIds(processIds: string[]) {
  const knownIds = new Set(processCatalog.map((process) => process.id));
  return [...new Set(processIds)].filter((processId) => knownIds.has(processId));
}
