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
  Link2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  rncpDashboardSummary,
  supplierAuditSemesters,
  supplierQualityCatalog,
  type SupplierAuditCalendarEvent,
} from "@/lib/quality-parties-data";

type SupplierView = "directory" | "audits" | "dashboard" | "rncp" | "results";

export function SuppliersModule() {
  const [view, setView] = useState<SupplierView>("directory");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(supplierQualityCatalog[0].id);
  const [checklistName, setChecklistName] = useState("");

  const filteredSuppliers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return supplierQualityCatalog.filter(
      (supplier) =>
        !normalized ||
        [supplier.code, supplier.name, supplier.category].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        ),
    );
  }, [query]);

  const selected =
    filteredSuppliers.find((supplier) => supplier.id === selectedId) ??
    filteredSuppliers[0] ??
    supplierQualityCatalog[0];

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Gestión interna</p>
          <h2>Gestión de calidad de proveedores</h2>
          <p>RNCP, auditorías semestrales, efectividad y seguimiento de planes por proveedor.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setView("rncp")}>
          <Plus size={17} /> Nuevo RNCP
        </button>
      </section>

      <section className="metric-grid" aria-label="Resumen de proveedores">
        <SupplierMetric icon={<ShieldCheck size={18} />} label="Proveedores identificados" value={supplierQualityCatalog.length} tone="neutral" />
        <SupplierMetric icon={<FileText size={18} />} label="RNCP históricos" value={rncpDashboardSummary.total} tone="success" />
        <SupplierMetric icon={<CalendarClock size={18} />} label="Acciones tardías" value={rncpDashboardSummary.late} tone="warning" />
        <SupplierMetric icon={<AlertTriangle size={18} />} label="En proceso" value={rncpDashboardSummary.inProcess} tone="danger" />
      </section>

      <section className="quality-source-note supplier-source-note">
        <Link2 size={18} />
        <div>
          <strong>Una captura, dos vistas</strong>
          <p>F-CA-24 alimenta la matriz y el dashboard; F-CA-25 define el reporte. Auditorías, planes y evidencias se registran aquí y se replican al portal del proveedor correspondiente.</p>
        </div>
        <span>Sin Root2Cause</span>
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
          <div className="party-detail-panel">
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
          </div>
        </section>
      ) : null}

      {view === "audits" ? <SemesterAuditCalendar /> : null}

      {view === "dashboard" ? <RncpDashboard /> : null}
      {view === "rncp" ? <RncpForm /> : null}
      {view === "results" ? (
        <AuditResults checklistName={checklistName} onChecklist={(name) => setChecklistName(name)} />
      ) : null}
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

function RncpForm() {
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaved(true); };
  return (
    <section className="rncp-form-panel">
      <header><div><p className="module-kicker">Formato F-CA-25</p><h3>Reporte de No Calidad Proveedores</h3></div><span>Salida PDF</span></header>
      <form onSubmit={submit}>
        <div className="rncp-form-grid">
          <label><span>Folio de RNCP</span><input defaultValue="RNCP0205" required /></label>
          <label><span>Fecha de reporte</span><input type="date" defaultValue="2026-08-10" required /></label>
          <label><span>Proveedor</span><select defaultValue=""><option value="" disabled>Seleccionar proveedor</option>{supplierQualityCatalog.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label><span>Número de proveedor</span><input placeholder="PR00000" required /></label>
          <label><span>¿Cuál es el defecto?</span><input required /></label>
          <label><span>¿Qué producto se detectó?</span><input required /></label>
          <label><span>¿Dónde se detectó?</span><input required /></label>
          <label><span>¿Qué lote se detectó?</span><input required /></label>
          <label><span>¿Quién lo detectó?</span><input required /></label>
          <label><span>¿Cuánto afectó?</span><input placeholder="Paros, horas, segundas o merma" /></label>
          <label className="wide"><span>Evidencias y descripción del fallo</span><textarea rows={5} required /></label>
          <label className="wide"><span>Acciones inmediatas para contener (Towel)</span><textarea rows={3} required /></label>
          <label className="checkbox-field"><input type="checkbox" /> Requiere acción correctiva del proveedor</label>
        </div>
        {saved ? <div className="form-success"><CheckCircle2 size={17} /> Borrador preparado para persistencia y generación del PDF F-CA-25.</div> : null}
        <div className="configuration-actions"><button className="button button-secondary" type="button" disabled><Download size={16} /> Vista PDF</button><button className="button button-primary" type="submit">Guardar borrador</button></div>
      </form>
    </section>
  );
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

function AuditResults({ checklistName, onChecklist }: { checklistName: string; onChecklist: (name: string) => void }) {
  const [evidenceFindingId, setEvidenceFindingId] = useState<string | null>(null);
  const selectedFinding = auditFindings.find((finding) => finding.id === evidenceFindingId) ?? null;
  const evidenceCount = auditFindings.reduce((total, finding) => total + finding.evidence.length, 0);
  return (
    <section className="audit-results-panel">
      <header><div><p className="module-kicker">Auditoría a proveedores</p><h3>Resultados, planes y evidencias</h3></div><label className="button button-secondary file-button"><Upload size={16} /> Cargar checklist XLSX<input type="file" accept=".xlsx,.xlsm" onChange={(event) => onChecklist(event.target.files?.[0]?.name ?? "")} /></label></header>
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

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
