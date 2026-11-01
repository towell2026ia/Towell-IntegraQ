"use client";

import { useEffect, useState } from "react";
import { buildHomeDashboard, type HomeDashboardSources, type HomeDashboardFilters } from "@/lib/home-dashboard";
import type { IndicatorRuntimeSnapshot } from "@/lib/indicators/indicator-types";
import { isDemoSession } from "@/lib/session-data";
import { HomeObjectives } from "./home-objectives";

export function HomeObjectiveCatalog({ sources, filters, asOf, onOpenIndicator }: {
  sources: HomeDashboardSources;
  filters: HomeDashboardFilters;
  asOf: Date;
  onOpenIndicator: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<IndicatorRuntimeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const demo = isDemoSession(sources.session);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void fetch("/api/indicators/runtime?includeInactive=true", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No fue posible consultar los objetivos e indicadores.");
        if (!Array.isArray(payload.definitions) || !payload.results) throw new Error("El catálogo de indicadores está incompleto.");
        if (!controller.signal.aborted) { setSnapshot(payload); setError(""); }
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "Error al consultar indicadores."); }
      });
    return () => controller.abort();
  }, [demo, sources.session.authUserId, retry]);
  if (!demo && error) return <section role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Reintentar</button></section>;
  if (!demo && !snapshot) return <p role="status">Consultando objetivos e indicadores autorizados…</p>;
  const dashboard = buildHomeDashboard({ ...sources, ...(snapshot && !demo ? { indicators: snapshot.definitions, indicatorResults: snapshot.results } : {}) }, filters, asOf);
  return <HomeObjectives items={dashboard.qualityObjectives} onOpenIndicator={onOpenIndicator} />;
}