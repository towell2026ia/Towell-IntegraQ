import { canSubmitIndicator, getIndicatorProcessIds, type ConfiguredIndicator, type Quarter } from "@/lib/indicator-data";
import {
  canAccessProcess,
  isAdministrator,
  isExternalUser,
  type ActiveSession,
} from "@/lib/session-data";
import { canPerformModuleAction } from "@/lib/module-permissions";
import type { IndicatorRuntimeAccess } from "@/lib/indicators/indicator-types";

export const ALL_INDICATOR_AREAS = "__all__";

export function canManageIndicatorCatalog(session: ActiveSession) {
  return isAdministrator(session);
}

export function canViewIndicator(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId" | "processIds">,
) {
  return getIndicatorProcessIds(indicator).some((processId) =>
    canAccessProcess(session, processId),
  );
}

export function canUpdateIndicatorResult(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId" | "processIds">,
) {
  return isAdministrator(session) || (
    !isExternalUser(session) &&
    canViewIndicator(session, indicator) &&
    canPerformModuleAction(session, "indicators", "update")
  );
}

export type IndicatorCaptureDenialReason = "permission" | "process" | "window" | null;

export function getIndicatorCaptureDenialReason(
  session: ActiveSession,
  indicator: ConfiguredIndicator,
  year: number,
  quarter: Quarter,
  now = new Date(),
): IndicatorCaptureDenialReason {
  if (isAdministrator(session)) return null;
  if (!canViewIndicator(session, indicator)) return "process";
  if (isExternalUser(session) || !canPerformModuleAction(session, "indicators", "update")) {
    return "permission";
  }
  return canSubmitIndicator(indicator, year, quarter, now) ? null : "window";
}

export function getIndicatorCaptureDenialMessage(reason: IndicatorCaptureDenialReason) {
  if (reason === "process") return "Este indicador no pertenece a uno de tus procesos asignados.";
  if (reason === "permission") return "No tienes permiso para capturar resultados de este indicador.";
  if (reason === "window") return "El periodo de captura está cerrado. Consulta la fecha de apertura y cierre.";
  return "";
}

export function applyIndicatorRuntimeAccess(
  session: ActiveSession,
  access: IndicatorRuntimeAccess,
): ActiveSession {
  const assignedModuleIds: NonNullable<ActiveSession["assignedModuleIds"]> = (
    session.assignedModuleIds ?? []
  ).filter((moduleId) => moduleId !== "indicators");
  if (access.canView) assignedModuleIds.push("indicators");
  const moduleActionPermissions = (session.moduleActionPermissions ?? []).filter(
    (permission) => permission.moduleId !== "indicators",
  );
  if (access.canView) moduleActionPermissions.push({ moduleId: "indicators", action: "view" });
  if (access.canUpdate) moduleActionPermissions.push({ moduleId: "indicators", action: "update" });
  return {
    ...session,
    assignedProcessIds: [...access.assignedProcessIds],
    assignedModuleIds,
    moduleActionPermissions,
  };
}

export function canEditIndicatorPeriod(
  session: ActiveSession,
  indicator: ConfiguredIndicator,
  year: number,
  quarter: Quarter,
  now = new Date(),
) {
  return getIndicatorCaptureDenialReason(session, indicator, year, quarter, now) === null;
}

export function getAccessibleIndicators(
  session: ActiveSession,
  indicators: ConfiguredIndicator[],
) {
  return indicators.filter((indicator) => canViewIndicator(session, indicator));
}

export function getDefaultIndicatorArea(
  session: ActiveSession,
  focusedArea?: string,
) {
  return focusedArea ?? (isAdministrator(session) ? ALL_INDICATOR_AREAS : session.department);
}

export function matchesIndicatorArea(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "area">,
  area: string,
) {
  return isAdministrator(session) && area === ALL_INDICATOR_AREAS
    ? true
    : indicator.area === area;
}
