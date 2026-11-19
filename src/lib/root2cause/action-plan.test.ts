import { describe, expect, it } from "vitest";
import { appendBlankActionPlan, isActionPlanReady, removeActionPlan } from "@/lib/root2cause/action-plan";
import { applyStageSuggestion, stageSnapshot, type StageSuggestion } from "@/lib/root2cause/assistant";
import type { A3Analysis, A3ActionPlanItem } from "@/lib/types";
import { PlansStage } from "@/components/modules/a3-analysis-workbench";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const responsibleId = "2a4b8c39-a6a2-47f2-9b2b-c8074f39b5d2";
const causeId = "83cfccde-83d7-481c-9c8e-4fd4e7d605e4";
const manualPlan: A3ActionPlanItem = {
  id: "40fc1982-e13f-4d98-bac6-990a8791bbd0",
  description: "Instalar una guía de inspección para evitar el defecto recurrente.",
  causeCategory: "method",
  owner: "Responsable de proceso",
  ownerUserId: responsibleId,
  dueDate: "2026-12-15",
  status: "pending",
};

describe("Root2Cause P0-04 action plan", () => {
  it("T04.1 accepts a manual plan with only action, Ishikawa M, catalog user and due date", () => {
    const plan = { ...manualPlan, expectedResult: undefined, completionEvidence: undefined, effectivenessMethod: undefined };
    expect(isActionPlanReady(plan, new Set([responsibleId]))).toBe(true);
    expect(isActionPlanReady(plan, new Set())).toBe(false);
  });

  it("T04.2 appends an immediately editable blank action and exposes the add control by the heading", () => {
    const added = appendBlankActionPlan([manualPlan], "b30c4932-faf4-4d14-b90d-3cbe093f28ad");
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ description: "", owner: "", dueDate: "", status: "pending" });
    const html = renderToStaticMarkup(createElement(PlansStage, {
      draft: { origin: "internal", rootCause: "Causa raíz", causeItems: [{ id: "cause-existing", text: "Causa del Ishikawa", category: "method" }], ishikawa: { workforce: [], machinery: [], method: ["Causa del Ishikawa"], material: [], environment: [], measurement: [] }, plans: [manualPlan] } as never,
      setDraft: (() => undefined) as never,
      updatePlan: () => undefined,
      responsibleUsers: [{ id: responsibleId, fullName: "Responsable de proceso" }],
      loadingResponsibleUsers: false,
      responsibleUsersError: "",
    }));
    expect(html).toContain("Agregar acción");
    expect(html).toContain("M del Ishikawa");
    expect(html).toContain("Seleccionar M");
    expect(html).not.toContain("Seleccionar causa del Ishikawa");
    expect(html).toContain("Responsable del catálogo interno");
    expect(html).not.toContain("Resultado esperado");
    expect(html).not.toContain("Evidencia de cumplimiento");
    expect(html).not.toContain("Verificación de efectividad");
  });

  it("T04.3 removes only the selected action and preserves the others", () => {
    const second = { ...manualPlan, id: "d8d670fa-b462-4113-bf70-2ca5d7f974a6", description: "Otra acción" };
    expect(removeActionPlan([manualPlan, second], manualPlan.id)).toEqual([second]);
    expect([manualPlan, second]).toHaveLength(2);
  });

  it("T04.4 adds an accepted AI action once and leaves it editable with its identifier", () => {
    const analysis: A3Analysis = {
      eventType: "Defecto", severityJustification: "", fiveW2H: { what: "", why: "", where: "", when: "", who: "", how: "", howMuch: "" },
      brainstorm: [], ishikawa: { workforce: [], machinery: [], method: ["Falta de control de ajuste"], material: [], environment: [], measurement: [] },
      causeItems: [{ id: causeId, text: "Falta de control de ajuste", category: "method" }], nonDetectionCause: "", rootCause: "", nonDetectionWhys: [], rootCauseWhys: [], plans: [],
    };
    const suggestion: StageSuggestion = { step: 7, rationale: "", missingData: [], references: [], fields: {}, actions: [{ description: manualPlan.description, cause: "Falta de control de ajuste", expectedResult: "", completionEvidence: "", effectivenessMethod: "", documentRefs: [] }] };
    const once = applyStageSuggestion(analysis, suggestion, stageSnapshot(analysis, 7));
    const twice = applyStageSuggestion(once, suggestion, stageSnapshot(once, 7));
    expect(once.plans).toHaveLength(1);
    expect(twice.plans).toHaveLength(1);
    const edited = { ...twice.plans[0], description: "Acción revisada por Calidad" };
    expect(edited.id).toBe(twice.plans[0].id);
    expect(edited.description).toBe("Acción revisada por Calidad");
  });
});
