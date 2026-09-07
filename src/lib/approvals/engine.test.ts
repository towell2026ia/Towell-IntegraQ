import { describe, expect, it } from "vitest";

import type { ActiveSession } from "@/lib/session-data";

import { ApprovalError, decideApproval, getPendingApprovals } from "./engine";
import type { ApprovalRequestRecord } from "./types";

const approver: ActiveSession = { userId: "approver", authUserId: "approver", name: "Aprobador", shortName: "A", initials: "A", position: "Calidad", department: "Calidad", company: "Towell", userType: "Usuario interno", assignedProcessIds: ["P-08"], moduleActionPermissions: [] };
const request: ApprovalRequestRecord = { id: "ar1", module: "documents", entityType: "document", entityId: "doc1", processId: "P-08", requestedBy: "creator", requiredPermission: "documents.file.approve", assignedApproverId: "approver", status: "pending" };
const grants = [{ permission: "documents.file.approve", scope: "process" as const, processId: "P-08" }];

describe("approval engine", () => {
  it("approves with permission, identity and timestamp", () => {
    expect(decideApproval({ request, actor: approver, decision: "approved", grants, now: new Date("2026-09-07T12:00:00Z") })).toMatchObject({ status: "approved", decisionBy: "approver", decisionAt: "2026-09-07T12:00:00.000Z" });
  });

  it("requires a rejection reason", () => {
    expect(() => decideApproval({ request, actor: approver, decision: "rejected", grants })).toThrowError(ApprovalError);
    try { decideApproval({ request, actor: approver, decision: "rejected", grants }); } catch (error) { expect((error as ApprovalError).code).toBe("REASON_REQUIRED"); }
  });

  it("rejects missing permission, self approval and invalid state", () => {
    expect(() => decideApproval({ request, actor: approver, decision: "approved" })).toThrow();
    expect(() => decideApproval({ request: { ...request, requestedBy: "approver" }, actor: approver, decision: "approved", grants })).toThrow();
    expect(() => decideApproval({ request: { ...request, status: "approved" }, actor: approver, decision: "approved", grants })).toThrow();
  });

  it("returns only pending approvals assigned to the user", () => {
    expect(getPendingApprovals("approver", [request, { ...request, id: "ar2", status: "rejected" }, { ...request, id: "ar3", assignedApproverId: "other" }]).map((item) => item.id)).toEqual(["ar1"]);
  });
});
