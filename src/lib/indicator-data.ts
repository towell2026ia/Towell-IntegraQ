import indicatorSource from "@/lib/indicator-source.json";

export const quarters = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof quarters)[number];

export type IndicatorStatus =
  | "compliant"
  | "marginal"
  | "noncompliant"
  | "not_uploaded"
  | "pending";

export interface IndicatorDefinition {
  id: string;
  sourceRow: number;
  processId: string;
  area: string;
  directionObjective: string;
  directionMetric: string;
  qualityObjective: string;
  name: string;
  leader: string;
  metric: string;
  period: string;
  description: string;
}

export interface ConfiguredIndicator extends IndicatorDefinition {
  evaluationRules: IndicatorEvaluationRules;
  schedule: Record<string, Record<Quarter, string>>;
}

export interface IndicatorEvaluationRules {
  compliant: string;
  marginal: string;
  noncompliant: string;
}

export interface IndicatorResultRecord {
  value: number;
  comments: string;
  evidenceName?: string;
  evidenceSize?: number;
  submittedAt: string;
  submittedBy: string;
}

export interface IndicatorTargetRule {
  type: "minimum" | "maximum" | "range" | "exact";
  min?: number;
  max?: number;
  target?: number;
  unit: "percent" | "weeks" | "currency" | "value";
}

export type IndicatorResults = Record<
  string,
  Record<string, Partial<Record<Quarter, IndicatorResultRecord>>>
>;

export const indicatorCatalog = indicatorSource as IndicatorDefinition[];
export const indicatorAreas = Array.from(
  new Set(indicatorCatalog.map((indicator) => indicator.area)),
);

export const statusLabels: Record<IndicatorStatus, string> = {
  compliant: "Cumple",
  marginal: "Marginal",
  noncompliant: "No cumple",
  not_uploaded: "No subido",
  pending: "Pendiente",
};

export function parseIndicatorMetric(metric: string): IndicatorTargetRule {
  const normalized = metric.replace(/\s+/g, " ").trim();
  const unit: IndicatorTargetRule["unit"] = normalized.includes("%")
    ? "percent"
    : /semana/i.test(normalized)
      ? "weeks"
      : /\$|MXN/i.test(normalized)
        ? "currency"
        : "value";
  const numbers = Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );

  if (numbers.length >= 2 && /[,;]/.test(normalized)) {
    return { type: "range", min: numbers[0], max: numbers[1], unit };
  }

  const target = numbers[0] ?? 0;
  if (/≥|>=|>/.test(normalized)) return { type: "minimum", min: target, unit };
  if (/≤|<=|</.test(normalized)) return { type: "maximum", max: target, unit };
  return { type: "exact", target, unit };
}

export function evaluateIndicator(
  value: number | undefined,
  rule: IndicatorTargetRule,
  year: number,
  quarter: Quarter,
  now = new Date(),
): IndicatorStatus {
  if (value === undefined || Number.isNaN(value)) {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const resultQuarter = quarters.indexOf(quarter);
    return year < now.getFullYear() ||
      (year === now.getFullYear() && resultQuarter < currentQuarter)
      ? "not_uploaded"
      : "pending";
  }

  const reference =
    rule.type === "minimum"
      ? rule.min ?? 0
      : rule.type === "maximum"
        ? rule.max ?? 0
        : rule.type === "exact"
          ? rule.target ?? 0
          : Math.max(Math.abs(rule.min ?? 0), Math.abs(rule.max ?? 0));
  const tolerance = Math.max(reference * 0.05, rule.unit === "percent" ? 0.5 : 1);

  if (rule.type === "minimum") {
    if (value >= (rule.min ?? 0)) return "compliant";
    return value >= (rule.min ?? 0) - tolerance ? "marginal" : "noncompliant";
  }
  if (rule.type === "maximum") {
    if (value <= (rule.max ?? 0)) return "compliant";
    return value <= (rule.max ?? 0) + tolerance ? "marginal" : "noncompliant";
  }
  if (rule.type === "range") {
    if (value >= (rule.min ?? 0) && value <= (rule.max ?? 0)) return "compliant";
    if (value >= (rule.min ?? 0) - tolerance && value <= (rule.max ?? 0) + tolerance) {
      return "marginal";
    }
    return "noncompliant";
  }

  if (value === (rule.target ?? 0)) return "compliant";
  return Math.abs(value - (rule.target ?? 0)) <= tolerance
    ? "marginal"
    : "noncompliant";
}

export function evaluateConfiguredIndicator(
  indicator: ConfiguredIndicator,
  value: number | undefined,
  year: number,
  quarter: Quarter,
  now = new Date(),
): IndicatorStatus {
  if (value === undefined || Number.isNaN(value)) {
    return evaluateIndicator(undefined, parseIndicatorMetric(indicator.metric), year, quarter, now);
  }

  const rules = indicator.evaluationRules ?? buildDefaultEvaluationRules(indicator.metric);
  if (matchesEvaluationRule(value, rules.compliant)) return "compliant";
  if (matchesEvaluationRule(value, rules.marginal)) return "marginal";
  return "noncompliant";
}

