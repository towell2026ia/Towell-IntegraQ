import { authorize } from "@/lib/access/authorize";
import type { AuthorizationInput, AuthorizationReason } from "@/lib/access/types";

import type { ApprovalRequestRecord } from "./types";

export class ApprovalError extends Error {
  constructor(public readonly code: AuthorizationReason, message: string) { super(message); this.name = "ApprovalError"; }
}

export function decideApproval(input: {
  request: ApprovalRequestRecord;
  actor: NonNullable<AuthorizationInput["user"]>;
  decision: "approved" | "rejected";
  comments?: string;
  grants?: AuthorizationInput["grants"];
  now?: Date;
}) {
  if (input.request.status !== "pending") throw new ApprovalError("INVALID_STATE_TRANSITION", "La solicitud ya no está pendiente.");
  if (input.decision === "rejected" && !input.comments?.trim()) throw new ApprovalError("REASON_REQUIRED", "El motivo del rechazo es obligatorio.");
  const actorId = input.actor.authUserId ?? input.actor.userId;
  if (input.request.requestedBy === actorId) throw new ApprovalError("CONFLICT_OF_INTEREST", "El solicitante no puede aprobar su propia solicitud.");
  if (input.request.assignedApproverId && input.request.assignedApproverId !== actorId) throw new ApprovalError("OUTSIDE_SCOPE", "La solicitud está asignada a otro aprobador.");
  const access = authorize({ user: input.actor, permission: input.request.requiredPermission, record: { id: input.request.entityId, processId: input.request.processId, organizationId: input.request.organizationId }, grants: input.grants, now: input.now });
  if (!access.allowed) throw new ApprovalError(access.reason ?? "FORBIDDEN", "El usuario no cuenta con el permiso requerido.");
  const decidedAt = (input.now ?? new Date()).toISOString();
  return { ...input.request, status: input.decision, decision: input.decision, decisionBy: actorId, decisionAt: decidedAt, comments: input.comments?.trim() || undefined, authorizationOrigin: access.origin };
}

export function getPendingApprovals(userId: string, requests: ApprovalRequestRecord[]) {
  return requests.filter((request) => request.status === "pending" && (!request.assignedApproverId || request.assignedApproverId === userId));
}
