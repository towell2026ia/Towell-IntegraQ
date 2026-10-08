"use client";

import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  History,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { useExternalCompanies } from "@/hooks/use-external-companies";
import { useRncpReports } from "@/hooks/use-rncp-reports";
import { useSupplierAssessments } from "@/hooks/use-supplier-assessments";
import { useSupplierDashboard } from "@/hooks/use-supplier-dashboard";
import type { ExternalCompany } from "@/lib/external-company-data";
import { canPerformModuleAction } from "@/lib/module-permissions";
import {
  rncpDashboardSummary,
  supplierAuditSemesters,
  supplierQualityCatalog,
  type SupplierAuditCalendarEvent,
  type SupplierQualityRecord,
} from "@/lib/quality-parties-data";
import { isAdministrator, isDemoSession, type ActiveSession } from "@/lib/session-data";
import { getRncpEvidenceUrl, reviewRncpResponseAction, saveRncpReport, setRncpDeleted, type RncpDraftInput, type RncpReport } from "@/lib/rncp-data";
import { createSupplierAssessment, getSupplierAssessmentFileUrl, supplierAssessmentTypeLabel, type SupplierAssessment, type SupplierAssessmentType } from "@/lib/supplier-assessment-data";
import { emptySupplierDashboardFilters, exportSupplierDashboard, type SupplierDashboardFilters } from "@/lib/supplier-dashboard-data";

type SupplierView = "directory" | "audits" | "dashboard" | "rncp" | "results";

export function SuppliersModule({ session }: { session: ActiveSession }) {
  const [view, setView] = useState<SupplierView>("directory");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [checklistName, setChecklistName] = useState("");
  const [editingRncpId, setEditingRncpId] = useState<string | undefined>();
  const demo = isDemoSession(session);
  const canUpdateRncp = canPerformModuleAction(session, "suppliers", "update");
  const companyDirectory = useExternalCompanies();
  const rncpDirectory = useRncpReports(!demo);
  const activeRncp = rncpDirectory.reports.filter((report) => !report.deletedAt);
  const suppliers = useMemo(
    () => demo
      ? supplierQualityCatalog
      : companyDirectory.companies.filter((company) => company.kind === "supplier" && company.active).map((company) => toSupplierQualityRecord(company, activeRncp)),
    [activeRncp, companyDirectory.companies, demo],
  );
  const rncpMetrics = summarizeRncp(activeRncp);

  const filteredSuppliers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return suppliers.filter(
      (supplier) =>
        !normalized ||
        [supplier.code, supplier.name, supplier.category].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        ),
    );
  }, [query, suppliers]);

  const selected =
    filteredSuppliers.find((supplier) => supplier.id === selectedId) ??
    filteredSuppliers[0] ??
    suppliers[0];

  if (!demo && companyDirectory.loading) return <div className="access-empty"><ShieldCheck size={24} /><p>Cargando maestro de proveedores…</p></div>;
  if (!demo && companyDirectory.error) return <div className="access-empty"><AlertTriangle size={24} /><h3>No fue posible consultar proveedores</h3><p>{companyDirectory.error}</p><button className="button button-secondary" onClick={() => void companyDirectory.refresh()} type="button">Reintentar</button></div>;

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Gestión interna</p>
          <h2>Gestión de calidad de proveedores</h2>
          <p>RNCP, auditorías semestrales, efectividad y seguimiento de planes por proveedor.</p>
        </div>
        {canUpdateRncp ? <button className="button button-primary" type="button" onClick={() => { setEditingRncpId(undefined); setView("rncp"); }}>
          <Plus size={17} /> Nuevo RNCP
        </button> : null}
      </section>

      <section className="metric-grid" aria-label="Resumen de proveedores">
        <SupplierMetric icon={<ShieldCheck size={18} />} label="Proveedores identificados" value={suppliers.length} tone="neutral" />
        <SupplierMetric icon={<FileText size={18} />} label="RNCP históricos" value={demo ? rncpDashboardSummary.total : rncpMetrics.total} tone="success" />
        <SupplierMetric icon={<CalendarClock size={18} />} label="Acciones tardías" value={demo ? rncpDashboardSummary.late : rncpMetrics.late} tone="warning" />
        <SupplierMetric icon={<AlertTriangle size={18} />} label="En proceso" value={demo ? rncpDashboardSummary.inProcess : rncpMetrics.inProgress} tone="danger" />
      </section>

      <div className="quality-view-tabs supplier-tabs" aria-label="Vistas de calidad de proveedores">
        <button className={view === "directory" ? "active" : ""} type="button" onClick={() => setView("directory")}>Proveedores</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Auditorías semestrales</button>
        <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => setView("dashboard")}>Dashboard RNCP</button>
        <button className={view === "rncp" ? "active" : ""} type="button" onClick={() => setView("rncp")}>Formulario RNCP</button>
        <button className={view === "results" ? "active" : ""} type="button" onClick={() => setView("results")}>Resultados y planes</button>
      </div>

      {view === "directory" ? (
        <section className="party-directory-layout">
          <div className="party-list-panel">
            <label className="panel-search party-search">
              <Search size={16} />
              <input aria-label="Buscar proveedor" placeholder="Proveedor, código o categoría" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="configuration-count">{filteredSuppliers.length} proveedores</div>
            <div className="party-list supplier-party-list">
              {filteredSuppliers.map((supplier) => (
                <button className={supplier.id === selected.id ? "selected" : ""} key={supplier.id} type="button" onClick={() => setSelectedId(supplier.id)}>
                  <span><strong>{supplier.name}</strong><small>{supplier.code} · {supplier.category}</small></span>
                  <span className={supplier.rncpOpen > 0 || supplier.rncpLate > 0 ? "quality-state warning" : "quality-state success"}>{supplier.rncpTotal} RNCP</span>
                </button>
              ))}
            </div>
          </div>
          {selected ? <div className="party-detail-panel">
            <header><span className="detail-eyebrow"><ShieldCheck size={14} /> {selected.code}</span><h3>{selected.name}</h3><p>{selected.category} · Expediente de desempeño del proveedor</p></header>
            <div className="party-detail-facts supplier-facts">
              <div><small>RNCP</small><strong>{selected.rncpTotal}</strong></div>
              <div><small>Cerrados</small><strong>{selected.rncpClosed}</strong></div>
              <div><small>Tardíos</small><strong>{selected.rncpLate}</strong></div>
              <div><small>Efectividad</small><strong>{selected.effectiveness === null ? "Pendiente" : `${selected.effectiveness}%`}</strong></div>
            </div>
            <section className="party-detail-section">
              <div className="section-title-row"><h4>Clasificación de auditoría</h4><span className={selected.auditRequired ? "quality-state warning" : "quality-state success"}>{selected.auditRequired ? "Auditable" : "Alto desempeño"}</span></div>
              <div className="supplier-audit-decision">
                <CalendarDays size={20} />
                <div><strong>{selected.auditRequired ? "Auditoría semestral requerida" : "Exento de auditoría por desempeño"}</strong><p>{selected.auditRequired ? `Próxima fecha: ${formatDate(selected.nextAudit ?? "Sin programar")}` : `Efectividad vigente: ${selected.effectiveness}%`}</p></div>
              </div>
              <div className="account-scope-list compact">
                <div><Link2 size={17} /><span><strong>Portal vinculado</strong><small>Solo este proveedor recibe sus RNCP, auditorías, plazos y solicitudes de evidencia.</small></span></div>
                <div><FileSpreadsheet size={17} /><span><strong>Compras capturadas manualmente</strong><small>La efectividad se actualizará contra RNCP y compras del periodo.</small></span></div>
              </div>
            </section>
          </div> : <div className="party-detail-panel"><div className="access-empty"><ShieldCheck size={24} /><h3>Sin proveedores activos</h3><p>Un administrador puede registrar el primero en Usuarios y acceso → Empresas externas.</p></div></div>}
        </section>
      ) : null}

      {view === "audits" ? <SemesterAuditCalendar /> : null}

      {view === "dashboard" ? demo
        ? <RncpDashboard />
        : <RncpLifecycleDashboard administrator={isAdministrator(session)} canUpdate={canUpdateRncp} error={rncpDirectory.error} loading={rncpDirectory.loading} onChanged={rncpDirectory.refresh} onEdit={(id) => { setEditingRncpId(id); setView("rncp"); }} reports={rncpDirectory.reports} /> : null}
      {view === "rncp" ? <RncpForm administrator={isAdministrator(session)} companies={companyDirectory.companies} demo={demo} key={editingRncpId ?? "new"} onSaved={async (submitted) => { await rncpDirectory.refresh(); if (submitted) setView("dashboard"); }} report={rncpDirectory.reports.find((item) => item.id === editingRncpId)} /> : null}
      {view === "results" ? demo
        ? <AuditResults administrator={isAdministrator(session)} checklistName={checklistName} onChecklist={(name) => setChecklistName(name)} />
        : <SupplierAssessmentResults canUpdate={canUpdateRncp} companies={companyDirectory.companies} /> : null}
    </>
  );
}

