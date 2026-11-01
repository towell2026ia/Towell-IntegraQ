import type { HomeDashboardData } from "./home-dashboard";
export type HomeObjectiveIndicator = HomeDashboardData["qualityObjectives"][number];
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
