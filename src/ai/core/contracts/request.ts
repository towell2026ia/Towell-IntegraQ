import { isWorkspaceModuleId, type WorkspaceModuleId } from "@/lib/navigation";

import { contextIncludeValues, type ContextInclude } from "../context/types";

export type IntegraQAiTask = "read" | "suggest" | "generate_draft" | "execute" | "approve";

export interface IntegraQAiRequest {
  requestId: string;
  task: IntegraQAiTask;
  capability?: string;
  module: WorkspaceModuleId;
  action: string;
  recordId?: string;
  context: {
    include: ContextInclude[];
    processId?: string;
    activeArea?: string;
  };
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type RequestValidationResult =
  | { valid: true; value: IntegraQAiRequest }
  | { valid: false; issues: string[] };

const taskValues: IntegraQAiTask[] = ["read", "suggest", "generate_draft", "execute", "approve"];

export function validateIntegraQAiRequest(value: unknown): RequestValidationResult {
  if (!isRecord(value)) return { valid: false, issues: ["La solicitud debe ser un objeto JSON."] };
  const issues: string[] = [];
  const requestId = readRequiredString(value.requestId, "requestId", issues);
  const task = typeof value.task === "string" && taskValues.includes(value.task as IntegraQAiTask)
    ? value.task as IntegraQAiTask
    : (issues.push("task no es válido."), "read" as const);
  const moduleId = typeof value.module === "string" && isWorkspaceModuleId(value.module)
    ? value.module
    : (issues.push("module no es un módulo válido de IntegraQ."), "home" as const);
  const action = readRequiredString(value.action, "action", issues);
  const contextCandidate = isRecord(value.context) ? value.context : {};
  if (!isRecord(value.context)) issues.push("context debe ser un objeto.");
  const includeCandidate = Array.isArray(contextCandidate.include) ? contextCandidate.include : [];
  if (!Array.isArray(contextCandidate.include)) issues.push("context.include debe ser una lista.");
  const include = includeCandidate.filter((item): item is ContextInclude => typeof item === "string" && contextIncludeValues.includes(item as ContextInclude));
  if (include.length !== includeCandidate.length) issues.push("context.include contiene una fuente no válida.");
  const input = isRecord(value.input) ? value.input : {};
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  if (!isRecord(value.input)) issues.push("input debe ser un objeto.");
  if (!isRecord(value.metadata)) issues.push("metadata debe ser un objeto.");
  if (issues.length) return { valid: false, issues };
  return {
    valid: true,
    value: {
      requestId,
      task,
      ...(typeof value.capability === "string" && value.capability.trim() ? { capability: value.capability.trim() } : {}),
      module: moduleId,
      action,
      ...(typeof value.recordId === "string" && value.recordId.trim() ? { recordId: value.recordId.trim() } : {}),
      context: {
        include: [...new Set(include)],
        ...(typeof contextCandidate.processId === "string" && contextCandidate.processId.trim() ? { processId: contextCandidate.processId.trim() } : {}),
        ...(typeof contextCandidate.activeArea === "string" && contextCandidate.activeArea.trim() ? { activeArea: contextCandidate.activeArea.trim() } : {}),
      },
      input,
      metadata,
    },
  };
}

function readRequiredString(value: unknown, field: string, issues: string[]) {
  if (typeof value === "string" && value.trim()) return value.trim();
  issues.push(`${field} es obligatorio.`);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
