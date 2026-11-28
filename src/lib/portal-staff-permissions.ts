import { canAccessModule } from "./access-policy";
import type { ActiveSession, ExternalPartyKind } from "./session-data";

export const invitationActions = ["consultar", "emitir", "reenviar", "revocar"] as const;
export type InvitationAction = typeof invitationActions[number];
export type InvitationPermissions = Record<InvitationAction, boolean>;

export function canSupervisePortal(session: ActiveSession | null, kind: ExternalPartyKind) {
  if (!session || session.workspaceMode !== "production" || !session.organizationId) return false;
  if (session.userType === "Administrador") return true;
  if (session.userType !== "Usuario interno") return false;
  const supplier = kind === "supplier";
  return canAccessModule(session, supplier ? "supplier-portal" : "customer-portal")
    && canAccessModule(session, supplier ? "suppliers" : "customers")
    && session.specificPermissions?.[supplier ? "proveedores.ver" : "clientes.ver"] !== false;
}

export function invitationPermissions(session: ActiveSession | null, kind: ExternalPartyKind): InvitationPermissions {
  function allowed(action: InvitationAction) {
    if (!session || !canSupervisePortal(session, kind)) return false;
    const family = kind === "supplier" ? "portal_proveedores" : "portal_clientes";
    return session.userType === "Administrador" || session.specificPermissions?.[`${family}.${action}_invitaciones`] === true;
  }
  return { consultar: allowed("consultar"), emitir: allowed("emitir"), reenviar: allowed("reenviar"), revocar: allowed("revocar") };
}
