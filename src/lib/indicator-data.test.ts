import { describe, expect, it } from "vitest";

import {
  buildInitialIndicatorDefinitions,
  buildInitialIndicatorResults,
  buildDefaultEvaluationRules,
  canSubmitIndicator,
  evaluateConfiguredIndicator,
  evaluateIndicator,
  indicatorAreas,
  indicatorCatalog,
  parseIndicatorMetric,
} from "@/lib/indicator-data";

describe("indicator catalog", () => {
  it("preserves the complete quarterly source catalog", () => {
    expect(indicatorCatalog).toHaveLength(52);
    expect(indicatorAreas).toHaveLength(11);
    expect(new Set(indicatorCatalog.map((indicator) => indicator.period))).toEqual(
      new Set(["Trimestral"]),
    );
  });

  it("parses minimum, maximum and range metrics", () => {
    expect(parseIndicatorMetric("≥90% de cierre")).toMatchObject({
      type: "minimum",
      min: 90,
      unit: "percent",
    });
    expect(parseIndicatorMetric("≤2.9%")).toMatchObject({
      type: "maximum",
      max: 2.9,
    });
    expect(parseIndicatorMetric(">6000, <14000")).toMatchObject({
      type: "range",
      min: 6000,
      max: 14000,
    });
  });

  it("starts without automatically uploaded results", () => {
    const results = buildInitialIndicatorResults();
    expect(Object.values(results).every((years) =>
      Object.values(years).every((year) => Object.keys(year).length === 0),
    )).toBe(true);
  });

  it("only opens capture on the programmed date", () => {
    const indicator = buildInitialIndicatorDefinitions()[0];
    expect(canSubmitIndicator(indicator, 2026, "Q3", new Date("2026-09-30T12:00:00-06:00"))).toBe(true);
    expect(canSubmitIndicator(indicator, 2026, "Q3", new Date("2026-09-29T12:00:00-06:00"))).toBe(false);
  });

  it("creates and applies the three administrative evaluation rules", () => {
    expect(buildDefaultEvaluationRules("≥90%")).toEqual({
      compliant: ">=90",
      marginal: ">=85.5,<90",
      noncompliant: "<85.5",
    });
    const indicator = {
      ...buildInitialIndicatorDefinitions()[0],
      evaluationRules: {
        compliant: ">=95",
        marginal: ">=90,<95",
        noncompliant: "<90",
      },
    };
    expect(evaluateConfiguredIndicator(indicator, 96, 2026, "Q3")).toBe("compliant");
    expect(evaluateConfiguredIndicator(indicator, 92, 2026, "Q3")).toBe("marginal");
    expect(evaluateConfiguredIndicator(indicator, 80, 2026, "Q3")).toBe("noncompliant");
  });
});

describe("quarterly indicator status", () => {
  const now = new Date("2026-08-13T12:00:00-06:00");

  it("uses green, marginal and red bands around the target", () => {
    const rule = parseIndicatorMetric("≥90%");
    expect(evaluateIndicator(92, rule, 2026, "Q2", now)).toBe("compliant");
    expect(evaluateIndicator(88, rule, 2026, "Q2", now)).toBe("marginal");
    expect(evaluateIndicator(70, rule, 2026, "Q2", now)).toBe("noncompliant");
  });

  it("distinguishes overdue missing results from pending quarters", () => {
    const rule = parseIndicatorMetric("≤2%");
    expect(evaluateIndicator(undefined, rule, 2026, "Q2", now)).toBe("not_uploaded");
    expect(evaluateIndicator(undefined, rule, 2026, "Q3", now)).toBe("pending");
    expect(evaluateIndicator(undefined, rule, 2026, "Q4", now)).toBe("pending");
  });
});
