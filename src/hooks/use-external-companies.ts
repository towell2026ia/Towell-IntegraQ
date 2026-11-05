"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listenForBackgroundRefresh, traceContinuity } from "@/lib/workspace-continuity";

import { loadExternalCompanies, type ExternalCompany } from "@/lib/external-company-data";

export function useExternalCompanies() {
  const [companies, setCompanies] = useState<ExternalCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasLoaded,setHasLoaded]=useState(false);
  const loaded=useRef(false);
  const inFlight=useRef<Promise<ExternalCompany[]>|null>(null);

  const refresh = useCallback(() => {
    if(inFlight.current)return inFlight.current;
    if(!loaded.current)setLoading(true);
    traceContinuity("refetch-start","companies");
    const task=(async()=>{
    try {
      const result = await loadExternalCompanies();
      setCompanies(current=>JSON.stringify(current)===JSON.stringify(result.companies)?current:result.companies);
      loaded.current=true;setHasLoaded(true);setError("");
      return result.companies;
    } catch (cause) {
      if([401,403].includes(Number((cause as {status?:number}).status))){loaded.current=false;setHasLoaded(false);setCompanies([]);}
      setError(cause instanceof Error ? cause.message : "No fue posible consultar las empresas externas.");
      return [];
    } finally {
      setLoading(false);
      inFlight.current=null;
      traceContinuity("refetch-end","companies");
    }
    })();
    inFlight.current=task;return task;
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    return listenForBackgroundRefresh("companies",refresh);
  }, [refresh]);

  return { companies, error, loading, hasLoaded, refresh, setCompanies };
}
