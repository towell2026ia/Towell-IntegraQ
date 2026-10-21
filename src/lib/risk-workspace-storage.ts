import type { RiskWorkspaceState } from "@/lib/risk-opportunity-data";

let currentVersion: string | undefined;

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación.");
  return body;
}

export async function loadRiskWorkspace() {
  const response = await fetch("/api/risks/workspace", { cache: "no-store" });
  const result = await parseResponse<{ state: RiskWorkspaceState; updatedAt: string; storage: "supabase" }>(response);
  currentVersion = result.updatedAt;
  return result;
}

export async function saveRiskWorkspace(state: RiskWorkspaceState) {
  const response = await fetch("/api/risks/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, updatedAt: currentVersion }) });
  const result = await parseResponse<{ ok: true; updatedAt: string }>(response);
  currentVersion = result.updatedAt;
  return result;
}

export async function startRiskAnalysis() {
  const response = await fetch("/api/risks/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start_analysis", updatedAt: currentVersion }) });
  const result = await parseResponse<{ ok: true; state: RiskWorkspaceState; updatedAt: string; notifiedUsers: number; processCount: number; uncoveredProcessIds: string[] }>(response);
  currentVersion = result.updatedAt;
  return result;
}

export async function changeRiskDeletion(action: "delete" | "restore", riskId: string, reason: string, category?: string) {
  const response = await fetch("/api/risks/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, riskId, reason, category, updatedAt: currentVersion }) });
  const result = await parseResponse<{state: RiskWorkspaceState; updatedAt: string}>(response);
  currentVersion = result.updatedAt;
  return result.state;
}
