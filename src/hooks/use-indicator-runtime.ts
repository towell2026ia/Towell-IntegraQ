"use client";

import { useCallback, useEffect, useState } from "react";

import type { ConfiguredIndicator, IndicatorResults } from "@/lib/indicator-data";
import {
  archiveIndicatorDefinition,
  loadIndicatorRuntime,
  saveIndicatorDefinition,
  saveIndicatorResult,
  saveIndicatorRuntimeSettings,
} from "@/lib/indicators/indicator-service";
import type { IndicatorResultInput, IndicatorRuntimeAccess, IndicatorRuntimeSettings } from "@/lib/indicators/indicator-types";
import { DEFAULT_CAPTURE_DAYS_AFTER_CLOSE, INDICATOR_BUSINESS_TIME_ZONE } from "@/lib/indicators/indicator-windows";

export function useIndicatorRuntime(enabled: boolean) {
  const [definitions, setDefinitions] = useState<ConfiguredIndicator[]>([]);
  const [results, setResults] = useState<IndicatorResults>({});
  const [access, setAccess] = useState<IndicatorRuntimeAccess | null>(null);
  const [settings, setSettings] = useState<IndicatorRuntimeSettings>({
    captureDaysAfterClose: DEFAULT_CAPTURE_DAYS_AFTER_CLOSE,
    timezone: INDICATOR_BUSINESS_TIME_ZONE,
  });
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const snapshot = await loadIndicatorRuntime();
      setDefinitions(snapshot.definitions);
      setResults(snapshot.results);
      setAccess(snapshot.access);
      setSettings(snapshot.settings);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible sincronizar indicadores.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const runConfirmedMutation = useCallback(async (mutation: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await mutation();
      const snapshot = await loadIndicatorRuntime();
      setDefinitions(snapshot.definitions);
      setResults(snapshot.results);
      setAccess(snapshot.access);
      setSettings(snapshot.settings);
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : "No fue posible guardar el cambio.";
      setError(message);
      throw mutationError;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveDefinition = useCallback(
    (indicator: ConfiguredIndicator) => runConfirmedMutation(() => saveIndicatorDefinition(indicator)),
    [runConfirmedMutation],
  );
  const disableDefinition = useCallback(
    (indicatorId: string) => runConfirmedMutation(() => archiveIndicatorDefinition(indicatorId)),
    [runConfirmedMutation],
  );
  const saveResult = useCallback(
    (input: IndicatorResultInput) => runConfirmedMutation(() => saveIndicatorResult(input)),
    [runConfirmedMutation],
  );
  const saveSettings = useCallback(
    (nextSettings: IndicatorRuntimeSettings) => runConfirmedMutation(() => saveIndicatorRuntimeSettings(nextSettings)),
    [runConfirmedMutation],
  );

  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(refresh);
    const refreshOnFocus = () => { void refresh(); };
    const refreshOnVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [enabled, refresh]);

  return {
    definitions,
    results,
    access,
    settings,
    loading,
    saving,
    error,
    refresh,
    saveDefinition,
    disableDefinition,
    saveResult,
    saveSettings,
  };
}
