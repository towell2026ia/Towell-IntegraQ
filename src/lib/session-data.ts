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

export interface ProcessDocumentAccess {
  processId: string;
  role: DocumentAccessRole;
  inheritedFromPositionId: string;
}

export interface ActiveSession {
  userId: string;
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
  continuousImprovementRole: "manager",
  positionId: "PU-07",
};
