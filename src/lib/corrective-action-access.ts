import { canPerformModuleAction } from "@/lib/module-permissions";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction } from "@/lib/types";

export function canViewCorrectiveAction(
  session: ActiveSession,
  action: CorrectiveAction,
) {
  if (isAdministrator(session)) return true;
  if (!canPerformModuleAction(session, "corrective-actions", "view")) {
    return false;
  }
  if (action.organizationId && action.organizationId !== session.organizationId) return false;
  if (!action.organizationId && session.workspaceMode !== "demo") return false;
  return !action.processId || session.assignedProcessIds.includes(action.processId);
}

export function canEditCorrectiveAction(
  session: ActiveSession,
  action: CorrectiveAction,
) {
  return isAdministrator(session) && canViewCorrectiveAction(session, action);
}
