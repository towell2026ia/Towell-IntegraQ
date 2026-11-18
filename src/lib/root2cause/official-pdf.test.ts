import { describe, expect, it } from "vitest";
import { buildRootCauseOfficialPdf } from "./official-pdf";

describe("Root2Cause official PDF renderer", () => {
  it("generates a multi-stage PDF from the persisted analysis and plan", () => {
    const bytes = buildRootCauseOfficialPdf({
      folio: "AC-000001", title: "Defecto de tejido", problem: "Se detectó un defecto en el tejido durante la inspección.",
      source: "internal", severity: "medium", area: "Tejido", process: "Tejido", owner: "Responsable registrado",
      reportDate: "2026-11-18", dueDate: "2026-11-30", customer: "", externalReference: "",
      analysis: {
        severityJustification: "Impacto evaluado", fiveW2H: { what: "Defecto", why: "Hipótesis", where: "Línea", when: "Inspección", who: "Operación", how: "Tejido", howMuch: "Un lote" },
        brainstorm: ["Ajuste de tensión"], ishikawa: { workforce: [], machinery: ["Tensión"], method: [], material: [], environment: [], measurement: [] },
        nonDetectionCause: "Causa de detección", rootCause: "Causa de ocurrencia", nonDetectionWhys: ["1", "2"], rootCauseWhys: ["1", "2"],
      },
      plans: [{ description: "Revisar tensión", cause_text: "Tensión", owner_name: "Responsable registrado", due_date: "2026-11-30", expected_result: "Reducir defectos", completion_evidence: "Registro", effectiveness_method: "Inspección" }],
      evidence: [],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
