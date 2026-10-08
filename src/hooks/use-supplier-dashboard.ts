"use client";

import { useCallback, useEffect, useState } from "react";
import { emptySupplierDashboardFilters, loadSupplierDashboard, type SupplierDashboardFilters, type SupplierDashboardResult } from "@/lib/supplier-dashboard-data";

export function useSupplierDashboard(enabled = true) {
  const [filters, setFilters] = useState<SupplierDashboardFilters>(emptySupplierDashboardFilters);
  const [data, setData] = useState<SupplierDashboardResult | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setLoading(true); setError("");
    try { const result = await loadSupplierDashboard(filters); setData(result); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible consultar el dashboard."); return null; }
    finally { setLoading(false); }
  }, [enabled, filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 180);
    const onFocus = () => void refresh(); window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  return { filters, setFilters, data, loading, error, refresh };
}
