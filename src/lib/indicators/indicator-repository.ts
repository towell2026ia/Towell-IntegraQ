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

export async function persistIndicatorDefinition(indicator: ConfiguredIndicator) {
  return readJson<{ id: string }>(await fetch("/api/indicators/runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indicator }),
  }));
}

export async function disableIndicatorDefinition(indicatorId: string) {
  return readJson<{ id: string }>(await fetch("/api/indicators/runtime", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indicatorId }),
  }));
}

export async function persistIndicatorResult(input: IndicatorResultInput) {
  return readJson<IndicatorResultConfirmation>(await fetch("/api/indicators/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function persistIndicatorRuntimeSettings(settings: IndicatorRuntimeSettings) {
  return readJson<{ ok: true }>(await fetch("/api/indicators/runtime", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }));
}
