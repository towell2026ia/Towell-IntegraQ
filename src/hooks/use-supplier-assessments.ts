"use client";

import { useCallback, useEffect, useState } from "react";
import { loadSupplierAssessments, type SupplierAssessment } from "@/lib/supplier-assessment-data";

export function useSupplierAssessments(enabled = true) {
  const [assessments, setAssessments] = useState<SupplierAssessment[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!enabled) return [];
    setLoading(true); setError("");
    try { const result = await loadSupplierAssessments(); setAssessments(result.assessments); return result.assessments; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible consultar evaluaciones."); return []; }
    finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { if (!enabled) return; void Promise.resolve().then(refresh); const onFocus = () => void refresh(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [enabled, refresh]);
  return { assessments, loading, error, refresh };
}
