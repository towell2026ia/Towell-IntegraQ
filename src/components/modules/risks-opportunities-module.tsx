"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldAlert,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import { processCatalog } from "@/lib/configuration-data";
import type { ConfiguredIndicator, IndicatorResults } from "@/lib/indicator-data";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { directionCandidateFingerprint, parseDirectionImportRows, type DirectionImportCell } from "@/lib/risk-direction-import";
import {
  buildInitialRiskWorkspace,
  calculateAssessment,
  incorporateContribution,
  riskTabs,
  riskTreatmentCatalog,
  type CrossContribution,
  type DirectionCandidate,
  type DirectionCandidateKind,
  type RiskRecord,
  type RiskTab,
  type RiskWorkspaceState,
  type StrategicAxis,
  type SwotQuadrant,
} from "@/lib/risk-opportunity-data";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";

const tabLabels: Record<RiskTab, string> = {
  summary: "Resumen",
  direction: "Dirección",
  okr: "OKR",
  swot: "FODA por proceso",
  matrix: "Matriz de riesgos y oportunidades",
  actions: "Tratamientos y acciones",
  contributions: "Aportaciones cruzadas",
  settings: "Configuración",
};

const tabIcons = {
  summary: LayoutDashboard,
  direction: GitBranch,
  okr: Target,
  swot: BarChart3,
  matrix: ShieldAlert,
  actions: ListChecks,
  contributions: MessageSquareText,
  settings: Settings2,
} as const;

const quadrantLabels: Record<SwotQuadrant, string> = {
  strength: "Fortalezas",
  opportunity: "Oportunidades",
  weakness: "Debilidades",
  threat: "Amenazas",
};

const masterProcesses = processCatalog.filter((process) => process.level === "process");
const directionKindLabels: Record<DirectionCandidateKind, string> = { pending: "Pendiente", objective: "Objetivo", key_result: "Resultado clave", risk: "Riesgo", opportunity: "Oportunidad", initiative: "Iniciativa", control: "Control", activity: "Actividad" };

interface Props {
  indicators: ConfiguredIndicator[];
  indicatorResults: IndicatorResults;
  onChange: (state: RiskWorkspaceState) => void;
  onActivate: () => Promise<{ state: RiskWorkspaceState; notifiedUsers: number; processCount: number; uncoveredProcessIds: string[] }>;
  onNavigateToIndicators: (indicatorId?: string) => void;
  serverConnected: boolean;
  session: ActiveSession;
  state: RiskWorkspaceState;
}

export function RisksOpportunitiesModule({ indicators, indicatorResults, onActivate, onChange, onNavigateToIndicators, serverConnected, session, state }: Props) {
  const [tab, setTab] = useState<RiskTab>("summary");
  const [processId, setProcessId] = useState(() => accessibleProcesses(session)[0]?.id ?? masterProcesses[0]?.id ?? "P-01");
  const [riskEditorOpen, setRiskEditorOpen] = useState(false);
  const [contributionEditorOpen, setContributionEditorOpen] = useState(false);
  const [activationMessage, setActivationMessage] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activating, setActivating] = useState(false);
  const canEdit = canPerformModuleAction(session, "risks", "update");
  const allowedProcessIds = new Set(accessibleProcesses(session).map((process) => process.id));
  const visibleRisks = state.risks.filter((risk) => isAdministrator(session) || allowedProcessIds.has(risk.processId));
  const critical = visibleRisks.filter((risk) => (risk.latest ?? risk.initial).level === "CRÍTICO").length;
  const overdue = state.actions.filter((action) => action.status !== "completed" && action.dueDate < new Date().toISOString().slice(0, 10) && visibleRisks.some((risk) => risk.id === action.riskId)).length;
  const pendingContributions = state.contributions.filter((item) => item.status === "pending" && (isAdministrator(session) || allowedProcessIds.has(item.targetProcessId))).length;
  const withoutDetection = visibleRisks.filter((risk) => (risk.latest ?? risk.initial).sod === undefined).length;

  return (
    <div className="risk-module">
      <section className="module-heading risk-module-heading">
        <div><p className="module-kicker">Planeación, contexto y control</p><h2>Riesgos y oportunidades</h2><p>Estrategia de Dirección, FODA colaborativo, SO/SOD, tratamientos y eficacia en un solo expediente.</p></div>
        <div className="risk-heading-meta"><span className={`risk-storage-status ${serverConnected ? "connected" : "local"}`}>{serverConnected ? "Conectado a Supabase" : "Copia local"}</span><span className="risk-cycle"><CalendarClock size={16} /><small>Ciclo</small><strong>{state.cycle}</strong></span><span className={`risk-cycle-status ${state.cycleStatus}`}>{state.cycleStatus === "preparation" ? "Histórico en preparación" : state.cycleStatus === "active" ? "Vigente" : "Cerrado"}</span></div>
      </section>

      <nav className="risk-tabs" aria-label="Vistas de riesgos y oportunidades">
        {riskTabs.map((item) => { const Icon = tabIcons[item]; return <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)} type="button"><Icon size={16} />{tabLabels[item]}</button>; })}
      </nav>

      {tab === "summary" ? <RiskSummary critical={critical} overdue={overdue} pendingContributions={pendingContributions} state={state} visibleRisks={visibleRisks} withoutDetection={withoutDetection} /> : null}
      {tab === "direction" ? <DirectionView activationError={activationError} activationMessage={activationMessage} activating={activating} canEdit={isAdministrator(session)} onActivate={async () => { setActivationError(""); setActivationMessage(""); setActivating(true); try { const result = await onActivate(); setActivationMessage(`Análisis iniciado para ${result.processCount} procesos. ${result.notifiedUsers} usuarios recibieron la notificación.${result.uncoveredProcessIds.length ? ` Sin responsable directo: ${result.uncoveredProcessIds.join(", ")}.` : ""}`); } catch (error) { setActivationError(error instanceof Error ? error.message : "No fue posible iniciar el análisis."); } finally { setActivating(false); } }} onChange={onChange} serverConnected={serverConnected} state={state} /> : null}
      {tab === "okr" ? <OkrView indicators={indicators} indicatorResults={indicatorResults} onNavigate={onNavigateToIndicators} processIds={[...allowedProcessIds]} /> : null}
      {tab === "swot" ? <SwotView canEdit={canEdit} onChange={onChange} processId={processId} setProcessId={setProcessId} session={session} state={state} /> : null}
      {tab === "matrix" ? <RiskMatrix canEdit={canEdit} onAdd={() => setRiskEditorOpen(true)} risks={visibleRisks} /> : null}
      {tab === "actions" ? <ActionsView onChange={onChange} risks={visibleRisks} state={state} /> : null}
      {tab === "contributions" ? <ContributionsView canEdit={canEdit} onAdd={() => setContributionEditorOpen(true)} onChange={onChange} session={session} state={state} /> : null}
      {tab === "settings" ? <SettingsView isAdmin={isAdministrator(session)} state={state} /> : null}

      {riskEditorOpen ? <RiskEditor onClose={() => setRiskEditorOpen(false)} onSave={(risk, action) => { onChange({ ...state, risks: [...state.risks, risk], actions: [...state.actions, action] }); setRiskEditorOpen(false); }} processIds={[...allowedProcessIds]} state={state} /> : null}
      {contributionEditorOpen ? <ContributionEditor onClose={() => setContributionEditorOpen(false)} onSave={(contribution) => { onChange({ ...state, contributions: [...state.contributions, contribution] }); setContributionEditorOpen(false); }} session={session} state={state} /> : null}
    </div>
  );
}

