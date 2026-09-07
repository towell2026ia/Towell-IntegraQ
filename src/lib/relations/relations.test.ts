import { describe, expect, it } from "vitest";

import { resolveMigrationRelationship } from "./migration-resolution";
import { getProcessRelations, ProcessRelationError, processRelationKinds, type ProcessRelationsRepository } from "./process-relations";
import { uniqueRecordRelations } from "./record-relations";

function repository(active = true): ProcessRelationsRepository {
  return {
    async findProcess(id) { return id === "P-17" ? { id, code: id, name: "Tintorería", active, parentProcessId: "P-03" } : null; },
    async listByProcess(kind) {
      if (kind === "documents") return [{ id: "doc-1", code: "P-TIN-01", title: "Procedimiento" }, { id: "doc-2", title: "Instructivo" }];
      if (kind === "audits") return [{ id: "audit-1", code: "AUD-1", title: "Auditoría" }];
      return [];
    },
  };
}

describe("process relations", () => {
  it("reconstructs every relation group using only the process id", async () => {
    const result = await getProcessRelations("P-17", repository());
    expect(result.process).toMatchObject({ id: "P-17", parentProcessId: "P-03" });
    expect(result.documents).toHaveLength(2);
    expect(result.audits).toHaveLength(1);
    expect(processRelationKinds.every((kind) => Array.isArray(result[kind]))).toBe(true);
  });

  it("rejects nonexistent and inactive processes", async () => {
    await expect(getProcessRelations("missing", repository())).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" } satisfies Partial<ProcessRelationError>);
    await expect(getProcessRelations("P-17", repository(false))).rejects.toMatchObject({ code: "PROCESS_INACTIVE" } satisfies Partial<ProcessRelationError>);
  });
});

describe("migration relationship resolution", () => {
  const candidates = [{ id: "P-17", name: "Tintorería" }, { id: "P-18", name: "Laboratorio" }];
  it("matches accents, case and spaces without changing the official value", () => {
    expect(resolveMigrationRelationship("  TINTORERIA ", candidates)).toMatchObject({ status: "matched", candidate: { id: "P-17", name: "Tintorería" } });
  });
  it("reports ambiguous and unmatched values instead of guessing", () => {
    expect(resolveMigrationRelationship("calidad", [{ id: "A", name: "Calidad" }, { id: "B", name: "CALIDAD" }]).status).toBe("ambiguous");
    expect(resolveMigrationRelationship("desconocido", candidates).status).toBe("unmatched");
  });
});

describe("record relations", () => {
  it("deduplicates secondary links by typed id", () => {
    expect(uniqueRecordRelations([{ type: "process", id: "P-17", title: "Tintorería" }, { type: "process", id: "P-17", title: "Tintorería" }])).toHaveLength(1);
  });
});
