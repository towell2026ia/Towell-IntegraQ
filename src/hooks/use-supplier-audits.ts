"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuditData } from "@/lib/supplier-audits/client";
import type { AuditWorkspace } from "@/lib/supplier-audits/model";
export function useSupplierAudits(identity: string, enabled = true) {
  const [data, setData] = useState<AuditWorkspace | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(enabled);
  const [loadedFor, setLoadedFor] = useState("");
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError("");
    try { const result = await loadAuditData(controller.signal); if (!controller.signal.aborted) { setData(result); setLoadedFor(identity); } }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron consultar auditorías."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [enabled, identity]);
  useEffect(() => { void Promise.resolve().then(() => { setData(null); return refresh(); }); return () => pending.current?.abort(); }, [refresh, identity]);
  return { data: loadedFor === identity ? data : null, error, loading, refresh };
}
export type SupplierAuditDirectory = ReturnType<typeof useSupplierAudits>;