function RiskSummary({ critical, overdue, pendingContributions, state, visibleRisks, withoutDetection }: { critical: number; overdue: number; pendingContributions: number; state: RiskWorkspaceState; visibleRisks: RiskRecord[]; withoutDetection: number }) {
  const cards = [
    { label: "Riesgos críticos", value: critical, note: "Última evaluación aprobada SO", tone: "critical" },
    { label: "Acciones vencidas", value: overdue, note: "Compromisos abiertos fuera de fecha", tone: "warning" },
    { label: "Aportaciones pendientes", value: pendingContributions, note: "Comentarios sin decisión final", tone: "info" },
    { label: "Detección pendiente", value: withoutDetection, note: "SO calculado; SOD aún incompleto", tone: "neutral" },
  ];
  return <div className="risk-view-stack">
    <section className="risk-metric-grid">{cards.map((card) => <article className={`risk-metric ${card.tone}`} key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</section>
    <div className="risk-summary-grid">
      <section className="work-panel risk-overview-panel"><header><div><p className="module-kicker">Panorama</p><h3>Exposición por nivel SO</h3></div><span>{visibleRisks.length} registros</span></header><div className="risk-level-bars">{(["CRÍTICO", "MAYOR", "MENOR"] as const).map((level) => { const count = visibleRisks.filter((risk) => (risk.latest ?? risk.initial).level === level).length; return <div key={level}><span><strong>{level}</strong><small>{count} registros</small></span><div><i className={`level-${level.toLocaleLowerCase("es")}`} style={{ width: `${visibleRisks.length ? Math.max(8, count / visibleRisks.length * 100) : 0}%` }} /></div></div>; })}</div></section>
      <section className="work-panel risk-overview-panel"><header><div><p className="module-kicker">Despliegue</p><h3>Procesos master</h3></div><span>{masterProcesses.length}</span></header><div className="risk-deployment"><strong>{new Set(state.swotItems.filter((item) => item.status === "published").map((item) => item.processId)).size} de {masterProcesses.length}</strong><p>procesos con FODA publicado en el ciclo histórico</p><div><i style={{ width: `${new Set(state.swotItems.filter((item) => item.status === "published").map((item) => item.processId)).size / masterProcesses.length * 100}%` }} /></div><small>Los datos 2025 permanecen históricos hasta revisión de Dirección.</small></div></section>
    </div>
    <section className="work-panel risk-trace-panel"><header><div><p className="module-kicker">Trazabilidad</p><h3>Cadena de control visible</h3></div></header><div className="risk-flow"><span>Objetivo directivo</span><ArrowRight /><span>FODA del proceso</span><ArrowRight /><span>Riesgo / oportunidad</span><ArrowRight /><span>Acción y evidencia</span><ArrowRight /><span>Reevaluación y eficacia</span></div></section>
  </div>;
}

function DirectionView({ activationError, activationMessage, activating, canEdit, onActivate, onChange, serverConnected, state }: { activationError: string; activationMessage: string; activating: boolean; canEdit: boolean; onActivate: () => Promise<void>; onChange: (state: RiskWorkspaceState) => void; serverConnected: boolean; state: RiskWorkspaceState }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DirectionCandidateKind | "all">("all");
  const [candidateEditor, setCandidateEditor] = useState<DirectionCandidate | "new" | null>(null);
  const [axisEditor, setAxisEditor] = useState<StrategicAxis | "new" | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const candidates = (state.directionCandidates ?? []).filter((item) => (kind === "all" || item.classification === kind) && (!query.trim() || [item.description, item.controlPoint, item.responsibleLabel, item.sourceName ?? "", String(item.sourceRow)].some((value) => value.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")))));

  function updateCandidate(id: string, patch: Partial<DirectionCandidate>) {
    onChange({ ...state, directionCandidates: (state.directionCandidates ?? []).map((item) => item.id === id ? { ...item, ...patch, reviewStatus: patch.classification && patch.classification !== "pending" ? "ready" : item.reviewStatus } : item) });
  }

  function saveCandidate(candidate: DirectionCandidate) {
    const exists = state.directionCandidates.some((item) => item.id === candidate.id);
    onChange({ ...state, directionCandidates: exists ? state.directionCandidates.map((item) => item.id === candidate.id ? candidate : item) : [...state.directionCandidates, candidate] });
    setCandidateEditor(null);
  }

  function deleteCandidate(candidate: DirectionCandidate) {
    if (!window.confirm(`¿Eliminar “${candidate.description}”? Esta acción retirará el registro del ciclo de Dirección.`)) return;
    onChange({ ...state, directionCandidates: state.directionCandidates.filter((item) => item.id !== candidate.id) });
  }

  function saveAxis(axis: StrategicAxis) {
    const exists = state.axes.some((item) => item.id === axis.id);
    onChange({ ...state, axes: exists ? state.axes.map((item) => item.id === axis.id ? axis : item) : [...state.axes, axis] });
    setAxisEditor(null);
  }

  function deleteAxis(axis: StrategicAxis) {
    const referenced = state.risks.some((item) => item.strategicAxisId === axis.id) || state.swotItems.some((item) => item.strategicAxisId === axis.id);
    if (referenced) { window.alert("Este eje está relacionado con un FODA o riesgo. Reasigna esos registros antes de eliminarlo."); return; }
    if (!window.confirm(`¿Eliminar el eje “${axis.title}”?`)) return;
    onChange({ ...state, axes: state.axes.filter((item) => item.id !== axis.id) });
  }

  async function importHistory(file: File) {
    setImporting(true);
    setImportMessage("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null }) as DirectionImportCell[][];
      const parsed = parseDirectionImportRows(rows, file.name);
      const known = new Set(state.directionCandidates.map(directionCandidateFingerprint));
      const fresh = parsed.filter((item) => { const fingerprint = directionCandidateFingerprint(item); if (known.has(fingerprint)) return false; known.add(fingerprint); return true; });
      if (!fresh.length) { setImportMessage(parsed.length ? "El archivo no agregó filas: todos los registros ya existían." : "No se encontraron filas reconocibles. Usa una columna Descripción o la estructura histórica B:U."); return; }
      const stamp = Date.now();
      onChange({ ...state, directionCandidates: [...state.directionCandidates, ...fresh.map((item, index) => ({ ...item, id: `DIR-${state.cycle}-IMP-${stamp}-${index + 1}` }))] });
      setImportMessage(`${fresh.length} registros incorporados desde ${file.name}.${parsed.length > fresh.length ? ` ${parsed.length - fresh.length} duplicados se omitieron.` : ""}`);
    } catch (error) {
      setImportMessage(error instanceof Error ? `No fue posible leer el archivo: ${error.message}` : "No fue posible leer el archivo.");
    } finally {
      setImporting(false);
    }
  }

  return <div className="risk-view-stack">
    <section className="work-panel risk-direction-intro direction-history-step">
      <div><FileWarning size={21} /><span><strong>Paso 1 · Historial como punto de partida</strong><p>La matriz 2025 permanece como antecedente. Puedes sumar otro Excel/CSV o capturar registros sin sustituir lo ya revisado.</p></span></div>
      {canEdit ? <div className="direction-step-actions"><label className={`button button-secondary file-button ${importing ? "disabled" : ""}`}><Upload size={16} /> {importing ? "Cargando…" : "Cargar historial"}<input accept=".xlsx,.xls,.xlsm,.csv" disabled={importing} type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importHistory(file); event.currentTarget.value = ""; }} /></label><button className="button button-primary" onClick={() => setCandidateEditor("new")} type="button"><Plus size={16} /> Captura manual</button></div> : <span>{state.directionCandidates.length} registros históricos</span>}
      {importMessage ? <p className="direction-import-result">{importMessage}</p> : null}
    </section>

    <section className="work-panel">
      <div className="risk-section-heading"><div><p className="module-kicker">Paso 2 · Estructura estratégica</p><h3>Ejes editables por Dirección</h3></div><div className="direction-heading-actions"><span className="count-badge">{state.axes.length}</span>{canEdit ? <button className="button button-secondary" onClick={() => setAxisEditor("new")} type="button"><Plus size={15} /> Nuevo eje</button> : null}</div></div>
      <div className="strategy-axis-list">{state.axes.map((axis) => <article key={axis.id}><code>{axis.id}</code><span><strong>{axis.title}</strong><small>Origen: {axis.sourceCell}</small></span><span className="axis-target"><small>Meta</small><strong>{axis.originalTarget}</strong></span><span className={`risk-status status-${axis.status}`}>{axis.status === "review" ? "Requiere definición" : "Lista para revisar"}</span>{canEdit ? <span className="direction-row-actions"><button className="icon-button" onClick={() => setAxisEditor(axis)} title="Editar eje" type="button"><Pencil size={14} /></button><button className="icon-button danger" onClick={() => deleteAxis(axis)} title="Eliminar eje" type="button"><Trash2 size={14} /></button></span> : null}</article>)}</div>
    </section>

    <section className="work-panel direction-candidates-panel">
      <div className="risk-section-heading"><div><p className="module-kicker">Paso 2 · Revisión y asignación</p><h3>Registros históricos y manuales</h3></div><span>{candidates.length} de {state.directionCandidates.length}</span></div>
      <div className="direction-candidate-toolbar"><label className="panel-search"><input aria-label="Buscar en matriz de Dirección" placeholder="Buscar descripción, control, responsable o archivo" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filtrar clasificación" value={kind} onChange={(event) => setKind(event.target.value as DirectionCandidateKind | "all")}><option value="all">Todas las etapas</option>{Object.entries(directionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="direction-candidate-list">{candidates.map((item) => <article key={item.id}><span><code>{item.sourceType === "manual" ? "Captura manual" : `Fila ${item.sourceRow}`}</code><strong>{item.description}</strong><small>{item.controlPoint || "Sin punto de control"} · Responsable original: {item.responsibleLabel || "Sin definir"}</small><small className="direction-source-label">{item.sourceName ?? "Historial cargado"}</small></span><span className="source-marks"><small>R/O original</small><strong>{item.roPrimary || "—"} / {item.roSecondary || "—"}</strong><small>Avance histórico: {item.historicalProgress === null ? "—" : `${Math.round(item.historicalProgress * 100)}%`}</small></span><label><span>Etapa</span><select disabled={!canEdit} value={item.classification} onChange={(event) => updateCandidate(item.id, { classification: event.target.value as DirectionCandidateKind })}>{Object.entries(directionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Proceso responsable</span><select disabled={!canEdit} value={item.processId ?? ""} onChange={(event) => updateCandidate(item.id, { processId: event.target.value || undefined })}><option value="">Por asignar</option>{masterProcesses.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label><span>Responsable confirmado</span><input value={item.ownerName ?? ""} disabled={!canEdit} placeholder="Nombre del responsable" onChange={(event) => updateCandidate(item.id, { ownerName: event.target.value || undefined })} /></label>{canEdit ? <span className="direction-row-actions"><button className="icon-button" onClick={() => setCandidateEditor(item)} title="Editar registro" type="button"><Pencil size={14} /></button><button className="icon-button danger" onClick={() => deleteCandidate(item)} title="Eliminar registro" type="button"><Trash2 size={14} /></button></span> : null}</article>)}</div>
    </section>

    {canEdit ? <section className="work-panel direction-launch-panel"><div><Target size={21} /><span><strong>Paso 3 · Despliegue anual a procesos</strong><p>Al iniciar, IntegraQ guardará la versión preparada y notificará una sola vez a los responsables para elaborar FODA, FODA cruzado, riesgos y matriz de operaciones.</p></span></div><button className="button button-primary" disabled={!serverConnected || activating} onClick={() => void onActivate()} type="button">{activating ? "Enviando…" : state.cycleStatus === "active" ? "Reenviar a nuevos responsables" : "Iniciar análisis en 18 procesos"}</button>{activationMessage ? <p className="launch-result success">{activationMessage}</p> : null}{activationError ? <p className="launch-result error">{activationError}</p> : null}</section> : null}

    {candidateEditor ? <DirectionCandidateEditor candidate={candidateEditor === "new" ? undefined : candidateEditor} cycle={state.cycle} nextRow={Math.max(0, ...state.directionCandidates.map((item) => item.sourceRow)) + 1} onClose={() => setCandidateEditor(null)} onSave={saveCandidate} /> : null}
    {axisEditor ? <StrategicAxisEditor axis={axisEditor === "new" ? undefined : axisEditor} nextId={`EJE-${String(Math.max(0, ...state.axes.map((item) => Number(item.id.match(/\d+/)?.[0] ?? 0))) + 1).padStart(2, "0")}`} onClose={() => setAxisEditor(null)} onSave={saveAxis} /> : null}
  </div>;
}

function DirectionCandidateEditor({ candidate, cycle, nextRow, onClose, onSave }: { candidate?: DirectionCandidate; cycle: number; nextRow: number; onClose: () => void; onSave: (candidate: DirectionCandidate) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const itemClassification = String(form.get("classification")) as DirectionCandidateKind;
    const historicalProgress = String(form.get("historicalProgress")).trim();
    onSave({
      id: candidate?.id ?? `DIR-${cycle}-MAN-${Date.now()}`,
      sourceRow: candidate?.sourceRow ?? nextRow,
      description: String(form.get("description")).trim(),
      responsibleLabel: String(form.get("responsibleLabel")).trim(),
      controlPoint: String(form.get("controlPoint")).trim(),
      roPrimary: String(form.get("roPrimary")).trim(),
      roSecondary: String(form.get("roSecondary")).trim(),
      historicalProgress: historicalProgress ? Number(historicalProgress) / 100 : null,
      axisWeights: candidate?.axisWeights ?? [],
      classification: itemClassification,
      processId: String(form.get("processId")) || undefined,
      ownerName: String(form.get("ownerName")).trim() || undefined,
      reviewStatus: itemClassification === "pending" ? "pending" : "ready",
      sourceType: candidate?.sourceType ?? "manual",
      sourceName: candidate?.sourceName ?? "Captura manual de Dirección",
    });
  }
  return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="quality-modal direction-editor-modal" role="dialog" aria-modal="true" aria-labelledby="direction-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>DIRECCIÓN · CICLO {cycle}</span><h3 id="direction-editor-title">{candidate ? "Editar registro" : "Nuevo registro manual"}</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={17} /></button></header><form onSubmit={submit}><div className="direction-editor-grid"><label className="span-2"><span>Descripción</span><textarea defaultValue={candidate?.description} name="description" required rows={3} /></label><label><span>Responsable histórico</span><input defaultValue={candidate?.responsibleLabel} name="responsibleLabel" /></label><label><span>Responsable confirmado</span><input defaultValue={candidate?.ownerName} name="ownerName" /></label><label className="span-2"><span>Punto de control</span><input defaultValue={candidate?.controlPoint} name="controlPoint" /></label><label><span>Marca R/O 1</span><input defaultValue={candidate?.roPrimary} name="roPrimary" /></label><label><span>Marca R/O 2</span><input defaultValue={candidate?.roSecondary} name="roSecondary" /></label><label><span>Avance histórico (%)</span><input defaultValue={candidate?.historicalProgress === null || candidate?.historicalProgress === undefined ? "" : Math.round(candidate.historicalProgress * 100)} max="100" min="0" name="historicalProgress" type="number" /></label><label><span>Etapa</span><select defaultValue={candidate?.classification ?? "pending"} name="classification">{Object.entries(directionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Proceso responsable</span><select defaultValue={candidate?.processId ?? ""} name="processId"><option value="">Por asignar</option>{masterProcesses.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label><span>Origen</span><input disabled value={candidate?.sourceName ?? "Captura manual de Dirección"} /></label></div><footer><button className="button button-secondary" onClick={onClose} type="button">Cancelar</button><button className="button button-primary" type="submit"><Save size={16} /> Guardar registro</button></footer></form></section></div>;
}

function StrategicAxisEditor({ axis, nextId, onClose, onSave }: { axis?: StrategicAxis; nextId: string; onClose: () => void; onSave: (axis: StrategicAxis) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); onSave({ id: axis?.id ?? nextId, title: String(form.get("title")).trim(), originalTarget: String(form.get("target")).trim(), status: String(form.get("status")) as StrategicAxis["status"], sourceCell: axis?.sourceCell ?? "Captura manual" }); }
  return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="quality-modal direction-editor-modal compact" role="dialog" aria-modal="true" aria-labelledby="axis-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>DIRECCIÓN · ESTRUCTURA</span><h3 id="axis-editor-title">{axis ? "Editar eje estratégico" : "Nuevo eje estratégico"}</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={17} /></button></header><form onSubmit={submit}><div className="direction-editor-grid"><label className="span-2"><span>Nombre del eje</span><input defaultValue={axis?.title} name="title" required /></label><label><span>Meta</span><input defaultValue={axis?.originalTarget} name="target" required /></label><label><span>Estado</span><select defaultValue={axis?.status ?? "review"} name="status"><option value="review">Requiere definición</option><option value="ready">Listo para revisar</option></select></label></div><footer><button className="button button-secondary" onClick={onClose} type="button">Cancelar</button><button className="button button-primary" type="submit"><Save size={16} /> Guardar eje</button></footer></form></section></div>;
}

function OkrView({ indicators, indicatorResults, onNavigate, processIds }: { indicators: ConfiguredIndicator[]; indicatorResults: IndicatorResults; onNavigate: (id?: string) => void; processIds: string[] }) {
  const scoped = indicators.filter((indicator) => processIds.includes(indicator.processId));
  return <div className="risk-view-stack"><section className="work-panel risk-direction-intro okr-reuse"><div><Target size={21} /><span><strong>Catálogo compartido con Objetivos e indicadores</strong><p>Esta vista enlaza los registros existentes; no crea un segundo catálogo ni suma porcentajes incompatibles.</p></span></div><button className="button button-primary" type="button" onClick={() => onNavigate()}><ArrowRight size={16} /> Abrir módulo de indicadores</button></section><section className="work-panel"><div className="risk-section-heading"><div><p className="module-kicker">Despliegue Dirección → procesos</p><h3>Resultados clave vinculables</h3></div><span className="count-badge">{scoped.length}</span></div><div className="okr-link-list">{scoped.slice(0, 16).map((indicator) => { const years = indicatorResults[indicator.id] ?? {}; const measurements = Object.values(years).flatMap((quarters) => Object.values(quarters)).filter(Boolean).length; return <button key={indicator.id} onClick={() => onNavigate(indicator.id)} type="button"><code>{indicator.id}</code><span><strong>{indicator.name}</strong><small>{indicator.processId} · {indicator.leader}</small></span><span><small>Mediciones</small><strong>{measurements}</strong></span><ArrowRight size={16} /></button>; })}</div>{scoped.length === 0 ? <EmptyState title="Sin indicadores en el alcance" copy="Solicita acceso al proceso o configura sus resultados clave en el módulo existente." /> : null}</section></div>;
}

function SwotView({ canEdit, onChange, processId, setProcessId, session, state }: { canEdit: boolean; onChange: (state: RiskWorkspaceState) => void; processId: string; setProcessId: (id: string) => void; session: ActiveSession; state: RiskWorkspaceState }) {
  const processes = accessibleProcesses(session);
  function addItem(quadrant: SwotQuadrant) { const description = window.prompt(`Nuevo elemento de ${quadrantLabels[quadrant]}`)?.trim(); if (!description) return; onChange({ ...state, swotItems: [...state.swotItems, { id: `FODA-${processId}-${String(state.swotItems.length + 1).padStart(3, "0")}`, processId, cycle: state.cycle, quadrant, description, status: "draft", author: session.name }] }); }
  return <div className="risk-view-stack"><section className="work-panel risk-filterbar"><label><span>Proceso autorizado</span><select value={processId} onChange={(event) => setProcessId(event.target.value)}>{processes.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><div><small>Límite de clasificación</small><strong>Towell: interno / externo</strong></div><span>{state.cycle}</span></section><div className="swot-grid">{(["strength", "opportunity", "weakness", "threat"] as SwotQuadrant[]).map((quadrant) => <section className={`work-panel swot-quadrant ${quadrant}`} key={quadrant}><header><div><span>{quadrant === "strength" || quadrant === "weakness" ? "Interno" : "Externo"}</span><h3>{quadrantLabels[quadrant]}</h3></div>{canEdit ? <button className="icon-button" title={`Agregar ${quadrantLabels[quadrant]}`} type="button" onClick={() => addItem(quadrant)}><Plus size={16} /></button> : null}</header><div>{state.swotItems.filter((item) => item.processId === processId && item.quadrant === quadrant).map((item) => <article key={item.id}><p>{item.description}</p><footer><span>{item.id}</span><span className={`risk-status status-${item.status}`}>{item.status === "published" ? "Publicado" : item.status === "review" ? "Por revisar" : "Borrador"}</span></footer></article>)}</div>{!state.swotItems.some((item) => item.processId === processId && item.quadrant === quadrant) ? <p className="swot-empty">Sin elementos en este cuadrante.</p> : null}</section>)}</div></div>;
}

function RiskMatrix({ canEdit, onAdd, risks }: { canEdit: boolean; onAdd: () => void; risks: RiskRecord[] }) {
  const [query, setQuery] = useState("");
  const filtered = risks.filter((risk) => !query || [risk.id, risk.title, risk.processId, risk.owner].some((value) => value.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))));
  return <section className="work-panel risk-matrix-panel"><div className="risk-section-heading"><div><p className="module-kicker">Evaluación y alineación</p><h3>Matriz digital</h3></div>{canEdit ? <button className="button button-primary" onClick={onAdd} type="button"><Plus size={16} /> Nuevo registro</button> : null}</div><div className="risk-matrix-toolbar"><label className="panel-search"><input aria-label="Buscar riesgo" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar folio, título, proceso o responsable" /></label><span>{filtered.length} registros</span></div><div className="risk-table"><div className="risk-table-head"><span>Registro</span><span>Proceso / responsable</span><span>Evaluación inicial</span><span>Última evaluación</span><span>Tratamiento / estado</span></div>{filtered.map((risk) => <article key={risk.id}><span><code>{risk.id}</code><strong>{risk.title}</strong><small>{risk.kind === "risk" ? "Riesgo" : "Oportunidad"} · {risk.source}</small></span><span><strong>{risk.processId}</strong><small>{risk.owner}</small></span><AssessmentBadge assessment={risk.initial} /><AssessmentBadge assessment={risk.latest ?? risk.initial} compare={risk.latest ? (risk.latest.so ?? 0) - (risk.initial.so ?? 0) : undefined} /><span><small>{risk.treatment}</small><span className={`risk-status status-${risk.status}`}>{formatRiskStatus(risk.status)}</span></span></article>)}</div></section>;
}

function AssessmentBadge({ assessment, compare }: { assessment: RiskRecord["initial"]; compare?: number }) { return <span className="assessment-badge"><strong className={`so-${assessment.level?.toLocaleLowerCase("es") ?? "pending"}`}>{assessment.so ?? "—"} <small>{assessment.level ?? "Sin evaluar"}</small></strong><small>S {assessment.severity ?? "—"} · O {assessment.occurrence ?? "—"} · D {assessment.detection ?? "—"}</small><small>SOD {assessment.sod ?? "Pendiente de detección"}</small>{compare !== undefined ? <em className={compare > 0 ? "increased" : compare < 0 ? "decreased" : "stable"}>{compare > 0 ? <ArrowDown size={12} /> : null}{compare > 0 ? `Aumentó ${compare}` : compare < 0 ? `Disminuyó ${Math.abs(compare)}` : "Sin cambio"}</em> : null}</span>; }

function ActionsView({ onChange, risks, state }: { onChange: (state: RiskWorkspaceState) => void; risks: RiskRecord[]; state: RiskWorkspaceState }) {
  const ids = new Set(risks.map((risk) => risk.id));
  const actions = state.actions.filter((action) => ids.has(action.riskId));
  function complete(id: string) { onChange({ ...state, actions: state.actions.map((action) => action.id === id ? { ...action, status: "completed" } : action) }); }
  return <section className="work-panel risk-actions-panel"><div className="risk-section-heading"><div><p className="module-kicker">Compromisos consolidados</p><h3>Tratamientos, acciones y eficacia</h3></div><span className="count-badge">{actions.length}</span></div><div className="action-list">{actions.map((action) => { const risk = state.risks.find((item) => item.id === action.riskId); const overdue = action.status !== "completed" && action.dueDate < new Date().toISOString().slice(0, 10); return <article key={action.id}><span className={`action-marker ${overdue ? "overdue" : action.status}`}><ClipboardList size={18} /></span><span><code>{action.id} · {action.riskId}</code><strong>{action.title}</strong><small>{risk?.title}</small></span><span><small>Responsable</small><strong>{action.owner}</strong></span><span><small>Compromiso</small><strong>{formatDate(action.dueDate)}</strong></span><span><span className={`risk-status status-${action.status}`}>{action.status === "completed" ? "Terminada" : action.status === "in_progress" ? "En curso" : overdue ? "Vencida" : "Abierta"}</span><small className="effectiveness-note">Eficacia: {action.effectiveness === "pending" ? "pendiente" : action.effectiveness === "effective" ? "eficaz" : "no eficaz"}</small></span>{action.status !== "completed" ? <button className="button button-secondary" onClick={() => complete(action.id)} type="button">Marcar terminada</button> : <span className="action-evidence"><CheckCircle2 size={15} />{action.evidence ?? "Requiere evidencia"}</span>}</article>; })}</div><p className="risk-rule-note"><AlertTriangle size={15} /> Terminar acciones no cierra el riesgo: se requiere evidencia, reevaluación y dictamen de eficacia.</p></section>;
}

function ContributionsView({ canEdit, onAdd, onChange, session, state }: { canEdit: boolean; onAdd: () => void; onChange: (state: RiskWorkspaceState) => void; session: ActiveSession; state: RiskWorkspaceState }) {
  const allowed = new Set(accessibleProcesses(session).map((process) => process.id));
  const contributions = state.contributions.filter((item) => isAdministrator(session) || allowed.has(item.sourceProcessId) || allowed.has(item.targetProcessId));
  function incorporate(id: string) { onChange(incorporateContribution(state, id, session.name)); }
  function clarify(id: string) { const resolution = window.prompt("Información que debe aclarar el autor")?.trim(); if (!resolution) return; onChange({ ...state, contributions: state.contributions.map((item) => item.id === id ? { ...item, status: "clarification", resolution } : item) }); }
  function dismiss(id: string) { const resolution = window.prompt("Motivo obligatorio para descartar")?.trim(); if (!resolution) return; onChange({ ...state, contributions: state.contributions.map((item) => item.id === id ? { ...item, status: "dismissed", resolution } : item) }); }
  return <section className="work-panel risk-contributions-panel"><div className="risk-section-heading"><div><p className="module-kicker">Colaboración entre procesos</p><h3>Bandeja de aportaciones</h3></div><button className="button button-primary" onClick={onAdd} type="button"><Plus size={16} /> Nueva aportación</button></div><div className="contribution-list">{contributions.map((item) => { const canResolve = canEdit && (isAdministrator(session) || allowed.has(item.targetProcessId)); return <article key={item.id}><header><span><code>{item.id}</code><strong>{item.sourceProcessId} <ArrowRight size={13} /> {item.targetProcessId}</strong></span><span className={`risk-status status-${item.status}`}>{formatContributionStatus(item.status)}</span></header><p>{item.comment}</p><small>{quadrantLabels[item.quadrant]} sugerida · {item.author} · {formatDate(item.createdAt)}</small>{item.impact ? <blockquote>Impacto observado: {item.impact}</blockquote> : null}{item.resolution ? <div className="contribution-resolution"><strong>Respuesta del proceso destino</strong><p>{item.resolution}</p></div> : null}{canResolve && item.status === "pending" ? <footer><button className="button button-secondary" onClick={() => clarify(item.id)} type="button">Solicitar información</button><button className="button button-secondary" onClick={() => dismiss(item.id)} type="button">Descartar con motivo</button><button className="button button-primary" onClick={() => incorporate(item.id)} type="button">Incorporar al FODA</button></footer> : null}</article>; })}</div></section>;
}

function SettingsView({ isAdmin, state }: { isAdmin: boolean; state: RiskWorkspaceState }) { return <div className="risk-settings-grid"><section className="work-panel"><div className="risk-section-heading"><div><p className="module-kicker">Ciclo</p><h3>Regla anual</h3></div><span className="risk-status status-review">{state.cycle}</span></div><p>La matriz de operaciones, el FODA, el FODA cruzado y la matriz de riesgos se ejecutan durante los primeros 30 días del año.</p><div className="settings-facts"><span><small>Estado</small><strong>Preparación histórica</strong></span><span><small>Procesos master</small><strong>{masterProcesses.length}</strong></span><span><small>Administración</small><strong>{isAdmin ? "Habilitada" : "Solo lectura"}</strong></span></div></section><section className="work-panel"><div className="risk-section-heading"><div><p className="module-kicker">Cálculo</p><h3>SO y SOD</h3></div></div><div className="formula-cards"><span><strong>SO = S × O</strong><small>MENOR 1–25 · MAYOR 26–50 · CRÍTICO 51–100</small></span><span><strong>SOD = S × O × D</strong><small>1–1000 · sin umbrales activos · D alta significa peor detección</small></span></div></section><section className="work-panel treatment-catalog"><div className="risk-section-heading"><div><p className="module-kicker">Catálogo controlado</p><h3>Siete tratamientos</h3></div><span>{riskTreatmentCatalog.length}</span></div>{riskTreatmentCatalog.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong></div>)}</section><section className="work-panel"><div className="risk-section-heading"><div><p className="module-kicker">Importación</p><h3>Incidencias conservadas</h3></div><span>{state.importIssues.length}</span></div><div className="import-issue-list">{state.importIssues.map((issue) => <article key={issue.id}><code>{issue.location}</code><strong>{issue.value}</strong><p>{issue.issue}</p><span className="risk-status status-review">Pendiente</span></article>)}</div></section></div>; }

