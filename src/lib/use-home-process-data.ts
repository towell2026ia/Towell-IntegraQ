"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveSession } from "./session-data";
import { emptyHomeDashboardFilters, type HomeDashboardData, type HomeDashboardFilters } from "./home-dashboard";
import { emptyOperationalHome } from "./home-process-data";
import { sessionAccessKey } from "./workspace-continuity";

export function useHomeProcessData(session: ActiveSession, filters: HomeDashboardFilters = emptyHomeDashboardFilters, enabled = true) {
  const query = new URLSearchParams({ ...filters }).toString();
  const accessKey = sessionAccessKey(session);
  const key = accessKey + query;
  const [state, setState] = useState<{ key: string; dashboard: HomeDashboardData } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cached = useRef(new Map<string, { at: number; dashboard: HomeDashboardData }>());
  useEffect(() => { cached.current.clear(); }, [accessKey]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { cached.current.clear(); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    if (!enabled || session.workspaceMode === "demo" || !["Administrador", "Usuario interno"].includes(session.userType)) return;
    const controller = new AbortController();
    const saved = cached.current.get(key);
    const warm = saved && Date.now() - saved.at < 15_000;
    setState(warm ? { key, dashboard: saved.dashboard } : null);
    setFailure(null);
    const refresh = async () => {
      try {
        const response = await fetch(`/api/home/process-dashboard?${query}`, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/x-ndjson" } });
        if (!response.ok) throw new Error("HOME_LOAD_FAILED");
        if (!response.body) throw new Error("HOME_STREAM_MISSING");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let dashboard: HomeDashboardData | undefined;
        let keepWarm = Boolean(warm);
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += chunk.value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            dashboard = { ...dashboard, ...JSON.parse(line) } as HomeDashboardData;
            if (keepWarm && saved && (JSON.stringify(saved.dashboard.visibleSections) !== JSON.stringify(dashboard.visibleSections) || JSON.stringify(saved.dashboard.processScope.ids) !== JSON.stringify(dashboard.processScope.ids) || dashboard.unavailableSources?.length)) keepWarm = false;
            if (!controller.signal.aborted && (!keepWarm || !dashboard.pendingSources?.length)) setState({ key, dashboard });
          }
        }
        if (buffer || !dashboard || dashboard.pendingSources?.length) throw new Error("HOME_STREAM_INCOMPLETE");
        if (!controller.signal.aborted && !dashboard.unavailableSources?.length) {
          if (cached.current.size >= 8) cached.current.delete(cached.current.keys().next().value!);
          cached.current.set(key, { at: Date.now(), dashboard });
        }
      } catch { if (!controller.signal.aborted) { cached.current.delete(key); setState(null); setFailure(key); } }
    };
    void refresh();
    return () => controller.abort();
  }, [attempt, enabled, key, query, session.workspaceMode, session.userType]);
  const empty = useMemo(() => emptyOperationalHome(session), [session]);
  const dashboard = enabled && state?.key === key ? state.dashboard : { ...empty, visibleSections: [] };
  return { dashboard, retry, failed: failure === key || Boolean(dashboard.unavailableSources?.length) };

}

export async function getHomeImageUrl(versionId: string) {
  const response = await fetch(`/api/home/process-dashboard?image=${encodeURIComponent(versionId)}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.signedUrl) throw new Error(payload.error || "Imagen no disponible.");
  return payload.signedUrl as string;
}
