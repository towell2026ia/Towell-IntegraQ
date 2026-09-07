import type { ActiveSession } from "@/lib/session-data";

export type PermissionScope = "global" | "organization" | "area" | "process" | "own_records" | "assigned_records" | "company";
export type PermissionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuthorizationReason = "UNAUTHORIZED" | "FORBIDDEN" | "OUTSIDE_SCOPE" | "CONFLICT_OF_INTEREST" | "APPROVAL_REQUIRED" | "INVALID_STATE_TRANSITION" | "REASON_REQUIRED" | "NOT_FOUND";

export interface PermissionGrant {
  permission: string;
  scope: PermissionScope;
  organizationId?: string;
  areaId?: string;
  processId?: string;
  companyId?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface AuthorizationRecord {
  id?: string;
  organizationId?: string;
  areaId?: string;
  processId?: string;
  ownerId?: string;
  assignedUserIds?: string[];
  companyId?: string;
  createdBy?: string;
}

export interface AuthorizationInput {
  user: ActiveSession | null;
  permission: string;
  record?: AuthorizationRecord;
  grants?: PermissionGrant[];
  now?: Date;
  disallowAdminOverride?: boolean;
}

export interface AuthorizationResult {
  allowed: boolean;
  scope?: PermissionScope;
  reason: AuthorizationReason | null;
  origin: "human" | "admin_override";
  permission: string;
}