export function buildDefaultEvaluationRules(metric: string): IndicatorEvaluationRules {
  const rule = parseIndicatorMetric(metric);
  const reference =
    rule.type === "minimum"
      ? rule.min ?? 0
      : rule.type === "maximum"
        ? rule.max ?? 0
        : rule.type === "exact"
          ? rule.target ?? 0
          : Math.max(Math.abs(rule.min ?? 0), Math.abs(rule.max ?? 0));
  const tolerance = Math.max(reference * 0.05, rule.unit === "percent" ? 0.5 : 1);

  if (rule.type === "minimum") {
    const target = rule.min ?? 0;
    const marginal = roundRuleNumber(target - tolerance);
    return {
      compliant: `>=${roundRuleNumber(target)}`,
      marginal: `>=${marginal},<${roundRuleNumber(target)}`,
      noncompliant: `<${marginal}`,
    };
  }
  if (rule.type === "maximum") {
    const target = rule.max ?? 0;
    const marginal = roundRuleNumber(target + tolerance);
    return {
      compliant: `<=${roundRuleNumber(target)}`,
      marginal: `>${roundRuleNumber(target)},<=${marginal}`,
      noncompliant: `>${marginal}`,
    };
  }
  if (rule.type === "range") {
    const minimum = rule.min ?? 0;
    const maximum = rule.max ?? minimum;
    const lower = roundRuleNumber(minimum - tolerance);
    const upper = roundRuleNumber(maximum + tolerance);
    return {
      compliant: `>=${roundRuleNumber(minimum)},<=${roundRuleNumber(maximum)}`,
      marginal: `>=${lower},<${roundRuleNumber(minimum)};>${roundRuleNumber(maximum)},<=${upper}`,
      noncompliant: `<${lower};>${upper}`,
    };
  }

  const target = rule.target ?? 0;
  const lower = roundRuleNumber(target - tolerance);
  const upper = roundRuleNumber(target + tolerance);
  return {
    compliant: `=${roundRuleNumber(target)}`,
    marginal: `>=${lower},<${roundRuleNumber(target)};>${roundRuleNumber(target)},<=${upper}`,
    noncompliant: `<${lower};>${upper}`,
  };
}

export function getIndicatorScore(
  value: number | undefined,
  rule: IndicatorTargetRule,
  status: IndicatorStatus,
) {
  if (value === undefined || status === "pending" || status === "not_uploaded") return null;
  if (status === "compliant") {
    if (rule.type === "minimum" && (rule.min ?? 0) > 0) {
      return clamp(80 + ((value / (rule.min ?? 1)) - 1) * 80, 80, 100);
    }
    if (rule.type === "maximum" && (rule.max ?? 0) > 0) {
      return clamp(100 - (value / (rule.max ?? 1)) * 20, 80, 100);
    }
    return 92;
  }
  if (status === "marginal") return 70;
  return 38;
}

export function formatIndicatorValue(
  value: number | undefined,
  rule: IndicatorTargetRule,
) {
  if (value === undefined) return "—";
  const formatted = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: value < 10 ? 2 : 1,
  }).format(value);
  if (rule.unit === "percent") return `${formatted}%`;
  if (rule.unit === "weeks") return `${formatted} sem`;
  if (rule.unit === "currency") return `$${formatted}`;
  return formatted;
}

export function buildInitialIndicatorResults(): IndicatorResults {
  return Object.fromEntries(
    indicatorCatalog.map((indicator) => [indicator.id, { "2025": {}, "2026": {} }]),
  );
}

export function buildInitialIndicatorDefinitions(): ConfiguredIndicator[] {
  return indicatorCatalog.map((indicator) => ({
    ...indicator,
    evaluationRules: buildDefaultEvaluationRules(indicator.metric),
    schedule: {
      "2025": buildQuarterSchedule(2025),
      "2026": buildQuarterSchedule(2026),
    },
  }));
}

export function normalizeConfiguredIndicators(
  indicators: Array<IndicatorDefinition & Partial<ConfiguredIndicator>>,
): ConfiguredIndicator[] {
  return indicators.map((indicator) => ({
    ...indicator,
    evaluationRules:
      indicator.evaluationRules ?? buildDefaultEvaluationRules(indicator.metric),
    schedule: indicator.schedule ?? {
      "2025": buildQuarterSchedule(2025),
      "2026": buildQuarterSchedule(2026),
    },
  }));
}

export function buildQuarterSchedule(year: number): Record<Quarter, string> {
  return {
    Q1: `${year}-03-31`,
    Q2: `${year}-06-30`,
    Q3: `${year}-09-30`,
    Q4: `${year}-12-31`,
  };
}

export function getIndicatorScheduleDate(
  indicator: ConfiguredIndicator,
  year: number,
  quarter: Quarter,
) {
  return indicator.schedule[String(year)]?.[quarter] ?? "";
}

export function canSubmitIndicator(
  indicator: ConfiguredIndicator,
  year: number,
  quarter: Quarter,
  now = new Date(),
) {
  const scheduledDate = getIndicatorScheduleDate(indicator, year, quarter);
  const currentDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return Boolean(scheduledDate) && scheduledDate === currentDate;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function matchesEvaluationRule(value: number, expression: string) {
  return expression
    .split(";")
    .map((alternative) => alternative.trim())
    .filter(Boolean)
    .some((alternative) =>
      alternative
        .split(",")
        .map((condition) => condition.trim().replaceAll("≤", "<=").replaceAll("≥", ">="))
        .filter(Boolean)
        .every((condition) => {
          const match = condition.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/);
          if (!match) return false;
          const target = Number(match[2]);
          if (match[1] === ">=") return value >= target;
          if (match[1] === "<=") return value <= target;
          if (match[1] === ">") return value > target;
          if (match[1] === "<") return value < target;
          return value === target;
        }),
    );
}

function roundRuleNumber(value: number) {
  return Math.round(value * 100) / 100;
}
