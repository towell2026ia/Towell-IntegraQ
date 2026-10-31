"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
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
  const latestRead = useRef(0);
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
    const sequence = ++latestRead.current;
    setLoading(true);
    try {
      const snapshot = await loadIndicatorRuntime();
      if (sequence !== latestRead.current) return;
      setDefinitions(snapshot.definitions);
      setResults(snapshot.results);
      setAccess(snapshot.access);
      setSettings(snapshot.settings);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible sincronizar indicadores.");
    } finally {
      if (sequence === latestRead.current) setLoading(false);
    }
  }, [enabled]);

  const runConfirmedMutation = useCallback(async (mutation: () => Promise<unknown>) => {
    ++latestRead.current;
    setSaving(true);
    setError("");
    try {
      await mutation();
      const sequence = ++latestRead.current;
      const snapshot = await loadIndicatorRuntime();
      if (sequence !== latestRead.current) return;
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
    let debounce: ReturnType<typeof setTimeout>;
    const refreshOnFocus = () => { clearTimeout(debounce); debounce = setTimeout(() => void refresh(), 100); };
    const client = createClient();
    const channel = client.channel("indicator-capture-invalidation").on("postgres_changes", {event: "*", schema: "public", table: "indicator_periods"}, refreshOnFocus).on("postgres_changes", {event: "*", schema: "public", table: "indicator_capture_rules"}, refreshOnFocus).subscribe();
    const poll = setInterval(refreshOnFocus, 15000);
    window.addEventListener("indicator-capture-changed", refreshOnFocus);
    const refreshOnVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      clearTimeout(debounce); clearInterval(poll); void client.removeChannel(channel);
      window.removeEventListener("indicator-capture-changed", refreshOnFocus);
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
