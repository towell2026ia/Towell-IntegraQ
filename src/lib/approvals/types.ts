export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export interface ApprovalRequestRecord {
  id: string;
  organizationId?: string;
  module: string;
  entityType: string;
  entityId: string;
  processId?: string;
  requestedBy: string;
  requiredPermission: string;
  assignedApproverId?: string;
  status: ApprovalStatus;
  decisionBy?: string;
  decisionAt?: string;
  decision?: "approved" | "rejected";
  comments?: string;
}

export interface ApprovalPolicy {
  requiresApproval: boolean;
  requiredPermission: string;
  allowedApprovers: "permission" | "assigned";
  segregationRules: Array<"creator_ne_approver" | "executor_ne_effectiveness_reviewer">;
}
