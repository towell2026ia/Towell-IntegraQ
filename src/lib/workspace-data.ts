export type WorkspaceDataArea =
  | "correctiveActions"
  | "measurementAssets"
  | "controlledDocuments"
  | "forms"
  | "riskWorkspace"
  | "managementReviews"
  | "improvementProjects"
  | "auditOccurrences"
  | "customers"
  | "suppliers"
  | "a3Draft"
  | "metromap";

export const workspaceDataAreas = [
  "correctiveActions",
  "measurementAssets",
  "controlledDocuments",
  "forms",
  "riskWorkspace",
  "managementReviews",
  "improvementProjects",
  "auditOccurrences",
  "customers",
  "suppliers",
  "a3Draft",
  "metromap",
] as const satisfies readonly WorkspaceDataArea[];

export function isWorkspaceDataArea(value: unknown): value is WorkspaceDataArea {
  return typeof value === "string" && workspaceDataAreas.includes(value as WorkspaceDataArea);
}

export type WorkspaceDataSnapshot = Partial<Record<WorkspaceDataArea, unknown>>;
