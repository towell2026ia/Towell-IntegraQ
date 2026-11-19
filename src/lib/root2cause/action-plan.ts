import type { A3ActionPlanItem } from "@/lib/types";

export type RootCauseResponsible = { id: string; fullName: string };
export const ishikawaCategories = ["workforce", "machinery", "method", "material", "environment", "measurement"] as const;

export function createBlankActionPlan(id: string): A3ActionPlanItem {
  return { id, description: "", owner: "", dueDate: "", status: "pending" };
}

export function removeActionPlan(plans: A3ActionPlanItem[], id: string): A3ActionPlanItem[] {
  return plans.filter((plan) => plan.id !== id);
}

export function appendBlankActionPlan(plans: A3ActionPlanItem[], id: string): A3ActionPlanItem[] {
  return [...plans, createBlankActionPlan(id)];
}

export function isActionPlanReady(plan: A3ActionPlanItem, responsibleIds: ReadonlySet<string>): boolean {
  return Boolean(
    plan.description.trim() && ishikawaCategories.includes(plan.causeCategory as typeof ishikawaCategories[number]) &&
    plan.ownerUserId && responsibleIds.has(plan.ownerUserId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(plan.dueDate),
  );
}

export function suggestedActionKey(step: number, index: number, description: string, cause: string): string {
  return `${step}:${index}:${description.trim().toLocaleLowerCase("es")}:${cause.trim().toLocaleLowerCase("es")}`;
}
