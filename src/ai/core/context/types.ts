import type { WorkspaceModuleId } from "@/lib/navigation";
import type { UserType } from "@/lib/session-data";

import type { AiPermission } from "../permissions/types";

export const contextIncludeValues = ["process", "documents", "indicators", "risks", "audits", "corrective-actions", "metrology", "improvements", "equipment", "customers", "suppliers"] as const;
export type ContextInclude = typeof contextIncludeValues[number];
export type ContextSourceType = "process" | "document" | "indicator" | "risk" | "audit" | "corrective_action" | "equipment" | "customer" | "supplier" | "improvement";

export interface ContextSource {
  type: ContextSourceType;
  id: string;
  code?: string;
  title: string;
  version?: string;
  status?: string;
  processId?: string;
}

export interface IntegraQUserContext {
  userId: string;
  name: string;
  role: string;
  userType: UserType;
  permissions: AiPermission[];
}

export interface IntegraQProcessContext {
  areaId?: string;
  areaName?: string;
  processId: string;
  processName: string;
  parentProcessId?: string;
  parentProcessName?: string;
}

export interface IntegraQRecordContext {
  entityType: string;
  entityId: string;
  entityCode?: string;
  entityStatus?: string;
  processId?: string;
}

export interface OmittedContextSource {
  include: ContextInclude;
  reason: "not_requested" | "not_available" | "not_authorized" | "missing_scope";
}

export interface IntegraQContext {
  user: IntegraQUserContext;
  session: {
    organizationId?: string;
    activeArea?: string;
    activeProcess?: string;
    currentModule: WorkspaceModuleId;
  };
  navigation: {
    route: string;
    module: WorkspaceModuleId;
    action: string;
    recordId?: string;
  };
  organization?: IntegraQProcessContext;
  record?: IntegraQRecordContext;
  sources: Partial<Record<ContextInclude, ContextSource[]>>;
  requestedIncludes: ContextInclude[];
  omitted: OmittedContextSource[];
}

export interface ContextSelectorScope {
  organizationId?: string;
  processId?: string;
  recordId?: string;
}

export interface ContextRepository {
  getOrganizationId(userAuthId?: string): Promise<string | undefined>;
  getProcess(processId: string): Promise<IntegraQProcessContext | null>;
  getRecord(module: WorkspaceModuleId, recordId: string): Promise<IntegraQRecordContext | null>;
  getSources(include: ContextInclude, scope: ContextSelectorScope): Promise<ContextSource[] | null>;
}

export class ContextBuildError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "CONTEXT_NOT_FOUND", message: string) {
    super(message);
    this.name = "ContextBuildError";
  }
}

