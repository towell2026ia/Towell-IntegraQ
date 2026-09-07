import type { ContextSource } from "../context/types";

export type IntegraQAiExecutionStatus = "pending" | "processing" | "success" | "failed" | "disabled" | "awaiting_approval" | "approved" | "rejected";
export type IntegraQAiResponseType = "suggestion" | "draft" | "validation" | "error";
export type IntegraQAiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" | "CONTEXT_NOT_FOUND" | "CAPABILITY_DISABLED" | "APPROVAL_REQUIRED" | "PROVIDER_ERROR" | "TIMEOUT" | "INTERNAL_ERROR";

export interface IntegraQAiError {
  code: IntegraQAiErrorCode;
  message: string;
  retryable: boolean;
}

export interface IntegraQAiResponse<TResult = unknown> {
  requestId: string;
  status: IntegraQAiExecutionStatus;
  type: IntegraQAiResponseType;
  result: TResult | null;
  warnings: string[];
  sources: ContextSource[];
  requiresApproval: boolean;
  metadata: Record<string, unknown>;
  error?: IntegraQAiError;
}

export function createAiErrorResponse({
  requestId,
  status,
  code,
  message,
  retryable = false,
  metadata = {},
}: {
  requestId: string;
  status: Extract<IntegraQAiExecutionStatus, "failed" | "disabled" | "rejected">;
  code: IntegraQAiErrorCode;
  message: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
}): IntegraQAiResponse<null> {
  return { requestId, status, type: "error", result: null, warnings: [], sources: [], requiresApproval: false, metadata, error: { code, message, retryable } };
}

export function isIntegraQAiResponse(value: unknown): value is IntegraQAiResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IntegraQAiResponse>;
  return Boolean(
    typeof candidate.requestId === "string" &&
    ["pending", "processing", "success", "failed", "disabled", "awaiting_approval", "approved", "rejected"].includes(candidate.status ?? "") &&
    ["suggestion", "draft", "validation", "error"].includes(candidate.type ?? "") &&
    Array.isArray(candidate.warnings) &&
    Array.isArray(candidate.sources) &&
    typeof candidate.requiresApproval === "boolean" &&
    candidate.metadata && typeof candidate.metadata === "object",
  );
}

