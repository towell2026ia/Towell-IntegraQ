import type { ConfiguredIndicator } from "@/lib/indicator-data";
import {
  canAccessProcess,
  canModifyProcess,
  isAdministrator,
  type ActiveSession,
} from "@/lib/session-data";
import { canPerformModuleAction } from "@/lib/module-permissions";

export const ALL_INDICATOR_AREAS = "__all__";

export function canManageIndicatorCatalog(session: ActiveSession) {
  return isAdministrator(session);
}

export function canViewIndicator(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId">,
) {
  return canAccessProcess(session, indicator.processId);
}

export function canUpdateIndicatorResult(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId">,
) {
  return (
    canViewIndicator(session, indicator) &&
    canModifyProcess(session, indicator.processId) &&
    canPerformModuleAction(session, "indicators", "update")
  );
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
