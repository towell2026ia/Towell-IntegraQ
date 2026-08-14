"use client";

import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Bot,
  ChevronRight,
  ClipboardList,
  Code2,
  Database,
  Download,
  FileInput,
  Files,
  FileText,
  Images,
  LayoutDashboard,
  ListChecks,
  Search,
  TableProperties,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { DocumentTypeWorkspace } from "@/components/modules/document-type-workspace";
import {
  processCatalog,
  type ProcessCatalogItem,
} from "@/lib/configuration-data";
import {
  buildInitialControlledDocuments,
  getDocumentPermissions,
  type ControlledDocument,
} from "@/lib/document-control-data";
import { documentTypeCatalog } from "@/lib/document-data";
import {
  appFormCatalog,
  buildFormDashboard,
  serializeFormRecordsToCsv,
  type AppFormDefinition,
  type AppFormField,
  type AppFormValue,
} from "@/lib/form-data";
import { activeSession } from "@/lib/session-data";

const documentTypeIcons: Record<string, LucideIcon> = {
  processes: Workflow,
  manuals: BookOpen,
  procedures: ClipboardList,
  instructions: ListChecks,
  forms: Files,
  "application-forms": FileInput,
  "standard-operation-sheets": TableProperties,
  "visual-aids": Images,
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type DocumentsView = "process" | "type" | "form";
type FormView = "dashboard" | "data";

export function DocumentsModule() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("P-01");
  const [documentsView, setDocumentsView] = useState<DocumentsView>("process");
  const [selectedTypeId, setSelectedTypeId] = useState("processes");
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [formView, setFormView] = useState<FormView>("dashboard");
  const [controlledDocuments, setControlledDocuments] = useState(
    buildInitialControlledDocuments,
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return processCatalog.filter(
      (process) =>
        getDocumentPermissions(activeSession, process.id).view &&
        (!normalized ||
          [process.id, process.name].some((value) =>
            value.toLocaleLowerCase("es").includes(normalized),
          )),
    );
  }, [query]);

  const selected =
    filtered.find((process) => process.id === selectedId) ??
    filtered[0] ??
    processCatalog[0];
  const selectedType =
    documentTypeCatalog.find((item) => item.id === selectedTypeId) ??
    documentTypeCatalog[0];
  const selectedPermissions = getDocumentPermissions(activeSession, selected.id);
  const typeDocuments = controlledDocuments.filter(
    (document) =>
      document.processId === selected.id &&
      document.documentTypeId === selectedType.id,
  );
  const selectedForm =
    appFormCatalog.find((form) => form.id === selectedFormId) ?? null;

  function selectProcess(processId: string) {
    setSelectedId(processId);
    setDocumentsView("process");
    setSelectedTypeId("processes");
    setSelectedFormId(null);
    setFormView("dashboard");
  }

  function openDocumentType(documentTypeId: string) {
    setSelectedTypeId(documentTypeId);
    setSelectedFormId(null);
    setDocumentsView("type");
  }

  function openForm(formId: string) {
    setSelectedFormId(formId);
    setFormView("dashboard");
    setDocumentsView("form");
  }

  function changeDocument(nextDocument: ControlledDocument) {
    setControlledDocuments((current) =>
      current.map((document) =>
        document.id === nextDocument.id ? nextDocument : document,
      ),
    );
  }

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Control documental</p>
          <h2>Información documentada</h2>
          <p>Organigrama, documentos y registros organizados por proceso.</p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Resumen documental">
        <DocumentMetric icon={<FileText size={18} />} label="Tipos documentales" value={8} tone="neutral" />
        <DocumentMetric icon={<BookOpenCheck size={18} />} label="Procesos clasificados" value={processCatalog.length} tone="success" />
        <DocumentMetric icon={<Workflow size={18} />} label="Organigramas cargados" value={0} tone="warning" />
        <DocumentMetric icon={<Files size={18} />} label="Formularios activos" value={appFormCatalog.length} tone="danger" />
      </section>

      <section className={`documents-layout ${documentsView === "process" ? "" : "documents-layout-focus"}`}>
        <div className="documents-process-panel">
          <div className="configuration-toolbar document-toolbar">
            <label className="panel-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar proceso"
                aria-label="Buscar proceso documental"
              />
            </label>
          </div>
          <div className="configuration-count">{filtered.length} procesos</div>
          <div className="document-process-list">
            {filtered.map((process) => {
              const documentCount = controlledDocuments.filter(
                (document) => document.processId === process.id,
              ).length;
              return (
                <button
                  className={`document-process-row ${process.id === selected.id ? "document-process-row-selected" : ""}`}
                  key={process.id}
                  type="button"
                  onClick={() => selectProcess(process.id)}
                >
                  <span>
                    <strong>{process.name}</strong>
                    <small>{process.id} · {process.level === "process" ? "Proceso" : "Subproceso"}</small>
                  </span>
                  <span className="document-count-state">
                    {documentCount} {documentCount === 1 ? "doc" : "docs"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="documents-detail-panel">
          {documentsView === "process" ? (
            <ProcessDocumentHome
              process={selected}
              documents={controlledDocuments.filter(
                (document) => document.processId === selected.id,
              )}
              permissions={selectedPermissions}
              onOpenType={openDocumentType}
            />
          ) : null}

          {documentsView === "type" ? (
            <DocumentTypeWorkspace
              process={selected}
              documentType={selectedType}
              documents={typeDocuments}
              permissions={selectedPermissions}
              session={activeSession}
              onBack={() => setDocumentsView("process")}
              onOpenForm={openForm}
              onChangeDocument={changeDocument}
              onAddDocument={(document) =>
                setControlledDocuments((current) => [...current, document])
              }
            />
          ) : null}

          {documentsView === "form" && selectedForm ? (
            <FormWorkspace
              form={selectedForm}
              process={selected}
              view={formView}
              onChangeView={setFormView}
              onBack={() => setDocumentsView("type")}
            />
          ) : null}
        </div>
      </section>
    </>
  );
}

function ProcessDocumentHome({
  process,
  documents,
  permissions,
  onOpenType,
}: {
  process: ProcessCatalogItem;
  documents: ControlledDocument[];
  permissions: ReturnType<typeof getDocumentPermissions>;
  onOpenType: (documentTypeId: string) => void;
}) {
  return (
    <>
      <header className="documents-detail-header">
        <span className="detail-eyebrow"><Workflow size={14} /> {process.id}</span>
        <h3>{process.name}</h3>
        <p>{process.level === "process" ? "Proceso" : "Subproceso"} · Expediente documental</p>
      </header>

      <section className="documents-detail-section department-chart-section">
        <div className="section-title-row">
          <h4>Organigrama del departamento</h4>
          <span className="pending-badge">Pendiente por subir</span>
        </div>
        <div className="department-chart-placeholder">
          <div className="department-chart-flow" aria-hidden="true">
            <span />
            <i />
            <span />
            <i />
            <span />
          </div>
          <div>
            <strong>Organigrama vertical</strong>
            <p>{process.name}</p>
          </div>
          <button className="button button-secondary" type="button" disabled>
            Subir organigrama
          </button>
        </div>
      </section>

      <section className="documents-detail-section">
        <div className="section-title-row">
          <h4>Documentos por tipo</h4>
          <span className="count-badge">8</span>
        </div>
        <div className="document-type-list">
          {documentTypeCatalog.map((documentType) => {
            const Icon = documentTypeIcons[documentType.id] ?? FileText;
            const count = documents.filter(
              (document) => document.documentTypeId === documentType.id,
            ).length;
            return (
              <button
                key={documentType.id}
                type="button"
                onClick={() => onOpenType(documentType.id)}
              >
                <span className="document-type-icon"><Icon size={16} /></span>
                <span>
                  <strong>{documentType.name}</strong>
                  <small>{documentType.description}</small>
                </span>
                <span className="document-type-count">{count}</span>
                <ChevronRight size={15} className="document-type-arrow" />
              </button>
            );
          })}
        </div>
      </section>

      <div className="configuration-actions">
        <span className="document-permission-copy">
          {permissions.upload
            ? "La carga se realiza dentro de cada tipo documental."
            : "Consulta documental del proceso."}
        </span>
      </div>
    </>
  );
}

function FormWorkspace({
  form,
  process,
  view,
  onChangeView,
  onBack,
}: {
  form: AppFormDefinition;
  process: ProcessCatalogItem;
  view: FormView;
  onChangeView: (view: FormView) => void;
  onBack: () => void;
}) {
  const [structureOpen, setStructureOpen] = useState(false);

  return (
    <>
      <header className="document-subview-header form-workspace-header">
        <button className="icon-button" type="button" onClick={onBack} title="Volver a formularios" aria-label="Volver a formularios">
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className="detail-eyebrow"><FileInput size={14} /> {form.registrationNumber}</span>
          <h3>{form.name}</h3>
          <p>{process.id} · {process.name} · Versión {form.version}</p>
        </div>
        <div className="form-workspace-actions">
          <button className="button button-secondary" type="button" onClick={() => setStructureOpen(true)}>
            <Code2 size={16} /> Estructura y código
          </button>
          <span className="quality-state success">{form.status}</span>
        </div>
      </header>

      <nav className="form-view-tabs" aria-label="Vistas del formulario">
        <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => onChangeView("dashboard")}>
          <LayoutDashboard size={15} /> Dashboard
        </button>
        <button className={view === "data" ? "active" : ""} type="button" onClick={() => onChangeView("data")}>
          <Database size={15} /> Datos
        </button>
      </nav>

      {view === "dashboard" ? <FormDashboard form={form} /> : null}
      {view === "data" ? <FormDataTable form={form} /> : null}

      {structureOpen ? (
        <FormStructureWindow
          form={form}
          process={process}
          onClose={() => setStructureOpen(false)}
        />
      ) : null}
    </>
  );
}

function FormDashboard({ form }: { form: AppFormDefinition }) {
  const snapshot = buildFormDashboard(form);
  const metricField = form.fields.find(
    (field) => field.id === form.dashboard.metricField,
  );
  const trendMaximum = Math.max(...snapshot.monthlyTrend.map((item) => item.value), 1);
  const categoryMaximum = Math.max(...snapshot.categoryBreakdown.map((item) => item.value), 1);
  const statusMaximum = Math.max(...snapshot.statusBreakdown.map((item) => item.value), 1);

  return (
    <div className="form-dashboard-view">
      <section className="form-agent-band">
        <span><Bot size={18} /></span>
        <div>
          <small>Estructura de análisis</small>
          <strong>{form.dashboard.id} · Versión {form.dashboard.version}</strong>
          <p>{form.dashboard.agentName} · Generada el {formatDate(form.dashboard.generatedAt)}</p>
        </div>
        <span className="form-agent-update">
          Datos al {snapshot.lastRecordAt ? formatDate(snapshot.lastRecordAt) : "Sin registros"}
        </span>
      </section>

      <section className="form-dashboard-metrics" aria-label="Indicadores del formulario">
        <DashboardMetric label="Registros totales" value={String(snapshot.totalRecords)} />
        <DashboardMetric label="Registros este mes" value={String(snapshot.recordsThisMonth)} />
        <DashboardMetric
          label={snapshot.metricLabel ? `Promedio · ${snapshot.metricLabel}` : "Promedio"}
          value={snapshot.metricAverage === null ? "—" : `${formatNumber(snapshot.metricAverage)}${metricField?.unit ? ` ${metricField.unit}` : ""}`}
        />
        <DashboardMetric label="Último registro" value={snapshot.lastRecordAt ? formatDate(snapshot.lastRecordAt) : "—"} compact />
      </section>

      <section className="form-dashboard-grid">
        <div className="form-dashboard-panel">
          <div className="section-title-row">
            <h4>Registros por mes</h4>
            <BarChart3 size={16} />
          </div>
          <div className="form-trend-chart" aria-label="Tendencia de registros de los últimos seis meses">
            {snapshot.monthlyTrend.map((item) => (
              <div key={item.label}>
                <span>{item.value}</span>
                <i style={{ height: `${Math.max((item.value / trendMaximum) * 100, item.value ? 12 : 2)}%` }} />
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="form-dashboard-panel">
          <div className="section-title-row">
            <h4>Distribución por estado</h4>
            <span className="count-badge">{snapshot.statusBreakdown.length}</span>
          </div>
          <div className="form-breakdown-list">
            {snapshot.statusBreakdown.map((item) => (
              <div key={item.label}>
                <span><strong>{item.label}</strong><small>{item.value}</small></span>
                <i><b style={{ width: `${(item.value / statusMaximum) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </div>

        <div className="form-dashboard-panel form-dashboard-panel-wide">
          <div className="section-title-row">
            <h4>Distribución · {form.fields.find((field) => field.id === form.dashboard.categoryField)?.label}</h4>
            <span className="count-badge">{snapshot.categoryBreakdown.length}</span>
          </div>
          <div className="form-category-grid">
            {snapshot.categoryBreakdown.map((item) => (
              <div key={item.label}>
                <span><strong>{item.label}</strong><small>{item.value} registros</small></span>
                <i><b style={{ width: `${(item.value / categoryMaximum) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardMetric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong className={compact ? "compact" : ""}>{value}</strong>
    </div>
  );
}

function FormStructureWindow({
  form,
  process,
  onClose,
}: {
  form: AppFormDefinition;
  process: ProcessCatalogItem;
  onClose: () => void;
}) {
  return (
    <div className="form-structure-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="form-structure-dialog" role="dialog" aria-modal="true" aria-labelledby="form-structure-title">
        <header className="form-structure-dialog-header">
          <span><Code2 size={18} /></span>
          <div>
            <small>Estructura y código</small>
            <h4 id="form-structure-title">{form.name}</h4>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar estructura del formulario">
            <X size={17} />
          </button>
        </header>

        <div className="form-structure-metadata">
          <div><small>Código del formulario</small><strong>{form.registrationNumber}</strong></div>
          <div><small>Versión</small><strong>{form.version}</strong></div>
          <div><small>Proceso</small><strong>{process.id} · {process.name}</strong></div>
          <div><small>Estado</small><strong>{form.status}</strong></div>
        </div>

        <div className="form-structure-dialog-body">
          <header className="form-section-header">
            <div>
              <span className="detail-eyebrow"><FileInput size={14} /> Definición vigente</span>
              <h4>{form.fields.length} campos</h4>
            </div>
            <span className="app-form-code">{form.registrationNumber}</span>
          </header>
          <form className="form-structure-preview" aria-label={`Estructura de ${form.name}`}>
            {form.fields.map((field) => (
              <label className={field.type === "textarea" ? "form-field-wide" : ""} key={field.id}>
                <span className="form-field-definition">
                  <strong>{field.label}</strong>
                  <code>{field.id}</code>
                </span>
                <small>{field.required ? "Obligatorio" : "Opcional"}{field.unit ? ` · ${field.unit}` : ""}</small>
                <FormFieldPreview field={field} />
              </label>
            ))}
          </form>
        </div>
      </section>
    </div>
  );
}

function FormFieldPreview({ field }: { field: AppFormField }) {
  if (field.type === "select") {
    return (
      <select defaultValue="" disabled aria-label={field.label}>
        <option value="">Seleccionar</option>
        {field.options?.map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }

  if (field.type === "textarea") {
    return <textarea value="" readOnly aria-label={field.label} />;
  }

  return <input type={field.type} value="" readOnly aria-label={field.label} />;
}

function FormDataTable({ form }: { form: AppFormDefinition }) {
  return (
    <div className="form-data-view">
      <header className="form-data-toolbar">
        <div>
          <span className="detail-eyebrow"><Database size={14} /> Registros capturados</span>
          <h4>{form.records.length} registros</h4>
        </div>
        <button className="button button-secondary" type="button" onClick={() => exportFormRecords(form)}>
          <Download size={16} /> Exportar CSV
        </button>
      </header>
      <div className="form-data-table-wrap">
        <table className="form-data-table">
          <thead>
            <tr>
              <th>Registro</th>
              <th>Captura</th>
              <th>Estado</th>
              {form.fields.map((field) => <th key={field.id}>{field.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {form.records.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.id}</strong></td>
                <td>{formatDate(record.createdAt)}</td>
                <td><span className="form-record-status">{record.status}</span></td>
                {form.fields.map((field) => (
                  <td key={field.id}>{formatFieldValue(record.values[field.id], field)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exportFormRecords(form: AppFormDefinition) {
  const csv = serializeFormRecordsToCsv(form);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${form.registrationNumber}-datos.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatFieldValue(value: AppFormValue | undefined, field: AppFormField) {
  if (value === undefined || value === "") return "—";
  if (field.type === "date" && typeof value === "string") {
    return formatDate(`${value}T00:00:00.000Z`);
  }
  if (typeof value === "number") {
    return `${formatNumber(value)}${field.unit ? ` ${field.unit}` : ""}`;
  }
  return value;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatNumber(value: number) {
  return value.toLocaleString("es-MX", { maximumFractionDigits: 1 });
}

function DocumentMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}
