export const improvementSourceTypes = ["indicator", "risk", "audit", "corrective_action", "metrology", "document"] as const;
export type ImprovementSourceType = typeof improvementSourceTypes[number];

export function isImprovementSourceType(value: string): value is ImprovementSourceType {
  return improvementSourceTypes.includes(value as ImprovementSourceType);
}

