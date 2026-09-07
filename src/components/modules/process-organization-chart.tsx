"use client";

import { AlertTriangle, Check, FileSpreadsheet, ImageIcon, LoaderCircle, Network, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProcessCatalogItem } from "@/lib/configuration-data";
import type { DocumentPermissions } from "@/lib/document-control-data";
import { documentValidatorByProcess } from "@/lib/document-data";
import { computeHierarchyLevels, type OrganizationChartDraft } from "@/lib/organization-chart-data";
import {
  interpretProcessOrganizationChart,
  type OrganizationImportItem,
  type ProcessOrganizationSource,
  uploadProcessOrganizationChart,
} from "@/lib/organization-chart-storage";
import type { OrganizationPosition } from "@/lib/organization-data";
import { normalizePositionName } from "@/lib/organization-position-data";
import { createClient } from "@/lib/supabase/client";

type PositionRow = { id: string; name: string; level: number; parent_id: string | null; branch: string };
type ReviewPosition = {
  clientId: string;
  name: string;
  branch: string;
  level: number;
  parentRef: string;
  include: boolean;
};

export function ProcessOrganizationChart({
  process,
  permissions,
  source,
  onSaved,
}: {
  process: ProcessCatalogItem;
  permissions: DocumentPermissions;
  source?: ProcessOrganizationSource;
  onSaved: () => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<OrganizationChartDraft | null>(null);
  const [rows, setRows] = useState<ReviewPosition[]>([]);
  const [positions, setPositions] = useState<OrganizationPosition[]>([]);
  const [interpreting, setInterpreting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const ownerPositionId = documentValidatorByProcess[process.id]?.positionId ?? "PU-01";

  useEffect(() => {
    let active = true;
    void createClient().from("positions").select("id,name,level,parent_id,branch").order("id").then((result) => {
      if (!active || result.error) return;
      const loaded = (result.data as PositionRow[]).map((row) => ({ id: row.id, name: row.name, level: row.level, parentId: row.parent_id ?? undefined, branch: row.branch, processLinks: [] }));
      setPositions(computeHierarchyLevels(loaded));
    });
    return () => { active = false; };
  }, []);

  const parentOptions = useMemo(() => [...positions].sort((left, right) => left.level - right.level || left.id.localeCompare(right.id)), [positions]);

  async function selectFile(selectedFile: File) {
    setFile(selectedFile); setFeedback(""); setInterpreting(true);
    try {
      const interpreted = await interpretProcessOrganizationChart(selectedFile, process.name);
      setDraft(interpreted);
      setRows(buildReviewRows(interpreted, positions, ownerPositionId, process.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible interpretar el organigrama.";
      const fallback: OrganizationChartDraft = { sourceName: selectedFile.name, positions: [], confidence: 0, warnings: [message, "El archivo todavía puede guardarse; agrega o confirma los puestos manualmente."] };
      setDraft(fallback);
      setRows([emptyReviewRow(process.name, ownerPositionId, positions.find((position) => position.id === ownerPositionId)?.level ?? 4)]);
    } finally { setInterpreting(false); }
  }

  function updateRow(clientId: string, update: Partial<ReviewPosition>) {
    setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, ...update } : row));
  }

  async function save() {
    if (!file) return;
    setSaving(true); setFeedback("");
    const selectedRows = rows.filter((row) => row.include && row.name.trim());
    const items: OrganizationImportItem[] = selectedRows.map((row) => ({
      clientId: row.clientId,
      name: normalizePositionName(row.name),
      branch: row.branch.trim() || process.name,
      ...(row.parentRef.startsWith("draft:")
        ? { parentClientId: row.parentRef.slice(6) }
        : row.parentRef ? { parentId: row.parentRef } : {}),
      processId: process.id,
      relationship: "participant",
    }));
    try {
      const result = await uploadProcessOrganizationChart({ file, processId: process.id, items });
      setFeedback(`Organigrama guardado. ${result.created.length} puesto${result.created.length === 1 ? "" : "s"} nuevo${result.created.length === 1 ? "" : "s"} integrado${result.created.length === 1 ? "" : "s"}${result.skipped.length ? `; ${result.skipped.length} ya existían o requieren revisión` : ""}.`);
      setDraft(null); setFile(null); setRows([]);
      await onSaved();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No fue posible guardar el organigrama.");
    } finally { setSaving(false); }
  }

  return <>
    <section className="documents-detail-section department-chart-section">
      <div className="section-title-row">
        <h4>Organigrama del departamento</h4>
        <span className={source ? "quality-state success" : "pending-badge"}>{source ? "Interpretado" : "Pendiente por subir"}</span>
      </div>
      <div className={`department-chart-placeholder ${source ? "department-chart-ready" : ""}`}>
        <div className="department-chart-flow" aria-hidden="true"><span /><i /><span /><i /><span /></div>
        <div><strong>{source ? source.fileName : "Organigrama vertical"}</strong><p>{process.name}{source ? ` · ${formatDate(source.createdAt)} · ${source.interpretedCount} puestos revisados` : ""}</p></div>
        {permissions.upload ? <label className={`button button-secondary file-button ${interpreting ? "disabled" : ""}`}>
          {interpreting ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} {interpreting ? "Interpretando…" : source ? "Actualizar organigrama" : "Subir organigrama"}
          <input accept=".xlsx,.xlsm,image/jpeg,image/png,image/webp" disabled={interpreting} type="file" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void selectFile(selected); event.currentTarget.value = ""; }} />
        </label> : <span className="organization-readonly-note">Consulta de organigrama</span>}
      </div>
      {feedback ? <p className="organization-import-feedback" role="status">{feedback}</p> : null}
    </section>

    {draft && file ? <div className="organization-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}>
      <section className="organization-import-dialog" role="dialog" aria-modal="true" aria-labelledby="organization-import-title">
        <header><span className="organization-import-icon">{file.type.startsWith("image/") ? <ImageIcon size={20} /> : <FileSpreadsheet size={20} />}</span><div><small>Interpretación previa</small><h3 id="organization-import-title">{file.name}</h3><p>{process.id} · {process.name} · Confianza {Math.round(draft.confidence * 100)}%</p></div><button type="button" disabled={saving} onClick={() => setDraft(null)} aria-label="Cerrar"><X size={18} /></button></header>
        <div className="organization-import-warnings">{draft.warnings.map((warning) => <span key={warning}><AlertTriangle size={14} />{warning}</span>)}</div>
        <div className="organization-import-summary"><span><Network size={16} /><strong>{rows.filter((row) => row.include).length}</strong> puestos por integrar</span><button className="button button-secondary" type="button" onClick={() => { const parent = positions.find((position) => position.id === ownerPositionId); setRows((current) => [...current, emptyReviewRow(process.name, ownerPositionId, parent?.level ?? 4)]); }}><Plus size={15} /> Agregar puesto</button></div>
        <div className="organization-import-table-wrap"><table className="organization-import-table"><thead><tr><th>Agregar</th><th>Puesto</th><th>Área</th><th>Nivel calculado</th><th>Reporta a</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.clientId} className={row.include ? "selected" : ""}><td><input checked={row.include} onChange={(event) => updateRow(row.clientId, { include: event.target.checked })} type="checkbox" aria-label={`Integrar ${row.name || "puesto"}`} /></td><td><input value={row.name} onChange={(event) => updateRow(row.clientId, { name: event.target.value })} placeholder="Nombre del puesto" /></td><td><input value={row.branch} onChange={(event) => updateRow(row.clientId, { branch: event.target.value })} placeholder="Área" /></td><td><span className="organization-import-level">Nivel {row.level}</span></td><td><select value={row.parentRef} onChange={(event) => { const parentRef = event.target.value; const parent = parentRef.startsWith("draft:") ? rows.find((candidate) => candidate.clientId === parentRef.slice(6)) : positions.find((position) => position.id === parentRef); updateRow(row.clientId, { parentRef, level: parent ? parent.level + 1 : 1 }); }}><option value="">Máxima autoridad</option>{parentOptions.map((position) => <option key={position.id} value={position.id}>N{position.level} · {position.id} · {position.name}</option>)}{rows.filter((candidate) => candidate.clientId !== row.clientId && candidate.level < row.level && candidate.name.trim()).map((candidate) => <option key={candidate.clientId} value={`draft:${candidate.clientId}`}>Detectado · {candidate.name}</option>)}</select></td><td><button className="icon-button" type="button" onClick={() => setRows((current) => current.filter((candidate) => candidate.clientId !== row.clientId))} aria-label="Quitar puesto"><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
        <footer><button className="button button-secondary" disabled={saving} type="button" onClick={() => setDraft(null)}>Cancelar</button><button className="button button-primary" disabled={saving} type="button" onClick={() => void save()}><Check size={15} /> {saving ? "Guardando e integrando…" : "Guardar e integrar puestos"}</button></footer>
      </section>
    </div> : null}
  </>;
}

