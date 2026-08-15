"use client";

import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  Gauge,
  LockKeyhole,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  Sheet,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, type ReactNode, useMemo, useState } from "react";

import {
  buildDefaultEvaluationRules,
  buildQuarterSchedule,
  canSubmitIndicator,
  evaluateConfiguredIndicator,
  formatIndicatorValue,
  getIndicatorScheduleDate,
  getIndicatorScore,
  parseIndicatorMetric,
  quarters,
  statusLabels,
  type ConfiguredIndicator,
  type IndicatorResultRecord,
  type IndicatorResults,
  type IndicatorStatus,
  type Quarter,
} from "@/lib/indicator-data";
import {
  canManageIndicatorCatalog,
  canUpdateIndicatorResult,
  getAccessibleIndicators,
} from "@/lib/indicator-access";
import { activeSession } from "@/lib/session-data";

type IndicatorView = "dashboard" | "sheet" | "pending" | "catalog" | "submission";

interface SubmissionSelection {
  indicatorId: string;
  quarter: Quarter;
  year: number;
}

const yearOptions = [2025, 2026];
const quarterLabels: Record<Quarter, string> = {
  Q1: "T1 · Ene–Mar",
  Q2: "T2 · Abr–Jun",
  Q3: "T3 · Jul–Sep",
  Q4: "T4 · Oct–Dic",
};

interface IndicatorsModuleProps {
  definitions: ConfiguredIndicator[];
  focusId?: string;
  results: IndicatorResults;
  onDefinitionsChange: (definitions: ConfiguredIndicator[]) => void;
  onResultsChange: (results: IndicatorResults) => void;
}

export function IndicatorsModule({
  definitions,
  focusId,
  results,
  onDefinitionsChange,
  onResultsChange,
}: IndicatorsModuleProps) {
  const canManageCatalog = canManageIndicatorCatalog(activeSession);
  const focusedIndicator = definitions.find((indicator) => indicator.id === focusId);
  const [view, setView] = useState<IndicatorView>("dashboard");
  const [year, setYear] = useState(2026);
  const [area, setArea] = useState(focusedIndicator?.area ?? activeSession.department);
  const [query, setQuery] = useState(focusedIndicator?.id ?? "");
  const [dashboardQuarter, setDashboardQuarter] = useState<Quarter>("Q2");
  const [pendingQuarter, setPendingQuarter] = useState<Quarter>("Q3");
  const [submission, setSubmission] = useState<SubmissionSelection | null>(null);

  const accessibleDefinitions = useMemo(
    () => getAccessibleIndicators(activeSession, definitions),
    [definitions],
  );
  const areas = useMemo(() => Array.from(new Set(accessibleDefinitions.map((indicator) => indicator.area))), [accessibleDefinitions]);
  const visibleIndicators = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return accessibleDefinitions.filter(
      (indicator) =>
        indicator.area === area &&
        (!normalized || [indicator.id, indicator.name, indicator.leader, indicator.description].some((value) => value.toLocaleLowerCase("es").includes(normalized))),
    );
  }, [accessibleDefinitions, area, query]);

  function openSubmission(indicatorId: string, selectedYear: number, quarter: Quarter) {
    if (!accessibleDefinitions.some((indicator) => indicator.id === indicatorId)) return;
    setSubmission({ indicatorId, year: selectedYear, quarter });
    setView("submission");
  }

  return (
    <>
      <section className="module-heading indicator-module-heading">
        <div>
          <p className="module-kicker">Planeación y desempeño</p>
          <h2>Objetivos e indicadores</h2>
          <p>Seguimiento trimestral basado en la sábana F-SGC-29.</p>
        </div>
        <div className="indicator-heading-actions">
          <span><Settings2 size={16} /> {accessibleDefinitions.length} indicadores</span>
          {canManageCatalog ? (
            <button className="button button-primary" type="button" onClick={() => setView("catalog")}>
              <Settings2 size={17} /> Administrar indicadores
            </button>
          ) : null}
        </div>
      </section>

      {view !== "catalog" && view !== "submission" ? (
        <div className="indicator-view-tabs" aria-label="Vistas de objetivos e indicadores">
          <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => setView("dashboard")}><Gauge size={16} /> Dashboard</button>
          <button className={view === "sheet" ? "active" : ""} type="button" onClick={() => setView("sheet")}><Sheet size={16} /> Sábana anual</button>
          <button className={view === "pending" ? "active" : ""} type="button" onClick={() => setView("pending")}><CalendarClock size={16} /> Pendientes de captura</button>
        </div>
      ) : null}

      {view === "dashboard" ? <IndicatorDashboard area={area} areas={areas} indicators={visibleIndicators} onAreaChange={setArea} onQueryChange={setQuery} onQuarterChange={setDashboardQuarter} onYearChange={setYear} query={query} quarter={dashboardQuarter} results={results} year={year} /> : null}
      {view === "sheet" ? <IndicatorSheet area={area} areas={areas} indicators={visibleIndicators} onAreaChange={setArea} onOpenSubmission={openSubmission} onQueryChange={setQuery} onYearChange={setYear} query={query} results={results} year={year} /> : null}
      {view === "pending" ? <PendingIndicators area={area} areas={areas} indicators={visibleIndicators} onAreaChange={setArea} onOpenSubmission={openSubmission} onQueryChange={setQuery} onQuarterChange={setPendingQuarter} onYearChange={setYear} query={query} quarter={pendingQuarter} results={results} year={year} /> : null}
      {view === "catalog" && canManageCatalog ? <IndicatorCatalogManager definitions={definitions} onBack={() => setView("dashboard")} onDefinitionsChange={onDefinitionsChange} onResultsChange={onResultsChange} results={results} year={year} /> : null}
      {view === "submission" && submission && accessibleDefinitions.some((indicator) => indicator.id === submission.indicatorId) ? (
        <IndicatorSubmission
          indicator={accessibleDefinitions.find((item) => item.id === submission.indicatorId) ?? accessibleDefinitions[0]}
          onBack={() => setView("pending")}
          onResult={(record) => onResultsChange(setIndicatorRecord(results, submission.indicatorId, submission.year, submission.quarter, record))}
          quarter={submission.quarter}
          record={getIndicatorRecord(results, submission.indicatorId, submission.year, submission.quarter)}
          year={submission.year}
        />
      ) : null}
    </>
  );
}

