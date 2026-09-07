import "server-only";

import { createClient } from "@/lib/supabase/server";

import { getProcessRelations, type ProcessRelationKind, type ProcessRelationMaster, type ProcessRelationRecord, type ProcessRelationsRepository } from "./process-relations";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

export class SupabaseProcessRelationsRepository implements ProcessRelationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findProcess(processId: string): Promise<ProcessRelationMaster | null> {
    const result = await this.client.from("processes").select("id,code,name,active,parent_id,organization_id,area_id").eq("id", processId).maybeSingle();
    if (result.error && isMissingSchemaObject(result.error)) {
      const legacyResult = await this.client.from("processes").select("id,name,active,parent_id").eq("id", processId).maybeSingle();
      if (legacyResult.error) throw legacyResult.error;
      if (!legacyResult.data) return null;
      return { id: legacyResult.data.id, code: legacyResult.data.id, name: legacyResult.data.name, active: legacyResult.data.active, ...(legacyResult.data.parent_id ? { parentProcessId: legacyResult.data.parent_id } : {}) };
    }
    if (result.error) throw result.error;
    if (!result.data) return null;
    return { id: result.data.id, code: result.data.code ?? result.data.id, name: result.data.name, active: result.data.active, ...(result.data.parent_id ? { parentProcessId: result.data.parent_id } : {}), ...(result.data.organization_id ? { organizationId: result.data.organization_id } : {}), ...(result.data.area_id ? { areaId: result.data.area_id } : {}) };
  }

  async listByProcess(kind: ProcessRelationKind, processId: string): Promise<ProcessRelationRecord[]> {
    if (kind === "documents") return this.listDocuments(processId);
    if (kind === "risks") return (await this.listBridge("risk_item_processes", "risk_id", "risk:risk_items(id,code,title,status)", "risk", processId)) ?? [];
    if (kind === "audits") return this.listAudits(processId);
    if (kind === "findings") return this.listFindings(processId);
    const config = {
      indicators: { table: "indicator_definitions", select: "id,code,name,status:active", title: "name" },
      correctiveActions: { table: "corrective_actions", select: "id,folio,title,status", title: "title", code: "folio" },
      equipment: { table: "measurement_assets", select: "id,code,name,status:active", title: "name" },
      improvements: { table: "improvement_projects", select: "id,code,title,status", title: "title" },
    }[kind];
    if (!config) return [];
    const result = await this.client.from(config.table).select(config.select).eq("process_id", processId).limit(100);
    if (result.error) throw result.error;
    return ((result.data ?? []) as unknown as Row[]).map((row) => toRecord(row, config.title, config.code));
  }

  private async listDocuments(processId: string) {
    const [owned, linked] = await Promise.all([
      this.client.from("controlled_documents").select("id,code,title,active").eq("process_id", processId).limit(100),
      this.client.from("document_processes").select("document:controlled_documents(id,code,title,active)").eq("process_id", processId).limit(100),
    ]);
    if (owned.error) throw owned.error;
    if (linked.error && !isMissingSchemaObject(linked.error)) throw linked.error;
    return uniqueRecords([
      ...((owned.data ?? []) as unknown as Row[]).map((row) => toRecord(row, "title")),
      ...((linked.error ? [] : linked.data ?? []) as unknown as Row[]).flatMap((row) => relationRow(row.document) ? [toRecord(relationRow(row.document)!, "title")] : []),
    ]);
  }

  private async listAudits(processId: string) {
    const linked = await this.listBridge("audit_processes", "audit_id", "audit:audits(id,code,title,status)", "audit", processId, true);
    if (linked) return linked;
    const legacy = await this.client.from("audits").select("id,code,title,status").eq("process_id", processId).limit(100);
    if (legacy.error) throw legacy.error;
    return ((legacy.data ?? []) as unknown as Row[]).map((row) => toRecord(row, "title"));
  }

  private async listFindings(processId: string) {
    const current = await this.client.from("audit_findings").select("id,folio,description,status").eq("process_id", processId).limit(100);
    if (!current.error) return ((current.data ?? []) as unknown as Row[]).map((row) => toRecord(row, "description", "folio"));
    if (!isMissingSchemaObject(current.error)) throw current.error;

    const legacy = await this.client.from("audit_findings").select("id,folio,description,status,audit:audits!inner(process_id)").eq("audit.process_id", processId).limit(100);
    if (legacy.error) throw legacy.error;
    return ((legacy.data ?? []) as unknown as Row[]).map((row) => toRecord(row, "description", "folio"));
  }

  private async listBridge(table: string, _foreignKey: string, select: string, relation: string, processId: string, allowMissing = false) {
    const result = await this.client.from(table).select(select).eq("process_id", processId).limit(100);
    if (result.error && allowMissing && isMissingSchemaObject(result.error)) return null;
    if (result.error) throw result.error;
    return ((result.data ?? []) as unknown as Row[]).flatMap((row) => relationRow(row[relation]) ? [toRecord(relationRow(row[relation])!, relation === "risk" ? "title" : "title")] : []);
  }
}

export async function getAuthorizedProcessRelations(processId: string) {
  const client = await createClient();
  return getProcessRelations(processId, new SupabaseProcessRelationsRepository(client));
}

function toRecord(row: Row, titleField: string, codeField = "code"): ProcessRelationRecord {
  return { id: String(row.id), ...(row[codeField] != null ? { code: String(row[codeField]) } : {}), title: String(row[titleField] ?? "Sin título"), ...(row.status != null ? { status: typeof row.status === "boolean" ? row.status ? "active" : "inactive" : String(row.status) } : row.active != null ? { status: row.active ? "active" : "inactive" } : {}) };
}

function relationRow(value: unknown): Row | undefined {
  if (Array.isArray(value)) return value[0] as Row | undefined;
  return value && typeof value === "object" ? value as Row : undefined;
}

function uniqueRecords(records: ProcessRelationRecord[]) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function isMissingSchemaObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return ["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(code);
}
