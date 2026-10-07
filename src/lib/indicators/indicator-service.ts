import type { ConfiguredIndicator } from "@/lib/indicator-data";
import {
  disableIndicatorDefinition,
  fetchIndicatorRuntime,
  persistIndicatorDefinition,
  persistIndicatorResult,
  persistIndicatorRuntimeSettings,
} from "@/lib/indicators/indicator-repository";
import type { IndicatorResultInput, IndicatorRuntimeSettings } from "@/lib/indicators/indicator-types";

export async function loadIndicatorRuntime() {
  return fetchIndicatorRuntime();
}

export async function saveIndicatorDefinition(indicator: ConfiguredIndicator) {
  if (!indicator.id.trim() || !indicator.name.trim() || !indicator.processId.trim()) {
    throw new Error("Código, nombre y proceso principal son obligatorios.");
  }
  if (!indicator.metric.trim()) throw new Error("La métrica es obligatoria.");
  const periods = Object.values(indicator.schedule).flatMap((schedule) => Object.values(schedule));
  if (!periods.length || periods.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error("Todos los periodos deben tener una fecha válida.");
  }
  const windows = Object.values(indicator.captureWindows ?? {}).flatMap((year) => Object.values(year));
  if (windows.some((window) => {
    const opensAt = new Date(window.opensAt).getTime();
    const closesAt = new Date(window.closesAt).getTime();
    return !Number.isFinite(opensAt) || !Number.isFinite(closesAt) || opensAt > closesAt;
  })) {
    throw new Error("La apertura debe ser anterior o igual al cierre.");
  }
  return persistIndicatorDefinition(indicator);
}

export async function archiveIndicatorDefinition(indicatorId: string) {
  if (!indicatorId.trim()) throw new Error("Indicador inválido.");
  return disableIndicatorDefinition(indicatorId);
}

export async function saveIndicatorResult(input: IndicatorResultInput) {
  if (!input.indicatorId.trim() || !Number.isFinite(input.value)) {
    throw new Error("Indicador y resultado son obligatorios.");
  }
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2200) {
    throw new Error("El año del periodo no es válido.");
  }
  return persistIndicatorResult(input);
}

export async function saveIndicatorRuntimeSettings(settings: IndicatorRuntimeSettings) {
  if (!Number.isInteger(settings.captureDaysAfterClose)
    || settings.captureDaysAfterClose < 1
    || settings.captureDaysAfterClose > 90) {
    throw new Error("Los días disponibles deben estar entre 1 y 90.");
  }
  return persistIndicatorRuntimeSettings(settings);
}
