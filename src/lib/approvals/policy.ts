import type { ApprovalPolicy } from "./types";

const approvalPermissions: Record<string, string> = {
  "document.approve": "documents.file.approve",
  "document.publish": "documents.file.publish",
  "risk.approve": "risks.approve",
  "audit.program.approve": "audits.program.approve",
  "audit.plan.approve": "audits.plan.approve",
  "audit.report.approve": "audits.report.approve",
  "corrective_action.close": "corrective_actions.close",
  "corrective_action.effectiveness": "corrective_actions.effectiveness.validate",
  "metrology.report.approve": "metrology.report.validate",
  "improvement.approve": "improvement.approve",
  "management_review.approve": "management_review.approve",
  "management_review.publish": "management_review.publish",
};

export function getApprovalPolicy(input: { module: string; entityType: string; action: string }): ApprovalPolicy {
  const key = `${input.entityType}.${input.action}`;
  const requiredPermission = approvalPermissions[key] ?? `${input.module}.${input.action}`;
  return {
    requiresApproval: key in approvalPermissions,
    requiredPermission,
    allowedApprovers: "permission",
    segregationRules: ["creator_ne_approver", ...(key === "corrective_action.effectiveness" ? ["executor_ne_effectiveness_reviewer" as const] : [])],
  };
}
