"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { matrixQuery, rncpRequest, type MatrixResult } from "@/lib/rncp/client";
import { emptyMatrixFilters } from "@/lib/rncp/model";

export function useRncpMatrix(initialSupplierId = "") {
  const [filters, setFilters] = useState({ ...emptyMatrixFilters, supplierId: initialSupplierId });
  const [data, setData] = useState<MatrixResult | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [pdfCounts, setPdfCounts] = useState<Record<string, number> | null>(null);
  const [countsUnavailable, setCountsUnavailable] = useState(false);
  const sequence = useRef(0); const abort = useRef<AbortController | null>(null);
  const scopedFilters = { ...filters, supplierId: initialSupplierId || filters.supplierId };
  const query = matrixQuery(scopedFilters);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setLoading(true);
    try {
      const result = await rncpRequest<MatrixResult>(`/matrix?part=list&${query}`, { signal: controller.signal });
      if (request !== sequence.current || controller.signal.aborted) return;
      setData(result);
      setError("");
    } catch (error) {
      if (request === sequence.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : "No fue posible actualizar RNCP.");
    } finally { if (request === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 200);
    return () => { window.clearTimeout(timer); abort.current?.abort(); };
  }, [load]);
  // Filters only change which rows are displayed. Counts belong to the authorized
  // directory and are refreshed after explicit reloads or document changes.
  const [countsRevision, setCountsRevision] = useState(0);
  const hasReports = Boolean(data?.sourceCount);
  useEffect(() => {
    if (!hasReports) return;
    const controller = new AbortController();
    rncpRequest<{ counts: Record<string, number> }>("/matrix?part=pdfCounts", { signal: controller.signal })
      .then(({ counts }) => { if (!controller.signal.aborted) setPdfCounts(counts); })
      .catch(() => { if (!controller.signal.aborted) setCountsUnavailable(true); });
    return () => controller.abort();
  }, [hasReports, countsRevision]);
  const refresh = useCallback(async () => {
    setPdfCounts(null);
    setCountsUnavailable(false);
    setCountsRevision(previous => previous + 1);
    await load();
  }, [load]);
  return { data, pdfCounts, countsUnavailable, filters: scopedFilters, setFilters, refresh, loading, error };
}
