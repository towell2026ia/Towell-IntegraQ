"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matrixQuery, rncpRequest, type MatrixResult } from "@/lib/rncp/client";
import { emptyMatrixFilters, type MatrixFilters } from "@/lib/rncp/model";
import { buildMatrixDashboard, matchesFilters } from "@/lib/rncp/analytics";
import { generateSupplierAlerts } from "@/lib/rncp/alerts";
import { selectedAlertPeriod } from "@/lib/rncp/alert-period";

type Alerts = Pick<MatrixResult, "alerts" | "aiStatus">;
type Counts = Record<string, number>;
type Entry = { scope: string; base: MatrixResult; loadedAt: number };
export class MatrixListCache {
  private entry: Entry | null = null;
  private countRequest?: Promise<Counts>;
  private counts?: Counts;
  countsFor(entry: Entry) { return this.entry === entry ? this.counts : undefined; }
  loadCounts(entry: Entry) {
    if (this.entry !== entry) return Promise.reject(new Error("La consulta cambió."));
    if (this.countRequest) return this.countRequest;
    const request = rncpRequest<{ counts: Counts }>("/matrix?part=pdfCounts")
      .then(({ counts }) => { if (this.entry === entry) this.counts = counts; return counts; })
      .catch(error => { if (this.entry === entry) this.countRequest = undefined; throw error; });
    this.countRequest = request;
    return request;
  }
  get(scope: string) { return this.entry?.scope === scope ? this.entry : null; }
  put(entry: Entry) { this.clear(); this.entry = entry; }
  clear() { this.entry = null; this.counts = undefined; this.countRequest = undefined; }
}

export function filterMatrix(base: MatrixResult, filters: MatrixFilters) {
  if (matrixQuery(base.filters) === matrixQuery(filters)) return { result: base, needsAlerts: false };
  const dashboard = buildMatrixDashboard(base.reports, filters, base.now);
  const dateFree = { ...filters, year: "", month: "", day: "", from: "", to: "" };
  const candidates = base.reports.filter(report => matchesFilters(report, dateFree, base.now));
  const range = selectedAlertPeriod(filters, dashboard.reports, base.now);
  const rules = generateSupplierAlerts(candidates, base.now, base.settings.alertRules, {}, range);
  const signed = new Map(base.alerts.map(alert => [alert.key, alert]));
  const needsAlerts = (base.aiConfigured && base.settings.semanticAiApproved) || rules.some(alert => !signed.has(alert.key));
  const alerts = needsAlerts ? [] : rules.map(alert => ({ ...alert, review: signed.get(alert.key)?.review, reviewToken: signed.get(alert.key)?.reviewToken }));
  return { result: { ...base, ...dashboard, alerts, aiStatus: base.aiStatus, deletedReports: base.deletedReports,
    options: base.options, sourceCount: base.sourceCount }, needsAlerts };
}

export function useRncpMatrix(cache: MatrixListCache, initialSupplierId = "") {
  const [filters, changeFilters] = useState({ ...emptyMatrixFilters, supplierId: initialSupplierId });
  const scopedFilters = useMemo(() => ({ ...filters, supplierId: initialSupplierId || filters.supplierId }), [filters, initialSupplierId]);
  const activeRequest = useRef<AbortController | null>(null);
  const [entry, setEntry] = useState(() => { const stored = cache.get(initialSupplierId); return stored && Date.now() - stored.loadedAt < 60_000 ? stored : null; });
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<{ entry: Entry; values?: Counts } | null>(null);
  const [remote, setRemote] = useState<{ view: MatrixResult; alerts?: Alerts } | null>(null);
  const current = entry && entry === cache.get(initialSupplierId) && entry.scope === initialSupplierId ? entry : null;
  const load = useCallback(async (signal: AbortSignal) => {
    const stored = cache.get(initialSupplierId);
    if (stored && stored.scope === initialSupplierId && Date.now() - stored.loadedAt < 60_000) {
      setEntry(stored); return;
    }
    const base = await rncpRequest<MatrixResult>("/matrix?part=list&" + matrixQuery({ ...emptyMatrixFilters, supplierId: initialSupplierId }), { signal });
    if (signal.aborted) return;
    const next = { base, scope: initialSupplierId, loadedAt: Date.now() };
    cache.put(next); setEntry(next); setError("");
  }, [cache, initialSupplierId]);
  const requestList = useCallback(async (invalidate: boolean) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (invalidate) { cache.clear(); setEntry(null); }
    try {
      await load(controller.signal);
    } catch {
      if (!controller.signal.aborted) { cache.clear(); setEntry(null); setError("No se pudo consultar el dashboard."); }
    }
  }, [cache, load]);
  const refresh = useCallback(() => requestList(true), [requestList]);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void requestList(false); });
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mounted = false; document.removeEventListener("visibilitychange", onVisible); activeRequest.current?.abort(); };
  }, [refresh, requestList]);
  const setFilters = (next: Parameters<typeof changeFilters>[0]) => {
    if (current && Date.now() - current.loadedAt >= 60_000) void refresh();
    changeFilters(next);
  };
  const view = useMemo(() => current ? filterMatrix(current.base, scopedFilters) : null, [current, scopedFilters]);
  useEffect(() => {
    if (!current || cache.countsFor(current) || !current.base.sourceCount) return;
    let active = true;
    cache.loadCounts(current)
      .then(values => { if (active) setCounts({ entry: current, values }); })
      .catch(() => { if (active) setCounts({ entry: current }); });
    return () => { active = false; };
  }, [cache, current]);
  useEffect(() => {
    if (!view?.needsAlerts) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      rncpRequest<Alerts>("/matrix?part=alerts&" + matrixQuery(view.result.filters), { signal: controller.signal })
        .then(alerts => { if (!controller.signal.aborted) setRemote({ view: view.result, alerts }); })
        .catch(() => { if (!controller.signal.aborted) setRemote({ view: view.result }); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [view]);
  const resolved = remote?.view === view?.result ? remote : null;
  const data = useMemo(() => view ? (resolved?.alerts ? { ...view.result, ...resolved.alerts } : view.result) : null, [resolved, view]);
  return { data, filters: scopedFilters, setFilters, refresh, error, loading: !data && !error,
    pdfCounts: current ? cache.countsFor(current) ?? null : null, countsUnavailable: Boolean(current && counts?.entry === current && !counts.values),
    alertsPending: Boolean(view?.needsAlerts && !resolved), alertsError: Boolean(resolved && !resolved.alerts) };
}
