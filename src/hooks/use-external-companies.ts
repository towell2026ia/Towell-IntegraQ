"use client";

import { useCallback, useEffect, useState } from "react";

import { loadExternalCompanies, type ExternalCompany } from "@/lib/external-company-data";

export function useExternalCompanies() {
  const [companies, setCompanies] = useState<ExternalCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadExternalCompanies();
      setCompanies(result.companies);
      return result.companies;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible consultar las empresas externas.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const refreshOnFocus = () => { void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refresh]);

  return { companies, error, loading, refresh, setCompanies };
}
