import type { WorkspaceModuleId } from "@/lib/navigation";
import type { ActiveSession, ExternalPartyKind } from "@/lib/session-data";
import { isAdministrator } from "@/lib/session-data";

const EXTERNAL_PORTALS: Record<ExternalPartyKind, WorkspaceModuleId> = {
  customer: "customer-portal",
  supplier: "supplier-portal",
};

export function getExternalKindForSession(
  session: ActiveSession,
): ExternalPartyKind | null {
  if (session.userType === "Cliente") return "customer";
  if (session.userType === "Proveedor") return "supplier";
  return null;
}

export function hasValidExternalScope(session: ActiveSession) {
  const kind = getExternalKindForSession(session);
  return Boolean(
    kind &&
      session.externalParty?.kind === kind &&
      session.externalParty.companyId.trim(),
  );
}

export function canAccessModule(
  session: ActiveSession,
  module: WorkspaceModuleId,
) {
  if (isAdministrator(session)) return true;

  const externalKind = getExternalKindForSession(session);
  if (externalKind) {
    const permission = externalKind === "customer"
      ? "portal_clientes.acceder"
      : "portal_proveedores.acceder";
    if (session.specificPermissions?.[permission] !== true) return false;
    return (
      hasValidExternalScope(session) && module === EXTERNAL_PORTALS[externalKind]
    );
  }

  if (module === "documents") return Boolean(session.assignedModuleIds?.includes(module)) || Boolean(session.moduleActionPermissions?.some((permission) => permission.moduleId === module && permission.action === "view"));

  const requiredSpecificPermission = module === "customers"
    ? "clientes.acceder"
    : module === "suppliers"
      ? "proveedores.acceder"
      : module === "customer-portal"
        ? "portal_clientes.acceder"
        : module === "supplier-portal"
          ? "portal_proveedores.acceder"
          : null;
  if (module === "customers" && session.specificPermissions?.["clientes.ver"] === false) return false;
  if (module === "suppliers" && session.specificPermissions?.["proveedores.ver"] === false) return false;
  if (requiredSpecificPermission) {
    const configured = session.specificPermissions?.[requiredSpecificPermission];
    if (configured === false || ((module === "customer-portal" || module === "supplier-portal") && configured !== true)) return false;
    if (configured === true) return Boolean(session.assignedModuleIds?.includes(module));
  }

  if (module === "access") return session.specificPermissions?.["usuarios.ver"] !== false && (Boolean(session.assignedModuleIds?.includes(module)) || Object.entries(session.specificPermissions ?? {}).some(([key, allowed]) => key.startsWith("usuarios.") && allowed));
  return (
    module === "home" || Boolean(session.assignedModuleIds?.includes(module))
  );
}

export function getDefaultModuleForSession(
  session: ActiveSession,
): WorkspaceModuleId {
  const externalKind = getExternalKindForSession(session);
  if (externalKind) {
    return EXTERNAL_PORTALS[externalKind];
  }
  return "home";
}

export function resolveAuthorizedModule(
  session: ActiveSession,
  requestedModule: WorkspaceModuleId | null,
) {
  const fallback = getDefaultModuleForSession(session);
  return requestedModule && canAccessModule(session, requestedModule)
    ? requestedModule
    : fallback;
}

export function canAccessCompanyRecord(
  session: ActiveSession,
  kind: ExternalPartyKind,
  companyId: string,
  siteId?: string,
) {
  if (isAdministrator(session)) return true;
  return (
    canAccessModule(session, EXTERNAL_PORTALS[kind]) &&
    getExternalKindForSession(session) === kind &&
    session.externalParty?.kind === kind &&
    session.externalParty.companyId === companyId &&
    (!session.externalParty.siteId || !siteId || session.externalParty.siteId === siteId)
  );
}
