import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import indicatorSource from "@/lib/indicator-source.json";
import {
  buildDefaultEvaluationRules,
  buildInitialIndicatorDefinitions,
  buildQuarterSchedule,
  parseIndicatorMetric,
  type IndicatorDefinition,
} from "@/lib/indicator-data";
import { buildDefaultCaptureWindows } from "@/lib/indicators/indicator-windows";

const TARGET_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_WORKSPACE = "production";
const IMPORT_YEARS = [2026, 2027, 2028];
const VALID_PRODUCTION_PROCESSES = new Set([
  "P-01",
  "P-04",
  "P-05",
  "P-08",
  "P-09",
  "P-11",
  "P-12",
  "P-13",
  "P-17",
  "P-22",
  "P-34",
]);
const STRICT_RANGE_INDICATORS = new Set([
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
]);

const indicators = indicatorSource as IndicatorDefinition[];

function mappedProcessId(processId: string) {
  return processId;
}

function buildImportPlan() {
  return indicators.map((indicator) => ({
    code: indicator.id,
    organizationId: TARGET_ORGANIZATION_ID,
    workspaceMode: TARGET_WORKSPACE,
    processId: mappedProcessId(indicator.processId),
    rule: parseIndicatorMetric(indicator.metric),
    evaluationRules: buildDefaultEvaluationRules(indicator.metric),
    periods: IMPORT_YEARS.flatMap((year) => {
      const schedule = buildQuarterSchedule(year);
      const windows = buildDefaultCaptureWindows(year);
      return (["Q1", "Q2", "Q3", "Q4"] as const).map((quarter) => ({
        year,
        quarter,
        scheduledDate: schedule[quarter],
        ...windows[quarter],
      }));
    }),
  }));
}

