import type { AiPermission } from "../permissions";

export type AiApprovalStatus = "suggestion" | "draft" | "review" | "awaiting_approval" | "approved" | "rejected";

export interface AiApprovalRequirement {
  required: boolean;
  requiredPermission?: AiPermission;
  approverRole?: string;
  reason?: string;
}

export interface AiApprovalRecord {
  requestId: string;
  status: AiApprovalStatus;
  requestedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comment?: string;
}

