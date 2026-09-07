"use client";

import { Download, History, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ActivityRow = { id: string; user_name_snapshot?: string; actor_id?: string; module?: string; action: string; resource_type: string; resource_id?: string; entity_code_snapshot?: string; origin?: string; reason?: string; created_at: string };

export function ActivityLogModule() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (selectedModule = moduleFilter) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/activity${selectedModule ? `?module=${encodeURIComponent(selectedModule)}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as { activity?: ActivityRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible consultar la bitácora.");
      setRows(payload.activity ?? []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No fue posible consultar la bitácora."); }
    finally { setLoading(false); }
  }, [moduleFilter]);
  useEffect(() => {
    let active = true;
    fetch("/api/activity", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as { activity?: ActivityRow[]; error?: string } }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) throw new Error(payload.error ?? "No fue posible consultar la bitácora.");
        setRows(payload.activity ?? []);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible consultar la bitácora."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const visible = rows.filter((row) => [row.user_name_snapshot, row.actor_id, row.module, row.action, row.resource_type, row.resource_id, row.entity_code_snapshot, row.origin, row.reason].some((value) => value?.toLocaleLowerCase("es-MX").includes(query.toLocaleLowerCase("es-MX"))));
  const exportHref = (format: "csv" | "xlsx") => `/api/activity?format=${format}${moduleFilter ? `&module=${encodeURIComponent(moduleFilter)}` : ""}`;
  return <section className="activity-log-module">
    <header className="activity-log-heading"><div><span className="module-kicker">Administración</span><h2>Bitácora de actividad</h2><p>Historial inmutable de operaciones críticas, aprobaciones y excepciones.</p></div><History size={28} /></header>
    <div className="activity-log-toolbar">
      <label className="panel-search"><Search size={16} /><input aria-label="Buscar actividad" onChange={(event) => setQuery(event.target.value)} placeholder="Usuario, acción, entidad o motivo" value={query} /></label>
      <select aria-label="Filtrar módulo" onChange={(event) => { setModuleFilter(event.target.value); void load(event.target.value); }} value={moduleFilter}><option value="">Todos los módulos</option><option value="documents">Documentos</option><option value="risks">Riesgos</option><option value="audits">Auditorías</option><option value="corrective_actions">Acciones correctivas</option><option value="metrology">Metrología</option><option value="organization">Organización</option><option value="approval">Aprobaciones</option></select>
      <button className="button button-secondary" onClick={() => void load()} type="button"><RefreshCw size={16} />Actualizar</button>
      <a className="button button-secondary" href={exportHref("csv")}><Download size={16} />CSV</a>
      <a className="button button-primary" href={exportHref("xlsx")}><Download size={16} />Excel</a>
    </div>
    {error ? <div className="activity-log-message error">{error}</div> : null}
    <div className="data-table-wrap"><table className="data-table activity-log-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th><th>Origen</th><th>Motivo</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}</td><td>{row.user_name_snapshot ?? row.actor_id ?? "Sistema"}</td><td>{row.module ?? row.action.split(".")[0]}</td><td><code>{row.action}</code></td><td><strong>{row.entity_code_snapshot ?? row.resource_id ?? "—"}</strong><small>{row.resource_type}</small></td><td>{row.origin ?? "human"}</td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table>{!loading && !visible.length ? <div className="activity-log-message">No hay actividades para los filtros seleccionados.</div> : null}{loading ? <div className="activity-log-message">Cargando bitácora…</div> : null}</div>
  </section>;
}