interface SharedViewProps {
  area: string;
  areas: string[];
  indicators: ConfiguredIndicator[];
  onAreaChange: (area: string) => void;
  onQueryChange: (query: string) => void;
  onYearChange: (year: number) => void;
  query: string;
  results: IndicatorResults;
  year: number;
}

function IndicatorDashboard({ area, areas, indicators, onAreaChange, onQueryChange, onQuarterChange, onYearChange, query, quarter, results, year }: SharedViewProps & { quarter: Quarter; onQuarterChange: (quarter: Quarter) => void }) {
  const statusCounts = countStatuses(indicators, results, year, quarter);
  const uploaded = indicators.length - statusCounts.not_uploaded - statusCounts.pending;
  const compliance = uploaded === 0 ? 0 : Math.round((statusCounts.compliant / uploaded) * 100);
  const groups = groupIndicators(indicators);

  return (
    <section className="indicator-workspace-panel">
      <IndicatorToolbar area={area} areas={areas} onAreaChange={onAreaChange} onQueryChange={onQueryChange} onYearChange={onYearChange} query={query} year={year}>
        <select aria-label="Trimestre del dashboard" value={quarter} onChange={(event) => onQuarterChange(event.target.value as Quarter)}>{quarters.map((item) => <option key={item} value={item}>{quarterLabels[item]}</option>)}</select>
      </IndicatorToolbar>
      <div className="indicator-summary-strip" aria-label="Resumen del trimestre">
        <div className="indicator-summary-main"><BarChart3 size={20} /><span><strong>{compliance}%</strong><small>cumplimiento · {quarterLabels[quarter]}</small></span></div>
        <StatusSummary status="compliant" value={statusCounts.compliant} />
        <StatusSummary status="marginal" value={statusCounts.marginal} />
        <StatusSummary status="noncompliant" value={statusCounts.noncompliant} />
        <StatusSummary status="not_uploaded" value={statusCounts.not_uploaded} />
      </div>
      <header className="indicator-section-header"><div><p className="module-kicker">Lectura por métrica</p><h3>{area}</h3></div><IndicatorLegend compact /></header>
      {groups.map((group) => (
        <section className="indicator-process-group" key={group.area}>
          <header><div><strong>{group.area}</strong><small>{group.items[0]?.processId}</small></div><span>{group.items.length} indicadores</span></header>
          <div className="gauge-grid">
            {group.items.map((indicator) => {
              const record = getIndicatorRecord(results, indicator.id, year, quarter);
              const rule = parseIndicatorMetric(indicator.metric);
              const status = evaluateConfiguredIndicator(indicator, record?.value, year, quarter);
              return <IndicatorGauge indicator={indicator} key={indicator.id} rule={rule} status={status} value={record?.value} />;
            })}
          </div>
        </section>
      ))}
      {indicators.length === 0 ? <EmptyIndicators /> : null}
    </section>
  );
}