function RiskEditor({ onClose, onSave, processIds, state }: { onClose: () => void; onSave: (risk: RiskRecord, action: RiskWorkspaceState["actions"][number]) => void; processIds: string[]; state: RiskWorkspaceState }) {
  const [severity, setSeverity] = useState(7); const [occurrence, setOccurrence] = useState(8); const [detection, setDetection] = useState<number | undefined>();
  const assessment = calculateAssessment(severity, occurrence, detection, "SOD-propuesta-v1");
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const id = `RYO-${state.cycle}-${String(state.risks.length + 1).padStart(3, "0")}`; const risk: RiskRecord = { id, kind: String(form.get("kind")) as RiskRecord["kind"], processId: String(form.get("processId")), cycle: state.cycle, title: String(form.get("title")), event: String(form.get("event")), consequence: String(form.get("consequence")), owner: String(form.get("owner")), strategicAxisId: String(form.get("axis")), status: "draft", treatment: String(form.get("treatment")) as RiskRecord["treatment"], currentControls: String(form.get("controls")), initial: assessment, source: "Captura manual" }; onSave(risk, { id: `ACT-${id}-01`, riskId: id, title: String(form.get("action")), owner: String(form.get("owner")), dueDate: String(form.get("dueDate")), status: "open", effectiveness: "pending" }); }
  return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="quality-modal risk-editor-modal" role="dialog" aria-modal="true" aria-labelledby="risk-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>NUEVO EXPEDIENTE</span><h3 id="risk-editor-title">Riesgo u oportunidad</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={17} /></button></header><form onSubmit={submit}><div className="risk-editor-grid"><label><span>Tipo</span><select name="kind"><option value="risk">Riesgo</option><option value="opportunity">Oportunidad</option></select></label><label><span>Proceso dueño</span><select name="processId">{masterProcesses.filter((process) => processIds.includes(process.id)).map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label className="span-2"><span>Título</span><input name="title" required /></label><label className="span-2"><span>Modo de falla o evento</span><textarea name="event" required rows={2} /></label><label className="span-2"><span>Efecto / consecuencia</span><textarea name="consequence" required rows={2} /></label><label><span>Responsable principal</span><input name="owner" required /></label><label><span>Asunto estratégico</span><select name="axis">{state.axes.map((axis) => <option key={axis.id} value={axis.id}>{axis.id} · {axis.title}</option>)}</select></label><label className="span-2"><span>Controles actuales</span><textarea name="controls" required rows={2} /></label><label><span>Severidad S</span><input min="1" max="10" step="1" type="number" value={severity} onChange={(event) => setSeverity(Number(event.target.value))} /></label><label><span>Ocurrencia O</span><input min="1" max="10" step="1" type="number" value={occurrence} onChange={(event) => setOccurrence(Number(event.target.value))} /></label><label><span>Detección D (opcional)</span><input min="1" max="10" step="1" type="number" value={detection ?? ""} onChange={(event) => setDetection(event.target.value ? Number(event.target.value) : undefined)} /></label><div className="assessment-preview"><span>SO <strong>{assessment.so}</strong> {assessment.level}</span><span>SOD <strong>{assessment.sod ?? "Pendiente"}</strong></span></div><label className="span-2"><span>Tratamiento</span><select name="treatment">{riskTreatmentCatalog.map((item) => <option key={item}>{item}</option>)}</select></label><label className="span-2"><span>Primera acción</span><input name="action" required /></label><label><span>Fecha compromiso</span><input name="dueDate" required type="date" /></label></div><footer><button className="button button-secondary" onClick={onClose} type="button">Cancelar</button><button className="button button-primary" type="submit"><Save size={16} /> Guardar borrador</button></footer></form></section></div>;
}

