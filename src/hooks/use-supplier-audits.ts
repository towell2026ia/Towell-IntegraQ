"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuditData } from "@/lib/supplier-audits/client";
import type { AuditWorkspace } from "@/lib/supplier-audits/model";
export function useSupplierAudits(identity: string, enabled = true) {
  const [data, setData] = useState<AuditWorkspace | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(enabled);
  const [loadedFor, setLoadedFor] = useState("");
  const checked = useRef({ identity: "", at: 0 });
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError("");
    try { const result = await loadAuditData(controller.signal); if (!controller.signal.aborted) { setData(result); setLoadedFor(identity); checked.current = { identity, at: Date.now() }; } }
    catch (cause) { if (!controller.signal.aborted) {
      checked.current = { identity: "", at: 0 };
      setData(null);
      setError(cause instanceof Error ? cause.message : "No se pudieron consultar auditorías.");
    } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [enabled, identity]);
  useEffect(() => {
    if (!enabled || (checked.current.identity === identity && Date.now() - checked.current.at < 60_000)) return;
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; pending.current?.abort(); };
  }, [enabled, identity, refresh]);
  return { data: loadedFor === identity ? data : null, error, loading, refresh };
}
export type SupplierAuditDirectory = ReturnType<typeof useSupplierAudits>;
