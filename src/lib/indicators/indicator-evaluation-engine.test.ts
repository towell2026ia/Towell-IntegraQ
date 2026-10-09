import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDefaultEvaluationRules,
  buildInitialIndicatorDefinitions,
  evaluateConfiguredIndicator,
  matchesEvaluationRule,
  parseIndicatorMetric,
} from "@/lib/indicator-data";

const engineMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/202610090001_indicator_rule_expression_engine.sql"),
  "utf8",
).toLowerCase();
const bootstrapMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/202610090002_indicator_master_bootstrap.sql"),
  "utf8",
);
const definitions = buildInitialIndicatorDefinitions();

const strictIndicatorIds = [
  "IND-017",
  "IND-018",
  "IND-019",
  "IND-024",
  "IND-025",
  "IND-026",
  "IND-031",
  "IND-032",
  "IND-033",
  "IND-034",
  "IND-035",
] as const;
const manualIndicatorIds = ["IND-028", "IND-046", "IND-050"] as const;

describe("indicator evaluation expression engine", () => {
  it.each(strictIndicatorIds)("preserves strict lower and upper boundaries for %s", (indicatorId) => {
    const indicator = definitions.find((item) => item.id === indicatorId);
    expect(indicator).toBeDefined();
    const rule = parseIndicatorMetric(indicator!.metric);
    expect(rule).toMatchObject({ type: "range", minOperator: ">", maxOperator: "<" });
    expect(indicator!.evaluationRules.compliant).toBe(`>${rule.min},<${rule.max}`);

    expect(evaluateConfiguredIndicator(indicator!, rule.min! - 1, 2026, "Q3")).not.toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator!, rule.min!, 2026, "Q3")).not.toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator!, rule.min! + 1, 2026, "Q3")).toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator!, rule.max! - 1, 2026, "Q3")).toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator!, rule.max!, 2026, "Q3")).not.toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator!, rule.max! + 1, 2026, "Q3")).not.toBe("compliant");
  });

  it("implements the three approved manual percent rules", () => {
    const expected = {
      "IND-028": { metric: "≤3%", type: "maximum", max: 3, unit: "percent", compliant: "<=3" },
      "IND-046": { metric: "≥95%", type: "minimum", min: 95, unit: "percent", compliant: ">=95" },
      "IND-050": { metric: "=100%", type: "exact", target: 100, unit: "percent", compliant: "=100" },
    } as const;

    for (const indicatorId of manualIndicatorIds) {
      const indicator = definitions.find((item) => item.id === indicatorId)!;
      const rule = parseIndicatorMetric(indicator.metric);
      expect({ metric: indicator.metric, ...rule, compliant: indicator.evaluationRules.compliant })
        .toMatchObject(expected[indicatorId]);
    }

    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-028")!, 3, 2026, "Q3"))
      .toBe("compliant");
    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-028")!, 3.1, 2026, "Q3"))
      .not.toBe("compliant");
    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-046")!, 95, 2026, "Q3"))
      .toBe("compliant");
    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-046")!, 94.9, 2026, "Q3"))
      .not.toBe("compliant");
    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-050")!, 100, 2026, "Q3"))
      .toBe("compliant");
    expect(evaluateConfiguredIndicator(definitions.find((item) => item.id === "IND-050")!, 99.9, 2026, "Q3"))
      .not.toBe("compliant");
  });

  it("keeps the other 38 previously validated metrics compliant at their configured target", () => {
    const excluded = new Set<string>([...strictIndicatorIds, ...manualIndicatorIds]);
    const stableDefinitions = definitions.filter((indicator) => !excluded.has(indicator.id));
    expect(stableDefinitions).toHaveLength(38);

    for (const indicator of stableDefinitions) {
      const rule = parseIndicatorMetric(indicator.metric);
      const compliantValue = rule.type === "minimum"
        ? rule.min! + (rule.minOperator === ">" ? 1 : 0)
        : rule.type === "maximum"
          ? rule.max! - (rule.maxOperator === "<" ? 1 : 0)
          : rule.type === "range"
            ? (rule.min! + rule.max!) / 2
            : rule.target!;
      expect(evaluateConfiguredIndicator(indicator, compliantValue, 2026, "Q3"), indicator.id)
        .toBe("compliant");
    }
  });

  it("evaluates all supported operators and alternatives in the frontend contract", () => {
    const cases = [
      [6000, ">6000", false],
      [6001, ">6000", true],
      [6000, ">=6000", true],
      [14000, "<14000", false],
      [13999, "<14000", true],
      [14000, "<=14000", true],
      [100, "=100", true],
      [6001, ">6000,<14000", true],
      [6000, ">6000,<14000", false],
      [14000, ">6000,<14000", false],
      [6000, ">=5300,<=6000;>=14000,<=14700", true],
    ] as const;

    for (const [value, expression, expected] of cases) {
      expect(matchesEvaluationRule(value, expression)).toBe(expected);
    }
  });

  it("keeps the PostgreSQL evaluator contract aligned with the frontend operators", () => {
    expect(engineMigration).toContain("create or replace function public.indicator_rule_expression_matches");
    expect(engineMigration).toContain("when '>=' then measured_value >= target");
    expect(engineMigration).toContain("when '<=' then measured_value <= target");
    expect(engineMigration).toContain("when '>' then measured_value > target");
    expect(engineMigration).toContain("when '<' then measured_value < target");
    expect(engineMigration).toContain("when '=' then measured_value = target");
    expect(engineMigration).toContain("rule.compliant_rule");
    expect(engineMigration).toContain("rule.marginal_rule");
    expect(engineMigration).toContain("rule.noncompliant_rule");
    expect(engineMigration).not.toMatch(/measured_value\s+between/);
  });

  it("prepares an idempotent 52-definition bootstrap with no results", () => {
    expect(bootstrapMigration.match(/\('IND-\d{3}'/g)).toHaveLength(52);
    expect(bootstrapMigration).toContain("'00000000-0000-0000-0000-000000000001'");
    expect(bootstrapMigration).toContain("'production'");
    expect(bootstrapMigration).toContain("existing_definition_count not in (0, 52)");
    expect(bootstrapMigration).toContain("on conflict (organization_id, workspace_mode, code) do update");
    expect(bootstrapMigration).toContain("Indicator bootstrap postcondition failed: definitions.");
    expect(bootstrapMigration).toContain("Indicator bootstrap postcondition failed: process relations.");
    expect(bootstrapMigration).toContain("Indicator bootstrap postcondition failed: evaluation rules.");
    expect(bootstrapMigration).toContain("Indicator bootstrap postcondition failed: periods.");
    expect(bootstrapMigration).toContain(") <> 624 then");
    expect(bootstrapMigration).not.toMatch(/insert\s+into\s+public\.indicator_results/i);
  });

  it("serializes the current master rules into the bootstrap", () => {
    for (const indicator of definitions) {
      const rules = buildDefaultEvaluationRules(indicator.metric);
      expect(bootstrapMigration, indicator.id).toContain(`'${indicator.id}'`);
      expect(bootstrapMigration, indicator.id).toContain(`'${rules.compliant}'`);
    }
  });
});