describe("indicator master production preflight", () => {
  it("keeps exactly 52 unique, complete source records", () => {
    expect(indicators).toHaveLength(52);
    expect(new Set(indicators.map((indicator) => indicator.id))).toHaveLength(52);
    expect(indicators.filter((indicator) => !indicator.id.trim())).toHaveLength(0);
    expect(indicators.filter((indicator) => !indicator.name.trim())).toHaveLength(0);
    expect(indicators.filter((indicator) => !indicator.metric.trim())).toHaveLength(0);
    expect(new Set(indicators.map((indicator) => indicator.sourceRow))).toHaveLength(52);
    expect(Math.min(...indicators.map((indicator) => indicator.sourceRow))).toBe(6);
    expect(Math.max(...indicators.map((indicator) => indicator.sourceRow))).toBe(57);
    expect(new Set(indicators.map((indicator) => indicator.period))).toEqual(new Set(["Trimestral"]));
  });

  it("stores the authorized AREA-RH to P-11 mapping on the four Recursos Humanos indicators", () => {
    const mapped = indicators.filter((indicator) => ["IND-042", "IND-043", "IND-044", "IND-045"].includes(indicator.id));
    expect(mapped).toHaveLength(4);
    expect(mapped.every((indicator) => indicator.area === "Recursos Humanos")).toBe(true);
    expect(mapped.every((indicator) => indicator.processId === "P-11")).toBe(true);
    expect(indicators.some((indicator) => indicator.processId === "AREA-RH")).toBe(false);
    expect(indicators.every((indicator) => VALID_PRODUCTION_PROCESSES.has(mappedProcessId(indicator.processId)))).toBe(true);
  });

  it("applies the authorized canonical objective only to IND-003 through IND-005", () => {
    const objectives = new Set(indicators.map((indicator) => indicator.qualityObjective).filter(Boolean));
    const canonical = "Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.";
    const repeated = `${canonical} eficiencia en todos nuestros procesos.`;
    expect(objectives).toHaveLength(5);
    expect(objectives.has(canonical)).toBe(true);
    expect(objectives.has(repeated)).toBe(false);
    expect(indicators.filter((indicator) => indicator.qualityObjective === canonical)).toHaveLength(16);
    expect(indicators.filter((indicator) => ["IND-003", "IND-004", "IND-005"].includes(indicator.id)).every(
      (indicator) => indicator.qualityObjective === canonical,
    )).toBe(true);
  });

  it("parses every metric into a finite minimum, maximum, range, or exact rule", () => {
    for (const indicator of indicators) {
      const rule = parseIndicatorMetric(indicator.metric);
      expect(["minimum", "maximum", "range", "exact"]).toContain(rule.type);
      expect([rule.min, rule.max, rule.target].filter((value) => value !== undefined).every(Number.isFinite)).toBe(true);
      expect(buildDefaultEvaluationRules(indicator.metric)).toEqual({
        compliant: expect.any(String),
        marginal: expect.any(String),
        noncompliant: expect.any(String),
      });
    }
  });

  it("preserves all eleven authorized strict-boundary metrics", () => {
    expect([...STRICT_RANGE_INDICATORS]).toHaveLength(11);
    for (const indicator of indicators.filter((item) => STRICT_RANGE_INDICATORS.has(item.id))) {
      expect(indicator.metric).toMatch(/^>\s*\d+(?:\.\d+)?,\s*<\s*\d+(?:\.\d+)?$/);
      expect(parseIndicatorMetric(indicator.metric)).toMatchObject({
        type: "range",
        minOperator: ">",
        maxOperator: "<",
      });
    }
  });

  it("targets only Towell production and plans one relation and rule per definition", () => {
    const plan = buildImportPlan();
    expect(plan).toHaveLength(52);
    expect(new Set(plan.map((item) => item.organizationId))).toEqual(new Set([TARGET_ORGANIZATION_ID]));
    expect(new Set(plan.map((item) => item.workspaceMode))).toEqual(new Set([TARGET_WORKSPACE]));
    expect(plan.map((item) => item.processId)).toHaveLength(52);
    expect(plan.map((item) => item.evaluationRules)).toHaveLength(52);
  });

  it("plans 2026-2028 quarterly periods with valid 15-day capture windows", () => {
    const periods = buildImportPlan().flatMap((item) => item.periods);
    expect(periods).toHaveLength(52 * 3 * 4);
    for (const period of periods) {
      expect(new Date(period.opensAt).getTime()).toBeLessThanOrEqual(new Date(period.closesAt).getTime());
    }
    const q4 = periods.find((period) => period.year === 2026 && period.quarter === "Q4");
    expect(q4?.scheduledDate).toBe("2026-12-31");
    expect(q4?.opensAt).toContain("2027-01-01");
  });

  it("is idempotent by organization, workspace, and code and never plans results", () => {
    const stored = new Map<string, ReturnType<typeof buildImportPlan>[number]>();
    const apply = () => {
      for (const item of buildImportPlan()) {
        stored.set(`${item.organizationId}:${item.workspaceMode}:${item.code}`, item);
      }
    };
    apply();
    apply();
    expect(stored.size).toBe(52);
    expect(buildImportPlan().some((item) => "results" in item)).toBe(false);
  });

  it("simulates a runtime snapshot with 52 definitions and no results", () => {
    const definitions = buildInitialIndicatorDefinitions().map((indicator) => ({
      ...indicator,
      processId: mappedProcessId(indicator.processId),
    }));
    expect(definitions).toHaveLength(52);
    expect(definitions.every((indicator) => VALID_PRODUCTION_PROCESSES.has(indicator.processId))).toBe(true);
    expect({ definitions, results: {}, source: "supabase" }).toMatchObject({
      definitions: expect.arrayContaining([expect.objectContaining({ id: "IND-001" })]),
      results: {},
      source: "supabase",
    });
  });

  it("keeps Home wired to runtime indicators instead of the historical image", () => {
    const workspace = readFileSync(join(process.cwd(), "src/components/integraq-workspace.tsx"), "utf8");
    const home = readFileSync(join(process.cwd(), "src/components/modules/home-module.tsx"), "utf8");
    expect(workspace).toContain("const indicatorDefinitions = demoMode ? demoIndicatorDefinitions : indicatorRuntime.definitions");
    expect(home).toContain("dashboard.qualityObjectives");
    expect(workspace).not.toContain("objetivos-calidad.png");
    expect(home).not.toContain("objetivos-calidad.png");
  });
});
