import type { ProcessRelationKind } from "./process-relations";

export interface RecordRelationReference {
  type: ProcessRelationKind | "process" | "area" | "customer" | "supplier";
  id: string;
  code?: string;
  title: string;
}

export function uniqueRecordRelations(relations: RecordRelationReference[]) {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = `${relation.type}:${relation.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
