import { NextResponse } from "next/server";

import { authorize } from "@/lib/access/authorize";
import { getApprovalPolicy } from "@/lib/approvals/policy";
import { canAccessProcess, isExternalUser } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return error("UNAUTHORIZED", 401);
  if (isExternalUser(session)) return error("FORBIDDEN", 403);
  const body = await request.json() as { organizationId?: string; module?: string; entityType?: string; entityId?: string; processId?: string; action?: string; assignedApproverId?: string; assignedRoleId?: string };
  if (!body.module || !body.entityType || !body.entityId || !body.action) return error("INVALID_REQUEST", 400);
  if (body.processId && !canAccessProcess(session, body.processId)) return error("OUTSIDE_SCOPE", 403);
  const entityModules: Record<string, string> = { document: "documents", risk: "risks", audit: "audits", corrective_action: "corrective-actions", metrology_report: "calibrations", improvement: "continuous-improvement", management_review: "management-review" };
  if (entityModules[body.entityType] !== body.module) return error("INVALID_REQUEST", 400);
  const policy = getApprovalPolicy({ module: body.module, entityType: body.entityType, action: body.action });
  if (!policy.requiresApproval) return error("APPROVAL_NOT_REQUIRED", 409);
  const submitPermissions: Record<string, string> = { document: "documents.file.submit", risk: "risks.edit", audit: "audits.report.generate", corrective_action: "corrective_actions.analyze", metrology_report: "metrology.report.create", improvement: "improvement.edit", management_review: "management_review.submit" };
  const submitPermission = submitPermissions[body.entityType];
  if (!submitPermission) return error("INVALID_REQUEST", 400);
  const access = authorize({ user: session, permission: submitPermission, record: { processId: body.processId, organizationId: body.organizationId } });
  if (!access.allowed) return error(access.reason ?? "FORBIDDEN", 403);
  const supabase = await createClient();
  const inserted = await supabase.from("approval_requests").insert({
    organization_id: body.organizationId ?? null,
    module: body.module,
    entity_type: body.entityType,
    entity_id: body.entityId,
    process_id: body.processId ?? null,
    requested_by: session.authUserId ?? session.userId,
    approval_type: body.action,
    required_permission: policy.requiredPermission,
    assigned_approver_id: body.assignedApproverId ?? null,
    assigned_role_id: body.assignedRoleId ?? null,
  }).select("*").single();
  if (inserted.error) return NextResponse.json({ error: inserted.error.code === "23505" ? "APPROVAL_ALREADY_PENDING" : "APPROVAL_CREATE_FAILED" }, { status: inserted.error.code === "23505" ? 409 : 500 });
  const activity = await supabase.from("audit_log").select("id").eq("resource_type", body.entityType).eq("resource_id", body.entityId).contains("metadata", { approvalRequestId: inserted.data.id }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ success: true, message: "Solicitud de aprobación creada.", entity: inserted.data, activityLogId: activity.data?.id ?? null, approvalRequired: true, approvalRequestId: inserted.data.id }, { status: 201 });
}

function error(code: string, status: number) {
  return NextResponse.json({ success: false, error: code }, { status });
}
