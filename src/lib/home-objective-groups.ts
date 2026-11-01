import type { HomeDashboardData } from "./home-dashboard";
import { indicatorCatalog } from "./indicator-data";
export type HomeObjectiveIndicator = HomeDashboardData["qualityObjectives"][number];

// The institutional objectives come from the approved master, in source-row order.
// Runtime indicator assignments and results remain in the Indicators module.
export const institutionalQualityObjectives = [...new Set(
  [...indicatorCatalog]
    .sort((first, second) => first.sourceRow - second.sourceRow)
    .map((indicator) => indicator.qualityObjective.trim())
    .filter(Boolean),
)];

export function groupHomeObjectives(items: HomeObjectiveIndicator[]) {
  const grouped = new Map<string, HomeObjectiveIndicator[]>();
  const unassigned: HomeObjectiveIndicator[] = [];
  for (const item of items) {
    const objective = item.objective?.trim();
    if (!objective) { unassigned.push(item); continue; }
    const members = grouped.get(objective) ?? [];
    members.push(item);
    grouped.set(objective, members);
  }
  return { groups: [...grouped].map(([name, indicators]) => ({ name, indicators })), unassigned };
}
