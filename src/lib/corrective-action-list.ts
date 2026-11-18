import type { CorrectiveAction } from "@/lib/types";
export type CorrectiveListScope = "open" | "closed" | "all" | "customer" | "internal" | "system";
export function matchesCorrectiveListScope(action: Pick<CorrectiveAction, "source" | "status" | "deletedAt">, scope: CorrectiveListScope) {
  if (action.deletedAt || action.source === "supplier") return false;
  switch (scope) {
    case "all": return true;
    case "open": return action.status !== "closed";
    case "closed": return action.status === "closed";
    case "customer": return action.source === "customer";
    case "internal": return action.source === "internal";
    case "system": return action.source === "audit" || action.source === "sgc";
    default: return false;
  }
}
