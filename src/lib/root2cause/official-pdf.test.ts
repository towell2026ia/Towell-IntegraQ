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

it("adds pages for long fields instead of writing past the footer", () => {
  const common = {folio:"AC-QA", title:"QA", problem:"", source:"internal", severity:"medium", area:"", process:"", owner:"", reportDate:"", dueDate:"", customer:"", externalReference:"",analysis:{},plans:[],evidence:[]};
  const countPages = (text:string) => [...new TextDecoder().decode(buildRootCauseOfficialPdf({...common,problem:text})).matchAll(/\/Type \/Page\b/g)].length;
  expect(countPages("Línea de análisis. ".repeat(3400))).toBeGreaterThan(countPages("Breve")+4);
});
