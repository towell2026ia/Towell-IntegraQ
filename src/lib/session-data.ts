import type { WorkspaceModuleId } from "@/lib/navigation";

export type UserType =
  | "Administrador"
  | "Usuario interno"
  | "Cliente"
  | "Proveedor";

export type ExternalPartyKind = "customer" | "supplier";

export interface ExternalPartyScope {
  kind: ExternalPartyKind;
  companyId: string;
  companyName: string;
}

export type DocumentAccessRole = "viewer" | "modifier" | "authorizer";
export type ContinuousImprovementRole = "submitter" | "manager";
export type ModulePermissionAction =
  | "view"
  | "create"
  | "update"
  | "submit"
  | "review"
  | "approve"
  | "close"
  | "reopen"
  | "export"
  | "manage";

export interface ModuleActionPermission {
  moduleId: WorkspaceModuleId;
  action: ModulePermissionAction;
}

export interface ProcessDocumentAccess {
  processId: string;
  role: DocumentAccessRole;
  inheritedFromPositionId: string;
}

export interface ActiveSession {
  userId: string;
  authUserId?: string;
  name: string;
  shortName: string;
  initials: string;
  position: string;
  department: string;
  company: string;
  site?: string;
  userType: UserType;
  assignedProcessIds: string[];
  assignedModuleIds?: WorkspaceModuleId[];
  moduleActionPermissions?: ModuleActionPermission[];
  positionId?: string;
  documentAccess?: ProcessDocumentAccess[];
  continuousImprovementRole?: ContinuousImprovementRole;
  externalParty?: ExternalPartyScope;
}

export function isAdministrator(session: ActiveSession) {
  return session.userType === "Administrador";
}

export function canAccessProcess(session: ActiveSession, processId: string) {
  return (
    isAdministrator(session) ||
    (session.userType === "Usuario interno" &&
      session.assignedProcessIds.includes(processId))
  );
}

export function getProcessDocumentRole(
  session: ActiveSession,
  processId: string,
) {
  if (isAdministrator(session)) return "authorizer" as const;
  return session.documentAccess?.find((access) => access.processId === processId)
    ?.role;
}

export function canModifyProcess(session: ActiveSession, processId: string) {
  const role = getProcessDocumentRole(session, processId);
  return role === "modifier" || role === "authorizer";
}

export function isExternalUser(session: ActiveSession) {
  return session.userType === "Cliente" || session.userType === "Proveedor";
}

export const activeSession: ActiveSession = {
  userId: "USR-FJHR-001",
  name: "Francisco Javier Hernández Retana",
  shortName: "Francisco J. Hernández",
  initials: "FH",
  position: "Gerente de Calidad",
  department: "Calidad",
  company: "Towell",
  site: "Planta principal",
  userType: "Administrador",
  assignedProcessIds: ["P-08"],
  assignedModuleIds: [],
  moduleActionPermissions: [],
  continuousImprovementRole: "manager",
  positionId: "PU-07",
};
