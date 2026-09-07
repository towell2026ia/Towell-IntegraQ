import { isAdministrator, type ActiveSession } from "@/lib/session-data";

import { legacyPermissionCode } from "./permissions";
import { isGrantActive, isWithinScope } from "./scopes";
import type { AuthorizationInput, AuthorizationResult, PermissionGrant } from "./types";

export function authorize(input: AuthorizationInput): AuthorizationResult {
  const { user, permission, record = {}, now = new Date() } = input;
  if (!user) return denied(permission, "UNAUTHORIZED");
  if (isAdministrator(user) && !input.disallowAdminOverride) return { allowed: true, scope: "global", reason: null, origin: "admin_override", permission };

  const grants = [...deriveLegacyGrants(user, permission), ...(input.grants ?? [])]
    .filter((grant) => grant.permission === permission && isGrantActive(grant, now));
  if (!grants.length) return denied(permission, "FORBIDDEN");
  const matching = grants.find((grant) => isWithinScope(user, grant, record));
  if (!matching) return denied(permission, "OUTSIDE_SCOPE");
  return { allowed: true, scope: matching.scope, reason: null, origin: "human", permission };
}

export function can(input: AuthorizationInput) {
  return authorize(input).allowed;
}

function deriveLegacyGrants(user: ActiveSession, permission: string): PermissionGrant[] {
  if (user.externalParty) {
    const externalAllowed = permission.endsWith(".read") || permission.includes("evidence.submit");
    return externalAllowed ? [{ permission, scope: "company", companyId: user.externalParty.companyId }] : [];
  }
  const aliases: Record<string, string[]> = {
    "documents.file.submit": ["documents.file.edit"],
    "documents.file.validate": ["documents.file.approve"],
    "documents.file.reject": ["documents.file.approve"],
    "audits.report.generate": ["audits.execute"],
    "corrective_actions.analyze": ["corrective_actions.edit"],
    "metrology.report.create": ["metrology.equipment.edit"],
    "improvement.edit": ["improvement.edit"],
  };
  const accepted = new Set([permission, ...(aliases[permission] ?? [])]);
  const matching = (user.moduleActionPermissions ?? []).filter((item) => accepted.has(legacyPermissionCode(item.moduleId, item.action)));
  if (!matching.length) return [];
  if (!user.assignedProcessIds.length) return matching.map(() => ({ permission, scope: "own_records" }));
  return user.assignedProcessIds.flatMap((processId) => matching.map(() => ({ permission, scope: "process", processId })));
}

function denied(permission: string, reason: AuthorizationResult["reason"]): AuthorizationResult {
  return { allowed: false, reason, origin: "human", permission };
}