function IndicatorSheet({ area, areas, indicators, onAreaChange, onOpenSubmission, onQueryChange, onYearChange, query, results, year }: SharedViewProps & { onOpenSubmission: (id: string, year: number, quarter: Quarter) => void }) {
  function exportCsv() {
    const header = ["Código", "Área", "Objetivo de calidad", "KPI", "Líder", "Métrica", ...quarters];
    const rows = indicators.map((indicator) => {
      const rule = parseIndicatorMetric(indicator.metric);
      return [indicator.id, indicator.area, indicator.qualityObjective, indicator.name, indicator.leader, indicator.metric, ...quarters.map((quarter) => formatIndicatorValue(getIndicatorRecord(results, indicator.id, year, quarter)?.value, rule))];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sabana-indicadores-${year}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="indicator-workspace-panel">
      <IndicatorToolbar area={area} areas={areas} onAreaChange={onAreaChange} onQueryChange={onQueryChange} onYearChange={onYearChange} query={query} year={year}><button className="button button-secondary indicator-export" type="button" onClick={exportCsv}><Download size={16} /> Exportar CSV</button></IndicatorToolbar>
      <div className="indicator-sheet-title"><div><p className="module-kicker">Calendario trimestral</p><h3>Sábana de indicadores {year}</h3><p>Cada celda abre únicamente el expediente de ese indicador y trimestre.</p></div><IndicatorLegend /></div>
      <div className="indicator-table-wrap">
        <table className="indicator-table">
          <thead><tr><th>Código</th><th>Área</th><th>Objetivo de calidad</th><th>KPI</th><th>Líder</th><th>Métrica</th><th>Periodo</th>{quarters.map((quarter) => <th key={quarter}>{quarterLabels[quarter]}</th>)}<th>Descripción</th></tr></thead>
          <tbody>
            {groupIndicators(indicators).flatMap((group) => [
              <tr className="indicator-table-process-row" key={`group-${group.area}`}><td colSpan={12}><strong>{group.area}</strong><span>{group.items[0]?.processId} · {group.items.length} indicadores</span></td></tr>,
              ...group.items.map((indicator) => {
                const rule = parseIndicatorMetric(indicator.metric);
                return (
                  <tr key={indicator.id}>
                    <td><code>{indicator.id}</code></td><td><strong>{indicator.area}</strong><small>{indicator.processId}</small></td><td>{indicator.qualityObjective || "Sin vínculo definido"}</td><td><strong>{indicator.name}</strong></td><td>{indicator.leader}</td><td><span className="indicator-metric-cell">{indicator.metric}</span></td><td>{indicator.period}</td>
                    {quarters.map((quarter) => {
                      const record = getIndicatorRecord(results, indicator.id, year, quarter);
                      const status = evaluateConfiguredIndicator(indicator, record?.value, year, quarter);
                      return <td className={`quarter-result-cell quarter-result-${status}`} key={quarter}><button type="button" title={`Abrir ${indicator.name}, ${quarterLabels[quarter]}`} onClick={() => onOpenSubmission(indicator.id, year, quarter)}><strong>{formatIndicatorValue(record?.value, rule)}</strong><small>{statusLabels[status]}</small></button></td>;
                    })}
                    <td>{indicator.description}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
      {indicators.length === 0 ? <EmptyIndicators /> : null}
    </section>
  );
}

function PendingIndicators({ area, areas, indicators, onAreaChange, onOpenSubmission, onQueryChange, onQuarterChange, onYearChange, query, quarter, results, year }: SharedViewProps & { quarter: Quarter; onQuarterChange: (quarter: Quarter) => void; onOpenSubmission: (id: string, year: number, quarter: Quarter) => void }) {
  return (
    <section className="indicator-workspace-panel">
      <IndicatorToolbar area={area} areas={areas} onAreaChange={onAreaChange} onQueryChange={onQueryChange} onYearChange={onYearChange} query={query} year={year}><select aria-label="Trimestre pendiente" value={quarter} onChange={(event) => onQuarterChange(event.target.value as Quarter)}>{quarters.map((item) => <option key={item} value={item}>{quarterLabels[item]}</option>)}</select></IndicatorToolbar>
      <div className="capture-title-band"><div><p className="module-kicker">Captura manual</p><h3>Pendientes · {quarterLabels[quarter]} de {year}</h3><p>Abre un indicador para consultar su fecha y registrar únicamente ese resultado.</p></div><span>{indicators.filter((indicator) => !getIndicatorRecord(results, indicator.id, year, quarter)).length} pendientes</span></div>
      <div className="indicator-pending-groups">
        {groupIndicators(indicators).map((group) => (
          <section className="indicator-pending-group" key={group.area}>
            <header><div><strong>{group.area}</strong><small>{group.items[0]?.processId}</small></div><span>{group.items.length}</span></header>
            {group.items.map((indicator) => {
              const record = getIndicatorRecord(results, indicator.id, year, quarter);
              const status = evaluateConfiguredIndicator(indicator, record?.value, year, quarter);
              const available = canSubmitIndicator(indicator, year, quarter);
              return (
                <button className="indicator-pending-row" key={indicator.id} type="button" onClick={() => onOpenSubmission(indicator.id, year, quarter)}>
                  <span><strong>{indicator.name}</strong><small>{indicator.id} · {indicator.leader}</small></span>
                  <span><CalendarClock size={15} /><small>Fecha programada</small><strong>{formatScheduleDate(getIndicatorScheduleDate(indicator, year, quarter))}</strong></span>
                  <span className={`indicator-status indicator-status-${status}`}>{record ? statusLabels[status] : available ? "Disponible hoy" : statusLabels[status]}</span>
                  <Eye size={17} />
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {indicators.length === 0 ? <EmptyIndicators /> : null}
    </section>
  );
}

function IndicatorSubmission({ indicator, onBack, onResult, quarter, record, year }: { indicator: ConfiguredIndicator; onBack: () => void; onResult: (record: IndicatorResultRecord) => void; quarter: Quarter; record?: IndicatorResultRecord; year: number }) {
  const [evidence, setEvidence] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const rule = parseIndicatorMetric(indicator.metric);
  const status = evaluateConfiguredIndicator(indicator, record?.value, year, quarter);
  const editable = canUpdateIndicatorResult(activeSession, indicator) && canSubmitIndicator(indicator, year, quarter);
  const scheduledDate = getIndicatorScheduleDate(indicator, year, quarter);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    const form = new FormData(event.currentTarget);
    onResult({
      value: Number(form.get("value")),
      comments: String(form.get("comments") ?? "").trim(),
      evidenceName: evidence?.name ?? record?.evidenceName,
      evidenceSize: evidence?.size ?? record?.evidenceSize,
      submittedAt: new Date().toISOString(),
      submittedBy: activeSession.name,
    });
    setSaved(true);
  }

  return (
    <section className="indicator-workspace-panel indicator-submission-panel">
      <header className="indicator-submission-header">
        <button className="icon-button" type="button" title="Volver a pendientes" onClick={onBack}><ArrowLeft size={18} /></button>
        <div><p className="module-kicker">Expediente individual</p><h3>{indicator.name}</h3><p>{indicator.id} · {indicator.area} · {quarterLabels[quarter]} de {year}</p></div>
        <span className={`indicator-status indicator-status-${status}`}>{statusLabels[status]}</span>
      </header>
      <div className="indicator-submission-facts">
        <div><small>Métrica</small><strong>{indicator.metric}</strong></div><div><small>Responsable</small><strong>{indicator.leader}</strong></div><div><small>Fecha programada</small><strong>{formatScheduleDate(scheduledDate)}</strong></div><div><small>Periodicidad</small><strong>{indicator.period}</strong></div>
      </div>
      <section className={`indicator-capture-window ${editable ? "available" : "locked"}`}>
        {editable ? <CheckCircle2 size={19} /> : <LockKeyhole size={19} />}
        <div><strong>{editable ? "Captura habilitada hoy" : "Captura bloqueada por fecha"}</strong><p>{editable ? "El resultado se registrará manualmente en este expediente." : `Solo se habilitará el ${formatScheduleDate(scheduledDate)}. El administrador puede reprogramarlo desde el catálogo.`}</p></div>
      </section>
      <form className="indicator-single-form" onSubmit={submit}>
        <label><span>Resultado trimestral</span><div className="indicator-value-input"><input defaultValue={record?.value ?? ""} disabled={!editable} min="0" name="value" required step="any" type="number" /><span>{rule.unit === "percent" ? "%" : rule.unit === "weeks" ? "sem" : "valor"}</span></div><small>Se evaluará contra {indicator.metric}.</small></label>
        <label><span>Comentarios</span><textarea defaultValue={record?.comments ?? ""} disabled={!editable} name="comments" placeholder="Contexto del resultado, desviaciones o acciones relacionadas" rows={5} /></label>
        <label><span>Evidencia</span><div className={`indicator-evidence-field ${!editable ? "disabled" : ""}`}><Paperclip size={18} /><div><strong>{evidence?.name ?? record?.evidenceName ?? "Sin archivo adjunto"}</strong><small>PDF, imagen o archivo de Excel</small></div><input accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls" aria-label="Adjuntar evidencia" disabled={!editable} onChange={(event) => setEvidence(event.target.files?.[0] ?? null)} type="file" /></div></label>
        {record ? <div className="indicator-existing-record"><FileCheck2 size={17} /><span><strong>Último registro manual</strong><small>{record.submittedBy} · {formatTimestamp(record.submittedAt)}</small></span></div> : null}
        <footer><p>{saved ? <><CheckCircle2 size={15} /> Resultado guardado</> : <><CircleAlert size={15} /> No se cargará información automáticamente.</>}</p><button className="button button-primary" disabled={!editable} type="submit"><Save size={17} /> Guardar resultado</button></footer>
      </form>
    </section>
  );
}

function IndicatorCatalogManager({ definitions, onBack, onDefinitionsChange, onResultsChange, results, year }: { definitions: ConfiguredIndicator[]; onBack: () => void; onDefinitionsChange: (definitions: ConfiguredIndicator[]) => void; onResultsChange: (results: IndicatorResults) => void; results: IndicatorResults; year: number }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ConfiguredIndicator | "new" | null>(null);
  const [deleting, setDeleting] = useState<ConfiguredIndicator | null>(null);
  const filtered = definitions.filter((indicator) => !query.trim() || [indicator.id, indicator.area, indicator.name, indicator.leader].some((value) => value.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es"))));

  function saveIndicator(indicator: ConfiguredIndicator) {
    const exists = definitions.some((item) => item.id === indicator.id);
    onDefinitionsChange(exists ? definitions.map((item) => item.id === indicator.id ? indicator : item) : [...definitions, indicator]);
    if (!exists) onResultsChange({ ...results, [indicator.id]: { "2025": {}, "2026": {} } });
    setEditing(null);
  }

  function deleteIndicator() {
    if (!deleting) return;
    onDefinitionsChange(definitions.filter((item) => item.id !== deleting.id));
    const next = { ...results };
    delete next[deleting.id];
    onResultsChange(next);
    setDeleting(null);
  }

  return (
    <section className="indicator-workspace-panel indicator-catalog-panel">
      <header className="indicator-catalog-header"><button className="icon-button" type="button" title="Volver al dashboard" onClick={onBack}><ArrowLeft size={18} /></button><div><p className="module-kicker">Configuración administrativa</p><h3>Catálogo de indicadores</h3><p>Altas, responsables, métricas y fechas trimestrales de captura.</p></div><button className="button button-primary" type="button" onClick={() => setEditing("new")}><Plus size={17} /> Nuevo indicador</button></header>
      <div className="indicator-catalog-search"><label className="panel-search indicator-search"><Search size={16} /><input aria-label="Buscar en catálogo" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar indicador, proceso o responsable" value={query} /></label><span>{filtered.length} indicadores</span></div>
      <div className="indicator-catalog-groups">
        {groupIndicators(filtered).map((group) => <section className="indicator-catalog-group" key={group.area}><header><div><strong>{group.area}</strong><small>{group.items[0]?.processId}</small></div><span>{group.items.length}</span></header>{group.items.map((indicator) => <div className="indicator-catalog-row" key={indicator.id}><code>{indicator.id}</code><span><strong>{indicator.name}</strong><small>{indicator.leader} · {indicator.metric}</small><span className="indicator-rule-summary"><i className="rule-compliant">Cumple {indicator.evaluationRules.compliant}</i><i className="rule-marginal">Marginal {indicator.evaluationRules.marginal}</i><i className="rule-noncompliant">No cumple {indicator.evaluationRules.noncompliant}</i></span></span><span><small>{quarterLabels.Q3} {year}</small><strong>{formatScheduleDate(getIndicatorScheduleDate(indicator, year, "Q3"))}</strong></span><button className="icon-button" type="button" title={`Editar ${indicator.name}`} onClick={() => setEditing(indicator)}><Pencil size={16} /></button><button className="icon-button danger" type="button" title={`Eliminar ${indicator.name}`} onClick={() => setDeleting(indicator)}><Trash2 size={16} /></button></div>)}</section>)}
      </div>
      {editing ? <IndicatorEditor definitions={definitions} indicator={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={saveIndicator} year={year} /> : null}
      {deleting ? <div className="quality-modal-backdrop" role="presentation" onMouseDown={() => setDeleting(null)}><section className="quality-modal indicator-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-indicator-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>{deleting.id}</span><h3 id="delete-indicator-title">Eliminar indicador</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={() => setDeleting(null)}><X size={17} /></button></header><div className="indicator-delete-copy"><CircleAlert size={23} /><p>Se eliminará <strong>{deleting.name}</strong> y sus resultados locales. Esta acción no se puede deshacer.</p></div><footer><button className="button button-secondary" type="button" onClick={() => setDeleting(null)}>Cancelar</button><button className="button indicator-delete-button" type="button" onClick={deleteIndicator}><Trash2 size={16} /> Eliminar</button></footer></section></div> : null}
    </section>
  );
}

function IndicatorEditor({ definitions, indicator, onClose, onSave, year }: { definitions: ConfiguredIndicator[]; indicator: ConfiguredIndicator | null; onClose: () => void; onSave: (indicator: ConfiguredIndicator) => void; year: number }) {
  const nextId = `IND-${String(Math.max(0, ...definitions.map((item) => Number(item.id.replace(/\D/g, "")) || 0)) + 1).padStart(3, "0")}`;
  const defaults = indicator?.schedule[String(year)] ?? buildQuarterSchedule(year);
  const defaultRules = indicator?.evaluationRules ?? buildDefaultEvaluationRules(">=90%");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const schedule = structuredClone(indicator?.schedule ?? { "2025": buildQuarterSchedule(2025), "2026": buildQuarterSchedule(2026) });
    schedule[String(year)] = Object.fromEntries(quarters.map((quarter) => [quarter, String(form.get(`schedule-${quarter}`))])) as Record<Quarter, string>;
    onSave({
      id: indicator?.id ?? nextId,
      sourceRow: indicator?.sourceRow ?? 0,
      processId: String(form.get("processId")).trim(),
      area: String(form.get("area")).trim(),
      directionObjective: indicator?.directionObjective ?? "",
      directionMetric: indicator?.directionMetric ?? "",
      qualityObjective: String(form.get("qualityObjective")).trim(),
      name: String(form.get("name")).trim(),
      leader: String(form.get("leader")).trim(),
      metric: String(form.get("metric")).trim(),
      period: "Trimestral",
      description: String(form.get("description")).trim(),
      evaluationRules: {
        compliant: String(form.get("rule-compliant")).trim(),
        marginal: String(form.get("rule-marginal")).trim(),
        noncompliant: String(form.get("rule-noncompliant")).trim(),
      },
      schedule: { ...schedule },
    });
  }

  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal indicator-editor-modal" role="dialog" aria-modal="true" aria-labelledby="indicator-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{indicator?.id ?? nextId}</span><h3 id="indicator-editor-title">{indicator ? "Editar indicador" : "Nuevo indicador"}</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={submit}>
          <div className="indicator-editor-grid"><label><span>Proceso o área</span><input defaultValue={indicator?.area ?? ""} name="area" required /></label><label><span>Código de proceso</span><input defaultValue={indicator?.processId ?? ""} name="processId" required /></label><label className="span-2"><span>Nombre del indicador</span><input defaultValue={indicator?.name ?? ""} name="name" required /></label><label><span>Responsable</span><input defaultValue={indicator?.leader ?? ""} name="leader" required /></label><label><span>Métrica</span><input defaultValue={indicator?.metric ?? ""} name="metric" placeholder="Ej. ≥90%" required /></label><label className="span-2"><span>Objetivo de calidad</span><textarea defaultValue={indicator?.qualityObjective ?? ""} name="qualityObjective" rows={2} /></label><label className="span-2"><span>Descripción</span><textarea defaultValue={indicator?.description ?? ""} name="description" required rows={3} /></label></div>
          <fieldset className="indicator-rules-fieldset"><legend>Reglas de evaluación</legend><div><label className="rule-compliant"><span>Cumple</span><input defaultValue={defaultRules.compliant} name="rule-compliant" placeholder=">=90" required /></label><label className="rule-marginal"><span>Marginal</span><input defaultValue={defaultRules.marginal} name="rule-marginal" placeholder=">=85.5,<90" required /></label><label className="rule-noncompliant"><span>No cumple</span><input defaultValue={defaultRules.noncompliant} name="rule-noncompliant" placeholder="<85.5" required /></label></div><p>Usa operadores &gt;, &gt;=, &lt;, &lt;= o =. Separa condiciones simultáneas con coma y alternativas con punto y coma.</p></fieldset>
          <fieldset className="indicator-schedule-fieldset"><legend>Fechas programadas de captura · {year}</legend><div>{quarters.map((quarter) => <label key={quarter}><span>{quarterLabels[quarter]}</span><input defaultValue={defaults[quarter]} name={`schedule-${quarter}`} required type="date" /></label>)}</div><p>La captura solo estará habilitada en la fecha indicada para cada trimestre.</p></fieldset>
          <footer><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit"><Save size={16} /> Guardar indicador</button></footer>
        </form>
      </section>
    </div>
  );
}

function IndicatorToolbar({ area, areas, children, onAreaChange, onQueryChange, onYearChange, query, year }: Omit<SharedViewProps, "indicators" | "results"> & { children: ReactNode }) {
  return <div className="indicator-toolbar"><label className="panel-search indicator-search"><Search size={16} /><input aria-label="Buscar indicador" onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar KPI o responsable" value={query} /></label><label><span>Área o proceso</span><select aria-label="Área o proceso" value={area} onChange={(event) => onAreaChange(event.target.value)}>{areas.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Año</span><select aria-label="Año" value={year} onChange={(event) => onYearChange(Number(event.target.value))}>{yearOptions.map((item) => <option key={item}>{item}</option>)}</select></label><div className="indicator-toolbar-extra">{children}</div></div>;
}

function IndicatorGauge({ indicator, rule, status, value }: { indicator: ConfiguredIndicator; rule: ReturnType<typeof parseIndicatorMetric>; status: IndicatorStatus; value: number | undefined }) {
  const score = getIndicatorScore(value, rule, status);
  const angle = score === null ? null : 180 - score * 1.8;
  const needleX = angle === null ? 100 : 100 + 56 * Math.cos((angle * Math.PI) / 180);
  const needleY = angle === null ? 100 : 100 - 56 * Math.sin((angle * Math.PI) / 180);
  return <article className="indicator-gauge-card"><header><span>{indicator.id} · {indicator.area}</span><span className={`indicator-status indicator-status-${status}`}>{statusLabels[status]}</span></header><div className="indicator-gauge" aria-label={`${indicator.name}: ${statusLabels[status]}`}><svg viewBox="0 0 200 118" role="img"><path className="gauge-red" d="M20 100 A80 80 0 0 1 124.7 23.9" /><path className="gauge-orange" d="M124.7 23.9 A80 80 0 0 1 164.7 53" /><path className="gauge-green" d="M164.7 53 A80 80 0 0 1 180 100" />{angle === null ? null : <line className="gauge-needle" x1="100" y1="100" x2={needleX} y2={needleY} />}<circle cx="100" cy="100" r="6" /></svg><strong>{formatIndicatorValue(value, rule)}</strong></div><div className="indicator-gauge-copy"><h4>{indicator.name}</h4><p>Meta: <strong>{indicator.metric}</strong></p><small>{indicator.leader}</small></div></article>;
}

function StatusSummary({ status, value }: { status: IndicatorStatus; value: number }) { return <div className={`indicator-summary-status indicator-summary-${status}`}><span>{value}</span><small>{statusLabels[status]}</small></div>; }
function IndicatorLegend({ compact = false }: { compact?: boolean }) { return <div className={`indicator-legend ${compact ? "compact" : ""}`}>{(["compliant", "marginal", "noncompliant", "not_uploaded", "pending"] as IndicatorStatus[]).map((status) => <span key={status}><i className={`legend-${status}`} />{statusLabels[status]}</span>)}</div>; }
function EmptyIndicators() { return <div className="indicator-empty"><CalendarRange size={24} /><strong>Sin indicadores en esta vista</strong><p>Cambia el área o limpia la búsqueda.</p></div>; }

function groupIndicators(indicators: ConfiguredIndicator[]) {
  const groups = new Map<string, ConfiguredIndicator[]>();
  indicators.forEach((indicator) => groups.set(indicator.area, [...(groups.get(indicator.area) ?? []), indicator]));
  return Array.from(groups, ([area, items]) => ({ area, items }));
}

function getIndicatorRecord(results: IndicatorResults, id: string, year: number, quarter: Quarter) { return results[id]?.[String(year)]?.[quarter]; }
function setIndicatorRecord(results: IndicatorResults, id: string, year: number, quarter: Quarter, record: IndicatorResultRecord): IndicatorResults { return { ...results, [id]: { ...(results[id] ?? {}), [String(year)]: { ...(results[id]?.[String(year)] ?? {}), [quarter]: record } } }; }

function countStatuses(indicators: ConfiguredIndicator[], results: IndicatorResults, year: number, quarter: Quarter) {
  return indicators.reduce<Record<IndicatorStatus, number>>((counts, indicator) => { const status = evaluateConfiguredIndicator(indicator, getIndicatorRecord(results, indicator.id, year, quarter)?.value, year, quarter); counts[status] += 1; return counts; }, { compliant: 0, marginal: 0, noncompliant: 0, not_uploaded: 0, pending: 0 });
}

function formatScheduleDate(value: string) { if (!value) return "Sin programar"; return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function formatTimestamp(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
