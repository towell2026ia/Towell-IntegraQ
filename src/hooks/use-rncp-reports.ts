"use client";

import { useCallback, useEffect, useState } from "react";

import { loadRncpReports, type RncpReport } from "@/lib/rncp-data";

export function useRncpReports(enabled = true) {
  const [reports, setReports] = useState<RncpReport[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) return [];
    setLoading(true);
    setError("");
    try {
      const result = await loadRncpReports();
      setReports(result.reports);
      return result.reports;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible consultar los RNCP.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(refresh);
    const refreshOnFocus = () => { void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [enabled, refresh]);

  return { reports, loading, error, refresh };
}
