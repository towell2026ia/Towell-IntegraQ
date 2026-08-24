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
    return (
      hasValidExternalScope(session) && module === EXTERNAL_PORTALS[externalKind]
    );
  }

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
) {
  if (isAdministrator(session)) return true;
  return (
    getExternalKindForSession(session) === kind &&
    session.externalParty?.kind === kind &&
    session.externalParty.companyId === companyId
  );
}
