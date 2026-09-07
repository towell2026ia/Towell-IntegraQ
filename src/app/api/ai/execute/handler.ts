import { NextResponse } from "next/server";

import { getApprovalRequirement } from "@/ai/core/approvals";
import { createFingerprint, logAiActivity, type AiActivitySink } from "@/ai/core/audit";
import { buildIntegraQContext, ContextBuildError, type ContextRepository } from "@/ai/core/context";
import { createAiErrorResponse, validateIntegraQAiRequest } from "@/ai/core/contracts";
import { canUseAiCapability } from "@/ai/core/permissions";
import { aiCapabilityRegistry, type AiCapabilityRegistry } from "@/ai/core/registry";
import type { ActiveSession } from "@/lib/session-data";

export interface ExecuteAiDependencies {
  getSession(): Promise<ActiveSession | null>;
  repository: ContextRepository;
  auditSink: AiActivitySink;
  registry?: AiCapabilityRegistry;
}

export async function handleExecuteAiRequest(request: Request, dependencies: ExecuteAiDependencies) {
  const session = await dependencies.getSession();
  if (!session) return jsonError("unknown", "failed", "UNAUTHORIZED", "Inicia sesión para usar las capacidades inteligentes.", 401);
  const body: unknown = await request.json().catch(() => null);
  const validation = validateIntegraQAiRequest(body);
  if (!validation.valid) return NextResponse.json(createAiErrorResponse({ requestId: readRequestId(body), status: "failed", code: "INVALID_REQUEST", message: "La solicitud de inteligencia no es válida.", metadata: { issues: validation.issues } }), { status: 400 });
  const input = validation.value;
  const capabilityId = input.capability ?? `${input.module}.${input.action}`;
  const registry = dependencies.registry ?? aiCapabilityRegistry;
  const capability = registry.get(capabilityId);
  if (!capability || capability.module !== input.module) return jsonError(input.requestId, "failed", "INVALID_REQUEST", "La capacidad solicitada no está registrada para este módulo.", 404);

  const initialPermission = canUseAiCapability({ user: session, module: input.module, requiredPermissions: capability.requiredPermissions });
  if (!initialPermission.allowed) return jsonError(input.requestId, "failed", "FORBIDDEN", initialPermission.reason, 403);

  try {
    const context = await buildIntegraQContext({ user: session, module: input.module, action: input.action, route: new URL(request.url).pathname, recordId: input.recordId, processId: input.context.processId, activeArea: input.context.activeArea, include: input.context.include, repository: dependencies.repository });
    const scopedPermission = canUseAiCapability({ user: session, module: input.module, requiredPermissions: capability.requiredPermissions, record: { processId: context.organization?.processId ?? context.record?.processId } });
    if (!scopedPermission.allowed) return jsonError(input.requestId, "failed", "FORBIDDEN", scopedPermission.reason, 403);
    const approval = getApprovalRequirement(capability);
    await logAiActivity(dependencies.auditSink, {
      requestId: input.requestId,
      userId: session.authUserId ?? session.userId,
      module: input.module,
      recordType: context.record?.entityType,
      recordId: context.record?.entityId,
      capability: capability.id,
      inputFingerprint: createFingerprint(input.input),
      contextFingerprint: createFingerprint(context),
      status: "disabled",
      responseType: "error",
      requiresApproval: approval.required,
      metadata: { task: input.task, action: input.action, requestedIncludes: context.requestedIncludes, omitted: context.omitted },
    });
    return NextResponse.json(createAiErrorResponse({ requestId: input.requestId, status: "disabled", code: "CAPABILITY_DISABLED", message: "Esta capacidad todavía no está habilitada.", metadata: { capability: capability.id, requiresApprovalWhenEnabled: approval.required } }));
  } catch (error) {
    if (error instanceof ContextBuildError) return jsonError(input.requestId, "failed", error.code, error.message, error.code === "FORBIDDEN" ? 403 : 404);
    console.error("No fue posible preparar la ejecución de AI Core.", error);
    return jsonError(input.requestId, "failed", "INTERNAL_ERROR", "No fue posible preparar la solicitud de inteligencia.", 500);
  }
}

function jsonError(requestId: string, status: "failed" | "disabled" | "rejected", code: Parameters<typeof createAiErrorResponse>[0]["code"], message: string, httpStatus: number) {
  return NextResponse.json(createAiErrorResponse({ requestId, status, code, message }), { status: httpStatus });
}

function readRequestId(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { requestId?: unknown }).requestId === "string") return (value as { requestId: string }).requestId;
  return "unknown";
}

