"use client";

import {
  AlertTriangle,
  BadgeCheck,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Filter,
  FlaskConical,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { calculateNextDueDate, getAssetDueStatus, toIsoDate } from "@/lib/domain";
import { getCurrentReferenceStandards, getVerificationReadiness } from "@/lib/metrology-data";
import { latestReportForAsset, getMetrologyReportTemplate, getMetrologyTemplateName, type CalibrationValues, type MetrologyReport } from "@/lib/metrology-report-data";
import { loadMetrologyWorkspace, saveMetrologyWorkspace } from "@/lib/metrology-workspace-storage";
import { canPerformModuleAction } from "@/lib/module-permissions";
import type { ActiveSession } from "@/lib/session-data";
import type { DueStatus, MeasurementActivity, MeasurementAsset } from "@/lib/types";
import { MetrologyQrModal } from "@/components/modules/metrology-qr-modal";
import { MetrologyReportForm } from "@/components/modules/metrology-report-form";

interface CalibrationsModuleProps {
  assets: MeasurementAsset[];
  focusId?: string;
  onAssetsChange: (assets: MeasurementAsset[]) => void;
  session: ActiveSession;
}

type ScopeFilter = "all" | MeasurementActivity | "standards";

const activityLabels: Record<MeasurementActivity, string> = {
  calibration: "Calibración externa",
  verification: "Verificación interna",
};

const dueLabels: Record<DueStatus, string> = {
  current: "Vigente",
  due_soon: "Próximo",
  overdue: "Vencido",
};

export function CalibrationsModule({ assets, focusId, onAssetsChange, session }: CalibrationsModuleProps) {
  const today = toIsoDate(new Date());
  const focusedAsset = assets.find((asset) => asset.id === focusId) ?? null;
  const [query, setQuery] = useState(focusedAsset?.code ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [selectedAsset, setSelectedAsset] = useState<MeasurementAsset | null>(focusedAsset);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [formAssetId, setFormAssetId] = useState(focusedAsset?.id ?? assets.find((asset) => !asset.isReferenceStandard)?.id ?? assets[0]?.id ?? "");
  const [qrAsset, setQrAsset] = useState<MeasurementAsset | null>(null);
  const [reports, setReports] = useState<MetrologyReport[]>([]);
  const [serverConnected, setServerConnected] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const canExecute = canPerformModuleAction(session, "calibrations", "update");
  const canManageAssets = canPerformModuleAction(session, "calibrations", "manage");

  useEffect(() => {
    let active = true;
    void loadMetrologyWorkspace().then(({ workspace }) => {
      if (!active) return;
      onAssetsChange(workspace.assets);
      setReports(workspace.reports);
      setServerConnected(true);
      setFormAssetId((current) => workspace.assets.some((asset) => asset.id === current) ? current : workspace.assets.find((asset) => !asset.isReferenceStandard)?.id ?? workspace.assets[0]?.id ?? "");
    }).catch((error) => { if (active) setWorkspaceError(error instanceof Error ? error.message : "No fue posible conectar el expediente."); });
    return () => { active = false; };
  }, [onAssetsChange]);

  const referenceStandards = useMemo(() => assets.filter((asset) => asset.isReferenceStandard), [assets]);
  const currentStandards = useMemo(() => getCurrentReferenceStandards(assets, today), [assets, today]);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-MX");
    return assets.filter((asset) => {
      const referenceIds = asset.referenceStandardIds?.length
        ? asset.referenceStandardIds
        : asset.referenceStandardId
          ? [asset.referenceStandardId]
          : [];
      const references = referenceIds
        .map((id) => assets.find((candidate) => candidate.id === id))
        .filter((reference): reference is MeasurementAsset => Boolean(reference));
      const searchable = [
        asset.code,
        asset.name,
        asset.location,
        asset.owner,
        asset.externalProvider ?? "",
        asset.measurementCategory ?? "",
        asset.measurementType ?? "",
        asset.model ?? "",
        asset.serialNumber ?? "",
        asset.measurementRange ?? "",
        asset.observations ?? "",
        ...references.flatMap((reference) => [reference.code, reference.name]),
      ];
      const matchesQuery = !normalized || searchable.some((value) => value.toLocaleLowerCase("es-MX").includes(normalized));
      const status = getAssetDueStatus(asset, today);
      const matchesScope = scopeFilter === "all" || (scopeFilter === "standards" ? asset.isReferenceStandard : asset.activity === scopeFilter);
      return matchesQuery && matchesScope && (statusFilter === "all" || status === statusFilter);
    });
  }, [assets, query, scopeFilter, statusFilter, today]);

  const metrics = useMemo(() => ({
    verification: assets.filter((asset) => asset.activity === "verification").length,
    calibration: assets.filter((asset) => asset.activity === "calibration").length,
    standards: `${currentStandards.length}/${referenceStandards.length}`,
    overdue: assets.filter((asset) => getAssetDueStatus(asset, today) === "overdue").length,
  }), [assets, currentStandards.length, referenceStandards.length, today]);

  const formAsset = assets.find((asset) => asset.id === formAssetId) ?? assets[0];
  const formAssetReport = formAsset ? latestReportForAsset(reports, formAsset.id) : undefined;

  async function persist(nextAssets: MeasurementAsset[], nextReports: MetrologyReport[]) {
    const saved = await saveMetrologyWorkspace({ assets: nextAssets, reports: nextReports });
    onAssetsChange(saved.workspace.assets);
    setReports(saved.workspace.reports);
    setServerConnected(true);
    setWorkspaceError("");
  }

  async function completeActivity(asset: MeasurementAsset, report: MetrologyReport) {
    const calibration = report.template === "CALIBRATION" ? report.values as CalibrationValues : undefined;
    const nextAssets = assets.map((item) => item.id === asset.id ? {
      ...item,
      lastCompletedAt: report.completedAt,
      nextDueDate: report.nextDueDate,
      schedulePending: false,
      externalProvider: calibration?.provider ?? item.externalProvider,
      calibrationReport: calibration?.certificate ?? item.calibrationReport,
      evidenceCount: item.evidenceCount + 1,
    } : item);
    const nextReports = [report, ...reports.filter((item) => item.id !== report.id)];
    await persist(nextAssets, nextReports);
    setSelectedAsset(null);
  }

  function addAsset(asset: Omit<MeasurementAsset, "id" | "evidenceCount">) {
    const nextAssets = [{ ...asset, id: crypto.randomUUID(), publicToken: crypto.randomUUID().replace(/-/g, ""), evidenceCount: 0 }, ...assets];
    onAssetsChange(nextAssets);
    setCreateOpen(false);
    void persist(nextAssets, reports).catch((error) => setWorkspaceError(error instanceof Error ? error.message : "No fue posible guardar el equipo."));
  }

  return (
    <>
      <section className="module-heading metrology-heading">
        <div><p className="module-kicker">Control metrológico</p><h2>Calibración y verificación</h2><p>Programa F-CA-37 · verificación interna con patrón vigente y calibración externa.</p></div>
        {canManageAssets ? <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nuevo equipo</button> : null}
      </section>

      <section className="metric-grid" aria-label="Resumen metrológico">
        <CalibrationMetric icon={<ShieldCheck size={19} />} label="Verificación interna" value={metrics.verification} tone="success" />
        <CalibrationMetric icon={<Truck size={19} />} label="Calibración externa" value={metrics.calibration} tone="neutral" />
        <CalibrationMetric icon={<FlaskConical size={19} />} label="Patrones vigentes" value={metrics.standards} tone="success" />
        <CalibrationMetric icon={<AlertTriangle size={19} />} label="Vencidos" value={metrics.overdue} tone="danger" />
      </section>

      <section className="metrology-agent-panel metrology-native-workflow work-panel">
        <header><span><FileText size={20} /></span><div><small>Mini app interna</small><h3>Captura y firma de informes metrológicos</h3></div><span className={`risk-storage-status ${serverConnected ? "connected" : "local"}`}>{serverConnected ? "Conectado a Supabase" : "Sin conexión"}</span></header>
        <div className="metrology-agent-controls">
          <label><span>Equipo</span><select value={formAsset?.id ?? ""} onChange={(event) => setFormAssetId(event.target.value)}>{assets.filter((asset) => !asset.isReferenceStandard).map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</select></label>
          <div className="metrology-form-route"><span>Formato asignado</span><strong>{formAsset ? getMetrologyTemplateName(getMetrologyReportTemplate(formAsset)) : "Selecciona un equipo"}</strong><small>{formAssetReport ? `Último: ${formatDate(formAssetReport.completedAt)} · ${formAssetReport.performedBy}` : "Sin informe previo en la plataforma"}</small></div>
        </div>
        {workspaceError ? <p className="metrology-workspace-error"><AlertTriangle size={15} />{workspaceError}</p> : null}
        <footer><span><BadgeCheck size={15} /> El formato se llena, firma y guarda sin salir de IntegraQ.</span><button className="button button-primary" disabled={!formAsset || !serverConnected || !canExecute} type="button" onClick={() => formAsset && setSelectedAsset(formAsset)}><ClipboardCheck size={15} /> Abrir formato</button></footer>
      </section>

      <section className="table-panel metrology-register">
        <div className="metrology-scope-tabs" role="tablist" aria-label="Alcances metrológicos">
          <button className={scopeFilter === "all" ? "active" : ""} type="button" onClick={() => setScopeFilter("all")}>Todos <span>{assets.length}</span></button>
          <button className={scopeFilter === "verification" ? "active" : ""} type="button" onClick={() => setScopeFilter("verification")}>Verificación interna <span>{metrics.verification}</span></button>
          <button className={scopeFilter === "calibration" ? "active" : ""} type="button" onClick={() => setScopeFilter("calibration")}>Calibración externa <span>{metrics.calibration}</span></button>
          <button className={scopeFilter === "standards" ? "active" : ""} type="button" onClick={() => setScopeFilter("standards")}>Patrones <span>{referenceStandards.length}</span></button>
        </div>
        <div className="table-toolbar">
          <div><h3>Padrón de equipos de medición</h3><span>{filteredAssets.length} registros visibles · F-CA-37 Rev. 0</span></div>
          <div className="table-toolbar-actions">
            <label className="panel-search wide"><Search size={16} /><input aria-label="Buscar equipo" placeholder="Código, equipo, modelo, serie o proveedor" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="filter-control"><Filter size={15} /><select aria-label="Filtrar vigencia" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todas las vigencias</option><option value="current">Vigentes</option><option value="due_soon">Próximos</option><option value="overdue">Vencidos</option></select></label>
          </div>
        </div>

        <div className="data-table-wrap"><table className="data-table metrology-table"><thead><tr><th>Equipo</th><th>Alcance</th><th>Patrón / proveedor</th><th>Ubicación</th><th>Próxima fecha</th><th>Estado</th><th>Responsable</th><th aria-label="Acciones" /></tr></thead><tbody>
          {filteredAssets.map((asset) => {
            const status = getAssetDueStatus(asset, today);
            const readiness = getVerificationReadiness(asset, assets, today);
            return <tr key={asset.id}><td><div className="equipment-cell"><div className={`equipment-icon ${asset.isReferenceStandard ? "standard" : ""}`}>{asset.isReferenceStandard ? <FlaskConical size={17} /> : <Wrench size={17} />}</div><span><strong>{asset.name}</strong><small>{asset.code}{asset.model ? ` · ${asset.model}` : ""}{asset.isReferenceStandard ? " · Patrón" : ""}</small></span></div></td>
              <td><span className={`metrology-scope scope-${asset.activity}`}>{activityLabels[asset.activity]}</span></td>
              <td><MetrologySupport asset={asset} readiness={readiness} /></td><td>{asset.location}</td><td><strong>{formatDate(asset.nextDueDate)}</strong></td><td><span className={`due-badge due-${status}`}>{formatDueLabel(asset, status)}</span></td><td>{asset.owner}</td><td><span className="metrology-table-actions">{canExecute ? <button className="icon-button compact-button" title={asset.activity === "verification" ? "Llenar verificación" : "Registrar calibración"} type="button" onClick={() => setSelectedAsset(asset)}><ClipboardCheck size={17} /></button> : null}{latestReportForAsset(reports, asset.id) && asset.publicToken ? <a className="icon-button compact-button" href={`/equipment/${asset.publicToken}`} rel="noreferrer" target="_blank" title="Ver último informe"><ExternalLink size={16} /></a> : null}<button className="icon-button compact-button" disabled={!asset.publicToken} onClick={() => setQrAsset(asset)} title="Ver QR del equipo" type="button"><QrCode size={17} /></button></span></td></tr>;
          })}
        </tbody></table></div>

        <div className="mobile-asset-list">{filteredAssets.map((asset) => {
          const status = getAssetDueStatus(asset, today);
          const readiness = getVerificationReadiness(asset, assets, today);
          return <article className="asset-mobile-row" key={asset.id}><div className="asset-mobile-header"><div><small>{asset.code}{asset.isReferenceStandard ? " · Patrón" : ""}</small><strong>{asset.name}</strong></div><span className={`due-badge due-${status}`}>{formatDueLabel(asset, status)}</span></div><dl><div><dt>Alcance</dt><dd>{activityLabels[asset.activity]}</dd></div><div><dt>Patrón / proveedor</dt><dd>{asset.activity === "verification" ? readiness.references.length === 1 ? readiness.reference?.code : `${readiness.references.length} patrones aplicables` : asset.externalProvider ?? "Sin proveedor"}</dd></div><div><dt>Próxima fecha</dt><dd>{formatDate(asset.nextDueDate)}</dd></div><div><dt>Responsable</dt><dd>{asset.owner}</dd></div></dl><div className="metrology-mobile-actions">{canExecute ? <button className="button button-secondary" type="button" onClick={() => setSelectedAsset(asset)}><ClipboardCheck size={16} /> Llenar informe</button> : null}<button className="button button-secondary" disabled={!asset.publicToken} onClick={() => setQrAsset(asset)} type="button"><QrCode size={16} /> QR</button></div></article>;
        })}</div>
      </section>

      {selectedAsset && canExecute ? <MetrologyReportForm asset={selectedAsset} assets={assets} onClose={() => setSelectedAsset(null)} onSave={(report) => completeActivity(selectedAsset, report)} session={session} /> : null}
      {qrAsset ? <MetrologyQrModal asset={qrAsset} lastReport={latestReportForAsset(reports, qrAsset.id)} onClose={() => setQrAsset(null)} /> : null}
      {isCreateOpen && canManageAssets ? <CreateAssetModal assets={assets} today={today} onClose={() => setCreateOpen(false)} onSubmit={addAsset} /> : null}
    </>
  );
}

function MetrologySupport({ asset, readiness }: { asset: MeasurementAsset; readiness: ReturnType<typeof getVerificationReadiness> }) {
  if (asset.activity === "calibration") return <span className="metrology-support"><strong>{asset.externalProvider ?? "Proveedor pendiente"}</strong><small>Servicio externo</small></span>;
  const supportLabel = readiness.references.length > 1
    ? `${readiness.references.length} patrones de ${asset.measurementCategory?.toLocaleLowerCase("es-MX") ?? "medición"}`
    : readiness.reference
      ? `${readiness.reference.code} · ${readiness.reference.name}`
      : "Sin patrón asignado";
  return <span className={`metrology-support ${readiness.ready ? "ready" : "blocked"}`}><strong>{supportLabel}</strong><small>{readiness.reason}</small></span>;
}

function CalibrationMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: "neutral" | "danger" | "success" }) {
  return <div className={`metric metric-${tone}`}><div className="metric-icon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function CreateAssetModal({ assets, today, onClose, onSubmit }: { assets: MeasurementAsset[]; today: string; onClose: () => void; onSubmit: (asset: Omit<MeasurementAsset, "id" | "evidenceCount">) => void }) {
  const currentStandards = getCurrentReferenceStandards(assets, today);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [measurementCategory, setMeasurementCategory] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [measurementRange, setMeasurementRange] = useState("");
  const [resolution, setResolution] = useState("");
  const [observations, setObservations] = useState("");
  const [activity, setActivity] = useState<MeasurementActivity>(currentStandards.length ? "verification" : "calibration");
  const [frequencyMonths, setFrequencyMonths] = useState(3);
  const [lastCompletedAt, setLastCompletedAt] = useState(today);
  const [standard, setStandard] = useState("");
  const [referenceStandardId, setReferenceStandardId] = useState(currentStandards[0]?.id ?? "");
  const [externalProvider, setExternalProvider] = useState("");
  const [isReferenceStandard, setIsReferenceStandard] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ code, name, location, owner, activity, frequencyMonths, frequencyDays: frequencyMonths * 30, lastCompletedAt, nextDueDate: calculateNextDueDate(lastCompletedAt, frequencyMonths), standard, isReferenceStandard, referenceStandardId: activity === "verification" ? referenceStandardId : undefined, referenceStandardIds: activity === "verification" && referenceStandardId ? [referenceStandardId] : undefined, externalProvider: activity === "calibration" ? externalProvider : undefined, measurementCategory, model, serialNumber, measurementRange, resolution, observations });
  }

  return <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="module-kicker">Control metrológico</p><h3>Registrar nuevo equipo</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={submit}><div className="form-grid"><label className="field"><span>Código</span><input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="EQ-MET-000" /></label><label className="field"><span>Alcance</span><select disabled={isReferenceStandard} value={activity} onChange={(event) => setActivity(event.target.value as MeasurementActivity)}><option value="verification">Verificación interna</option><option value="calibration">Calibración externa</option></select></label>
      <label className="field field-span-2 metrology-standard-toggle"><input type="checkbox" checked={isReferenceStandard} onChange={(event) => { setIsReferenceStandard(event.target.checked); if (event.target.checked) setActivity("calibration"); }} /><span>Este registro es un patrón utilizado para verificaciones internas</span></label>
      <label className="field field-span-2"><span>Nombre del equipo</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Equipo, instrumento o patrón" /></label><label className="field"><span>Magnitud</span><input required value={measurementCategory} onChange={(event) => setMeasurementCategory(event.target.value)} placeholder="Masa, longitud, temperatura..." /></label><label className="field"><span>Modelo</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label><label className="field"><span>Número de serie</span><input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label><label className="field"><span>Alcance</span><input value={measurementRange} onChange={(event) => setMeasurementRange(event.target.value)} /></label><label className="field"><span>Resolución</span><input value={resolution} onChange={(event) => setResolution(event.target.value)} /></label><label className="field"><span>Ubicación</span><input required value={location} onChange={(event) => setLocation(event.target.value)} /></label><label className="field"><span>Responsable</span><input required value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
      {activity === "verification" ? <label className="field field-span-2"><span>Patrón interno vigente</span><select required value={referenceStandardId} onChange={(event) => setReferenceStandardId(event.target.value)}>{currentStandards.length ? currentStandards.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.code} · {pattern.name} · vence {formatDate(pattern.nextDueDate)}</option>) : <option value="">No hay patrones vigentes</option>}</select></label> : <label className="field field-span-2"><span>Proveedor externo</span><input required value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Laboratorio o proveedor de calibración" /></label>}
      <label className="field"><span>Frecuencia (meses)</span><input required type="number" min={1} max={60} value={frequencyMonths} onChange={(event) => setFrequencyMonths(Number(event.target.value))} /></label><label className="field"><span>Última ejecución</span><input required type="date" value={lastCompletedAt} onChange={(event) => setLastCompletedAt(event.target.value)} /></label><label className="field field-span-2"><span>Método, criterio o referencia</span><input required value={standard} onChange={(event) => setStandard(event.target.value)} placeholder="Método interno, criterio de aceptación o norma aplicable" /></label><label className="field field-span-2"><span>Observaciones</span><textarea value={observations} onChange={(event) => setObservations(event.target.value)} /></label>
    </div><div className="modal-footer"><button className="button button-ghost" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={activity === "verification" && !referenceStandardId} type="submit"><Plus size={16} /> Registrar equipo</button></div></form>
  </div></div>;
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatDueLabel(asset: MeasurementAsset, status: DueStatus) {
  return asset.schedulePending || !asset.nextDueDate ? "Sin fecha" : dueLabels[status];
}
