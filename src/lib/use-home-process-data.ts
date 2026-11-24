"use client";
import { useEffect, useMemo, useState } from "react";
import type { ActiveSession } from "./session-data";
import { emptyHomeDashboardFilters, type HomeDashboardData, type HomeDashboardFilters } from "./home-dashboard";
import { emptyOperationalHome } from "./home-process-data";
import { sessionAccessKey } from "./workspace-continuity";

export function useHomeProcessData(session: ActiveSession, filters: HomeDashboardFilters = emptyHomeDashboardFilters, enabled = true) {
  const query = new URLSearchParams({ ...filters }).toString();
  const key = sessionAccessKey(session) + query;
  const [state, setState] = useState<{ key: string; dashboard: HomeDashboardData } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || session.workspaceMode === "demo" || !["Administrador", "Usuario interno"].includes(session.userType)) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/home/process-dashboard?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("HOME_LOAD_FAILED");
        const payload = await response.json();
        if (!controller.signal.aborted) { setState({ key, dashboard: payload.dashboard }); setFailure(null); }
      } catch { if (!controller.signal.aborted) { setState(null); setFailure(key); } }
    };
    void refresh();
    return () => controller.abort();
  }, [enabled, key, query, session.workspaceMode, session.userType]);
  const empty = useMemo(() => emptyOperationalHome(session), [session]);
  if (state?.key === key) return state;
  if (failure === key) {
    const dashboard = { ...empty, moduleStatus: empty.moduleStatus.map(s => ({ ...s, value: "Error de consulta", detail: "Actualiza la pantalla para reintentar" })), kpis: empty.kpis.map(k => ({ ...k, value: "No disponible", detail: "No se pudo consultar Supabase" })) };
    return { dashboard };
  }
  return { dashboard: empty };
}

export async function getHomeImageUrl(versionId: string) {
  const response = await fetch(`/api/home/process-dashboard?image=${encodeURIComponent(versionId)}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.signedUrl) throw new Error(payload.error || "Imagen no disponible.");
  return payload.signedUrl as string;
}