function SemesterAuditCalendar() {
  const defaultSemester = getCurrentSemesterId();
  const [semesterId, setSemesterId] = useState(defaultSemester);
  const [eventsBySemester, setEventsBySemester] = useState<Record<string, SupplierAuditCalendarEvent[]>>(
    () => Object.fromEntries(supplierAuditSemesters.map((semester) => [semester.id, semester.events])),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const semester = supplierAuditSemesters.find((item) => item.id === semesterId) ?? supplierAuditSemesters[1];
  const events = eventsBySemester[semester.id] ?? [];
  const editingEvent = events.find((event) => event.id === editingId) ?? null;
  const averageQuality = events.reduce((sum, event) => sum + event.qualityLevel, 0) / Math.max(events.length, 1);

  const saveAudit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!editingEvent) return;
    const form = new FormData(formEvent.currentTarget);
    const date = String(form.get("date"));
    const status = String(form.get("status")) as SupplierAuditCalendarEvent["status"];
    setEventsBySemester((current) => ({
      ...current,
      [semester.id]: current[semester.id].map((event) =>
        event.id === editingEvent.id ? { ...event, date, status } : event,
      ),
    }));
    setEditingId(null);
  };

  return (
    <section className="semester-calendar-panel">
      <header className="semester-calendar-header">
        <div>
          <p className="module-kicker">Programa F-CA-58</p>
          <h3>Calendario semestral de auditorías</h3>
          <p>{semester.period} · Solo proveedores programados</p>
        </div>
        <div className="semester-switch" aria-label="Seleccionar semestre">
          {supplierAuditSemesters.map((item) => (
            <button
              className={item.id === semester.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => setSemesterId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="semester-calendar-summary">
        <div><CalendarDays size={18} /><span><strong>{events.length}</strong><small>auditorías en el programa</small></span></div>
        <div><ShieldCheck size={18} /><span><strong>{formatPercent(averageQuality)}</strong><small>nivel de calidad promedio</small></span></div>
        <p>Selecciona una auditoría para cambiar su fecha o estado.</p>
      </div>

      <div className="semester-month-grid">
        {semester.months.map(({ year, month }) => (
          <MonthCalendar
            events={events}
            key={`${year}-${month}`}
            month={month}
            onEdit={setEditingId}
            year={year}
          />
        ))}
      </div>

      {editingEvent ? (
        <div className="quality-modal-backdrop" role="presentation" onMouseDown={() => setEditingId(null)}>
          <section className="quality-modal audit-edit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-edit-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>{editingEvent.supplierCode}</span><h3 id="audit-edit-title">Editar auditoría</h3></div>
              <button className="icon-button" type="button" aria-label="Cerrar" title="Cerrar" onClick={() => setEditingId(null)}><X size={17} /></button>
            </header>
            <form onSubmit={saveAudit}>
              <div className="audit-edit-supplier"><ShieldCheck size={19} /><span><strong>{editingEvent.supplierName}</strong><small>Nivel de calidad: {formatPercent(editingEvent.qualityLevel)}</small></span></div>
              <label><span>Fecha programada</span><input name="date" type="date" defaultValue={editingEvent.date} required /></label>
              <label><span>Estado</span><select name="status" defaultValue={editingEvent.status}><option>Programada</option><option>Realizada</option><option>Pendiente</option><option>Cancelada</option></select></label>
              <footer><button className="button button-secondary" type="button" onClick={() => setEditingId(null)}>Cancelar</button><button className="button button-primary" type="submit">Guardar cambios</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function MonthCalendar({ year, month, events, onEdit }: { year: number; month: number; events: SupplierAuditCalendarEvent[]; onEdit: (id: string) => void }) {
  const cells = getMonthCells(year, month);
  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1)));
  return (
    <section className="semester-month">
      <h4>{monthLabel}</h4>
      <div className="month-weekdays" aria-hidden="true">{["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="month-days">
        {cells.map((date, index) => {
          if (!date) return <div className="month-day empty" key={`empty-${index}`} />;
          const dayEvents = events.filter((event) => event.date === date.iso);
          return (
            <div className={dayEvents.length ? "month-day has-audit" : "month-day"} key={date.iso}>
              <span>{date.day}</span>
              {dayEvents.map((event) => (
                <button className={`calendar-audit-event status-${event.status.toLowerCase()}`} key={event.id} type="button" title={`Editar ${event.supplierName}`} onClick={() => onEdit(event.id)}>
                  <span>{event.supplierName}</span>
                  <strong>{formatPercent(event.qualityLevel)}</strong>
                  <Pencil size={10} />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getMonthCells(year: number, month: number) {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > totalDays) return null;
    return { day, iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  });
}

function getCurrentSemesterId() {
  const month = new Date().getMonth();
  return month >= 1 && month <= 6 ? "semester-1-2026" : "semester-2-2026";
}

function formatPercent(value: number) {
  return `${value.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

function RncpLifecycleDashboard({ administrator, canUpdate, error, loading, onChanged, onEdit, reports }: {
  administrator: boolean;
  canUpdate: boolean;
  error: string;
  loading: boolean;
  onChanged: () => Promise<RncpReport[]>;
  onEdit: (id: string) => void;
  reports: RncpReport[];
}) {
  const dashboard = useSupplierDashboard(true);
  const [historyReport, setHistoryReport] = useState<RncpReport | null>(null);
  const [reasonOperation, setReasonOperation] = useState<{ kind: "delete" | "restore" | "reopen"; report: RncpReport } | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const deleted = reports.filter((report) => report.deletedAt);
  const summary = dashboard.data?.metrics;
  const active = dashboard.data?.rows ?? [];
  const updateFilter = <K extends keyof SupplierDashboardFilters>(key: K, value: SupplierDashboardFilters[K]) => dashboard.setFilters((current) => ({ ...current, [key]: value }));
  async function refreshAll() { const result = await onChanged(); await dashboard.refresh(); return result; }

  async function transition(report: RncpReport, action: "progress" | "close") {
    setActionError(""); setSaving(true);
    try { await saveRncpReport(action, valuesFromReport(report), report.id); await refreshAll(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "No fue posible cambiar el estado."); }
    finally { setSaving(false); }
  }

  async function confirmReasonOperation() {
    if (!reasonOperation || !reason.trim()) return;
    setActionError(""); setSaving(true);
    try {
      if (reasonOperation.kind === "reopen") await saveRncpReport("reopen", valuesFromReport(reasonOperation.report), reasonOperation.report.id, reason);
      else await setRncpDeleted(reasonOperation.report.id, reasonOperation.kind === "delete", reason);
      await refreshAll(); setReasonOperation(null); setReason(""); setHistoryReport(null);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "No fue posible completar la operación."); }
    finally { setSaving(false); }
  }

  if (loading || (dashboard.loading && !dashboard.data)) return <div className="access-empty"><CalendarClock size={24} /><p>Cargando dashboard de proveedores…</p></div>;
  if (error || dashboard.error) return <div className="access-empty"><AlertTriangle size={24} /><h3>No fue posible consultar el dashboard</h3><p>{error || dashboard.error}</p><button className="button button-secondary" onClick={() => void refreshAll()} type="button">Reintentar</button></div>;
  if (!summary) return null;

  return <section className="rncp-lifecycle-panel">
    <header><div><p className="module-kicker">Información centralizada</p><h3>Dashboard inteligente e histórico de proveedores</h3><p>Las métricas se recalculan desde registros vivos y respetan todos los filtros aplicados.</p></div><div className="rncp-dashboard-actions"><span className="quality-state success">{summary.total} RNCP</span>{administrator ? <><button className="button button-secondary" onClick={() => void exportSupplierDashboard(dashboard.filters, "csv").catch((cause) => setActionError(cause instanceof Error ? cause.message : "No fue posible exportar."))} type="button"><Download size={14} /> CSV</button><button className="button button-secondary" onClick={() => void exportSupplierDashboard(dashboard.filters, "xlsx").catch((cause) => setActionError(cause instanceof Error ? cause.message : "No fue posible exportar."))} type="button"><FileSpreadsheet size={14} /> XLSX</button></> : null}</div></header>
    <div className="supplier-dashboard-filters">
      <label className="panel-search"><Search size={15} /><input aria-label="Buscar RNCP" placeholder="Buscar RNCP, proveedor o material" value={dashboard.filters.search} onChange={(event) => updateFilter("search", event.target.value)} /></label>
      <label><span>Proveedor</span><select value={dashboard.filters.supplierId} onChange={(event) => { updateFilter("supplierId", event.target.value); updateFilter("siteId", ""); }}><option value="">Todos</option>{dashboard.data?.options.suppliers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label><span>Sucursal</span><select value={dashboard.filters.siteId} onChange={(event) => updateFilter("siteId", event.target.value)}><option value="">Todas</option>{dashboard.data?.options.sites.filter((option) => !dashboard.filters.supplierId || option.supplierId === dashboard.filters.supplierId).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label><span>Estado RNCP</span><select value={dashboard.filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">Todos</option><option value="draft">Borrador</option><option value="submitted">Enviada</option><option value="in_progress">En proceso</option><option value="closed">Cerrada</option></select></label>
      <label><span>Desde</span><input type="date" value={dashboard.filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></label>
      <label><span>Hasta</span><input type="date" value={dashboard.filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></label>
      <label><span>Categoría</span><select value={dashboard.filters.category} onChange={(event) => updateFilter("category", event.target.value)}><option value="">Todas</option>{dashboard.data?.options.categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label className="supplier-filter-check"><input checked={dashboard.filters.lateOnly} type="checkbox" onChange={(event) => updateFilter("lateOnly", event.target.checked)} /> Tardías</label>
      <label className="supplier-filter-check"><input checked={dashboard.filters.pendingActionsOnly} type="checkbox" onChange={(event) => updateFilter("pendingActionsOnly", event.target.checked)} /> Acciones pendientes</label>
      <button className="button button-secondary" onClick={() => dashboard.setFilters(emptySupplierDashboardFilters)} type="button"><RotateCcw size={14} /> Limpiar</button>
    </div>
    <div className="rncp-lifecycle-kpis supplier-dashboard-kpis">
      <div><small>RNCP totales</small><strong>{summary.total}</strong></div><div><small>Abiertas</small><strong>{summary.open}</strong></div><div><small>Tardías</small><strong>{summary.late}</strong></div><div><small>Cerradas</small><strong>{summary.closed}</strong></div><div><small>% cierre</small><strong>{summary.closureRate}%</strong></div><div><small>Promedio cierre</small><strong>{summary.averageCloseDays === null ? "—" : `${summary.averageCloseDays} d`}</strong></div><div><small>Acciones abiertas</small><strong>{summary.openActions}</strong></div><div><small>Auditorías realizadas</small><strong>{summary.completedAudits}</strong></div><div><small>Última evaluación</small><strong>{summary.latestEvaluation === null ? "—" : `${summary.latestEvaluation}%`}</strong></div>
    </div>
    {dashboard.loading ? <div className="supplier-dashboard-refreshing">Actualizando información…</div> : null}
    {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
    <div className="quality-table-wrap"><table className="quality-table rncp-history-table"><thead><tr><th>RNCP / fecha</th><th>Proveedor</th><th>Problema</th><th>Estado base</th><th>Plazo</th><th>Responsable</th><th>Acciones</th></tr></thead><tbody>
      {active.map((row) => { const report = reports.find((item) => item.id === row.id); return <tr key={row.id}><td><strong>{row.folio}</strong><small>{row.reportDate ? formatDate(row.reportDate) : "Fecha pendiente"}</small></td><td>{row.supplierName}<small>{row.siteName ?? row.supplierCode}{row.category ? ` · ${row.category}` : ""}</small></td><td>{row.findingType ?? "Sin definir"}<small>{row.materialOrService ?? "Material pendiente"}</small></td><td><span className={`quality-state ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td><td><span className={`quality-state ${row.late ? "danger" : "success"}`}>{row.late ? "Tardío" : row.status === "draft" ? "Sin iniciar" : row.status === "closed" ? "Cerrado" : "En tiempo"}</span><small>{row.responseDueDate ? formatDate(row.responseDueDate) : "Sin compromiso"}</small></td><td>{row.responsibleName ?? "Pendiente"}<small>{row.openActions} acciones abiertas</small></td><td>{report ? <div className="rncp-row-actions"><button className="icon-button" onClick={() => setHistoryReport(report)} title="Ver historial" type="button"><History size={14} /></button>{report.status === "draft" && canUpdate ? <button className="icon-button" onClick={() => onEdit(report.id)} title="Editar borrador" type="button"><Pencil size={14} /></button> : null}{report.status === "submitted" && canUpdate ? <button className="button button-secondary" disabled={saving} onClick={() => void transition(report, "progress")} type="button">Iniciar</button> : null}{report.status === "in_progress" && canUpdate ? <button className="button button-secondary" disabled={saving} onClick={() => void transition(report, "close")} type="button">Cerrar</button> : null}{report.status !== "draft" && administrator ? <button className="icon-button" onClick={() => onEdit(report.id)} title="Corrección administrativa" type="button"><Pencil size={14} /></button> : null}{report.status === "closed" && administrator ? <button className="icon-button" onClick={() => setReasonOperation({ kind: "reopen", report })} title="Reabrir" type="button"><RotateCcw size={14} /></button> : null}{administrator ? <button className="icon-button danger" onClick={() => setReasonOperation({ kind: "delete", report })} title="Eliminar RNCP" type="button"><Trash2 size={14} /></button> : null}</div> : null}</td></tr>; })}
      {!active.length ? <tr><td colSpan={7}><div className="access-empty"><FileText size={22} /><p>No hay RNCP activas.</p></div></td></tr> : null}
    </tbody></table></div>
    <details className="supplier-dashboard-history" open><summary>Histórico de proveedores ({dashboard.data?.timeline.length ?? 0})</summary><div>{dashboard.data?.timeline.slice(0, 150).map((event) => <article key={event.id}><time>{new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(event.occurredAt))}</time><span><strong>{event.supplierName} · {event.title}</strong><small>{event.detail}</small></span><em>{event.year}</em></article>)}{!dashboard.data?.timeline.length ? <p>Sin eventos para los filtros seleccionados.</p> : null}</div></details>
    {administrator && deleted.length ? <details className="rncp-deleted-register"><summary>Registros eliminados ({deleted.length})</summary>{deleted.map((report) => <article key={report.id}><span><strong>{report.folio}</strong><small>{report.supplierName ?? "Sin proveedor"} · {report.deleteReason}</small></span><time>{report.deletedAt ? formatDateTime(report.deletedAt) : ""}</time><button className="button button-secondary" onClick={() => setReasonOperation({ kind: "restore", report })} type="button"><RotateCcw size={14} /> Restaurar</button><button className="icon-button" onClick={() => setHistoryReport(report)} title="Ver historial" type="button"><History size={14} /></button></article>)}</details> : null}
    {historyReport ? <RncpHistoryModal canReview={canUpdate} onChanged={refreshAll} onClose={() => setHistoryReport(null)} report={reports.find((report) => report.id === historyReport.id) ?? historyReport} /> : null}
    {reasonOperation ? <div className="quality-modal-backdrop" role="presentation" onMouseDown={() => setReasonOperation(null)}><section className="quality-modal rncp-reason-modal" role="dialog" aria-modal="true" aria-labelledby="rncp-reason-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>{reasonOperation.report.folio}</span><h3 id="rncp-reason-title">{reasonOperation.kind === "delete" ? "Eliminar RNCP" : reasonOperation.kind === "restore" ? "Restaurar RNCP" : "Reabrir RNCP"}</h3></div><button className="icon-button" onClick={() => setReasonOperation(null)} title="Cerrar" type="button"><X size={16} /></button></header><div className="rncp-reason-content"><p>La operación quedará registrada con tu identidad y fecha.</p><label>Motivo obligatorio<textarea autoFocus rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{actionError ? <div className="form-error">{actionError}</div> : null}</div><footer><button className="button button-secondary" onClick={() => setReasonOperation(null)} type="button">Cancelar</button><button className="button button-primary" disabled={saving || !reason.trim()} onClick={() => void confirmReasonOperation()} type="button">Confirmar</button></footer></section></div> : null}
  </section>;
}

function RncpHistoryModal({ canReview, onChanged, onClose, report }: { canReview: boolean; onChanged: () => Promise<RncpReport[]>; onClose: () => void; report: RncpReport }) {
  const [rejectingId, setRejectingId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function review(actionId: string, decision: "accepted" | "rejected") {
    setSaving(true); setError("");
    try { await reviewRncpResponseAction(actionId, decision, decision === "rejected" ? comment : undefined); await onChanged(); setRejectingId(""); setComment(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible revisar la acción."); }
    finally { setSaving(false); }
  }
  async function openEvidence(fileId: string) {
    setError("");
    try { const result = await getRncpEvidenceUrl(fileId); window.open(result.signedUrl, "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible abrir la evidencia."); }
  }
  return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="quality-modal rncp-history-modal" role="dialog" aria-modal="true" aria-labelledby="rncp-history-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>{report.folio}</span><h3 id="rncp-history-title">Historial y acciones</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={16} /></button></header><div className="rncp-quality-actions"><h4>Respuesta del proveedor</h4>{report.actions.map((action) => <article key={action.id}><div><strong>{action.description}</strong><small>{action.responsibleName} · compromiso {formatDate(action.dueDate)}{action.executedAt ? ` · ejecutada ${formatDate(action.executedAt)}` : ""}</small>{action.comment ? <p>{action.comment}</p> : null}{action.validationComment ? <p><b>Revisión:</b> {action.validationComment}</p> : null}</div><span className={`quality-state ${action.status === "accepted" ? "success" : action.status === "rejected" ? "danger" : "warning"}`}>{responseStatusLabel(action.status)}</span><div className="rncp-evidence-links">{action.evidences.map((evidence) => <button key={evidence.id} onClick={() => void openEvidence(evidence.id)} type="button"><FileText size={13} /> {evidence.fileName}</button>)}</div>{canReview && action.status === "submitted" ? <footer><button className="button button-secondary" disabled={saving} onClick={() => void review(action.id, "accepted")} type="button">Aprobar evidencia</button><button className="button button-secondary danger" onClick={() => setRejectingId(action.id)} type="button">Rechazar</button></footer> : null}{rejectingId === action.id ? <div className="rncp-inline-rejection"><label>Motivo del rechazo *<textarea autoFocus rows={3} value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button button-primary" disabled={saving || !comment.trim()} onClick={() => void review(action.id, "rejected")} type="button">Confirmar rechazo</button></div> : null}</article>)}{!report.actions.length ? <p>El proveedor todavía no registra acciones.</p> : null}</div>{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="rncp-timeline"><h4>Eventos</h4>{report.history.map((event) => <article key={event.id}><span className={event.system ? "system" : ""}><History size={14} /></span><div><strong>{historyLabel(event.action)}</strong><small>{event.actorName}{event.reason ? ` · Motivo: ${event.reason}` : ""}</small></div><time>{formatDateTime(event.createdAt)}</time></article>)}{!report.history.length ? <p>Sin eventos registrados.</p> : null}</div><footer><button className="button button-secondary" onClick={onClose} type="button">Cerrar</button></footer></section></div>;
}

function RncpDashboard() {
  const summary = rncpDashboardSummary;
  return (
    <section className="rncp-dashboard matrix-dashboard">
      <header><div><p className="module-kicker">Fuente F-CA-24</p><h3>Dashboard de reportes de no calidad</h3></div><span className="quality-state success">{summary.total} RNCP</span></header>
      <div className="matrix-summary-strip">
        <div><small>Total RNCP</small><strong>{summary.total}</strong></div>
        <div><small>Acciones cerradas</small><strong>{summary.closed}</strong><span>{Math.round((summary.closed / summary.total) * 100)}%</span></div>
        <div><small>Acciones tardías</small><strong>{summary.late}</strong><span>{Math.round((summary.late / summary.total) * 100)}%</span></div>
        <div><small>En proceso</small><strong>{summary.inProcess}</strong><span>{Math.round((summary.inProcess / summary.total) * 100)}%</span></div>
      </div>
      <div className="matrix-chart-grid">
        <MatrixPie
          title="RNCP por tipo de materia prima"
          segments={summary.byMaterial.map((item, index) => ({ ...item, color: ["#2f7f89", "#df8d36", "#608d4e"][index] }))}
        />
        <MatrixPie
          title="Estatus de acciones"
          segments={[
            { label: "Cerradas", value: summary.closed, color: "#347a69" },
            { label: "Tardías", value: summary.late, color: "#df8d36" },
            { label: "En proceso", value: summary.inProcess, color: "#b84d55" },
          ]}
        />
        <SupplierStatusChart />
        <TrendLineChart />
        <SupplierParetoChart />
      </div>
      <div className="dashboard-source-footer"><FileSpreadsheet size={16} /><span><strong>F-CA-24_Matriz de RNCP.xlsx</strong><small>Las compras del periodo se incorporarán mediante captura manual para calcular efectividad.</small></span></div>
    </section>
  );
}

function MatrixPie({ title, segments }: { title: string; segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const gradient = segments.map((segment, index) => {
    const completed = segments.slice(0, index).reduce((sum, item) => sum + item.value, 0);
    const start = (completed / total) * 100;
    const end = ((completed + segment.value) / total) * 100;
    return `${segment.color} ${start}% ${end}%`;
  }).join(", ");
  return (
    <section className="matrix-chart-card matrix-pie-card">
      <h4>{title}</h4>
      <div className="matrix-pie-layout">
        <div className="matrix-pie" style={{ backgroundImage: `conic-gradient(${gradient})` }} aria-label={`${title}: ${total} registros`}><span><strong>{total}</strong><small>RNCP</small></span></div>
        <div className="matrix-legend">
          {segments.map((segment) => <div key={segment.label}><i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{Math.round((segment.value / total) * 100)}%</strong></div>)}
        </div>
      </div>
    </section>
  );
}

function SupplierStatusChart() {
  const rows = rncpDashboardSummary.bySupplierStatus;
  const max = Math.max(...rows.map((row) => row.closed + row.late + row.inProcess));
  return (
    <section className="matrix-chart-card supplier-status-chart">
      <h4>Estatus de acciones por proveedor</h4>
      <div className="matrix-status-legend"><span><i className="closed" />Cerradas</span><span><i className="late" />Tardías</span><span><i className="process" />En proceso</span></div>
      <div className="supplier-status-rows">
        {rows.map((row) => {
          const total = row.closed + row.late + row.inProcess;
          return <div key={row.label}><span>{row.label}</span><div className="supplier-status-track" style={{ width: `${Math.max((total / max) * 100, 5)}%` }}><i className="closed" style={{ flex: row.closed }} /><i className="late" style={{ flex: row.late }} />{row.inProcess ? <i className="process" style={{ flex: row.inProcess }} /> : null}</div><strong>{total}</strong></div>;
        })}
      </div>
    </section>
  );
}

function TrendLineChart() {
  const data = rncpDashboardSummary.byDate;
  const max = Math.max(...data.map((item) => item.value));
  const points = data.map((item, index) => `${42 + index * 58},${142 - (item.value / max) * 105}`).join(" ");
  return (
    <section className="matrix-chart-card matrix-wide-chart">
      <h4>RNCP por fecha</h4>
      <svg className="matrix-line-chart" viewBox="0 0 480 180" role="img" aria-label="Tendencia de RNCP por fecha">
        {[37, 72, 107, 142].map((y) => <line className="chart-grid-line" x1="36" x2="462" y1={y} y2={y} key={y} />)}
        <polyline className="chart-trend-line" fill="none" points={points} />
        {data.map((item, index) => {
          const x = 42 + index * 58;
          const y = 142 - (item.value / max) * 105;
          return <g key={item.label}><circle className="chart-trend-point" cx={x} cy={y} r="4" /><text className="chart-value" x={x} y={y - 9}>{item.value}</text><text className="chart-label" x={x} y="166">{item.label}</text></g>;
        })}
      </svg>
    </section>
  );
}

function SupplierParetoChart() {
  const data = rncpDashboardSummary.topSuppliers;
  const max = Math.max(...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const cumulativePoints = data.map((item, index) => {
    const cumulative = data.slice(0, index + 1).reduce((sum, current) => sum + current.value, 0);
    return `${66 + index * 80},${152 - (cumulative / total) * 112}`;
  }).join(" ");
  return (
    <section className="matrix-chart-card matrix-wide-chart">
      <h4>RNCP total por proveedor</h4>
      <svg className="matrix-pareto-chart" viewBox="0 0 540 200" role="img" aria-label="RNCP total por proveedor y porcentaje acumulado">
        {[40, 77, 114, 152].map((y) => <line className="chart-grid-line" x1="34" x2="516" y1={y} y2={y} key={y} />)}
        {data.map((item, index) => {
          const height = (item.value / max) * 112;
          const x = 48 + index * 80;
          return <g key={item.label}><rect className="pareto-bar" x={x} y={152 - height} width="36" height={height} rx="2" /><text className="chart-value" x={x + 18} y={145 - height}>{item.value}</text><text className="chart-label" x={x + 18} y="176">{item.label}</text></g>;
        })}
        <polyline className="pareto-line" fill="none" points={cumulativePoints} />
        {cumulativePoints.split(" ").map((point, index) => {
          const [x, y] = point.split(",");
          return <circle className="pareto-point" key={data[index].label} cx={x} cy={y} r="3.5" />;
        })}
        <text className="chart-axis-label" x="513" y="42">100%</text><text className="chart-axis-label" x="513" y="98">50%</text><text className="chart-axis-label" x="513" y="155">0%</text>
      </svg>
      <div className="pareto-legend"><span><i />RNCP</span><span><i />% acumulado</span></div>
    </section>
  );
}

function RncpForm({ administrator, companies, demo, onSaved, report }: { administrator: boolean; companies: ExternalCompany[]; demo: boolean; onSaved: (submitted: boolean) => Promise<void>; report?: RncpReport }) {
  const [values, setValues] = useState<RncpDraftInput>(() => valuesFromReport(report));
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [persistedId, setPersistedId] = useState(report?.id);
  const [persistedFolio, setPersistedFolio] = useState(report?.folio);
  const supplier = companies.find((company) => company.id === values.supplierId);
  const sites = supplier?.sites.filter((site) => site.active) ?? [];
  const correction = Boolean(report && report.status !== "draft");
  const editable = !report || report.status === "draft" || administrator;

  function update<K extends keyof RncpDraftInput>(key: K, value: RncpDraftInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function persist(action: "draft" | "submit" | "correct") {
    setSaving(true); setError(""); setNotice("");
    try {
      if (demo) {
        setNotice(action === "submit" ? "RNCP validada en modo demo; no se enviaron datos a producción." : "Borrador guardado únicamente en la sesión demo.");
      } else {
        const result = await saveRncpReport(action, values, persistedId, action === "correct" ? reason : undefined);
        setPersistedId(result.report.id);
        setPersistedFolio(result.report.folio);
        await onSaved(action === "submit");
        setNotice(action === "submit" ? "RNCP enviada y disponible para seguimiento." : action === "correct" ? "Corrección administrativa registrada en el historial." : "Borrador guardado en IntegraQ.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar la RNCP."); }
    finally { setSaving(false); }
  }

  return <section className="rncp-form-panel">
    <header><div><p className="module-kicker">Formato F-CA-25</p><h3>{report ? `${report.folio} · ${correction ? "Corrección administrativa" : "Editar borrador"}` : "Nuevo Reporte de No Calidad"}</h3><p>Guardar borrador admite información incompleta. Enviar valida los campos obligatorios.</p></div><span>{report ? statusLabel(report.status) : "Nuevo"}</span></header>
    <form onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={!editable || saving}>
        <div className="rncp-form-grid">
          <label><span>Folio</span><input disabled value={persistedFolio ?? "Se genera al guardar"} /></label>
          <label><span>Fecha de reporte *</span><input type="date" value={values.reportDate ?? ""} onChange={(event) => update("reportDate", event.target.value)} /></label>
          <label><span>Proveedor *</span><select value={values.supplierId ?? ""} onChange={(event) => { update("supplierId", event.target.value); update("siteId", ""); }}><option value="">Seleccionar proveedor</option>{companies.filter((company) => company.kind === "supplier" && company.active).map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></label>
          <label><span>Sucursal {sites.length ? "*" : "(opcional)"}</span><select disabled={!values.supplierId || !sites.length} value={values.siteId ?? ""} onChange={(event) => update("siteId", event.target.value)}><option value="">{sites.length ? "Seleccionar sucursal" : "Toda la empresa"}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></label>
          <label><span>Problema o defecto *</span><input value={values.findingType ?? ""} onChange={(event) => update("findingType", event.target.value)} /></label>
          <label><span>Producto, material o servicio *</span><input value={values.materialOrService ?? ""} onChange={(event) => update("materialOrService", event.target.value)} /></label>
          <label><span>Orden de compra</span><input value={values.purchaseOrder ?? ""} onChange={(event) => update("purchaseOrder", event.target.value)} /></label>
          <label><span>Cantidad rechazada</span><input min="0" step="any" type="number" value={values.rejectedQuantity ?? ""} onChange={(event) => update("rejectedQuantity", event.target.value)} /></label>
          <label><span>Responsable *</span><input value={values.responsibleName ?? ""} onChange={(event) => update("responsibleName", event.target.value)} /></label>
          <label><span>Fecha compromiso *</span><input type="date" value={values.responseDueDate ?? ""} onChange={(event) => update("responseDueDate", event.target.value)} /></label>
          <label className="wide"><span>Descripción y evidencia del problema *</span><textarea rows={5} value={values.description ?? ""} onChange={(event) => update("description", event.target.value)} /></label>
          <label className="wide"><span>Acciones inmediatas de contención</span><textarea rows={3} value={values.immediateDisposition ?? ""} onChange={(event) => update("immediateDisposition", event.target.value)} /></label>
          <label className="checkbox-field"><input checked={values.portalVisible !== false} type="checkbox" onChange={(event) => update("portalVisible", event.target.checked)} /> Visible en el portal del proveedor después del envío</label>
          {correction ? <label className="wide"><span>Motivo de corrección administrativa *</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
        </div>
      </fieldset>
      {notice ? <div className="form-success"><CheckCircle2 size={17} /> {notice}</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="configuration-actions"><button className="button button-secondary" type="button" disabled><Download size={16} /> Vista PDF</button>{!correction ? <button className="button button-secondary" disabled={saving} onClick={() => void persist("draft")} type="button">Guardar borrador</button> : null}{!report || report.status === "draft" ? <button className="button button-primary" disabled={saving} onClick={() => void persist("submit")} type="button">Enviar RNCP</button> : null}{correction && administrator ? <button className="button button-primary" disabled={saving || !reason.trim()} onClick={() => void persist("correct")} type="button">Guardar corrección</button> : null}</div>
    </form>
  </section>;
}

const auditFindings = [
  {
    id: "F-01",
    finding: "Control de lote incompleto",
    action: "Actualizar identificación y capacitar al personal.",
    dueDate: "21 ago 2026",
    deadline: "En tiempo",
    tone: "success",
    evidence: [
      { name: "EVID-01_Etiqueta-lote.jpg", kind: "image", uploaded: "09 ago 2026 · Portal del proveedor" },
      { name: "EVID-02_Registro-capacitacion.pdf", kind: "document", uploaded: "09 ago 2026 · Portal del proveedor" },
    ],
  },
  {
    id: "F-02",
    finding: "Certificado sin trazabilidad",
    action: "Vincular certificado, lote y orden de compra.",
    dueDate: "14 ago 2026",
    deadline: "4 días",
    tone: "warning",
    evidence: [
      { name: "EVID-03_Certificado-trazado.pdf", kind: "document", uploaded: "10 ago 2026 · Portal del proveedor" },
    ],
  },
  {
    id: "F-03",
    finding: "Inspección de salida",
    action: "Pendiente de captura en portal.",
    dueDate: "10 ago 2026",
    deadline: "Vencido",
    tone: "danger",
    evidence: [],
  },
];

function AuditResults({ administrator, checklistName, onChecklist }: { administrator: boolean; checklistName: string; onChecklist: (name: string) => void }) {
  const [evidenceFindingId, setEvidenceFindingId] = useState<string | null>(null);
  const selectedFinding = auditFindings.find((finding) => finding.id === evidenceFindingId) ?? null;
  const evidenceCount = auditFindings.reduce((total, finding) => total + finding.evidence.length, 0);
  return (
    <section className="audit-results-panel">
      <header><div><p className="module-kicker">Auditoría a proveedores</p><h3>Resultados, planes y evidencias</h3></div>{administrator ? <label className="button button-secondary file-button"><Upload size={16} /> Cargar checklist XLSX<input type="file" accept=".xlsx,.xlsm" onChange={(event) => onChecklist(event.target.files?.[0]?.name ?? "")} /></label> : <span className="module-documents-access readonly">Solo lectura</span>}</header>
      <div className="checklist-status">
        <FileSpreadsheet size={24} />
        <div><strong>{checklistName || "F-CO-05 · Resultado de auditoría"}</strong><p>{checklistName ? "Checklist recibido y listo para transformar en resultados." : "Resultado vinculado al proveedor y replicado en su portal."}</p></div>
        <span className="quality-state success">Procesado</span>
      </div>
      <div className="audit-result-summary">
        <div><small>Resultado de auditoría</small><strong>87%</strong></div>
        <div><small>Hallazgos</small><strong>{auditFindings.length}</strong></div>
        <div><small>Acciones abiertas</small><strong>2</strong></div>
        <div><small>Evidencias recibidas</small><strong>{evidenceCount}</strong></div>
      </div>
      <div className="quality-table-wrap"><table className="quality-table"><thead><tr><th>Hallazgo</th><th>Acción del proveedor</th><th>Fecha compromiso</th><th>Evidencias</th><th>Estado del plazo</th></tr></thead><tbody>
        {auditFindings.map((finding) => (
          <tr key={finding.id}>
            <td><strong>{finding.finding}</strong><small>{finding.id}</small></td>
            <td>{finding.action}</td>
            <td>{finding.dueDate}</td>
            <td>{finding.evidence.length ? <button className="evidence-link" type="button" onClick={() => setEvidenceFindingId(finding.id)}><Eye size={14} /> Ver evidencias ({finding.evidence.length})</button> : <span className="evidence-pending">Pendiente</span>}</td>
            <td><span className={`quality-state ${finding.tone}`}>{finding.deadline}</span></td>
          </tr>
        ))}
      </tbody></table></div>

      {selectedFinding ? (
        <div className="quality-modal-backdrop" role="presentation" onMouseDown={() => setEvidenceFindingId(null)}>
          <section className="quality-modal evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>{selectedFinding.id}</span><h3 id="evidence-modal-title">Evidencias del hallazgo</h3></div><button className="icon-button" type="button" aria-label="Cerrar" title="Cerrar" onClick={() => setEvidenceFindingId(null)}><X size={17} /></button></header>
            <div className="evidence-modal-finding"><strong>{selectedFinding.finding}</strong><p>{selectedFinding.action}</p></div>
            <div className="evidence-file-list">
              {selectedFinding.evidence.map((evidence) => (
                <article key={evidence.name}>
                  <span className="evidence-file-icon">{evidence.kind === "image" ? <FileImage size={20} /> : <FileText size={20} />}</span>
                  <span><strong>{evidence.name}</strong><small>{evidence.uploaded}</small></span>
                  <span className="evidence-file-kind">{evidence.kind === "image" ? "Imagen" : "Documento"}</span>
                </article>
              ))}
            </div>
            <footer><span><Link2 size={14} /> Evidencias recibidas desde el portal de este proveedor.</span><button className="button button-secondary" type="button" onClick={() => setEvidenceFindingId(null)}>Cerrar</button></footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SupplierMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function SupplierAssessmentResults({ canUpdate, companies }: { canUpdate: boolean; companies: ExternalCompany[] }) {
  const directory = useSupplierAssessments();
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [preview, setPreview] = useState<SupplierAssessment | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const supplier = companies.find((company) => company.id === supplierId);
  const suppliers = companies.filter((company) => company.kind === "supplier" && company.active);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await createSupplierAssessment({ supplierId, siteId: String(form.get("siteId") ?? "") || undefined, assessmentType: String(form.get("assessmentType")) as SupplierAssessmentType, assessmentDate: String(form.get("assessmentDate")), evaluatorName: String(form.get("evaluatorName") ?? "") || undefined, score: String(form.get("score") ?? "") || undefined, classification: String(form.get("classification") ?? "") || undefined, observations: String(form.get("observations") ?? "") || undefined, portalVisible: form.get("portalVisible") === "on", file });
      await directory.refresh(); event.currentTarget.reset(); setSupplierId(""); setFile(undefined); setCreating(false); setNotice("Resultado registrado y añadido al histórico del proveedor.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible registrar el resultado."); }
    finally { setSaving(false); }
  }

  async function openFile(assessmentId: string, download = false) {
    setError("");
    try { const result = await getSupplierAssessmentFileUrl(assessmentId, download); window.open(result.signedUrl, "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible abrir el archivo."); }
  }

  return <section className="audit-results-panel supplier-assessments-panel">
    <header><div><p className="module-kicker">Información estructurada</p><h3>Evaluaciones y auditorías</h3><p>El resultado capturado es la fuente maestra; el Excel se conserva como documento fuente.</p></div>{canUpdate ? <button className="button button-primary" onClick={() => setCreating((current) => !current)} type="button"><Plus size={15} /> Cargar evaluación</button> : <span className="module-documents-access readonly">Solo lectura</span>}</header>
    {creating ? <form className="supplier-assessment-form" onSubmit={(event) => void save(event)}>
      <div className="rncp-form-grid">
        <label><span>Proveedor *</span><select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Seleccionar proveedor</option>{suppliers.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></label>
        <label><span>Sucursal</span><select disabled={!supplier?.sites.length} name="siteId"><option value="">Toda la empresa</option>{supplier?.sites.filter((site) => site.active).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></label>
        <label><span>Tipo *</span><select name="assessmentType" required defaultValue="supplier_audit"><option value="supplier_audit">Auditoría proveedor</option><option value="semiannual_evaluation">Evaluación semestral</option><option value="annual_evaluation">Evaluación anual</option><option value="quality_evaluation">Evaluación de calidad</option><option value="other">Otro</option></select></label>
        <label><span>Fecha *</span><input name="assessmentDate" required type="date" /></label>
        <label><span>Evaluador</span><input name="evaluatorName" /></label>
        <label><span>Resultado / puntuación</span><input max="100" min="0" name="score" step="0.01" type="number" /></label>
        <label><span>Clasificación</span><input name="classification" placeholder="Aprobado, condicionado…" /></label>
        <label><span>Archivo fuente</span><input accept=".xlsx,.xls,.csv" type="file" onChange={(event) => setFile(event.target.files?.[0])} /></label>
        <label className="wide"><span>Observaciones</span><textarea name="observations" rows={4} /></label>
        <label className="checkbox-field"><input name="portalVisible" type="checkbox" /> Visible para el proveedor según su empresa y sucursal</label>
      </div>
      <div className="configuration-actions"><button className="button button-secondary" onClick={() => setCreating(false)} type="button">Cancelar</button><button className="button button-primary" disabled={saving} type="submit">{saving ? "Guardando…" : "Guardar resultado"}</button></div>
    </form> : null}
    {notice ? <div className="form-success"><CheckCircle2 size={16} /> {notice}</div> : null}
    {error || directory.error ? <div className="form-error" role="alert">{error || directory.error}</div> : null}
    {directory.loading ? <div className="access-empty"><CalendarClock size={22} /><p>Consultando evaluaciones y auditorías…</p></div> : <div className="quality-table-wrap"><table className="quality-table"><thead><tr><th>Fecha / tipo</th><th>Proveedor</th><th>Resultado</th><th>Evaluador</th><th>Archivo fuente</th><th>Portal</th></tr></thead><tbody>{directory.assessments.map((assessment) => <tr key={assessment.id}><td><strong>{formatDate(assessment.assessmentDate)}</strong><small>{supplierAssessmentTypeLabel(assessment.assessmentType)}</small></td><td>{assessment.supplierName}<small>{assessment.siteName ?? assessment.supplierCode}</small></td><td><strong>{assessment.score === undefined ? "Sin puntuación" : `${assessment.score}%`}</strong><small>{assessment.classification ?? "Sin clasificación"}</small></td><td>{assessment.evaluatorName ?? "No especificado"}</td><td><div className="assessment-file-actions"><button className="evidence-link" onClick={() => setPreview(assessment)} type="button"><FileText size={14} /> Vista previa</button>{assessment.sourceFile ? <><button className="evidence-link" onClick={() => void openFile(assessment.id)} type="button"><Eye size={14} /> Ver</button><button className="evidence-link" onClick={() => void openFile(assessment.id, true)} type="button"><Download size={14} /> Descargar</button></> : null}</div><small>{assessment.sourceFile?.name ?? "Sin archivo"}</small></td><td><span className={`quality-state ${assessment.portalVisible ? "success" : "neutral"}`}>{assessment.portalVisible ? "Visible" : "Interno"}</span></td></tr>)}{!directory.assessments.length ? <tr><td colSpan={6}><div className="access-empty"><FileSpreadsheet size={22} /><p>No hay resultados registrados.</p></div></td></tr> : null}</tbody></table></div>}
    {preview ? <div className="quality-modal-backdrop" role="presentation" onMouseDown={() => setPreview(null)}><section className="quality-modal assessment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="assessment-preview-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>{preview.supplierCode}</span><h3 id="assessment-preview-title">{supplierAssessmentTypeLabel(preview.assessmentType)}</h3></div><button className="icon-button" onClick={() => setPreview(null)} title="Cerrar" type="button"><X size={16} /></button></header><div className="assessment-preview-content"><dl><div><dt>Proveedor</dt><dd>{preview.supplierName}{preview.siteName ? ` · ${preview.siteName}` : ""}</dd></div><div><dt>Fecha</dt><dd>{formatDate(preview.assessmentDate)}</dd></div><div><dt>Resultado</dt><dd>{preview.score === undefined ? "Sin puntuación" : `${preview.score}%`}</dd></div><div><dt>Clasificación</dt><dd>{preview.classification ?? "Sin clasificación"}</dd></div><div><dt>Evaluador</dt><dd>{preview.evaluatorName ?? "No especificado"}</dd></div><div><dt>Archivo</dt><dd>{preview.sourceFile?.name ?? "Sin archivo"}</dd></div></dl>{preview.observations ? <p>{preview.observations}</p> : null}</div><footer>{preview.sourceFile ? <><button className="button button-secondary" onClick={() => void openFile(preview.id)} type="button"><Eye size={14} /> Ver</button><button className="button button-secondary" onClick={() => void openFile(preview.id, true)} type="button"><Download size={14} /> Descargar</button></> : null}<button className="button button-primary" onClick={() => setPreview(null)} type="button">Cerrar</button></footer></section></div> : null}
  </section>;
}

function toSupplierQualityRecord(company: ExternalCompany, reports: RncpReport[]): SupplierQualityRecord {
  const historicalCodes = new Set([company.code, ...company.sites.map((site) => site.code)]);
  const historical = supplierQualityCatalog.filter((supplier) => historicalCodes.has(supplier.code));
  const effective = historical.map((supplier) => supplier.effectiveness).filter((value): value is number => value !== null);
  const nextAudits = historical.map((supplier) => supplier.nextAudit).filter((value): value is string => Boolean(value)).sort();
  const companyReports = reports.filter((report) => report.supplierId === company.id);
  return {
    id: company.id,
    code: company.code,
    name: company.name,
    category: company.category ?? historical[0]?.category ?? "Sin categoría",
    rncpTotal: companyReports.length,
    rncpClosed: companyReports.filter((report) => report.status === "closed").length,
    rncpLate: companyReports.filter((report) => report.late).length,
    rncpOpen: companyReports.filter((report) => report.status === "submitted" || report.status === "in_progress").length,
    effectiveness: effective.length ? effective.reduce((total, value) => total + value, 0) / effective.length : null,
    auditRequired: historical.length ? historical.some((supplier) => supplier.auditRequired) : true,
    nextAudit: nextAudits[0] ?? null,
  };
}

function summarizeRncp(reports: RncpReport[]) {
  return {
    total: reports.length,
    draft: reports.filter((report) => report.status === "draft").length,
    submitted: reports.filter((report) => report.status === "submitted").length,
    inProgress: reports.filter((report) => report.status === "in_progress").length,
    late: reports.filter((report) => report.late).length,
    closed: reports.filter((report) => report.status === "closed").length,
  };
}

function valuesFromReport(report?: RncpReport): RncpDraftInput {
  return report ? {
    supplierId: report.supplierId, siteId: report.siteId, reportDate: report.reportDate,
    purchaseOrder: report.purchaseOrder, materialOrService: report.materialOrService,
    findingType: report.findingType, rejectedQuantity: report.rejectedQuantity?.toString(),
    description: report.description, immediateDisposition: report.immediateDisposition,
    responseDueDate: report.responseDueDate, responsibleName: report.responsibleName,
    portalVisible: report.portalVisible,
  } : { portalVisible: true };
}

function statusLabel(status: RncpReport["status"]) {
  return { draft: "Borrador", submitted: "Enviada", in_progress: "En proceso", closed: "Cerrada" }[status];
}

function statusTone(status: RncpReport["status"]) {
  return { draft: "neutral", submitted: "warning", in_progress: "warning", closed: "success" }[status];
}

function historyLabel(action: string) {
  const labels: Record<string, string> = {
    "rncp.created": "RNCP creada", "rncp.draft_saved": "Borrador guardado",
    "rncp.submitted": "RNCP enviada", "rncp.assigned": "Atención iniciada o reasignada",
    "rncp.action_added": "Acción agregada", "rncp.evidence_added": "Evidencia agregada",
    "rncp.closed": "RNCP cerrada", "rncp.reopened": "RNCP reabierta",
    "rncp.corrected": "Corrección administrativa", "rncp.deleted": "RNCP eliminada",
    "rncp.restored": "RNCP restaurada", "rncp.overdue": "Marcada como tardía",
    "rncp.action_validated": "Acción y evidencia validadas", "rncp.action_rejected": "Acción rechazada por Calidad",
  };
  return labels[action] ?? action;
}

function responseStatusLabel(status: RncpReport["actions"][number]["status"]) {
  return { pending: "Pendiente", in_progress: "En proceso", submitted: "Realizada", accepted: "Validada", rejected: "Rechazada", closed: "Validada" }[status];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(value));
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
