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
  Q1: "T1 Â· Eneâ€“Mar",
  Q2: "T2 Â· Abrâ€“Jun",
  Q3: "T3 Â· Julâ€“Sep",
  Q4: "T4 Â· Octâ€“Dic",
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
          <p className="module-kicker">PlaneaciÃ³n y desempeÃ±o</p>
          <h2>Objetivos e indicadores</h2>
          <p>Seguimiento trimestral basado en la sÃ¡bana F-SGC-29.</p>
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
          <button className={view === "sheet" ? "active" : ""} type="button" onClick={() => setView("sheet")}><Sheet size={16} /> SÃ¡bana anual</button>
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
        <div className="indicator-summary-main"><BarChart3 size={20} /><span><strong>{compliance}%</strong><small>cumplimiento Â· {quarterLabels[quarter]}</small></span></div>
        <StatusSummary status="compliant" value={statusCounts.compliant} />
        <StatusSummary status="marginal" value={statusCounts.marginal} />
        <StatusSummary status="noncompliant" value={statusCounts.noncompliant} />
        <StatusSummary status="not_uploaded" value={statusCounts.not_uploaded} />
      </div>
      <header className="indicator-section-header"><div><p className="module-kicker">Lectura por mÃ©trica</p><h3>{area}</h3></div><IndicatorLegend compact /></header>
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
    const header = ["CÃ³digo", "Ãrea", "Objetivo de calidad", "KPI", "LÃ­der", "MÃ©trica", ...quarters];
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
      <div className="indicator-sheet-title"><div><p className="module-kicker">Calendario trimestral</p><h3>SÃ¡bana de indicadores {year}</h3><p>Cada celda abre Ãºnicamente el expediente de ese indicador y trimestre.</p></div><IndicatorLegend /></div>
      <div className="indicator-table-wrap">
        <table className="indicator-table">
          <thead><tr><th>CÃ³digo</th><th>Ãrea</th><th>Objetivo de calidad</th><th>KPI</th><th>LÃ­der</th><th>MÃ©trica</th><th>Periodo</th>{quarters.map((quarter) => <th key={quarter}>{quarterLabels[quarter]}</th>)}<th>DescripciÃ³n</th></tr></thead>
          <tbody>
            {groupIndicators(indicators).flatMap((group) => [
              <tr className="indicator-table-process-row" key={`group-${group.area}`}><td colSpan={12}><strong>{group.area}</strong><span>{group.items[0]?.processId} Â· {group.items.length} indicadores</span></td></tr>,
              ...group.items.map((indicator) => {
                const rule = parseIndicatorMetric(indicator.metric);
                return (
                  <tr key={indicator.id}>
                    <td><code>{indicator.id}</code></td><td><strong>{indicator.area}</strong><small>{indicator.processId}</small></td><td>{indicator.qualityObjective || "Sin vÃ­nculo definido"}</td><td><strong>{indicator.name}</strong></td><td>{indicator.leader}</td><td><span className="indicator-metric-cell">{indicator.metric}</span></td><td>{indicator.period}</td>
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
      <div className="capture-title-band"><div><p className="module-kicker">Captura manual</p><h3>Pendientes Â· {quarterLabels[quarter]} de {year}</h3><p>Abre un indicador para consultar su fecha y registrar Ãºnicamente ese resultado.</p></div><span>{indicators.filter((indicator) => !getIndicatorRecord(results, indicator.id, year, quarter)).length} pendientes</span></div>
      <div className="indicator-pending-groups">
        {groupIndicators(indicators).map((group) => (
          <section className="indicator-pending-group" key={group.area}>
            <header><div><strong>{group.area}</strong><small>{group.items[0]?.processId}</small></div><span>{group.items.length}</span></header>
            {group.items.map((indicator) => {
              const record = getIndicatorRecord(results, indicator.id, year, quarter);
              const status = evaluateConfiguredIndicator(indicator, record?.value, year, quarter);
            ×žù¶‰žËkºwµç@€€íÉ•½É€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ•á¥ÍÑ¥¹œµÉ•½Éˆøñ¥±•¡•¬ÈÍ¥é”õìÄÝô€¼øñÍÁ…¸øñÍÑÉ½¹œûi±Ñ¥µ¼É•¥ÍÑÉ¼µ…¹Õ…°ð½ÍÑÉ½¹œøñÍµ…±°ùíÉ•½É¹ÍÕ‰µ¥ÑÑ•‘	åôƒ
Üí™½Éµ…ÑQ¥µ•ÍÑ…µÀ¡É•½É¹ÍÕ‰µ¥ÑÑ•‘Ð¥ôð½Íµ…±°øð½ÍÁ…¸øð½‘¥Øø€è¹Õ±±ô(€€€€€€€€ñ™½½Ñ•ÈøñÀùíÍ…Ù•€ü€ðøñ¡•­¥É±”ÈÍ¥é”õìÄÕô€¼øI•ÍÕ±Ñ…‘¼Õ…É‘…‘¼ð¼ø€è€ðøñ¥É±•±•ÉÐÍ¥é”õìÄÕô€¼ø9¼Í”…É…Ë„¥¹™½Éµ…§Í¸…ÕÑ½·…Ñ¥…µ•¹Ñ”¸ð¼ùôð½Àøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸‰ÕÑÑ½¸µÁÉ¥µ…Éäˆ‘¥Í…‰±•õì…•‘¥Ñ…‰±•ôÑåÁ”ô‰ÍÕ‰µ¥ÐˆøñM…Ù”Í¥é”õìÄÝô€¼øÕ…É‘…ÈÉ•ÍÕ±Ñ…‘¼ð½‰ÕÑÑ½¸øð½™½½Ñ•Èø(€€€€€€ð½™½É´ø(€€€€ð½Í•Ñ¥½¸ø(€€¤ì)ô()™Õ¹Ñ¥½¸%¹‘¥…Ñ½É…Ñ…±½5…¹…•È¡ì‘•™¥¹¥Ñ¥½¹Ì°½¹	…¬°½¹•™¥¹¥Ñ¥½¹Í¡…¹”°½¹I•ÍÕ±ÑÍ¡…¹”°É•ÍÕ±ÑÌ°å•…Èôèì‘•™¥¹¥Ñ¥½¹Ìè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émtì½¹	…¬è€ ¤€ôøÙ½¥ì½¹•™¥¹¥Ñ¥½¹Í¡…¹”è€¡‘•™¥¹¥Ñ¥½¹Ìè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émt¤€ôøÙ½¥ì½¹I•ÍÕ±ÑÍ¡…¹”è€¡É•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ¤€ôøÙ½¥ìÉ•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌìå•…Èè¹Õµ‰•Èô¤ì(€½¹ÍÐmÅÕ•Éä°Í•ÑEÕ•Éåt€ôÕÍ•MÑ…Ñ” ˆˆ¤ì(€½¹ÍÐm•‘¥Ñ¥¹œ°Í•Ñ‘¥Ñ¥¹t€ôÕÍ•MÑ…Ñ”ñ½¹™¥ÕÉ•‘%¹‘¥…Ñ½Èð€‰¹•Üˆð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐm‘•±•Ñ¥¹œ°Í•Ñ•±•Ñ¥¹t€ôÕÍ•MÑ…Ñ”ñ½¹™¥ÕÉ•‘%¹‘¥…Ñ½Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ™¥±Ñ•É•€ô‘•™¥¹¥Ñ¥½¹Ì¹™¥±Ñ•È ¡¥¹‘¥…Ñ½È¤€ôø€…ÅÕ•Éä¹ÑÉ¥´ ¤ñðm¥¹‘¥…Ñ½È¹¥°¥¹‘¥…Ñ½È¹…É•„°¥¹‘¥…Ñ½È¹¹…µ”°¥¹‘¥…Ñ½È¹±•…‘•Ét¹Í½µ” ¡Ù…±Õ”¤€ôøÙ…±Õ”¹Ñ½1½…±•1½Ý•É…Í” ‰•Ìˆ¤¹¥¹±Õ‘•Ì¡ÅÕ•Éä¹ÑÉ¥´ ¤¹Ñ½1½…±•1½Ý•É…Í” ‰•Ìˆ¤¤¤¤ì((€™Õ¹Ñ¥½¸Í…Ù•%¹‘¥…Ñ½È¡¥¹‘¥…Ñ½Èè½¹™¥ÕÉ•‘%¹‘¥…Ñ½È¤ì(€€€½¹ÍÐ•á¥ÍÑÌ€ô‘•™¥¹¥Ñ¥½¹Ì¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô¥¹‘¥…Ñ½È¹¥¤ì(€€€½¹•™¥¹¥Ñ¥½¹Í¡…¹”¡•á¥ÍÑÌ€ü‘•™¥¹¥Ñ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô¥¹‘¥…Ñ½È¹¥€ü¥¹‘¥…Ñ½È€è¥Ñ•´¤€èl¸¸¹‘•™¥¹¥Ñ¥½¹Ì°¥¹‘¥…Ñ½Ét¤ì(€€€¥˜€ …•á¥ÍÑÌ¤½¹I•ÍÕ±ÑÍ¡…¹”¡ì€¸¸¹É•ÍÕ±ÑÌ°m¥¹‘¥…Ñ½È¹¥‘tèì€ˆÈÀÈÔˆèíô°€ˆÈÀÈØˆèíôôô¤ì(€€€Í•Ñ‘¥Ñ¥¹œ¡¹Õ±°¤ì(€ô((€™Õ¹Ñ¥½¸‘•±•Ñ•%¹‘¥…Ñ½È ¤ì(€€€¥˜€ …‘•±•Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€½¹•™¥¹¥Ñ¥½¹Í¡…¹”¡‘•™¥¹¥Ñ¥½¹Ì¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€„ôô‘•±•Ñ¥¹œ¹¥¤¤ì(€€€½¹ÍÐ¹•áÐ€ôì€¸¸¹É•ÍÕ±ÑÌôì(€€€‘•±•Ñ”¹•áÑm‘•±•Ñ¥¹œ¹¥‘tì(€€€½¹I•ÍÕ±ÑÍ¡…¹”¡¹•áÐ¤ì(€€€Í•Ñ•±•Ñ¥¹œ¡¹Õ±°¤ì(€ô((€É•ÑÕÉ¸€ (€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÝ½É­ÍÁ…”µÁ…¹•°¥¹‘¥…Ñ½Èµ…Ñ…±½œµÁ…¹•°ˆø(€€€€€€ñ¡•…‘•È±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Ñ…±½œµ¡•…‘•Èˆøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆÑ¥Ñ±”ô‰Y½±Ù•È…°‘…Í¡‰½…Éˆ½¹±¥¬õí½¹	…­ôøñÉÉ½Ý1•™ÐÍ¥é”õìÄáô€¼øð½‰ÕÑÑ½¸øñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰µ½‘Õ±”µ­¥­•Èˆù½¹™¥ÕÉ…§Í¸…‘µ¥¹¥ÍÑÉ…Ñ¥Ù„ð½Àøñ Ìù…Ó…±½¼‘”¥¹‘¥…‘½É•Ìð½ ÌøñÀù±Ñ…Ì°É•ÍÁ½¹Í…‰±•Ì°·¥ÑÉ¥…Ìä™•¡…ÌÑÉ¥µ•ÍÑÉ…±•Ì‘”…ÁÑÕÉ„¸ð½Àøð½‘¥Øøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸‰ÕÑÑ½¸µÁÉ¥µ…ÉäˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ¥¹œ ‰¹•Üˆ¥ôøñA±ÕÌÍ¥é”õìÄÝô€¼ø9Õ•Ù¼¥¹‘¥…‘½Èð½‰ÕÑÑ½¸øð½¡•…‘•Èø(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Ñ…±½œµÍ•…É ˆøñ±…‰•°±…ÍÍ9…µ”ô‰Á…¹•°µÍ•…É ¥¹‘¥…Ñ½ÈµÍ•…É ˆøñM•…É Í¥é”õìÄÙô€¼øñ¥¹ÁÕÐ…É¥„µ±…‰•°ô‰	ÕÍ…È•¸…Ó…±½¼ˆ½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑEÕ•Éä¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ôÁ±…•¡½±‘•Èô‰	ÕÍ…È¥¹‘¥…‘½È°ÁÉ½•Í¼¼É•ÍÁ½¹Í…‰±”ˆÙ…±Õ”õíÅÕ•Éåô€¼øð½±…‰•°øñÍÁ…¸ùí™¥±Ñ•É•¹±•¹Ñ¡ô¥¹‘¥…‘½É•Ìð½ÍÁ…¸øð½‘¥Øø(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Ñ…±½œµÉ½ÕÁÌˆø(€€€€€€€íÉ½ÕÁ%¹‘¥…Ñ½ÉÌ¡™¥±Ñ•É•¤¹µ…À ¡É½ÕÀ¤€ôø€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Ñ…±½œµÉ½ÕÀˆ­•äõíÉ½ÕÀ¹…É•…ôøñ¡•…‘•Èøñ‘¥ØøñÍÑÉ½¹œùíÉ½ÕÀ¹…É•…ôð½ÍÑÉ½¹œøñÍµ…±°ùíÉ½ÕÀ¹¥Ñ•µÍlÁtü¹ÁÉ½•ÍÍ%‘ôð½Íµ…±°øð½‘¥ØøñÍÁ…¸ùíÉ½ÕÀ¹¥Ñ•µÌ¹±•¹Ñ¡ôð½ÍÁ…¸øð½¡•…‘•ÈùíÉ½ÕÀ¹¥Ñ•µÌ¹µ…À ¡¥¹‘¥…Ñ½È¤€ôø€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Ñ…±½œµÉ½Üˆ­•äõí¥¹‘¥…Ñ½È¹¥‘ôøñ½‘”ùí¥¹‘¥…Ñ½È¹¥‘ôð½½‘”øñÍÁ…¸øñÍÑÉ½¹œùí¥¹‘¥…Ñ½È¹¹…µ•ôð½ÍÑÉ½¹œøñÍµ…±°ùí¥¹‘¥…Ñ½È¹±•…‘•Éôƒ
Üí¥¹‘¥…Ñ½È¹µ•ÑÉ¥ôð½Íµ…±°øñÍÁ…¸±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÉÕ±”µÍÕµµ…Éäˆøñ¤±…ÍÍ9…µ”ô‰ÉÕ±”µ½µÁ±¥…¹ÐˆùÕµÁ±”í¥¹‘¥…Ñ½È¹•Ù…±Õ…Ñ¥½¹IÕ±•Ì¹½µÁ±¥…¹Ñôð½¤øñ¤±…ÍÍ9…µ”ô‰ÉÕ±”µµ…É¥¹…°ˆù5…É¥¹…°í¥¹‘¥…Ñ½È¹•Ù…±Õ…Ñ¥½¹IÕ±•Ì¹µ…É¥¹…±ôð½¤øñ¤±…ÍÍ9…µ”ô‰ÉÕ±”µ¹½¹½µÁ±¥…¹Ðˆù9¼ÕµÁ±”í¥¹‘¥…Ñ½È¹•Ù…±Õ…Ñ¥½¹IÕ±•Ì¹¹½¹½µÁ±¥…¹Ñôð½¤øð½ÍÁ…¸øð½ÍÁ…¸øñÍÁ…¸øñÍµ…±°ùíÅÕ…ÉÑ•É1…‰•±Ì¹DÍôíå•…Éôð½Íµ…±°øñÍÑÉ½¹œùí™½Éµ…ÑM¡•‘Õ±•…Ñ”¡•Ñ%¹‘¥…Ñ½ÉM¡•‘Õ±•…Ñ”¡¥¹‘¥…Ñ½È°å•…È°€‰DÌˆ¤¥ôð½ÍÑÉ½¹œøð½ÍÁ…¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆÑ¥Ñ±”õí‘¥Ñ…È€‘í¥¹‘¥…Ñ½È¹¹…µ•õô½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ¥¹œ¡¥¹‘¥…Ñ½È¥ôøñA•¹¥°Í¥é”õìÄÙô€¼øð½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰ÕÑÑ½¸‘…¹•ÈˆÑåÁ”ô‰‰ÕÑÑ½¸ˆÑ¥Ñ±”õí±¥µ¥¹…È€‘í¥¹‘¥…Ñ½È¹¹…µ•õô½¹±¥¬õì ¤€ôøÍ•Ñ•±•Ñ¥¹œ¡¥¹‘¥…Ñ½È¥ôøñQÉ…Í ÈÍ¥é”õìÄÙô€¼øð½‰ÕÑÑ½¸øð½‘¥Øø¥ôð½Í•Ñ¥½¸ø¥ô(€€€€€€ð½‘¥Øø(€€€€€í•‘¥Ñ¥¹œ€ü€ñ%¹‘¥…Ñ½É‘¥Ñ½È‘•™¥¹¥Ñ¥½¹Ìõí‘•™¥¹¥Ñ¥½¹Íô¥¹‘¥…Ñ½Èõí•‘¥Ñ¥¹œ€ôôô€‰¹•Üˆ€ü¹Õ±°€è•‘¥Ñ¥¹ô½¹±½Í”õì ¤€ôøÍ•Ñ‘¥Ñ¥¹œ¡¹Õ±°¥ô½¹M…Ù”õíÍ…Ù•%¹‘¥…Ñ½Éôå•…Èõíå•…Éô€¼ø€è¹Õ±±ô(€€€€€í‘•±•Ñ¥¹œ€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÅÕ…±¥Ñäµµ½‘…°µ‰…­‘É½ÀˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½Ý¸õì ¤€ôøÍ•Ñ•±•Ñ¥¹œ¡¹Õ±°¥ôøñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰ÅÕ…±¥Ñäµµ½‘…°¥¹‘¥…Ñ½Èµ‘•±•Ñ”µµ½‘…°ˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆ…É¥„µ±…‰•±±•‘‰äô‰‘•±•Ñ”µ¥¹‘¥…Ñ½ÈµÑ¥Ñ±”ˆ½¹5½ÕÍ•½Ý¸õì¡•Ù•¹Ð¤€ôø•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ôøñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸ùí‘•±•Ñ¥¹œ¹¥‘ôð½ÍÁ…¸øñ Ì¥ô‰‘•±•Ñ”µ¥¹‘¥…Ñ½ÈµÑ¥Ñ±”ˆù±¥µ¥¹…È¥¹‘¥…‘½Èð½ Ìøð½‘¥Øøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆÑ¥Ñ±”ô‰•ÉÉ…Èˆ½¹±¥¬õì ¤€ôøÍ•Ñ•±•Ñ¥¹œ¡¹Õ±°¥ôøñ`Í¥é”õìÄÝô€¼øð½‰ÕÑÑ½¸øð½¡•…‘•Èøñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ‘•±•Ñ”µ½Áäˆøñ¥É±•±•ÉÐÍ¥é”õìÈÍô€¼øñÀùM”•±¥µ¥¹…Ë„€ñÍÑÉ½¹œùí‘•±•Ñ¥¹œ¹¹…µ•ôð½ÍÑÉ½¹œøäÍÕÌÉ•ÍÕ±Ñ…‘½Ì±½…±•Ì¸ÍÑ„…§Í¸¹¼Í”ÁÕ•‘”‘•Í¡…•È¸ð½Àøð½‘¥Øøñ™½½Ñ•Èøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸‰ÕÑÑ½¸µÍ•½¹‘…ÉäˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ•±•Ñ¥¹œ¡¹Õ±°¥ôù…¹•±…Èð½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸¥¹‘¥…Ñ½Èµ‘•±•Ñ”µ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õí‘•±•Ñ•%¹‘¥…Ñ½ÉôøñQÉ…Í ÈÍ¥é”õìÄÙô€¼ø±¥µ¥¹…Èð½‰ÕÑÑ½¸øð½™½½Ñ•Èøð½Í•Ñ¥½¸øð½‘¥Øø€è¹Õ±±ô(€€€€ð½Í•Ñ¥½¸ø(€€¤ì)ô()™Õ¹Ñ¥½¸%¹‘¥…Ñ½É‘¥Ñ½È¡ì‘•™¥¹¥Ñ¥½¹Ì°¥¹‘¥…Ñ½È°½¹±½Í”°½¹M…Ù”°å•…Èôèì‘•™¥¹¥Ñ¥½¹Ìè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émtì¥¹‘¥…Ñ½Èè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Èð¹Õ±°ì½¹±½Í”è€ ¤€ôøÙ½¥ì½¹M…Ù”è€¡¥¹‘¥…Ñ½Èè½¹™¥ÕÉ•‘%¹‘¥…Ñ½È¤€ôøÙ½¥ìå•…Èè¹Õµ‰•Èô¤ì(€½¹ÍÐ¹•áÑ%€ô%9´‘íMÑÉ¥¹œ¡5…Ñ ¹µ…à À°€¸¸¹‘•™¥¹¥Ñ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø9Õµ‰•È¡¥Ñ•´¹¥¹É•Á±…” ½q½œ°€ˆˆ¤¤ñð€À¤¤€¬€Ä¤¹Á…‘MÑ…ÉÐ Ì°€ˆÀˆ¥õ€ì(€½¹ÍÐ‘•™…Õ±ÑÌ€ô¥¹‘¥…Ñ½Èü¹Í¡•‘Õ±•mMÑÉ¥¹œ¡å•…È¥t€üü‰Õ¥±‘EÕ…ÉÑ•ÉM¡•‘Õ±”¡å•…È¤ì(€½¹ÍÐ‘•™…Õ±ÑIÕ±•Ì€ô¥¹‘¥…Ñ½Èü¹•Ù…±Õ…Ñ¥½¹IÕ±•Ì€üü‰Õ¥±‘•™…Õ±ÑÙ…±Õ…Ñ¥½¹IÕ±•Ì ˆøôäÀ”ˆ¤ì((€™Õ¹Ñ¥½¸ÍÕ‰µ¥Ð¡•Ù•¹Ðè½ÉµÙ•¹Ðñ!Q51½Éµ±•µ•¹Ðø¤ì(€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€½¹ÍÐ™½É´€ô¹•Ü½Éµ…Ñ„¡•Ù•¹Ð¹ÕÉÉ•¹ÑQ…É•Ð¤ì(€€€½¹ÍÐÍ¡•‘Õ±”€ôÍÑÉÕÑÕÉ•‘±½¹”¡¥¹‘¥…Ñ½Èü¹Í¡•‘Õ±”€üüì€ˆÈÀÈÔˆè‰Õ¥±‘EÕ…ÉÑ•ÉM¡•‘Õ±” ÈÀÈÔ¤°€ˆÈÀÈØˆè‰Õ¥±‘EÕ…ÉÑ•ÉM¡•‘Õ±” ÈÀÈØ¤ô¤ì(€€€Í¡•‘Õ±•mMÑÉ¥¹œ¡å•…È¥t€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡ÅÕ…ÉÑ•ÉÌ¹µ…À ¡ÅÕ…ÉÑ•È¤€ôømÅÕ…ÉÑ•È°MÑÉ¥¹œ¡™½É´¹•Ð¡Í¡•‘Õ±”´‘íÅÕ…ÉÑ•Éõ€¤¥t¤¤…ÌI•½ÉñEÕ…ÉÑ•È°ÍÑÉ¥¹œøì(€€€½¹M…Ù”¡ì(€€€€€¥è¥¹‘¥…Ñ½Èü¹¥€üü¹•áÑ%°(€€€€€Í½ÕÉ•I½Üè¥¹‘¥…Ñ½Èü¹Í½ÕÉ•I½Ü€üü€À°(€€€€€ÁÉ½•ÍÍ%èMÑÉ¥¹œ¡™½É´¹•Ð ‰ÁÉ½•ÍÍ%ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€…É•„èMÑÉ¥¹œ¡™½É´¹•Ð ‰…É•„ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€‘¥É•Ñ¥½¹=‰©•Ñ¥Ù”è¥¹‘¥…Ñ½Èü¹‘¥É•Ñ¥½¹=‰©•Ñ¥Ù”€üü€ˆˆ°(€€€€€‘¥É•Ñ¥½¹5•ÑÉ¥Œè¥¹‘¥…Ñ½Èü¹‘¥É•Ñ¥½¹5•ÑÉ¥Œ€üü€ˆˆ°(€€€€€ÅÕ…±¥Ñå=‰©•Ñ¥Ù”èMÑÉ¥¹œ¡™½É´¹•Ð ‰ÅÕ…±¥Ñå=‰©•Ñ¥Ù”ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€¹…µ”èMÑÉ¥¹œ¡™½É´¹•Ð ‰¹…µ”ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€±•…‘•ÈèMÑÉ¥¹œ¡™½É´¹•Ð ‰±•…‘•Èˆ¤¤¹ÑÉ¥´ ¤°(€€€€€µ•ÑÉ¥ŒèMÑÉ¥¹œ¡™½É´¹•Ð ‰µ•ÑÉ¥Œˆ¤¤¹ÑÉ¥´ ¤°(€€€€€Á•É¥½è€‰QÉ¥µ•ÍÑÉ…°ˆ°(€€€€€‘•ÍÉ¥ÁÑ¥½¸èMÑÉ¥¹œ¡™½É´¹•Ð ‰‘•ÍÉ¥ÁÑ¥½¸ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€•Ù…±Õ…Ñ¥½¹IÕ±•Ìèì(€€€€€€€½µÁ±¥…¹ÐèMÑÉ¥¹œ¡™½É´¹•Ð ‰ÉÕ±”µ½µÁ±¥…¹Ðˆ¤¤¹ÑÉ¥´ ¤°(€€€€€€€µ…É¥¹…°èMÑÉ¥¹œ¡™½É´¹•Ð ‰ÉÕ±”µµ…É¥¹…°ˆ¤¤¹ÑÉ¥´ ¤°(€€€€€€€¹½¹½µÁ±¥…¹ÐèMÑÉ¥¹œ¡™½É´¹•Ð ‰ÉÕ±”µ¹½¹½µÁ±¥…¹Ðˆ¤¤¹ÑÉ¥´ ¤°(€€€€€ô°(€€€€€Í¡•‘Õ±”èì€¸¸¹Í¡•‘Õ±”ô°(€€€ô¤ì(€ô((€É•ÑÕÉ¸€ (€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÅÕ…±¥Ñäµµ½‘…°µ‰…­‘É½ÀˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½Ý¸õí½¹±½Í•ôø(€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰ÅÕ…±¥Ñäµµ½‘…°¥¹‘¥…Ñ½Èµ•‘¥Ñ½Èµµ½‘…°ˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆ…É¥„µ±…‰•±±•‘‰äô‰¥¹‘¥…Ñ½Èµ•‘¥Ñ½ÈµÑ¥Ñ±”ˆ½¹5½ÕÍ•½Ý¸õì¡•Ù•¹Ð¤€ôø•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ôø(€€€€€€€€ñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸ùí¥¹‘¥…Ñ½Èü¹¥€üü¹•áÑ%‘ôð½ÍÁ…¸øñ Ì¥ô‰¥¹‘¥…Ñ½Èµ•‘¥Ñ½ÈµÑ¥Ñ±”ˆùí¥¹‘¥…Ñ½È€ü€‰‘¥Ñ…È¥¹‘¥…‘½Èˆ€è€‰9Õ•Ù¼¥¹‘¥…‘½È‰ôð½ Ìøð½‘¥Øøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆÑ¥Ñ±”ô‰•ÉÉ…Èˆ½¹±¥¬õí½¹±½Í•ôøñ`Í¥é”õìÄÝô€¼øð½‰ÕÑÑ½¸øð½¡•…‘•Èø(€€€€€€€€ñ™½É´½¹MÕ‰µ¥ÐõíÍÕ‰µ¥Ñôø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ•‘¥Ñ½ÈµÉ¥ˆøñ±…‰•°øñÍÁ…¸ùAÉ½•Í¼¼ƒ…É•„ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹…É•„€üü€ˆ‰ô¹…µ”ô‰…É•„ˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°øñÍÁ…¸ùÍ‘¥¼‘”ÁÉ½•Í¼ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹ÁÉ½•ÍÍ%€üü€ˆ‰ô¹…µ”ô‰ÁÉ½•ÍÍ%ˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°±…ÍÍ9…µ”ô‰ÍÁ…¸´ÈˆøñÍÁ…¸ù9½µ‰É”‘•°¥¹‘¥…‘½Èð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹¹…µ”€üü€ˆ‰ô¹…µ”ô‰¹…µ”ˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°øñÍÁ…¸ùI•ÍÁ½¹Í…‰±”ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹±•…‘•È€üü€ˆ‰ô¹…µ”ô‰±•…‘•ÈˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°øñÍÁ…¸ù7¥ÑÉ¥„ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹µ•ÑÉ¥Œ€üü€ˆ‰ô¹…µ”ô‰µ•ÑÉ¥ŒˆÁ±…•¡½±‘•Èô‰¨¸ƒŠ&”äÀ”ˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°±…ÍÍ9…µ”ô‰ÍÁ…¸´ÈˆøñÍÁ…¸ù=‰©•Ñ¥Ù¼‘”…±¥‘…ð½ÍÁ…¸øñÑ•áÑ…É•„‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹ÅÕ…±¥Ñå=‰©•Ñ¥Ù”€üü€ˆ‰ô¹…µ”ô‰ÅÕ…±¥Ñå=‰©•Ñ¥Ù”ˆÉ½ÝÌõìÉô€¼øð½±…‰•°øñ±…‰•°±…ÍÍ9…µ”ô‰ÍÁ…¸´ÈˆøñÍÁ…¸ù•ÍÉ¥Á§Í¸ð½ÍÁ…¸øñÑ•áÑ…É•„‘•™…Õ±ÑY…±Õ”õí¥¹‘¥…Ñ½Èü¹‘•ÍÉ¥ÁÑ¥½¸€üü€ˆ‰ô¹…µ”ô‰‘•ÍÉ¥ÁÑ¥½¸ˆÉ•ÅÕ¥É•É½ÝÌõìÍô€¼øð½±…‰•°øð½‘¥Øø(€€€€€€€€€€ñ™¥•±‘Í•Ð±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÉÕ±•Ìµ™¥•±‘Í•Ðˆøñ±••¹ùI•±…Ì‘”•Ù…±Õ…§Í¸ð½±••¹øñ‘¥Øøñ±…‰•°±…ÍÍ9…µ”ô‰ÉÕ±”µ½µÁ±¥…¹ÐˆøñÍÁ…¸ùÕµÁ±”ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí‘•™…Õ±ÑIÕ±•Ì¹½µÁ±¥…¹Ñô¹…µ”ô‰ÉÕ±”µ½µÁ±¥…¹ÐˆÁ±…•¡½±‘•ÈôˆøôäÀˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°±…ÍÍ9…µ”ô‰ÉÕ±”µµ…É¥¹…°ˆøñÍÁ…¸ù5…É¥¹…°ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí‘•™…Õ±ÑIÕ±•Ì¹µ…É¥¹…±ô¹…µ”ô‰ÉÕ±”µµ…É¥¹…°ˆÁ±…•¡½±‘•ÈôˆøôàÔ¸Ô°ðäÀˆÉ•ÅÕ¥É•€¼øð½±…‰•°øñ±…‰•°±…ÍÍ9…µ”ô‰ÉÕ±”µ¹½¹½µÁ±¥…¹ÐˆøñÍÁ…¸ù9¼ÕµÁ±”ð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí‘•™…Õ±ÑIÕ±•Ì¹¹½¹½µÁ±¥…¹Ñô¹…µ”ô‰ÉÕ±”µ¹½¹½µÁ±¥…¹ÐˆÁ±…•¡½±‘•ÈôˆðàÔ¸ÔˆÉ•ÅÕ¥É•€¼øð½±…‰•°øð½‘¥ØøñÀùUÍ„½Á•É…‘½É•Ì€™Ðì°€™Ðìô°€™±Ðì°€™±Ðìô¼€ô¸M•Á…É„½¹‘¥¥½¹•ÌÍ¥µÕ±Ó…¹•…Ì½¸½µ„ä…±Ñ•É¹…Ñ¥Ù…Ì½¸ÁÕ¹Ñ¼ä½µ„¸ð½Àøð½™¥•±‘Í•Ðø(€€€€€€€€€€ñ™¥•±‘Í•Ð±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÍ¡•‘Õ±”µ™¥•±‘Í•Ðˆøñ±••¹ù•¡…ÌÁÉ½É…µ…‘…Ì‘”…ÁÑÕÉ„ƒ
Üíå•…Éôð½±••¹øñ‘¥ØùíÅÕ…ÉÑ•ÉÌ¹µ…À ¡ÅÕ…ÉÑ•È¤€ôø€ñ±…‰•°­•äõíÅÕ…ÉÑ•ÉôøñÍÁ…¸ùíÅÕ…ÉÑ•É1…‰•±ÍmÅÕ…ÉÑ•Éuôð½ÍÁ…¸øñ¥¹ÁÕÐ‘•™…Õ±ÑY…±Õ”õí‘•™…Õ±ÑÍmÅÕ…ÉÑ•Éuô¹…µ”õíÍ¡•‘Õ±”´‘íÅÕ…ÉÑ•ÉõôÉ•ÅÕ¥É•ÑåÁ”ô‰‘…Ñ”ˆ€¼øð½±…‰•°ø¥ôð½‘¥ØøñÀù1„…ÁÑÕÉ„Í½±¼•ÍÑ…Ë„¡…‰¥±¥Ñ…‘„•¸±„™•¡„¥¹‘¥…‘„Á…É„…‘„ÑÉ¥µ•ÍÑÉ”¸ð½Àøð½™¥•±‘Í•Ðø(€€€€€€€€€€ñ™½½Ñ•Èøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸‰ÕÑÑ½¸µÍ•½¹‘…ÉäˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õí½¹±½Í•ôù…¹•±…Èð½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰ÕÑÑ½¸‰ÕÑÑ½¸µÁÉ¥µ…ÉäˆÑåÁ”ô‰ÍÕ‰µ¥ÐˆøñM…Ù”Í¥é”õìÄÙô€¼øÕ…É‘…È¥¹‘¥…‘½Èð½‰ÕÑÑ½¸øð½™½½Ñ•Èø(€€€€€€€€ð½™½É´ø(€€€€€€ð½Í•Ñ¥½¸ø(€€€€ð½‘¥Øø(€€¤ì)ô()™Õ¹Ñ¥½¸%¹‘¥…Ñ½ÉQ½½±‰…È¡ì…É•„°…É•…Ì°¡¥±‘É•¸°½¹É•…¡…¹”°½¹EÕ•Éå¡…¹”°½¹e•…É¡…¹”°ÅÕ•Éä°å•…Èôè=µ¥ÐñM¡…É•‘Y¥•ÝAÉ½ÁÌ°€‰¥¹‘¥…Ñ½ÉÌˆð€‰É•ÍÕ±ÑÌˆø€˜ì¡¥±‘É•¸èI•…Ñ9½‘”ô¤ì(€É•ÑÕÉ¸€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÑ½½±‰…Èˆøñ±…‰•°±…ÍÍ9…µ”ô‰Á…¹•°µÍ•…É ¥¹‘¥…Ñ½ÈµÍ•…É ˆøñM•…É Í¥é”õìÄÙô€¼øñ¥¹ÁÕÐ…É¥„µ±…‰•°ô‰	ÕÍ…È¥¹‘¥…‘½Èˆ½¹¡…¹”õì¡•Ù•¹Ð¤€ôø½¹EÕ•Éå¡…¹”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ôÁ±…•¡½±‘•Èô‰	ÕÍ…È-A$¼É•ÍÁ½¹Í…‰±”ˆÙ…±Õ”õíÅÕ•Éåô€¼øð½±…‰•°øñ±…‰•°øñÍÁ…¸ûÉ•„¼ÁÉ½•Í¼ð½ÍÁ…¸øñÍ•±•Ð…É¥„µ±…‰•°ô‹É•„¼ÁÉ½•Í¼ˆÙ…±Õ”õí…É•…ô½¹¡…¹”õì¡•Ù•¹Ð¤€ôø½¹É•…¡…¹”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ôùí…É•…Ì¹µ…À ¡¥Ñ•´¤€ôø€ñ½ÁÑ¥½¸­•äõí¥Ñ•µôùí¥Ñ•µôð½½ÁÑ¥½¸ø¥ôð½Í•±•Ðøð½±…‰•°øñ±…‰•°øñÍÁ…¸ùÅ¼ð½ÍÁ…¸øñÍ•±•Ð…É¥„µ±…‰•°ô‰Å¼ˆÙ…±Õ”õíå•…Éô½¹¡…¹”õì¡•Ù•¹Ð¤€ôø½¹e•…É¡…¹”¡9Õµ‰•È¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¤¥ôùíå•…É=ÁÑ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø€ñ½ÁÑ¥½¸­•äõí¥Ñ•µôùí¥Ñ•µôð½½ÁÑ¥½¸ø¥ôð½Í•±•Ðøð½±…‰•°øñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½ÈµÑ½½±‰…Èµ•áÑÉ„ˆùí¡¥±‘É•¹ôð½‘¥Øøð½‘¥Øøì)ô()™Õ¹Ñ¥½¸%¹‘¥…Ñ½É…Õ”¡ì¥¹‘¥…Ñ½È°ÉÕ±”°ÍÑ…ÑÕÌ°Ù…±Õ”ôèì¥¹‘¥…Ñ½Èè½¹™¥ÕÉ•‘%¹‘¥…Ñ½ÈìÉÕ±”èI•ÑÕÉ¹QåÁ”ñÑåÁ•½˜Á…ÉÍ•%¹‘¥…Ñ½É5•ÑÉ¥ŒøìÍÑ…ÑÕÌè%¹‘¥…Ñ½ÉMÑ…ÑÕÌìÙ…±Õ”è¹Õµ‰•ÈðÕ¹‘•™¥¹•ô¤ì(€½¹ÍÐÍ½É”€ô•Ñ%¹‘¥…Ñ½ÉM½É”¡Ù…±Õ”°ÉÕ±”°ÍÑ…ÑÕÌ¤ì(€½¹ÍÐ…¹±”€ôÍ½É”€ôôô¹Õ±°€ü¹Õ±°€è€ÄàÀ€´Í½É”€¨€Ä¸àì(€½¹ÍÐ¹••‘±•`€ô…¹±”€ôôô¹Õ±°€ü€ÄÀÀ€è€ÄÀÀ€¬€ÔØ€¨5…Ñ ¹½Ì ¡…¹±”€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€½¹ÍÐ¹••‘±•d€ô…¹±”€ôôô¹Õ±°€ü€ÄÀÀ€è€ÄÀÀ€´€ÔØ€¨5…Ñ ¹Í¥¸ ¡…¹±”€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€É•ÑÕÉ¸€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Õ”µ…Éˆøñ¡•…‘•ÈøñÍÁ…¸ùí¥¹‘¥…Ñ½È¹¥‘ôƒ
Üí¥¹‘¥…Ñ½È¹…É•…ôð½ÍÁ…¸øñÍÁ…¸±…ÍÍ9…µ”õí¥¹‘¥…Ñ½ÈµÍÑ…ÑÕÌ¥¹‘¥…Ñ½ÈµÍÑ…ÑÕÌ´‘íÍÑ…ÑÕÍõôùíÍÑ…ÑÕÍ1…‰•±ÍmÍÑ…ÑÕÍuôð½ÍÁ…¸øð½¡•…‘•Èøñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Õ”ˆ…É¥„µ±…‰•°õí€‘í¥¹‘¥…Ñ½È¹¹…µ•ôè€‘íÍÑ…ÑÕÍ1…‰•±ÍmÍÑ…ÑÕÍuõôøñÍÙœÙ¥•Ý	½àôˆÀ€À€ÈÀÀ€ÄÄàˆÉ½±”ô‰¥µœˆøñÁ…Ñ ±…ÍÍ9…µ”ô‰…Õ”µÉ•ˆô‰4ÈÀ€ÄÀÀàÀ€àÀ€À€À€Ä€ÄÈÐ¸Ü€ÈÌ¸äˆ€¼øñÁ…Ñ ±…ÍÍ9…µ”ô‰…Õ”µ½É…¹”ˆô‰4ÄÈÐ¸Ü€ÈÌ¸äàÀ€àÀ€À€À€Ä€ÄØÐ¸Ü€ÔÌˆ€¼øñÁ…Ñ ±…ÍÍ9…µ”ô‰…Õ”µÉ••¸ˆô‰4ÄØÐ¸Ü€ÔÌàÀ€àÀ€À€À€Ä€ÄàÀ€ÄÀÀˆ€¼ùí…¹±”€ôôô¹Õ±°€ü¹Õ±°€è€ñ±¥¹”±…ÍÍ9…µ”ô‰…Õ”µ¹••‘±”ˆàÄôˆÄÀÀˆäÄôˆÄÀÀˆàÈõí¹••‘±•aôäÈõí¹••‘±•eô€¼ùôñ¥É±”àôˆÄÀÀˆäôˆÄÀÀˆÈôˆØˆ€¼øð½ÍÙœøñÍÑÉ½¹œùí™½Éµ…Ñ%¹‘¥…Ñ½ÉY…±Õ”¡Ù…±Õ”°ÉÕ±”¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ…Õ”µ½Áäˆøñ Ðùí¥¹‘¥…Ñ½È¹¹…µ•ôð½ ÐøñÀù5•Ñ„è€ñÍÑÉ½¹œùí¥¹‘¥…Ñ½È¹µ•ÑÉ¥ôð½ÍÑÉ½¹œøð½ÀøñÍµ…±°ùí¥¹‘¥…Ñ½È¹±•…‘•Éôð½Íµ…±°øð½‘¥Øøð½…ÉÑ¥±”øì)ô()™Õ¹Ñ¥½¸MÑ…ÑÕÍMÕµµ…Éä¡ìÍÑ…ÑÕÌ°Ù…±Õ”ôèìÍÑ…ÑÕÌè%¹‘¥…Ñ½ÉMÑ…ÑÕÌìÙ…±Õ”è¹Õµ‰•Èô¤ìÉ•ÑÕÉ¸€ñ‘¥Ø±…ÍÍ9…µ”õí¥¹‘¥…Ñ½ÈµÍÕµµ…ÉäµÍÑ…ÑÕÌ¥¹‘¥…Ñ½ÈµÍÕµµ…Éä´‘íÍÑ…ÑÕÍõôøñÍÁ…¸ùíÙ…±Õ•ôð½ÍÁ…¸øñÍµ…±°ùíÍÑ…ÑÕÍ1…‰•±ÍmÍÑ…ÑÕÍuôð½Íµ…±°øð½‘¥Øøìô)™Õ¹Ñ¥½¸%¹‘¥…Ñ½É1••¹¡ì½µÁ…Ð€ô™…±Í”ôèì½µÁ…Ðüè‰½½±•…¸ô¤ìÉ•ÑÕÉ¸€ñ‘¥Ø±…ÍÍ9…µ”õí¥¹‘¥…Ñ½Èµ±••¹€‘í½µÁ…Ð€ü€‰½µÁ…Ðˆ€è€ˆ‰õôùì¡l‰½µÁ±¥…¹Ðˆ°€‰µ…É¥¹…°ˆ°€‰¹½¹½µÁ±¥…¹Ðˆ°€‰¹½Ñ}ÕÁ±½…‘•ˆ°€‰Á•¹‘¥¹œ‰t…Ì%¹‘¥…Ñ½ÉMÑ…ÑÕÍmt¤¹µ…À ¡ÍÑ…ÑÕÌ¤€ôø€ñÍÁ…¸­•äõíÍÑ…ÑÕÍôøñ¤±…ÍÍ9…µ”õí±••¹´‘íÍÑ…ÑÕÍõô€¼ùíÍÑ…ÑÕÍ1…‰•±ÍmÍÑ…ÑÕÍuôð½ÍÁ…¸ø¥ôð½‘¥Øøìô)™Õ¹Ñ¥½¸µÁÑå%¹‘¥…Ñ½ÉÌ ¤ìÉ•ÑÕÉ¸€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥¹‘¥…Ñ½Èµ•µÁÑäˆøñ…±•¹‘…ÉI…¹”Í¥é”õìÈÑô€¼øñÍÑÉ½¹œùM¥¸¥¹‘¥…‘½É•Ì•¸•ÍÑ„Ù¥ÍÑ„ð½ÍÑÉ½¹œøñÀù…µ‰¥„•°ƒ…É•„¼±¥µÁ¥„±„‹éÍÅÕ•‘„¸ð½Àøð½‘¥Øøìô()™Õ¹Ñ¥½¸É½ÕÁ%¹‘¥…Ñ½ÉÌ¡¥¹‘¥…Ñ½ÉÌè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émt¤ì(€½¹ÍÐÉ½ÕÁÌ€ô¹•Ü5…ÀñÍÑÉ¥¹œ°½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émtø ¤ì(€¥¹‘¥…Ñ½ÉÌ¹™½É…  ¡¥¹‘¥…Ñ½È¤€ôøÉ½ÕÁÌ¹Í•Ð¡¥¹‘¥…Ñ½È¹…É•„°l¸¸¸¡É½ÕÁÌ¹•Ð¡¥¹‘¥…Ñ½È¹…É•„¤€üümt¤°¥¹‘¥…Ñ½Ét¤¤ì(€É•ÑÕÉ¸ÉÉ…ä¹™É½´¡É½ÕÁÌ°€¡m…É•„°¥Ñ•µÍt¤€ôø€¡ì…É•„°¥Ñ•µÌô¤¤ì)ô()™Õ¹Ñ¥½¸•Ñ%¹‘¥…Ñ½ÉI•½É¡É•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ°¥èÍÑÉ¥¹œ°å•…Èè¹Õµ‰•È°ÅÕ…ÉÑ•ÈèEÕ…ÉÑ•È¤ìÉ•ÑÕÉ¸É•ÍÕ±ÑÍm¥‘tü¹mMÑÉ¥¹œ¡å•…È¥tü¹mÅÕ…ÉÑ•Étìô)™Õ¹Ñ¥½¸Í•Ñ%¹‘¥…Ñ½ÉI•½É¡É•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ°¥èÍÑÉ¥¹œ°å•…Èè¹Õµ‰•È°ÅÕ…ÉÑ•ÈèEÕ…ÉÑ•È°É•½Éè%¹‘¥…Ñ½ÉI•ÍÕ±ÑI•½É¤è%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌìÉ•ÑÕÉ¸ì€¸¸¹É•ÍÕ±ÑÌ°m¥‘tèì€¸¸¸¡É•ÍÕ±ÑÍm¥‘t€üüíô¤°mMÑÉ¥¹œ¡å•…È¥tèì€¸¸¸¡É•ÍÕ±ÑÍm¥‘tü¹mMÑÉ¥¹œ¡å•…È¥t€üüíô¤°mÅÕ…ÉÑ•ÉtèÉ•½Éôôôìô()™Õ¹Ñ¥½¸½Õ¹ÑMÑ…ÑÕÍ•Ì¡¥¹‘¥…Ñ½ÉÌè½¹™¥ÕÉ•‘%¹‘¥…Ñ½Émt°É•ÍÕ±ÑÌè%¹‘¥…Ñ½ÉI•ÍÕ±ÑÌ°å•…Èè¹Õµ‰•È°ÅÕ…ÉÑ•ÈèEÕ…ÉÑ•È¤ì(€É•ÑÕÉ¸¥¹‘¥…Ñ½ÉÌ¹É•‘Õ”ñI•½Éñ%¹‘¥…Ñ½ÉMÑ…ÑÕÌ°¹Õµ‰•Èøø ¡½Õ¹ÑÌ°¥¹‘¥…Ñ½È¤€ôøì½¹ÍÐÍÑ…ÑÕÌ€ô•Ù…±Õ…Ñ•½¹™¥ÕÉ•‘%¹‘¥…Ñ½È¡¥¹‘¥…Ñ½È°•Ñ%¹‘¥…Ñ½ÉI•½É¡É•ÍÕ±ÑÌ°¥¹‘¥…Ñ½È¹¥°å•…È°ÅÕ…ÉÑ•È¤ü¹Ù…±Õ”°å•…È°ÅÕ…ÉÑ•È¤ì½Õ¹ÑÍmÍÑ…ÑÕÍt€¬ô€ÄìÉ•ÑÕÉ¸½Õ¹ÑÌìô°ì½µÁ±¥…¹Ðè€À°µ…É¥¹…°è€À°¹½¹½µÁ±¥…¹Ðè€À°¹½Ñ}ÕÁ±½…‘•è€À°Á•¹‘¥¹œè€Àô¤ì)ô()™Õ¹Ñ¥½¸™½Éµ…ÑM¡•‘Õ±•…Ñ”¡Ù…±Õ”èÍÑÉ¥¹œ¤ì¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸€‰M¥¸ÁÉ½É…µ…ÈˆìÉ•ÑÕÉ¸¹•Ü%¹Ñ°¹…Ñ•Q¥µ•½Éµ…Ð ‰•Ìµ5`ˆ°ì‘…äè€ˆÈµ‘¥¥Ðˆ°µ½¹Ñ è€‰Í¡½ÉÐˆ°å•…Èè€‰¹Õµ•É¥Œˆ°Ñ¥µ•i½¹”è€‰UQˆô¤¹™½Éµ…Ð¡¹•Ü…Ñ”¡€‘íÙ…±Õ•õPÀÀèÀÀèÀÁi€¤¤ìô)™Õ¹Ñ¥½¸™½Éµ…ÑQ¥µ•ÍÑ…µÀ¡Ù…±Õ”èÍÑÉ¥¹œ¤ìÉ•ÑÕÉ¸¹•Ü%¹Ñ°¹…Ñ•Q¥µ•½Éµ…Ð ‰•Ìµ5`ˆ°ì‘…Ñ•MÑå±”è€‰µ•‘¥Õ´ˆ°Ñ¥µ•MÑå±”è€‰Í¡½ÉÐˆô¤¹™½Éµ…Ð¡¹•Ü…Ñ”¡Ù…±Õ”¤¤ìô)™Õ¹Ñ¥½¸ÍÙ•±°¡Ù…±Õ”èÍÑÉ¥¹œ¤ìÉ•ÑÕÉ¸€ˆ‘íÙ…±Õ”¹É•Á±…•±° œˆœ°€œˆˆœ¥ô‰€ìô(