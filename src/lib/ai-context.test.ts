import { describe, expect, it } from "vitest";

import { buildRootCauseAiRequest } from "@/lib/ai-context";
import { demoCorrectiveActions } from "@/lib/demo-data";

describe("root cause AI context", () => {
  it("includes the matched process and completed A3 sections", () => {
    const action = demoCorrectiveActions.find((item) => item.id === "ca-002")!;
    const request = buildRootCauseAiRequest({
      title: action.title,
      problem: action.problem,
      source: action.source,
      severity: action.severity,
      area: action.area,
      owner: action.owner,
      relatedParty: action.relatedParty,
      analysis: action.a3,
    });

    expect(request.contextSources?.processId).toBe("P-13");
    expect(request.contextSources?.processName).toBe("Tejido");
    expect(request.contextSources?.a3Sections).toContain("5W2H");
    expect(request.contextSources?.a3Sections).toContain("Plan de acción");
    expect(request.context).toContain("Descripción integral");
  });

  it("reports zero documents instead of fabricating document content", () => {
    const request = buildRootCauseAiRequest({
      title: "Desviación de tono",
      problem: "El tono medido quedó fuera del rango autorizado del lote.",
      source: "internal",
      severity: "high",
      area: "Tintorería",
      owner: "Responsable de proceso",
    });

    expect(request.contextSources?.documents).toEqual([]);
    expect(request.context).toContain("Documentos indexados para consulta: 0");
  });
});
