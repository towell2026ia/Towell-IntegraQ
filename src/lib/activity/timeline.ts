import type { ActivityEvent } from "./types";

export interface ActivityRepository {
  list(entityType: string, entityId: string): Promise<ActivityEvent[]>;
}

export async function getActivityTimeline(entityType: string, entityId: string, repository: ActivityRepository) {
  if (!entityType.trim() || !entityId.trim()) return [];
  return (await repository.list(entityType, entityId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function changedFields(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].reduce<{ previousValue: Record<string, unknown>; newValue: Record<string, unknown> }>((diff, key) => {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      diff.previousValue[key] = previous[key];
      diff.newValue[key] = next[key];
    }
    return diff;
  }, { previousValue: {}, newValue: {} });
}
