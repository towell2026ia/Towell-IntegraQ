import { describe, expect, it } from "vitest";
import { groupHomeObjectives } from "./home-objective-groups";
import { buildHomeDashboard } from "./home-dashboard";
import { buildInitialIndicatorDefinitions } from "./indicator-data";
import { activeSession } from "./session-data";

describe("Home objective assignments using fixture data", () => {
  it("preserves all 52 records across five real objectives and the unassigned group", () => {
    const definitions = buildInitialIndicatorDefinitions();
    const before = JSON.stringify(definitions);
    const dashboard = buildHomeDashboard({ session: activeSession, documents: [], actions: [], assets: [], supplierAudits: [], externalAudits: [], indicatorResults: {}, indicators: definitions });
    const grouped = groupHomeObjectives(dashboard.qualityObjectives);
    expect(definitions).toHaveLength(52);
    expect(grouped.groups).toHaveLength(5);
    expect(grouped.groups.map((group) => group.indicators.length)).toEqual([2, 16, 7, 1, 3]);
    expect(grouped.unassigned).toHaveLength(23);
    const displayed = [...grouped.groups.flatMap((group) => group.indicators), ...grouped.unassigned];
    expect(new Set(displayed.map((item) => item.id)).size).toBe(52);
    for (const item of displayed) {
      const source = definitions.find((definition) => definition.id === item.id)!;
      expect(item.objective ?? "").toBe(source.qualityObjective.trim());
      expect(item.indicatorName).toBe(source.name);
      expect(item.target).toBe(source.metric);
    }
    expect(JSON.stringify(definitions)).toBe(before);
  });
  it("preserves missing assignments and applies the authorized process scope before grouping", () => {
    const definitions = buildInitialIndicatorDefinitions();
    const session = { ...activeSession, userType: "Usuario interno" as const, assignedProcessIds: ["P-13"] };
    const dashboard = buildHomeDashboard({ session, documents: [], actions: [], assets: [], supplierAudits: [], externalAudits: [], indicatorResults: {}, indicators: definitions });
    const grouped = groupHomeObjectives(dashboard.qualityObjectives);
    const displayed = [...grouped.groups.flatMap((group) => group.indicators), ...grouped.unassigned];
    expect(displayed.every((item) => item.processId === "P-13")).toBe(true);
    expect(grouped.unassigned.every((item) => !definitions.find((source) => source.id === item.id)!.qualityObjective.trim())).toBe(true);
  });
});

it("keeps inactive indicators identifiable without changing their assignment or result", () => {
  const definitions = buildInitialIndicatorDefinitions().slice(0, 1).map(item => ({ ...item, active: false }));
  const before = JSON.stringify(definitions);
  const id = definitions[0].id;
  const result = buildHomeDashboard({ session: activeSession, documents: [], actions: [], assets: [], supplierAudits: [], externalAudits: [], indicatorResults: { [id]: { "2026": { Q4: { value: 95, comments: "Histórico", submittedAt: "2026-10-29T12:00:00Z", submittedBy: "Usuario de prueba" } } } }, indicators: definitions }, undefined, new Date("2026-10-29T12:00:00Z"));
  expect(result.qualityObjectives[0]).toMatchObject({ id, active: false, result: 95, period: "2026 Q4", objective: definitions[0].qualityObjective });
  expect(JSON.stringify(definitions)).toBe(before);
});