function buildReviewRows(draft: OrganizationChartDraft, positions: OrganizationPosition[], ownerPositionId: string, processName: string): ReviewPosition[] {
  const existingByName = new Map(positions.map((position) => [normalize(position.name), position.id]));
  const detectedByName = new Map(draft.positions.map((position) => [normalize(position.name), position.clientId]));
  const rows = draft.positions.map((position) => {
    const existingParent = position.parentName ? existingByName.get(normalize(position.parentName)) : undefined;
    const detectedParent = position.parentName ? detectedByName.get(normalize(position.parentName)) : undefined;
    const inferredParent = positions.find((candidate) => candidate.level === position.level - 1 && normalize(candidate.branch) === normalize(position.branch || processName));
    const parentRef = existingParent || (detectedParent ? `draft:${detectedParent}` : inferredParent?.id || ownerPositionId);
    const parentLevel = parentRef.startsWith("draft:")
      ? draft.positions.find((candidate) => candidate.clientId === parentRef.slice(6))?.level
      : positions.find((candidate) => candidate.id === parentRef)?.level;
    return {
      clientId: position.clientId,
      name: position.name,
      branch: position.branch || processName,
      level: parentLevel ? parentLevel + 1 : position.level,
      parentRef,
      include: position.level > 4 && !existingByName.has(normalize(position.name)),
    };
  });
  const ownerLevel = positions.find((position) => position.id === ownerPositionId)?.level ?? 4;
  return rows.length ? rows : [emptyReviewRow(processName, ownerPositionId, ownerLevel)];
}

function emptyReviewRow(branch: string, parentRef: string, parentLevel: number): ReviewPosition {
  return { clientId: `manual-${crypto.randomUUID()}`, name: "", branch, level: parentLevel + 1, parentRef, include: true };
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
