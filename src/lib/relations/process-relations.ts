export const processRelationKinds = ["documents", "indicators", "risks", "audits", "findings", "correctiveActions", "equipment", "improvements"] as const;
export type ProcessRelationKind = typeof processRelationKinds[number];

export interface ProcessRelationRecord {
  id: string;
  code?: string;
  title: string;
  status?: string;
}

export interface ProcessRelationMaster {
  id: string;
  code: string;
  name: string;
  active: boolean;
  parentProcessId?: string;
  organizationId?: string;
  areaId?: string;
}

export type ProcessRelations = { process: ProcessRelationMaster } & Record<ProcessRelationKind, ProcessRelationRecord[]>;

export interface ProcessRelationsRepository {
  findProcess(processId: string): Promise<ProcessRelationMaster | null>;
  listByProcess(kind: ProcessRelationKind, processId: string): Promise<ProcessRelationRecord[]>;
}

export class ProcessRelationError extends Error {
  constructor(public readonly code: "PROCESS_NOT_FOUND" | "PROCESS_INACTIVE", message: string) {
    super(message);
    this.name = "ProcessRelationError";
  }
}

export async function getProcessRelations(processId: string, repository: ProcessRelationsRepository): Promise<ProcessRelations> {
  const process = await repository.findProcess(processId);
  if (!process) throw new ProcessRelationError("PROCESS_NOT_FOUND", "El proceso solicitado no existe.");
  if (!process.active) throw new ProcessRelationError("PROCESS_INACTIVE", "El proceso solicitado está inactivo.");
  const relationGroups = await Promise.all(processRelationKinds.map((kind) => repository.listByProcess(kind, process.id)));
  const relations = Object.fromEntries(processRelationKinds.map((kind, index) => [kind, relationGroups[index]])) as Record<ProcessRelationKind, ProcessRelationRecord[]>;
  return { process, ...relations };
}

