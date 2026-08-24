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
  const identityIds = [session.userId, session.authUserId].filter(Boolean);
  const participant = action.participantUserIds?.some((id) =>
    identityIds.includes(id),
  );
  const ownerById = Boolean(action.ownerId && identityIds.includes(action.ownerId));
  const ownerByName = normalizeName(action.owner) === normalizeName(session.name);
  return Boolean(participant || ownerById || ownerByName);
}

export function canEditCorrectiveAction(
  session: ActiveSession,
  action: CorrectiveAction,
) {
  return (
    canViewCorrectiveAction(session, action) &&
    canPerformModuleAction(session, "corrective-actions", "update")
  );
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase("es-MX");
}
