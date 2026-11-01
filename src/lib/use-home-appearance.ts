"use client";
import { useCallback, useEffect, useState } from "react";
import { isHomeTextSize, type HomeAppearance } from "./home-appearance";
export function useHomeAppearance(enabled = true) {
  const [appearance, setAppearance] = useState<HomeAppearance>({ textSize: 100, revision: 0 });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/home/appearance", { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !isHomeTextSize(payload.textSize) || !Number.isInteger(payload.revision)) throw new Error(payload.error || "No fue posible consultar la apariencia.");
        if (!controller.signal.aborted) { setAppearance(payload); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No fue posible consultar la apariencia."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [enabled, attempt, refresh]);
  return { appearance, loading, error, refresh };
}