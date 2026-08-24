"use client";

import { Building2, Check, ChevronRight, FileCheck2, Network, Pencil, RefreshCw, Search, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { processCatalog } from "@/lib/configuration-data";
import { OrganizationPosition, organizationPositions as fallbackPositions, processRelationshipLabels } from "@/lib/organization-data";
import { createClient } from "@/lib/supabase/client";

type PositionRow = { id: string; name: string; level: number; parent_id: string | null; branch: string };
type PermissionRow = { position_id: string; process_id: string; relationship: OrganizationPosition["processLinks"][number]["relationship"] };
const source = { name: "F-SGC-33 Organigrama General", version: "0", revisedAt: "22/11/2024" };

export function OrganizationModule() {
  const [positions, setPositions] = useState<OrganizationPosition[]>(fallbackPositions);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState("PU-01");
  const [view, setView] = useState<"chart" | "list">("chart");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const loadPositions = useCallback(async () => {
    try {
      const supabase = createClient();
      const [positionResult, permissionResult] = await Promise.all([
        supabase.from("positions").select("id,name,level,parent_id,branch").order("id"),
        supabase.from("position_process_permissions").select("position_id,process_id,relationship"),
      ]);
      if (positionResult.error) throw positionResult.error;
      if (permissionResult.error) throw permissionResult.error;
      const links = (permissionResult.data as PermissionRow[]).reduce<Record<string, OrganizationPosition["processLinks"]>>((result, row) => {
        (result[row.position_id] ??= []).push({ processId: row.process_id, relationship: row.relationship }); return result;
      }, {});
      const loaded = (positionResult.data as PositionRow[]).map((row) => ({ id: row.id, name: row.name, level: row.level as OrganizationPosition["level"], parentId: row.parent_id ?? undefined, branch: row.branch, processLinks: links[row.id] ?? [] }));
      if (loaded.length) setPositions(loaded);
    } catch { setPositions(fallbackPositions); setFeedback("Vista local activa; no fue posible sincronizar con Supabase."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadPositions); }, [loadPositions]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return positions.filter((position) => (!normalized || [position.id, position.name, position.branch].some((value) => value.toLocaleLowerCase("es").includes(normalized))) && (level === "all" || position.level === Number(level)));
  }, [level, positions, query]);
  const selected = positions.find((position) => position.id === selectedId) ?? positions[0];
  const parent = positions.find((position) => position.id === selected?.parentId);
  const reports = positions.filter((position) => position.parentId === selected?.id);
  const levels = Math.max(...positions.map((position) => position.level), 0);
  const ownerProcessIds = new Set(positions.flatMap((position) => position.processLinks.filter((link) => link.relationship === "owner").map((link) => link.processId)));
  const positionsWithoutProcess = positions.filter((position) => position.processLinks.length === 0).length;

  async function savePosition(formData: FormData) {
    if (!selected) return;
    setSaving(true); setFeedback("");
    const parentId = String(formData.get("parentId") ?? "") || null;
    const newParent = positions.find((position) => position.id === parentId);
    const update = { name: String(formData.get("name") ?? selected.name).trim(), branch: String(formData.get("branch") ?? selected.branch).trim(), parent_id: parentId, level: newParent ? Math.min(newParent.level + 1, 4) : 1 };
    try {
      const { error } = await createClient().from("positions").update(update).eq("id", selected.id);
      if (error) throw error;
      setPositions((current) => current.map((position) => position.id === selected.id ? { ...position, name: update.name, branch: update.branch, parentId: update.parent_id ?? undefined, level: update.level as OrganizationPosition["level"] } : position));
      setEditing(false); setFeedback("Jerarquía guardada en Supabase. Los permisos heredados usarán esta relación.");
    } catch { setFeedback("No se pudo guardar. La edición del organigrama requiere una cuenta administradora."); }
    finally { setSaving(false); }
  }

  return <>
    <section className="module-heading"><div><p className="module-kicker">Estructura organizacional</p><h2>Organización y puestos</h2><p>Organigrama vivo conectado con puestos, procesos y permisos.</p></div><span className="module-state module-state-vigente">Fuente vigente</span></section>
    <section className="metric-grid" aria-label="Resumen del organigrama"><OrganizationMetric icon={<Users size={18} />} label="Puestos" value={positions.length} tone="neutral" /><OrganizationMetric icon={<Network size={18} />} label="Niveles" value={levels} tone="success" /><OrganizationMetric icon={<ShieldCheck size={18} />} label="Procesos con responsable" value={ownerProcessIds.size} tone="warning" /><OrganizationMetric icon={<Building2 size={18} />} label="Puestos sin proceso" value={positionsWithoutProcess} tone="danger" /></section>
    <section className="organization-source" aria-label="Fuente del organigrama"><span><FileCheck2 size={19} /></span><div><small>Documento fuente</small><strong>{source.name} · Versión {source.version}</strong><p>Fecha de revisión {source.revisedAt} · {positions.length} puestos identificados</p></div><span className={`organization-sync ${loading ? "organization-sync-loading" : ""}`}><RefreshCw size={13} />{loading ? "Sincronizando" : "Supabase"}</span></section>
    {feedback ? <div className="organization-feedback" role="status">{feedback}</div> : null}
    <section className="organization-workspace">
      <div className="organization-view-toolbar"><div className="organization-view-switch" aria-label="Cambiar vista"><button className={view === "chart" ? "active" : ""} onClick={() => setView("chart")} type="button"><Network size={14} /> Organigrama</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} type="button"><Users size={14} /> Lista</button></div><label className="panel-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar puesto" /></label><select aria-label="Filtrar por nivel jerárquico" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">Todos los niveles</option>{[1,2,3,4].map((item) => <option key={item} value={item}>Nivel {item}</option>)}</select></div>
      {view === "chart" ? <div className="organization-chart-scroll"><div className="organization-chart" aria-label="Organigrama interactivo">{[1,2,3,4].map((currentLevel) => { const items = filtered.filter((position) => position.level === currentLevel); return items.length ? <div className="organization-chart-level" key={currentLevel}><div className="organization-chart-level-label">Nivel {currentLevel}</div><div className="organization-chart-nodes">{items.map((position) => <button className={`organization-node organization-node-${currentLevel} ${selected?.id === position.id ? "selected" : ""}`} key={position.id} onClick={() => setSelectedId(position.id)} type="button"><span>{position.id}</span><strong>{position.name}</strong><small>{position.branch}</small></button>)}</div></div> : null; })}</div></div> : <div className="organization-list organization-list-wide">{filtered.map((position) => <button className={`organization-row ${position.id === selected?.id ? "organization-row-selected" : ""}`} key={position.id} type="button" onClick={() => setSelectedId(position.id)}><span className="organization-level">N{position.level}</span><span className="organization-row-copy"><strong>{position.name}</strong><small>{position.branch} · {position.id}</small></span><span className="organization-link-count">{position.processLinks.length}</span><ChevronRight size={15} /></button>)}</div>}
      {selected ? <div className="organization-live-detail"><header><span className="detail-eyebrow"><UserRound size={14} /> {selected.id}</span><button className="button button-secondary" type="button" onClick={() => setEditing(true)}><Pencil size={14} /> Editar</button><h3>{selected.name}</h3><div className="detail-status-row"><span className="status-badge status-open">Nivel {selected.level}</span><span className="scope-badge">{selected.branch}</span></div></header><div className="organization-facts"><div><small>Reporta a</small><strong>{parent?.name ?? "Máxima autoridad"}</strong></div><div><small>Reportes directos</small><strong>{reports.length}</strong></div><div><small>Procesos vinculados</small><strong>{selected.processLinks.length}</strong></div></div><div className="organization-live-columns"><section className="organization-section"><div className="section-title-row"><h4>Permisos desde procesos</h4><span className="count-badge">{selected.processLinks.length}</span></div>{selected.processLinks.length ? <div className="position-process-list">{selected.processLinks.map((link) => { const process = processCatalog.find((item) => item.id === link.processId); return <div key={`${link.processId}-${link.relationship}`}><span><strong>{link.processId}</strong><small>{process?.name ?? "Proceso por confirmar"}</small></span><span className={`relationship-badge relationship-${link.relationship}`}>{processRelationshipLabels[link.relationship]}</span></div>; })}</div> : <div className="organization-gap"><ShieldCheck size={18} /><span><strong>Sin proceso directo</strong><small>Este puesto requiere asignación para derivar permisos.</small></span></div>}</section><section className="organization-section"><div className="section-title-row"><h4>Reportes directos</h4><span className="count-badge">{reports.length}</span></div><div className="direct-reports-list">{reports.length ? reports.map((report) => <button key={report.id} type="button" onClick={() => setSelectedId(report.id)}><span className="organization-level">N{report.level}</span><span><strong>{report.name}</strong><small>{report.id}</small></span><ChevronRight size={15} /></button>) : <p className="organization-empty-copy">Este puesto no tiene reportes directos.</p>}</div></section></div></div> : null}
    </section>
    {editing && selected ? <div className="organization-modal-backdrop" role="presentation"><form className="organization-modal" action={savePosition}><header><div><small>Editar puesto</small><h3>{selected.id} · {selected.name}</h3></div><button type="button" onClick={() => setEditing(false)} aria-label="Cerrar"><X size={18} /></button></header><label>Nombre del puesto<input name="name" defaultValue={selected.name} required /></label><label>Área o rama<input name="branch" defaultValue={selected.branch} required /></label><label>Reporta a<select name="parentId" defaultValue={selected.parentId ?? ""}><option value="">Máxima autoridad</option>{positions.filter((position) => position.id !== selected.id && position.level < 4).map((position) => <option key={position.id} value={position.id}>{position.id} · {position.name}</option>)}</select></label><p><ShieldCheck size={15} /> Esta jerarquía se usa como base de los permisos editables por puesto.</p><footer><button className="button button-secondary" type="button" onClick={() => setEditing(false)}>Cancelar</button><button className="button button-primary" disabled={saving} type="submit"><Check size={14} /> {saving ? "Guardando…" : "Guardar en Supabase"}</button></footer></form></div> : null}
  </>;
}

function OrganizationMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" }) { return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>; }