function ContributionEditor({ onClose, onSave, session, state }: { onClose: () => void; onSave: (item: CrossContribution) => void; session: ActiveSession; state: RiskWorkspaceState }) { function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); onSave({ id: `APO-${state.cycle}-${String(state.contributions.length + 1).padStart(3, "0")}`, sourceProcessId: String(form.get("source")), targetProcessId: String(form.get("target")), quadrant: String(form.get("quadrant")) as SwotQuadrant, comment: String(form.get("comment")), impact: String(form.get("impact")), author: session.name, createdAt: new Date().toISOString(), status: "pending" }); } const sources = accessibleProcesses(session); return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="quality-modal contribution-editor-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>COLABORACIÓN CRUZADA</span><h3 id="contribution-editor-title">Nueva aportación</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={17} /></button></header><form onSubmit={submit}><label><span>Proceso de origen</span><select name="source">{sources.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label><span>Proceso destino</span><select name="target">{masterProcesses.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label><label><span>Cuadrante sugerido</span><select name="quadrant">{Object.entries(quadrantLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Comentario</span><textarea name="comment" required rows={4} /></label><label><span>Impacto observado</span><textarea name="impact" rows={2} /></label><p className="risk-rule-note"><AlertTriangle size={15} /> La propuesta no modifica el FODA oficial hasta que el proceso destino la incorpore.</p><footer><button className="button button-secondary" onClick={onClose} type="button">Cancelar</button><button className="button button-primary" type="submit"><MessageSquareText size={16} /> Enviar aportación</button></footer></form></section></div>; }

function EmptyState({ copy, title }: { copy: string; title: string }) { return <div className="risk-empty"><AlertTriangle size={22} /><strong>{title}</strong><p>{copy}</p></div>; }
function accessibleProcesses(session: ActiveSession) { return isAdministrator(session) ? masterProcesses : masterProcesses.filter((process) => session.assignedProcessIds.includes(process.id)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
function formatRiskStatus(status: RiskRecord["status"]) { return ({ draft: "Borrador", review: "En validación", approved: "Aprobado", effectiveness_pending: "Eficacia pendiente", closed: "Cerrado" })[status]; }
function formatContributionStatus(status: CrossContribution["status"]) { return ({ pending: "Pendiente", clarification: "En aclaración", incorporated: "Incorporada", linked: "Vinculada", dismissed: "Descartada" })[status]; }

export { buildInitialRiskWorkspace };
