import type { A3Analysis } from "@/lib/types";
import { ishikawaCategories } from "./action-plan";

type Cause = NonNullable<A3Analysis["causeItems"]>[number];
type Linked = Pick<A3Analysis, "brainstorm" | "brainstormIds" | "plans" | "rootCause" | "rootCauseCauseId"> & {causeItems: Cause[]};

export function classifyCauses(items: Cause[]): A3Analysis["ishikawa"] {
  return Object.fromEntries(ishikawaCategories.map(category =>
    [category, items.filter(item => item.category === category).map(item => item.text)]
  )) as A3Analysis["ishikawa"];
}

export function changeCause<T extends Linked>(draft: T, id: string, changes: Partial<Pick<Cause, "category" | "text">>) {
  const original = draft.causeItems.find(item => item.id === id);
  if (!original) return draft;
  const cause = { ...original, ...changes };
  const causeItems = draft.causeItems.map(item => item.id === id ? cause : item);
  return {
    ...draft, causeItems, ishikawa: classifyCauses(causeItems),
    brainstorm: draft.brainstorm.map((text, index) => cause.sourceIdeaId && draft.brainstormIds?.[index] === cause.sourceIdeaId ? cause.text : text),
    rootCause: draft.rootCauseCauseId === id ? cause.text : draft.rootCause,
    plans: draft.plans.map(plan => plan.causeId === id ? { ...plan, cause: cause.text, causeCategory: cause.category ?? undefined } : plan),
  };
}

export function causeInUse(draft: Linked, id: string) {
  return draft.rootCauseCauseId === id || draft.plans.some(plan => plan.causeId === id);
}

export function removeCause<T extends Linked>(draft: T, id: string) {
  if (causeInUse(draft, id)) return draft;
  const causeItems = draft.causeItems.filter(item => item.id !== id);
  return { ...draft, causeItems, ishikawa: classifyCauses(causeItems) };
}
