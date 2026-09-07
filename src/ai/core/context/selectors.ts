import type { ActiveSession } from "@/lib/session-data";

import type { AiPermission } from "../permissions";
import type { ContextInclude, ContextRepository, ContextSelectorScope, ContextSource, IntegraQProcessContext, IntegraQRecordContext, IntegraQUserContext } from "./types";

export function getUserContext(user: ActiveSession, permissions: AiPermission[]): IntegraQUserContext {
  return { userId: user.authUserId ?? user.userId, name: user.name, role: user.position, userType: user.userType, permissions };
}

export function getProcessContext(repository: ContextRepository, processId: string): Promise<IntegraQProcessContext | null> {
  return repository.getProcess(processId);
}

export function getRecordContext(repository: ContextRepository, module: Parameters<ContextRepository["getRecord"]>[0], recordId: string): Promise<IntegraQRecordContext | null> {
  return repository.getRecord(module, recordId);
}

export const getDocumentContext = sourceSelector("documents");
export const getIndicatorContext = sourceSelector("indicators");
export const getRiskContext = sourceSelector("risks");
export const getAuditContext = sourceSelector("audits");
export const getCorrectiveActionContext = sourceSelector("corrective-actions");
export const getMetrologyContext = sourceSelector("metrology");
export const getImprovementContext = sourceSelector("improvements");

export function selectContextSources(repository: ContextRepository, include: ContextInclude, scope: ContextSelectorScope) {
  return repository.getSources(include, scope);
}

function sourceSelector(include: ContextInclude) {
  return (repository: ContextRepository, scope: ContextSelectorScope): Promise<ContextSource[] | null> => repository.getSources(include, scope);
}

