import type { ConfiguredIndicator } from "@/lib/indicator-data";
import type { ActiveSession } from "@/lib/session-data";

export function canManageIndicatorCatalog(session: ActiveSession) {
  return session.userType === "Administrador";
}

export function canViewIndicator(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId">,
) {
  return (
    canManageIndicatorCatalog(session) ||
    session.assignedProcessIds.includes(indicator.processId)
  );
}

export function canUpdateIndicatorResult(
  session: ActiveSession,
  indicator: Pick<ConfiguredIndicator, "processId">,
) {
  return canViewIndicator(session, indicator);
}

export function getAccessibleIndicators(
  session: ActiveSession,
  indicators: ConfiguredIndicator[],
) {
  return indicators.filter((indicator) => canViewIndicator(session, indicator));
}
