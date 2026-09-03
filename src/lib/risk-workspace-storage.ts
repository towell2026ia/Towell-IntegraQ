import type { RiskWorkspaceState } from "@/lib/risk-opportunity-data";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación.");
  return body;
}

export async function loadRiskWorkspace() {
  const response = await fetch("/api/risks/workspace", { cache: "no-store" });
  return parseResponse<{ state: RiskWorkspaceState; updatedAt: string; storage: "supabase" }>(response);
}

export async function saveRiskWorkspace(state: RiskWorkspaceState) {
  const response = await fetch("/api/risks/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
  return parseResponse<{ ok: true; updatedAt: string }>(response);
}

export async function startRiskAnalysis() {
  const response = await fetch("/api/risks/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start_analysis" }) });
  return parseResponse<{ ok: true; state: RiskWorkspaceState; notifiedUsers: number; processCount: number; uncoveredProcessIds: string[] }>(response);
}
