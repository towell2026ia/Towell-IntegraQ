"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadRncpReports, type RncpReport } from "@/lib/rncp-data";

export function useRncpReports(enabled = true, view: "detail" | "directory" = "detail") {
  const [reports, setReports] = useState<RncpReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [flowReady, setFlowReady] = useState(false);
  const [error, setError] = useState("");

  const directoryLoadedAt = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    // Mutations call refresh even while the directory is off screen.
    directoryLoadedAt.current = 0;
    if (!enabled) { setReports([]); setFlowReady(false); setLoading(true); return []; }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await loadRncpReports(view, controller.signal);
      if (controller.signal.aborted) return [];
      if (view === "directory") directoryLoadedAt.current = Date.now();
      setFlowReady(result.flowReady === true);
      setReports(result.reports);
      return result.reports;
    } catch (cause) {
      if (controller.signal.aborted) return [];
      setReports([]);
      setFlowReady(false);
      setError(cause instanceof Error ? cause.message : "No fue posible consultar los RNCP.");
      return [];
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setLoading(false); }
    }
  }, [enabled, view]);

  useEffect(() => {
    if (!enabled || (view === "directory" && Date.now() - directoryLoadedAt.current < 60_000)) return;
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    const refreshOnFocus = () => { if (!pending.current) void refresh(); };
    if (view !== "directory") window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      pending.current?.abort();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [enabled, refresh, view]);

  return { reports, loading, error, refresh, flowReady };
}
