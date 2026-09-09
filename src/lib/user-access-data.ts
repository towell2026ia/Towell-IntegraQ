import { processCatalog } from "@/lib/configuration-data";
import {
  organizationPositions,
  type OrganizationPosition,
  type ProcessRelationship,
} from "@/lib/organization-data";
import {
  workspaceModuleMeta,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import { normalizeModulePermissions } from "@/lib/module-permissions";
import type {
  ActiveSession,
  ContinuousImprovementRole,
  DocumentAccessRole,
  ModuleActionPermission,
  ProcessDocumentAccess,
  UserType,
} from "@/lib/session-data";

export type UserAccountStatus = "active" | "inactive";

export interface UserAccessAccount {
  id: string;
  authUserId?: string;
  fullName: string;
  email: string;
  userType: UserType;
  positionId?: string;
  positionName?: string;
  branch?: string;
  companyId?: string;
  companyName?: string;
  status: UserAccountStatus;
  assignedProcessIds: string[];
  assignedModuleIds: WorkspaceModuleId[];
  moduleActionPermissions: ModuleActionPermission[];
  documentAccess: ProcessDocumentAccess[];
  continuousImprovementRole?: ContinuousImprovementRole;
  createdAt: string;
}

export interface CreateUserAccessInput {
  id: string;
  fullName: string;
  email: string;
  userType: UserType;
  positionId?: string;
  companyId?: string;
  companyName?: string;
  continuousImprovementRole?: ContinuousImprovementRole;
  documentAccess?: ProcessDocumentAccess[];
  moduleActionPermissions?: ModuleActionPermission[];
  positionCatalog?: OrganizationPosition[];
  createdAt: string;
}

export const documentAccessRoleLabels: Record<DocumentAccessRole, string> = {
  viewer: "Visor",
  modifier: "Modificador",
  authorizer: "Modificador + autorizador",
};

export const relationshipDocumentRole: Record<
  ProcessRelationship,
  DocumentAccessRole
> = {
  owner: "modifier",
  approver: "authorizer",
  participant: "viewer",
  support: "viewer",
};

export const internalAssignableModuleIds: WorkspaceModuleId[] = [
  "home",
  "documents",
  "risks",
  "indicators",
  "audits",
  "audit-app",
  "corrective-actions",
  "customers",
  "customer-portal",
  "suppliers",
  "supplier-portal",
  "management-review",
  "continuous-improvement",
  "forms",
  "ai-assistant",
  "calibrations",
];

export function derivePositionAccess(
  positionId: string,
  positionCatalog: OrganizationPosition[] = organizationPositions,
) {
  const position = positionCatalog.find((item) => item.id === positionId);
  if (!position) return null;

  const documentAccess = position.processLinks.map((link) => ({
    processId: link.processId,
    role: relationshipDocumentRole[link.relationship],
    inheritedFromPositionId: position.id,
  }));
  const assignedProcessIds = [...new Set(documentAccess.map((item) => item.processId))];
  const assignedModuleIds = derivePositionModules(position, documentAccess);
  const moduleActionPermissions = derivePositionModuleActions(
    assignedModuleIds,
    documentAccess,
  );

  return {
    position,
    documentAccess,
    assignedProcessIds,
    assignedModuleIds,
    moduleActionPermissions,
  };
}

export function createUserAccessAccount(
  input: CreateUserAccessInput,
): UserAccessAccount | null {
  const shared = {
    id: input.id,
    fullName: input.fullName.trim(),
    email: input.email.trim().toLocaleLowerCase("es-MX"),
    userType: input.userType,
    status: "active" as const,
    createdAt: input.createdAt,
  };

  if (!shared.fullName || !shared.email) return null;

  if (input.userType === "Administrador") {
    const position = getPosition(input.positionId, input.positionCatalog);
    if (!position) return null;
    return {
      ...shared,
      positionId: position.id,
      positionName: position.name,
      branch: position.branch,
      assignedProcessIds: processCatalog.map((process) => process.id),
      assignedModuleIds: Object.keys(workspaceModuleMeta) as WorkspaceModuleId[],
      moduleActionPermissions: [],
      documentAccess: [],
      continuousImprovementRole: "manager",
    };
  }

  if (input.userType === "Usuario interno") {
    const inherited = input.positionId
      ? derivePositionAccess(input.positionId, input.positionCatalog)
      : null;
    if (!inherited) return null;
    const documentAccess = input.documentAccess ?? inherited.documentAccess;
    const moduleActionPermissions = normalizeModulePermissions(
      input.moduleActionPermissions ?? inherited.moduleActionPermissions,
    );
    if ((input.continuousImprovementRole ?? "submitter") === "manager") {
      moduleActionPermissions.push(
        { moduleId: "continuous-improvement", action: "update" },
        { moduleId: "continuous-improvement", action: "manage" },
      );
    }
    const normalizedModulePermissions = normalizeModulePermissions(
      moduleActionPermissions,
    );
    const assignedModuleIds = internalAssignableModuleIds.filter(
      (moduleId) =>
        moduleId === "home" ||
        normalizedModulePermissions.some(
          (permission) =>
            permission.moduleId === moduleId && permission.action === "view",
        ),
    );
    return {
      ...shared,
      positionId: inherited.position.id,
      positionName: inherited.position.name,
      branch: inherited.position.branch,
      assignedProcessIds: [...new Set(documentAccess.map((item) => item.processId))],
      assignedModuleIds,
      moduleActionPermissions: normalizedModulePermissions,
      documentAccess,
      continuousImprovementRole: input.continuousImprovementRole ?? "submitter",
    };
  }

  if (!input.companyId || !input.companyName?.trim()) return null;
  const portalId =
    input.userType === "Cliente" ? "customer-portal" : "supplier-portal";
  return {
    ...shared,
    companyId: input.companyId,
    companyName: input.companyName.trim(),
    assignedProcessIds: [],
    assignedModuleIds: [portalId],
    moduleActionPermissions: [{ moduleId: portalId, action: "view" }],
    documentAccess: [],
  };
}

export function refreshAccountFromOrganization(
  account: UserAccessAccount,
  positionCatalog: OrganizationPosition[] = organizationPositions,
): UserAccessAccount {
  if (account.userType !== "Usuario interno" || !account.positionId) {
    return account;
  }
  const inherited = derivePositionAccess(account.positionId, positionCatalog);
  if (!inherited) return account;
  return {
    ...account,
    positionName: inherited.position.name,
    branch: inherited.position.branch,
    assignedProcessIds: inherited.assignedProcessIds,
    assignedModuleIds: inherited.assignedModuleIds,
    moduleActionPermissions: inherited.moduleActionPermissions,
    documentAccess: inherited.documentAccess,
  };
}

export function buildSessionFromAccount(
  account: UserAccessAccount,
): ActiveSession {
  const names = account.fullName.split(/\s+/).filter(Boolean);
  const initials = names.slice(0, 2).map((name) => name[0]).join("").toLocaleUpperCase("es-MX");
  const externalKind =
    account.userType === "Cliente"
      ? "customer"
      : account.userType === "Proveedor"
        ? "supplier"
        : null;

  return {
    userId: account.id,
    name: account.fullName,
    shortName: names.length > 1 ? `${names[0]} ${names[1][0]}.` : account.fullName,
    initials,
    position: account.positionName ?? account.userType,
    positionId: account.positionId,
    department: account.branch ?? "Externo",
    company: account.companyName ?? "Towell",
    userType: account.userType,
    assignedProcessIds: account.assignedProcessIds,
    assignedModuleIds: account.assignedModuleIds,
    moduleActionPermissions: account.moduleActionPermissions,
    documentAccess: account.documentAccess,
    continuousImprovementRole: account.continuousImprovementRole,
    externalParty:
      externalKind && account.companyId && account.companyName
        ? {
            kind: externalKind,
            companyId: account.companyId,
            companyName: account.companyName,
          }
        : undefined,
  };
}

export function getPositionDocumentAccess(
  positionId: string | undefined,
  processId: string,
) {
  if (!positionId) return undefined;
  return derivePositionAccess(positionId)?.documentAccess.find(
    (item) => item.processId === processId,
  );
}

export function getAccountScopeLabel(account: UserAccessAccount) {
  if (account.userType === "Administrador") return "Acceso total";
  if (account.userType === "Usuario interno") {
    return `${account.assignedProcessIds.length} procesos · ${account.assignedModuleIds.length} menús`;
  }
  return account.companyName ?? "Empresa pendiente";
}

export const initialUserAccessAccounts: UserAccessAccount[] = [
  {
    id: "USR-FJHR-001",
    fullName: "Francisco Javier Hernández Retana",
    email: "",
    userType: "Administrador",
    positionId: "PU-07",
    positionName: "Gerente de Calidad",
    branch: "Calidad",
    status: "active",
    assignedProcessIds: processCatalog.map((process) => process.id),
    assignedModuleIds: Object.keys(workspaceModuleMeta) as WorkspaceModuleId[],
    moduleActionPermissions: [],
    documentAccess: [],
    continuousImprovementRole: "manager",
    createdAt: "2026-08-17T12:00:00.000Z",
  },
];

function getPosition(
  positionId: string | undefined,
  positionCatalog: OrganizationPosition[] = organizationPositions,
) {
  return positionId
    ? positionCatalog.find((position) => position.id === positionId)
    : undefined;
}

function derivePositionModules(
  position: OrganizationPosition,
  documentAccess: ProcessDocumentAccess[],
) {
  const modules = new Set<WorkspaceModuleId>(["home", "documents", "continuous-improvement"]);
  if (documentAccess.length) modules.add("indicators");
  if (documentAccess.some((item) => item.role === "modifier")) {
    modules.add("risks");
    modules.add("corrective-actions");
    modules.add("forms");
  }
  if (documentAccess.some((item) => item.role === "authorizer")) {
    modules.add("audits");
  }
  if (position.branch === "Calidad") {
    modules.add("audits");
    modules.add("corrective-actions");
    modules.add("customers");
    modules.add("suppliers");
    modules.add("calibrations");
    modules.add("continuous-improvement");
  }
  if (["PU-01", "PU-02"].includes(position.id)) {
    modules.add("management-review");
  }
  return internalAssignableModuleIds.filter((module) => modules.has(module));
}

function derivePositionModuleActions(
  assignedModuleIds: WorkspaceModuleId[],
  documentAccess: ProcessDocumentAccess[],
) {
  const permissions: ModuleActionPermission[] = assignedModuleIds.map(
    (moduleId) => ({ moduleId, action: "view" }),
  );
  const canModify = documentAccess.some((access) => access.role !== "viewer");
  const canAuthorize = documentAccess.some(
    (access) => access.role === "authorizer",
  );

  permissions.push({ moduleId: "continuous-improvement", action: "create" });
  if (canModify) {
    permissions.push(
      { moduleId: "documents", action: "update" },
      { moduleId: "indicators", action: "update" },
      { moduleId: "risks", action: "update" },
      { moduleId: "forms", action: "create" },
      { moduleId: "forms", action: "update" },
      { moduleId: "corrective-actions", action: "update" },
    );
  }
  if (canAuthorize) {
    permissions.push(
      { moduleId: "documents", action: "approve" },
      { moduleId: "audits", action: "update" },
    );
  }
  return normalizeModulePermissions(permissions);
}
