"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { matrixQuery, rncpRequest, type MatrixResult } from "@/lib/rncp/client";
import { emptyMatrixFilters } from "@/lib/rncp/model";

export function useRncpMatrix(initialSupplierId = "") {
  const [filters, setFilters] = useState({ ...emptyMatrixFilters, supplierId: initialSupplierId });
  const [data, setData] = useState<MatrixResult | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const sequence = useRef(0); const abort = useRef<AbortController | null>(null);
  const query = matrixQuery(filters);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setLoading(true);
    try {
      const result = await rncpRequest<MatrixResult>(`/matrix?${query}`, { signal: controller.signal });
      if (request === sequence.current && !controller.signal.aborted) { setData(result); setError(""); }
    } catch (error) {
      if (request === sequence.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : "No fue posible actualizar RNCP.");
    } finally { if (request === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 200);
    const clock = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(clock); abort.current?.abort(); };
  }, [refresh]);
  return { data, filters, setFilters, refresh, loading, error };
}
