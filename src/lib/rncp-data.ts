export type RncpStatus = "draft" | "submitted" | "in_progress" | "closed";
export type RncpAction = "draft" | "submit" | "progress" | "close" | "reopen" | "correct";

export interface RncpHistoryEvent {
  id: string;
  action: string;
  actorName: string;
  createdAt: string;
  reason?: string;
  system?: boolean;
}

export type RncpResponseStatus = "pending" | "in_progress" | "submitted" | "accepted" | "rejected" | "closed";

export interface RncpEvidence {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface RncpResponseAction {
  id: string;
  reportId: string;
  description: string;
  responsibleName: string;
  dueDate: string;
  executedAt?: string;
  comment?: string;
  status: RncpResponseStatus;
  validationComment?: string;
  validatedAt?: string;
  createdAt: string;
  evidences: RncpEvidence[];
}

export interface RncpReport {
  id: string;
  folio: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  siteId?: string;
  siteCode?: string;
  siteName?: string;
  reportDate?: string;
  purchaseOrder?: string;
  materialOrService?: string;
  findingType?: string;
  rejectedQuantity?: number;
  description?: string;
  immediateDisposition?: string;
  responseDueDate?: string;
  responsibleName?: string;
  status: RncpStatus;
  late: boolean;
  portalVisible: boolean;
  submittedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deleteReason?: string;
  history: RncpHistoryEvent[];
  actions: RncpResponseAction[];
}

export interface RncpDraftInput {
  supplierId?: string;
  siteId?: string;
  reportDate?: string;
  purchaseOrder?: string;
  materialOrService?: string;
  findingType?: string;
  rejectedQuantity?: string;
  description?: string;
  immediateDisposition?: string;
  responseDueDate?: string;
  responsibleName?: string;
  portalVisible?: boolean;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible completar la operación RNCP.");
  return payload;
}

export async function loadRncpReports() {
  const response = await fetch("/api/suppliers/rncp", { cache: "no-store" });
  return parseResponse<{ reports: RncpReport[] }>(response);
}

export async function saveRncpReport(action: RncpAction, values: RncpDraftInput, reportId?: string, reason?: string) {
  const response = await fetch("/api/suppliers/rncp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reportId, values, reason }),
  });
  return parseResponse<{ report: Pick<RncpReport, "id" | "folio" | "status"> }>(response);
}

export async function setRncpDeleted(reportId: string, deleted: boolean, reason: string) {
  const response = await fetch("/api/suppliers/rncp", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, deleted, reason }),
  });
  return parseResponse<{ report: Pick<RncpReport, "id" | "folio" | "status"> }>(response);
}

export async function saveRncpResponseAction(input: {
  actionId?: string;
  reportId: string;
  description: string;
  responsibleName: string;
  dueDate: string;
  executedAt?: string;
  comment?: string;
  status: "pending" | "in_progress" | "submitted";
}) {
  const response = await fetch("/api/suppliers/rncp/actions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return parseResponse<{ action: Pick<RncpResponseAction, "id" | "reportId" | "status"> }>(response);
}

export async function reviewRncpResponseAction(actionId: string, decision: "accepted" | "rejected", comment?: string) {
  const response = await fetch("/api/suppliers/rncp/actions", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionId, decision, comment }),
  });
  return parseResponse<{ action: Pick<RncpResponseAction, "id" | "reportId" | "status"> }>(response);
}

export async function uploadRncpEvidence(actionId: string, file: File) {
  const form = new FormData(); form.set("actionId", actionId); form.set("file", file);
  const response = await fetch("/api/suppliers/rncp/evidence", { method: "POST", body: form });
  return parseResponse<{ evidence: RncpEvidence }>(response);
}

export async function getRncpEvidenceUrl(fileId: string) {
  const response = await fetch(`/api/suppliers/rncp/evidence/${encodeURIComponent(fileId)}`, { cache: "no-store" });
  return parseResponse<{ signedUrl: string; expiresIn: number }>(response);
}
