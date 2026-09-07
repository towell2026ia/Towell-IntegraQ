import type { IntegraQAiExecutionStatus, IntegraQAiResponseType } from "../contracts";

export interface AiActivityEvent {
  requestId: string;
  userId: string;
  module: string;
  recordType?: string;
  recordId?: string;
  capability: string;
  inputFingerprint: string;
  contextFingerprint: string;
  status: IntegraQAiExecutionStatus;
  responseType?: IntegraQAiResponseType;
  model?: string;
  provider?: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AiActivitySink {
  write(event: AiActivityEvent): Promise<void>;
}

