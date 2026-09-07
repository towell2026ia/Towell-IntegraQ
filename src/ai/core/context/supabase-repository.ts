import "server-only";

import type { WorkspaceModuleId } from "@/lib/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

import type { ContextInclude, ContextRepository, ContextSelectorScope, ContextSource, ContextSourceType, IntegraQProcessContext, IntegraQRecordContext } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

const recordConfigs: Partial<Record<WorkspaceModuleId, { table: string; entityType: string; select: string; code?: string; status?: string; process?: string }>> = {
  documents: { table: "controlled_documents", entityType: "document", select: "id,code,title,process_id,active", code: "code", status: "active", process: "process_id" },
  indicators: { table: "indicator_definitions", entityType: "indicator", select: "id,code,name,process_id,active", code: "code", status: "active", process: "process_id" },
  audits: { table: "audits", entityType: "audit", select: "id,code,title,status,process_id", code: "code", status: "status", process: "process_id" },
  "corrective-actions": { table: "corrective_actions", entityType: "corrective_action", select: "id,folio,title,status,process_id", code: "folio", status: "status", process: "process_id" },
  calibrations: { table: "measurement_assets", entityType: "equipment", select: "id,code,name,process_id,active", code: "code", status: "active", process: "process_id" },
  "continuous-improvement": { table: "improvement_projects", entityType: "improvement", select: "id,code,title,status,process_id", code: "code", status: "status", process: "process_id" },
  forms: { table: "form_definitions", entityType: "form", select: "id,registration_number,name,process_id,status", code: "registration_number", status: "status", process: "process_id" },
  "management-review": { table: "management_reviews", entityType: "management_review", select: "id,status", status: "status" },
};

export class SupabaseContextRepository implements ContextRepository {
  constructor(private readonly admin: AdminClient) {}

  async getOrganizationId(userAuthId?: string) {
    if (!userAuthId) return undefined;
    const result = await this.admin.from("profiles").select("organization_id").eq("id", userAuthId).maybeSingle();
    if (result.error) throw result.error;
    return typeof result.data?.organization_id === "string" ? result.data.organization_id : undefined;
  }

  async getProcess(processId: string): Promise<IntegraQProcessContext | null> {
    const result = await this.admin.from("processes").select("id,name,parent_id").eq("id", processId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    const parentId = typeof result.data.parent_id === "string" ? result.data.parent_id : undefined;
    const parentResult = parentId ? await this.admin.from("processes").select("id,name").eq("id", parentId).maybeSingle() : null;
    if (parentResult?.error) throw parentResult.error;
    return {
      processId: String(result.data.id),
      processName: String(result.data.name),
      ...(parentId ? { parentProcessId: parentId } : {}),
      ...(parentResult?.data?.name ? { parentProcessName: String(parentResult.data.name) } : {}),
    };
  }

  async getRecord(module: WorkspaceModuleId, recordId: string): Promise<IntegraQRecordContext | null> {
    if (module === "risks") return this.getRiskRecord(recordId);
    const config = recordConfigs[module];
    if (!config) return null;
    const result = await this.admin.from(config.table).select(config.select).eq("id", recordId).maybeSingle();
    if (result.error) throw result.error;
    const row = result.data as Row | null;
    if (!row) return null;
    return {
      entityType: config.entityType,
      entityId: String(row.id),
      ...(config.code && row[config.code] != null ? { entityCode: String(row[config.code]) } : {}),
      ...(config.status && row[config.status] != null ? { entityStatus: normalizeStatus(row[config.status]) } : {}),
      ...(config.process && typeof row[config.process] === "string" ? { processId: row[config.process] as string } : {}),
    };
  }

  async getSources(include: ContextInclude, scope: ContextSelectorScope): Promise<ContextSource[] | null> {
    if (include === "risks") return this.getRiskSources(scope.processId);
    if (include === "customers" || include === "suppliers") return null;
    const config = sourceConfig(include);
    if (!config || !scope.processId) return null;
    const result = await this.admin.from(config.table).select(config.select).eq("process_id", scope.processId).limit(50);
    if (result.error) throw result.error;
    return ((result.data ?? []) as unknown as Row[]).map((row) => toSource(row, config.type, config.title));
  }

  private async getRiskRecord(recordId: string): Promise<IntegraQRecordContext | null> {
    const result = await this.admin.from("risk_items").select("id,code,status,register:risk_registers(process_id)").eq("id", recordId).maybeSingle();
    if (result.error) throw result.error;
    const row = result.data as Row | null;
    if (!row) return null;
    const register = relationRow(row.register);
    return { entityType: "risk", entityId: String(row.id), entityCode: String(row.code), entityStatus: String(row.status), ...(typeof register?.process_id === "string" ? { processId: register.process_id } : {}) };
  }

  private async getRiskSources(processId?: string): Promise<ContextSource[] | null> {
    if (!processId) return [];
    const registerResult = await this.admin.from("risk_registers").select("id").eq("process_id", processId).limit(20);
    if (registerResult.error) throw registerResult.error;
    const registerIds = (registerResult.data ?? []).map((row) => row.id);
    if (!registerIds.length) return [];
    const result = await this.admin.from("risk_items").select("id,code,title,status").in("register_id", registerIds).limit(50);
    if (result.error) throw result.error;
    return ((result.data ?? []) as Row[]).map((row) => ({ ...toSource(row, "risk", "title"), processId }));
  }
}

function sourceConfig(include: ContextInclude) {
  const configs: Partial<Record<ContextInclude, { table: string; select: string; type: ContextSourceType; title: string }>> = {
    documents: { table: "controlled_documents", select: "id,code,title,active,process_id", type: "document", title: "title" },
    indicators: { table: "indicator_definitions", select: "id,code,name,active,process_id", type: "indicator", title: "name" },
    audits: { table: "audits", select: "id,code,title,status,process_id", type: "audit", title: "title" },
    "corrective-actions": { table: "corrective_actions", select: "id,folio,title,status,process_id", type: "corrective_action", title: "title" },
    metrology: { table: "measurement_assets", select: "id,code,name,active,process_id", type: "equipment", title: "name" },
    equipment: { table: "measurement_assets", select: "id,code,name,active,process_id", type: "equipment", title: "name" },
    improvements: { table: "improvement_projects", select: "id,code,title,status,process_id", type: "improvement", title: "title" },
  };
  return configs[include];
}

function toSource(row: Row, type: ContextSourceType, titleField: string): ContextSource {
  return { type, id: String(row.id), ...(row.code != null ? { code: String(row.code) } : row.folio != null ? { code: String(row.folio) } : {}), title: String(row[titleField] ?? "Sin título"), ...(row.status != null ? { status: String(row.status) } : row.active != null ? { status: normalizeStatus(row.active) } : {}), ...(typeof row.process_id === "string" ? { processId: row.process_id } : {}) };
}

function normalizeStatus(value: unknown) {
  if (typeof value === "boolean") return value ? "active" : "inactive";
  return String(value);
}

function relationRow(value: unknown): Row | undefined {
  if (Array.isArray(value)) return value[0] as Row | undefined;
  return value && typeof value === "object" ? value as Row : undefined;
}
