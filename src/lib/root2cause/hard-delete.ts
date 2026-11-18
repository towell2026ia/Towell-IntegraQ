import type { ActiveSession } from "@/lib/session-data";
import { isAdministrator } from "@/lib/session-data";

export interface HardDeleteConfirmation {
  actionId: string;
  folio: string;
  reason: string;
  folioConfirmation: string;
}

/** The destructive control requires an explicit manage grant as well as admin role. */
export function canHardDeleteCorrectiveAction(session: ActiveSession) {
  return isAdministrator(session) && (session.moduleActionPermissions ?? []).some(
    (permission) => permission.moduleId === "corrective-actions" && permission.action === "manage" && permission.source === "direct",
  );
}

export function validateHardDeleteConfirmation(input: HardDeleteConfirmation) {
  if (!input.actionId.trim() || !input.folio.trim()) return "No se identificó la acción correctiva.";
  if (!input.reason.trim()) return "El motivo de eliminación es obligatorio.";
  if (input.reason.trim().length > 1000) return "El motivo no puede superar 1,000 caracteres.";
  if (input.folioConfirmation !== input.folio) return "Escribe el código AC exacto para confirmar.";
  return null;
}
