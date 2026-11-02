import { describe, expect, it } from "vitest";

import { buildInitialImprovementProjects, normalizeImprovementProjects } from "@/lib/continuous-improvement-data";
import { demoCorrectiveActions, enrichSavedCorrectiveActions } from "@/lib/demo-data";
import { withoutUnchangedSamples } from "@/lib/demo-cleanup";
import { appFormCatalog } from "@/lib/form-data";
import { validateHistoricalMinutes } from "@/lib/historical-minutes";
import { buildDemoManagementReviewHistory } from "@/lib/management-review-data";
import { buildEmptyRiskWorkspace, buildInitialRiskWorkspace, normalizeRiskWorkspace } from "@/lib/risk-opportunity-data";

describe("limpieza conservadora de muestras", () => {
  it("retira sólo las acciones, revisiones y proyectos que no cambiaron", () => {
    const realAction = { ...demoCorrectiveActions[0], title: "Acción real capturada por Towell" };
    expect(withoutUnchangedSamples([...demoCorrectiveActions, realAction], demoCorrectiveActions)).toEqual([realAction]);
    expect(withoutUnchangedSamples(buildDemoManagementReviewHistory(), buildDemoManagementReviewHistory())).toEqual([]);
    const samples = buildInitialImprovementProjects();
    const normalized = normalizeImprovementProjects(samples);
    expect(withoutUnchangedSamples(samples, [...samples, ...normalized], ["createdAt", "updatedAt"])).toEqual([]);
    expect(withoutUnchangedSamples(normalized, [...samples, ...normalized], ["createdAt", "updatedAt"])).toEqual([]);
  });

  it("retira copias antiguas de Root2Cause aunque el navegador cambie el orden de campos", () => {
    const stored = demoCorrectiveActions.map(action => Object.fromEntries(Object.entries(action).reverse()) as unknown as typeof action);
    const edited = { ...stored[0], title: "Caso real editado por un usuario" };
    const clean = withoutUnchangedSamples(enrichSavedCorrectiveActions([...stored, edited]), demoCorrectiveActions);
    expect(clean).toEqual([expect.objectContaining({ id: edited.id, title: edited.title })]);
    expect(clean.map(action => action.folio)).toEqual(["AC-2026-014"]);
  });

  it("conserva respuestas modificadas y mantiene las definiciones de formularios", () => {
    const form = appFormCatalog[0];
    const edited = { ...form.records[0], status: "real" };
    expect(withoutUnchangedSamples([...form.records, edited], form.records)).toEqual([edited]);
    expect(appFormCatalog.map(item => item.id)).toEqual(["FORM-VE-01", "FORM-CA-25", "FORM-TE-01"]);
  });

  it("inicia riesgos sin registros de ejemplo y conserva los datos cargados", () => {
    const empty = buildEmptyRiskWorkspace();
    expect(empty.risks).toEqual([]);
    expect(empty.swotItems).toEqual([]);
    expect(empty.directionCandidates).toEqual([]);
    expect(empty.axes.length).toBeGreaterThan(0);
    const stored = buildInitialRiskWorkspace();
    expect(normalizeRiskWorkspace(stored).risks).toEqual(stored.risks);
  });
});

describe("actas históricas", () => {
  const valid = { year: "2025", date: "2025-12-18", responsible: "Dirección", fileName: "Acta.pdf", mimeType: "application/pdf" };

  it("admite PDF y DOCX originales con año, fecha y responsable", () => {
    expect(validateHistoricalMinutes(valid, 2026)).toBeNull();
    expect(validateHistoricalMinutes({ ...valid, fileName: "Acta.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, 2026)).toBeNull();
  });

  it("rechaza fechas inconsistentes y tipos ajenos", () => {
    expect(validateHistoricalMinutes({ ...valid, date: "2024-12-18" }, 2026)).toMatch(/año y la fecha/);
    expect(validateHistoricalMinutes({ ...valid, responsible: " " }, 2026)).toMatch(/responsable/);
    expect(validateHistoricalMinutes({ ...valid, fileName: "Acta.exe" }, 2026)).toMatch(/PDF o DOCX/);
    expect(validateHistoricalMinutes({ ...valid, mimeType: "application/octet-stream" }, 2026)).toMatch(/PDF o DOCX/);
  });
});
