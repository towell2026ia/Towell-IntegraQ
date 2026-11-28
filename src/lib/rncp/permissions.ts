import { canPerformModuleAction } from "../module-permissions";
import type { ActiveSession } from "../session-data";
import type { SpecificPermissionKey } from "../specific-permissions";

type RncpPermission = Extract<SpecificPermissionKey,`rncp.${string}`>;
export function canPerformRncp(session: ActiveSession, permission: RncpPermission) {
  if (!canPerformModuleAction(session, "suppliers", "view")) return false;
  const effective = session.specificPermissions?.[permission];
  if (effective !== undefined) return effective;
  // Legacy projections may still be used by the demo and pre-migration views.
  if (permission.startsWith("rncp.consultar_")) return true;
  if (permission === "rncp.crear_rncp") return canPerformModuleAction(session, "suppliers", "create");
  if (permission === "rncp.editar_rncp") return canPerformModuleAction(session, "suppliers", "update");
  return false;
}
