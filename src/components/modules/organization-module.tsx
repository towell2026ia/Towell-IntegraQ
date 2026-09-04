"use client";

import { Building2, Check, ChevronRight, FileCheck2, Network, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRound, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { processCatalog } from "@/lib/configuration-data";
import { computeHierarchyLevels } from "@/lib/organization-chart-data";
import { type OrganizationPosition, organizationPositions as fallbackPositions, processRelationshipLabels, type ProcessRelationship } from "@/lib/organization-data";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { createClient } from "@/lib/supabase/client";

type PositionRow = { id: string; name: string; level: number; parent_id: string | null; branch: string };
type PermissionRow = { position_id: string; process_id: string; relationship: ProcessRelationship };
type EditorMode = "create" | "edit" | null;
const source = { name: "F-SGC-33 Organigrama General", version: "0", revisedAt: "22/11/2024" };

export function OrganizationModule({ session }: { session: ActiveSession }) {
  const [positions, setPositions] = useState<OrganizationPosition[]>(fallbackPositions);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState("PU-01");
  const [view, setView] = useState<"chart" | "list">("chart");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [processSourceCount, setProcessSourceCount] = useState(0);
  const canManage = isAdministrator(session);

  const loadPositions = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [positionResult, permissionResult, sourceResult] = await Promise.all([
        supabase.from("positions").select("id,name,level,parent_id,branch").order("id"),
        supabase.from("position_process_permissions").select("position_id,process_id,relationship"),
        supabase.from("file_objects").select("process_id").eq("resource_type", "process_organization_chart"),
      ]);
      if (positionResult.error) throw positionResult.error;
      if (permissionResult.error) throw permissionResult.error;
      const links = (permissionResult.data as PermissionRow[]).reduce<Record<string, OrganizationPosition["processLinks"]>>((result, row) => {
        (result[row.position_id] ??= []).push({ processId: row.process_id, relationship: row.relationship });
        return result;
      }, {});
      const loaded = (positionResult.data as PositionRow[]).map((row) => ({ id: row.id, name: row.name, level: row.level, parentId: row.parent_id ?? undefined, branch: row.branch, processLinks: links[row.id] ?? [] }));
      if (loaded.length) setPositions(computeHierarchyLevels(loaded));
      if (!sourceResult.error) setProcessSourceCount(new Set((sourceResult.data ?? []).map((item) => item.process_id).filter(Boolean)).size);
    } catch {
      setPositions(fallbackPositions);
      setFeedback("Vista local activa; no fue posible sincronizar con Supabase.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void Promise.resolve().then(loadPositions); }, [loadPositions]);

  const availableLevels = useMemo(() => [...new Set(positions.map((position) => position.level))].sort((a, b) => a - b), [positions]);
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
    setSaving(true); setFeedback("");
    const name = String(formData.get("name") ?? "").trim();
    const branch = String(formData.get("branch") ?? "").trim();
    const parentId = String(formData.get("parentId") ?? "") || undefined;
    try {
      if (editorMode === "edit" && selected) {
        const response = await fetch("/api/organization/positions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, name, branch, parentId: parentId ?? null }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible editar el puesto.");
        setFeedback("Puesto actualizado. La jerarquía y sus niveles se recalcularon.");
      } else {
        const processId = String(formData.get("processId") ?? "") || undefined;
        const relationship = String(formData.get("relationship") ?? "participant") as ProcessRelationship;
        const response = await fetch("/api/organization/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "manual", items: [{ clientId: crypto.randomUUID(), name, branch, parentId, processId, relationship }] }) });
        const payload = await response.json() as { created?: Array<{ id: string }>; error?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible crear el puesto.");
        if (payload.created?.[0]) setSelectedId(payload.created[0].id);
        setFeedback("Nuevo puesto agregado al organigrama y conectado con su proceso.");
      }
      setEditorMode(null);
      await loadPositions();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No fue posible guardar el puesto.");
    } finally { setSaving(false); }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(`¿Eliminar ${selected.id} · ${selected.name}?`)) return;
    setSaving(true); setFeedback("");
    try {
      const response = await fetch(`/api/organization/positions?id=${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible eliminar el puesto.");
      setSelectedId(selected.parentId ?? "PU-01");
      setFeedback("Puesto eliminado del organigrama.");
      await loadPositions();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No fue posible eliminar el puesto.");
    } finally { setSaving(false); }
  }

  return <>
    <section className="module-heading"><div><p className="module-kicker">Estructura organizacional</p><h2>Organización y puestos</h2><p>Organigrama vivo conectado con puestos, procesos y permisos, sin límite visual de cuatro niveles.</p></div>{canManage ? <button className="button button-primary" type="button" onClick={() => setEditorMode("create")}><Plus size={16} /> Nuevo puesto</button> : <span className="module-state module-state-vigente">Fuente vigente</span>}</section>
    <section className="metric-grid" aria-label="Resumen del organigrama"><OrganizationMetric icon={<Users size={18} />} label="Puestos" value={positions.length} tone="neutral" /><OrganizationMetric icon={<Network size={18} />} label="Niveles" value={levels} tone="success" /><OrganizationMetric icon={<ShieldCheck size={18} />} label="Procesos con responsable" value={ownerProcessIds.size} tone="warning" /><OrganizationMetric icon={<Building2 size={18} />} label="Puestos sin proceso" value={positionsWithoutProcess} tone="danger" /></section>
    <section className="organization-source" aria-label="Fuente del organigrama"><span><FileCheck2 size={19} /></span><div><small>Fuentes documentales</small><strong>{source.name} · Versión {source.version}</strong><p>Revisión {source.revisedAt} · {processSourceCount} organigramas de proceso · {positions.length} puestos integrados</p></div><span className={`organization-sync ${loading ? "organization-sync-loading" : ""}`}><RefreshCw size={13} />{loading ? "Sincronizando" : "Supabase"}</span></section>
    {feedback ? <div className="organization-feedback" role="status">{feedback}</div> : null}
    <section className="organization-workspace">
      <div className="organization-view-toolbar"><div className="organization-view-switch" aria-label="Cambiar vista"><button className={view === "chart" ? "active" : ""} onClick={() => setView("chart")} type="button"><Network size={14} /> Organigrama</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} type="button"><Users size={14} /> Lista</button></div><label className="panel-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar puesto" /></label><select aria-label="Filtrar por nivel jerárquico" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">Todos los niveles</option>{availableLevels.map((item) => <option key={item} value={item}>Nivel {item}</option>)}</select></div>
      {view === "chart" ? <div className="organization-chart-scroll"><div className="organization-chart" aria-label="Organigrama interactivo">{availableLevels.map((currentLevel) => { const items = filtered.filter((position) => position.level === currentLevel); return items.length ? <div className="organization-chart-level" key={currentLevel}><div className="organization-chart-level-label">Nivel {currentLevel}</div><div className="organization-chart-nodes">{items.map((position) => <button className={`organization-node ${currentLevel <= 4 ? `organization-node-${currentLevel}` : "organization-node-deep"} ${selected?.id === position.id ? "selected" : ""}`} key={position.id} onClick={() => setSelectedId(position.id)} type="button"><span>{position.id}</span><strong>{position.name}</strong><small>{position.branch}</small></button>)}</div></div> : null; })}</div></div> : <div className="organization-list organization-list-wide">{filtered.map((position) => <button className={`organization-row ${position.id === selected?.id ? "organization-row-selected" : ""}`} key={position.id} type="button" onClick={() => setSelectedId(position.id)}><span className="organization-level">N{position.level}</span><span className="organization-row-copy"><strong>{position.name}</strong><small>{position.branch} · {position.id}</small></span><span className="organization-link-count">{position.processLinks.length}</span><ChevronRight size={15} /></button>)}</div>}
      {selected ? <div className="organization-live-detail"><header><span className="detail-eyebrow"><UserRound size={14} /> {selected.id}</span>{canManage ? <div className="organization-detail-actions"><button className="button button-secondary" type="button" onClick={() => setEditorMode("edit")}><Pencil size={14} /> Editar</button><button className="button button-danger" disabled={saving} type="button" onClick={() => void deleteSelected()}><Trash2 size={14} /> Eliminar</button></div> : null}<h3>{selected.name}</h3><div className="detail-status-row"><span className="status-badge status-open">Nivel {selected.level}</span><span className="scope-badge">{selected.branch}</span></div></header><div className="organization-facts"><div><small>Reporta a</small><strong>{parent?.name ?? "Máxima autoridad"}</strong></div><div><small>Reportes directos</small><strong>{reports.length}</strong></div><div><small>Procesos vinculados</small><strong>{selected.processLinks.length}</strong></div></div><div className="organization-live-columns"><section className="organization-section"><div className="section-title-row"><h4>Permisos desde procesos</h4><span className="count-badge">{selected.processLinks.length}</span></div>{selected.processLinks.length ? <div className="position-process-list">{selected.processLinks.map((link) => { const process = processCatalog.find((item) => item.id === link.processId); return <div key={`${link.processId}-${link.relationship}`}><span><strong>{link.processId}</strong><small>{process?.name ?? "Proceso por confirmar"}</small></span><span className={`relationship-badge relationship-${link.relationship}`}>{processRelationshipLabels[link.relationship]}</span></div>; })}</div> : <div className="organization-gap"><ShieldCheck size={18} /><span><strong>Sin proceso directo</strong><small>Este puesto requiere asignación para derivar permisos.</small></span></div>}</section><section className="organization-section"><div className="section-title-row"><h4>Reportes directos</h4><span className="count-badge">{reports.length}</span></div><div className="direct-reports-list">{reports.length ? reports.map((report) => <button key={report.id} type="button" onClick={() => setSelectedId(report.id)}><span className="organization-level">N{report.level}</span><span><strong>{report.name}</strong><small>{report.id}</small></span><ChevronRight size={15} /></button>) : <p className="organization-empty-copy">Este puesto no tiene reportes directos.</p>}</div></section></div></div> : null}
    </section>
    {editorMode ? <PositionEditor mode={editorMode} selected={selected} positions={positions} saving={saving} onClose={() => setEditorMode(null)} onSave={savePosition} /> : null}
  </>;
}

function PositionEditor({ mode, selected, positions, saving, onClose, onSave }: { mode: Exclude<EditorMode, null>; selected?: OrganizationPosition; positions: OrganizationPosition[]; saving: boolean; onClose: () => void; onSave: (data: FormData) => Promise<void> }) {
  const defaultParent = mode === "edit" ? selected?.parentId : selected?.id;
  return <div className="organization-modal-backdrop" role="presentation"><form className="organization-modal" action={onSave}><header><div><small>{mode === "create" ? "Nuevo puesto" : "Editar puesto"}</small><h3>{mode === "create" ? "Agregar a la organización" : `${selected?.id} · ${selected?.name}`}</h3></div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></header><label>Nombre del puesto<input name="name" defaultValue={mode === "edit" ? selected?.name : ""} placeholder="Ej. Supervisor de Producción" required /></label><label>Área o rama<input name="branch" defaultValue={selected?.branch ?? ""} placeholder="Ej. Operaciones" required /></label><label>Reporta a<select name="parentId" defaultValue={defaultParent ?? ""}><option value="">Máxima autoridad</option>{positions.filter((position) => position.id !== selected?.id).sort((left, right) => left.level - right.level).map((position) => <option key={position.id} value={position.id}>N{position.level} · {position.id} · {position.name}</option>)}</select></label>{mode === "create" ? <><label>Proceso vinculado<select name="processId" defaultValue={selected?.processLinks[0]?.processId ?? ""}><option value="">Sin proceso directo</option>{processCatalog.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label>Relación con el proceso<select name="relationship" defaultValue="participant"><option value="participant">Participante</option><option value="support">Soporte</option><option value="owner">Responsable</option><option value="approver">Aprobador</option></select></label></> : null}<p><ShieldCheck size={15} /> El nivel se calcula automáticamente según el puesto superior; se permiten niveles 5 en adelante.</p><footer><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving} type="submit"><Check size={14} /> {saving ? "Guardando…" : mode === "create" ? "Crear puesto" : "Guardar cambios"}</button></footer></form></div>;
}

function OrganizationMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}
