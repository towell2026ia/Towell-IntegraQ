import type { ConfiguredIndicator } from "@/lib/indicator-data";
import type {
  IndicatorResultConfirmation,
  IndicatorResultInput,
  IndicatorRuntimeSnapshot,
  IndicatorRuntimeSettings,
} from "@/lib/indicators/indicator-types";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "No fue posible completar la operación de indicadores.");
  return body;
}

export async function fetchIndicatorRuntime() {
  return readJson<IndicatorRuntimeSnapshot>(
    await fetch("/api/indicators/runtime", { cache: "no-store" }),
  );
}

async function confirmedChange<T>(response: Response) {
  const result = await readJson<T>(response);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("integraq:indicators-changed"));
  return result;
}

export async function persistIndicatorDefinition(indicator: ConfiguredIndicator) {
  return confirmedChange<{ id: string }>(await fetch("/api/indicators/runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indicator }),
  }));
}

export async function disableIndicatorDefinition(indicatorId: string) {
  return confirmedChange<{ id: string }>(await fetch("/api/indicators/runtime", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indicatorId }),
  }));
}

export async function persistIndicatorResult(input: IndicatorResultInput) {
  return confirmedChange<IndicatorResultConfirmation>(await fetch("/api/indicators/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function persistIndicatorRuntimeSettings(settings: IndicatorRuntimeSettings) {
  return confirmedChange<{ ok: true }>(await fetch("/api/indicators/runtime", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }));
}

export async function persistIndicatorObjective(indicatorId: string, expectedUpdatedAt: string, objective: string) {
  return confirmedChange<{ indicatorId: string; objective: string; updatedAt: string }>(await fetch("/api/indicators/objective", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indicatorId, expectedUpdatedAt, objective }),
  }));
}
