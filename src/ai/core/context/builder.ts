import type { WorkspaceModuleId } from "@/lib/navigation";
import { canAccessProcess, type ActiveSession } from "@/lib/session-data";

import { getAiPermissions } from "../permissions";
import { getProcessContext, getRecordContext, getUserContext, selectContextSources } from "./selectors";
import { ContextBuildError, type ContextInclude, type ContextRepository, type IntegraQContext } from "./types";

export interface BuildIntegraQContextInput {
  user: ActiveSession;
  module: WorkspaceModuleId;
  action: string;
  route: string;
  recordId?: string;
  processId?: string;
  activeArea?: string;
  include: ContextInclude[];
  repository: ContextRepository;
}

export async function buildIntegraQContext(input: BuildIntegraQContextInput): Promise<IntegraQContext> {
  const permissions = getAiPermissions(input.user, input.module);
  const record = input.recordId ? await getRecordContext(input.repository, input.module, input.recordId) : undefined;
  if (input.recordId && !record) throw new ContextBuildError("CONTEXT_NOT_FOUND", "No se encontró el registro solicitado.");
  const processId = input.processId ?? record?.processId;
  if (processId && !canAccessProcess(input.user, processId)) throw new ContextBuildError("FORBIDDEN", "El usuario no tiene acceso al proceso solicitado.");
  const organization = processId ? await getProcessContext(input.repository, processId) : undefined;
  if (processId && !organization) throw new ContextBuildError("CONTEXT_NOT_FOUND", "No se encontró el proceso solicitado.");
  const organizationId = await input.repository.getOrganizationId(input.user.authUserId);
  const requestedIncludes = [...new Set(input.include)];
  const sources: IntegraQContext["sources"] = {};
  const omitted: IntegraQContext["omitted"] = [];

  for (const include of requestedIncludes) {
    if (include === "process") {
      if (organization) sources.process = [{ type: "process", id: organization.processId, code: organization.processId, title: organization.processName }];
      else omitted.push({ include, reason: "missing_scope" });
      continue;
    }
    if (!processId && !["customers", "suppliers"].includes(include)) {
      omitted.push({ include, reason: "missing_scope" });
      continue;
    }
    const selected = await selectContextSources(input.repository, include, { organizationId, processId, recordId: input.recordId });
    if (selected === null) omitted.push({ include, reason: "not_available" });
    else sources[include] = selected;
  }

  return {
    user: getUserContext(input.user, permissions),
    session: { organizationId, activeArea: input.activeArea, activeProcess: processId, currentModule: input.module },
    navigation: { route: input.route, module: input.module, action: input.action, ...(input.recordId ? { recordId: input.recordId } : {}) },
    ...(organization ? { organization } : {}),
    ...(record ? { record } : {}),
    sources,
    requestedIncludes,
    omitted,
  };
}
