import { describe, expect, it } from "vitest";
import { buildDemoRiskWorkspace, calculateAssessment, calculateKeyResultProgress, classifySO, incorporateContribution, normalizeRiskWorkspace, validateRiskRating } from "./risk-opportunity-data";

describe("risk opportunity calculations", () => {
  it.each([[25, "MENOR"], [26, "MAYOR"], [30, "MAYOR"], [50, "MAYOR"], [51, "CRÍTICO"], [54, "CRÍTICO"]] as const)("classifies SO %s", (score, level) => expect(classifySO(score)).toBe(level));
  it("preserves SO when SOD is calculated", () => expect(calculateAssessment(7, 8, 5)).toMatchObject({ so: 56, sod: 280, level: "CRÍTICO" }));
  it("keeps SOD pending without detection", () => expect(calculateAssessment(7, 8)).toMatchObject({ so: 56, sod: undefined, level: "CRÍTICO" }));
  it.each([[0, "D"], [11, "S"], [2.5, "O"]] as const)("rejects invalid rating %s", (value, field) => expect(() => validateRiskRating(value, field)).toThrow("entero de 1 a 10"));
  it("calculates a reduction KR", () => expect(calculateKeyResultProgress(10, 6, 8, "decrease")).toMatchObject({ progress: 50, actualProgress: 50 }));
  it("does not divide by zero", () => expect(() => calculateKeyResultProgress(10, 10, 8, "decrease")).toThrow("no pueden ser iguales"));
  it("incorporates a contribution only once", () => { const state = buildDemoRiskWorkspace(); const once = incorporateContribution(state, "APO-2025-001", "Compras"); const twice = incorporateContribution(once, "APO-2025-001", "Compras"); expect(twice.swotItems.filter((item) => item.sourceContributionId === "APO-2025-001")).toHaveLength(1); });
  it("loads the complete historical direction matrix as reviewable candidates", () => { const state = buildDemoRiskWorkspace(); expect(state.axes).toHaveLength(12); expect(state.directionCandidates).toHaveLength(74); expect(state.directionCandidates.find((item) => item.sourceRow === 38)?.description).toContain("proveedor de hilo Cloud"); });
  it("upgrades demo states only when explicitly requested", () => { const baseline = buildDemoRiskWorkspace(); const normalized = normalizeRiskWorkspace({ ...baseline, directionCandidates: [] }, "demo"); expect(normalized.directionCandidates).toHaveLength(74); });
});
