import { canAccessModule, canAccessCompanyRecord } from "./access-policy";
import { canPerformModuleAction } from "./module-permissions";
import type { ActiveSession, ExternalPartyKind } from "./session-data";
export function canUseLivePortal(session: ActiveSession, kind: ExternalPartyKind) {
  return session.workspaceMode !== "demo" && canAccessModule(session, kind === "customer" ? "customer-portal" : "supplier-portal")
    && (session.userType === (kind === "customer" ? "Cliente" : "Proveedor")) && Boolean(session.externalParty?.companyId);
}
export function canUseSupplierApi(session: ActiveSession) {
  if (session.workspaceMode === "demo") return false;
  return session.userType === "Proveedor" ? canUseLivePortal(session, "supplier")
    : (session.userType === "Administrador" || session.userType === "Usuario interno") && canPerformModuleAction(session, "suppliers", "view");
}
export function canReadSupplierRecord(session: ActiveSession, companyId: string, siteId?: string | null) {
  return canUseSupplierApi(session) && (session.userType !== "Proveedor" || canAccessCompanyRecord(session, "supplier", companyId, siteId ?? undefined));
}
