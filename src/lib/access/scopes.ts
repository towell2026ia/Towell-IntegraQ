import type { ActiveSession } from "@/lib/session-data";

import type { AuthorizationRecord, PermissionGrant } from "./types";

export function isGrantActive(grant: PermissionGrant, now = new Date()) {
  const time = now.getTime();
  return (!grant.startsAt || Date.parse(grant.startsAt) <= time) && (!grant.endsAt || Date.parse(grant.endsAt) >= time);
}

export function isWithinScope(user: ActiveSession, grant: PermissionGrant, record: AuthorizationRecord = {}) {
  switch (grant.scope) {
    case "global": return true;
    case "organization": return Boolean(grant.organizationId && record.organizationId === grant.organizationId);
    case "area": return Boolean(grant.areaId && record.areaId === grant.areaId);
    case "process": return Boolean(grant.processId && record.processId === grant.processId);
    case "own_records": return record.ownerId === (user.authUserId ?? user.userId) || record.createdBy === (user.authUserId ?? user.userId);
    case "assigned_records": return Boolean(record.assignedUserIds?.includes(user.authUserId ?? user.userId));
    case "company": return Boolean(grant.companyId && record.companyId === grant.companyId && user.externalParty?.companyId === grant.companyId);
  }
}
