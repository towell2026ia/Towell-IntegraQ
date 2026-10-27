import { describe, expect, it } from "vitest";
import { groupHomeObjectives } from "./home-objective-groups";
import { buildHomeDashboard } from "./home-dashboard";
import { buildInitialIndicatorDefinitions } from "./indicator-data";
import { activeSession } from "./session-data";

describe("real Home objective assignments", () => {
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
