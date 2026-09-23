"use client";

import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  ChevronRight,
  ClipboardList,
  Code2,
  Database,
  Download,
  FileInput,
  Files,
  FileText,
  Images,
  History,
  LayoutDashboard,
  ListChecks,
  Search,
  TableProperties,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DocumentHistoryModal, DocumentTypeWorkspace } from "@/components/modules/document-type-workspace";
import { FormIntelligenceDashboard } from "@/components/modules/form-intelligence-dashboard";
import { ProcessOrganizationChart } from "@/components/modules/process-organization-chart";
import {
  processCatalog,
  type ProcessCatalogItem,
} from "@/lib/configuration-data";
import {
  getDocumentPermissions,
  getWorkingVersion,
  isOperationalDocument,
  restoreControlledDocument,
  documentAdvancedActionsEnabled,
  type ControlledDocument,
} from "@/lib/document-control-data";
import {
  documentTypeCatalog,
  getDocumentProcessIds,
  getPrimaryDocumentProcessId,
  isGroupedDocumentProcess,
} from "@/lib/document-data";
import {
  serializeFormRecordsToCsv,
  type AppFormDefinition,
  type AppFormField,
  type AppFormValue,
} from "@/lib/form-data";
import type { ActiveSession } from "@/lib/session-data";
import { isAdministrator } from "@/lib/session-data";
import { restoreStoredDocument } from "@/lib/document-storage";
import {
  loadProcessOrganizationSources,
  type ProcessOrganizationSource,
} from "@/lib/organization-chart-storage";

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

type DocumentsView = "process" | "type" | "form" | "master";
type FormView = "dashboard" | "data";

interface DocumentsModuleProps {
  controlledDocuments: ControlledDocument[];
  forms: AppFormDefinition[];
  focusId?: string;
  onControlledDocumentsChange: (documents: ControlledDocument[]) => void;
  session: ActiveSession;
}

export function DocumentsModule({
  controlledDocuments,
  forms,
  focusId,
  onControlledDocumentsChange,
  session,
}: DocumentsModuleProps) {
  const focusedDocument = controlledDocuments.find((document) => document.id === focusId);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    getPrimaryDocumentProcessId(focusedDocument?.processId ?? "P-01"),
  );
  const [documentsView, setDocumentsView] = useState<DocumentsView>(
    focusedDocument?.appFormId ? "form" : focusedDocument ? "type" : "process",
  );
  const [selectedTypeId, setSelectedTypeId] = useState(focusedDocument?.documentTypeId ?? "processes");
  const [selectedFormId, setSelectedFormId] = useState<string | null>(focusedDocument?.appFormId ?? null);
  const [formView, setFormView] = useState<FormView>("dashboard");
  const [organizationSources, setOrganizationSources] = useState<ProcessOrganizationSource[]>([]);
  const loadOrganizationSources = useCallback(async () => {
    try { setOrganizationSources(await loadProcessOrganizationSources()); }
    catch { setOrganizationSources([]); }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadOrganizationSources); }, [loadOrganizationSources]);
  const operationalDocuments = useMemo(
    () => controlledDocuments.filter(isOperationalDocument),
    [controlledDocuments],
  );
  const canViewMasterList = documentAdvancedActionsEnabled && processCatalog.some(
    (process) => getDocumentPermissions(session, process.id).masterList,
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return processCatalog.filter(
      (process) =>
        !isGroupedDocumentProcess(process.id) &&
        getDocumentPermissions(session, process.id).view &&
        (!normalized ||
          [process.id, process.name].some((value) =>
            value.toLocaleLowerCase("es").includes(normalized),
          )),
    );
  }, [query, session]);

  const selected =
    filtered.find((process) => process.id === selectedId) ??
    filtered[0] ??
    processCatalog[0];
  const selectedType =
    documentTypeCatalog.find((item) => item.id === selectedTypeId) ??
    documentTypeCatalog[0];
  const selectedPermissions = getDocumentPermissions(session, selected.id);
  const selectedDocumentProcessIds = getDocumentProcessIds(selected.id);
  const typeDocuments = operationalDocuments.filter(
    (document) =>
      selectedDocumentProcessIds.includes(document.processId) &&
      document.documentTypeId === selectedType.id,
  );
  const selectedForm = forms.find((form) => form.id === selectedFormId) ?? null;

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
    onControlledDocumentsChange(
      controlledDocuments.map((document) =>
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
        {canViewMasterList ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setDocumentsView(documentsView === "master" ? "process" : "master")}
          >
            {documentsView === "master" ? <ArrowLeft size={16} /> : <TableProperties size={16} />}
            {documentsView === "master" ? "Volver" : "Lista Maestra"}
          </button>
        ) : null}
      </section>

      <section className="metric-grid" aria-label="Resumen documental">
        <DocumentMetric icon={<FileText size={18} />} label="Tipos documentales" value={8} tone="neutral" />
        <DocumentMetric icon={<BookOpenCheck size={18} />} label="Expedientes de proceso" value={processCatalog.filter((process) => !isGroupedDocumentProcess(process.id)).length} tone="success" />
        <DocumentMetric icon={<Workflow size={18} />} label="Organigramas cargados" value={new Set(organizationSources.map((source) => source.processId)).size} tone="warning" />
        <DocumentMetric icon={<Files size={18} />} label="Formularios activos" value={forms.filter((form) => form.status === "Activo").length} tone="danger" />
      </section>

      {documentsView === "master" ? (
        <MasterDocumentList
          documents={controlledDocuments}
          session={session}
          onChangeDocument={changeDocument}
        />
      ) : (
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
              const processIds = getDocumentProcessIds(process.id);
              const documentCount = operationalDocuments.filter(
                (document) => processIds.includes(document.processId),
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
                    <small>
                      {process.id} · {processIds.length > 1 ? "Expediente consolidado" : "Expediente documental"}
                    </small>
                  </span>
                  <span className="document-count-state">
                    {documentCount} {documentCount === 1 ? "doc" : "docs"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`documents-detail-panel ${documentsView === "process" ? "documents-detail-panel-home" : "documents-detail-panel-focus"}`}>
          {documentsView === "process" ? (
            <ProcessDocumentHome
              process={selected}
              documents={operationalDocuments.filter(
                (document) => selectedDocumentProcessIds.includes(document.processId),
              )}
              permissions={selectedPermissions}
              source={organizationSources.find((source) => source.processId === selected.id)}
              onOrganizationSaved={loadOrganizationSources}
              onOpenType={openDocumentType}
            />
          ) : null}

          {documentsView === "type" ? (
            <DocumentTypeWorkspace
              process={selected}
              documentType={selectedType}
              documents={typeDocuments}
              permissions={selectedPermissions}
              session={session}
              onBack={() => setDocumentsView("process")}
              onOpenForm={openForm}
              onChangeDocument={changeDocument}
              onAddDocument={(document) =>
                onControlledDocumentsChange([...controlledDocuments, document])
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
      )}
    </>
  );
}

function ProcessDocumentHome({
  process,
  documents,
  permissions,
  source,
  onOrganizationSaved,
  onOpenType,
}: {
  process: ProcessCatalogItem;
  documents: ControlledDocument[];
  permissions: ReturnType<typeof getDocumentPermissions>;
  source?: ProcessOrganizationSource;
  onOrganizationSaved: () => Promise<void> | void;
  onOpenType: (documentTypeId: string) => void;
}) {
  return (
    <>
      <header className="documents-detail-header">
        <span className="detail-eyebrow"><Workflow size={14} /> {process.id}</span>
        <h3>{process.name}</h3>
        <p>
          Proceso · {getDocumentProcessIds(process.id).length > 1
            ? "Expediente documental consolidado"
            : "Expediente documental"}
        </p>
      </header>

      <ProcessOrganizationChart process={process} permissions={permissions} source={source} onSaved={onOrganizationSaved} />

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

type MasterStatusFilter = "current" | "review" | "obsolete" | "all" | "deleted";

function MasterDocumentList({
  documents,
  session,
  onChangeDocument,
}: {
  documents: ControlledDocument[];
  session: ActiveSession;
  onChangeDocument: (document: ControlledDocument) => void;
}) {
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<MasterStatusFilter>("current");
  const [versionFilter, setVersionFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const authorizedProcesses = processCatalog.filter(
    (process) => !isGroupedDocumentProcess(process.id) && getDocumentPermissions(session, process.id).masterList,
  );
  const authorizedProcessIds = new Set(authorizedProcesses.flatMap((process) => getDocumentProcessIds(process.id)));
  const scopedDocuments = documents.filter((document) => authorizedProcessIds.has(document.processId));
  const owners = [...new Set(scopedDocuments.map((document) => document.owner))].sort((a, b) => a.localeCompare(b, "es"));
  const history = documents.find((document) => document.id === historyId) ?? null;

  function matchesStatus(document: ControlledDocument) {
    if (statusFilter === "deleted") return Boolean(document.lifecycle?.isDeleted);
    if (document.lifecycle?.isDeleted) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "obsolete") return document.lifecycle?.status === "obsolete" || document.versions.some((version) => version.status === "obsolete") && !document.versions.some((version) => version.status === "current");
    if (statusFilter === "review") return document.versions.some((version) => ["draft", "pending", "rejected"].includes(version.status));
    return document.lifecycle?.status !== "obsolete" && document.versions.some((version) => version.status === "current");
  }

  const filteredDocuments = scopedDocuments.filter((document) => {
    const primaryProcessId = getPrimaryDocumentProcessId(document.processId);
    const process = processCatalog.find((item) => item.id === primaryProcessId);
    const working = getWorkingVersion(document);
    const normalized = query.trim().toLocaleLowerCase("es");
    return (!selectedProcessId || primaryProcessId === selectedProcessId)
      && (!processFilter || primaryProcessId === processFilter)
      && (!typeFilter || document.documentTypeId === typeFilter)
      && (!ownerFilter || document.owner === ownerFilter)
      && (!versionFilter || String(working?.revision ?? "") === versionFilter)
      && matchesStatus(document)
      && (!normalized || [document.code, document.name, document.description ?? "", process?.name ?? ""].some((value) => value.toLocaleLowerCase("es").includes(normalized)));
  });

  if (!selectedProcessId) {
    return (
      <section className="master-list-panel">
        <header className="master-list-header"><div><span className="detail-eyebrow"><TableProperties size={14} /> Información Documentada</span><h3>Lista Maestra</h3><p>Documentos vigentes agrupados por proceso y calculados desde la fuente documental.</p></div></header>
        <label className="panel-search master-list-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar proceso" aria-label="Buscar proceso en Lista Maestra" /></label>
        <div className="master-process-grid">
          {authorizedProcesses.filter((process) => !query.trim() || process.name.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es"))).map((process) => {
            const processIds = getDocumentProcessIds(process.id);
            const count = scopedDocuments.filter((document) => processIds.includes(document.processId) && !document.lifecycle?.isDeleted && document.lifecycle?.status !== "obsolete" && document.versions.some((version) => version.status === "current")).length;
            return <button key={process.id} type="button" onClick={() => { setSelectedProcessId(process.id); setProcessFilter(process.id); setQuery(""); }}><span><strong>{process.name}</strong><small>{process.id}</small></span><span>{count} documentos <ChevronRight size={15} /></span></button>;
          })}
        </div>
      </section>
    );
  }

  const selectedProcess = processCatalog.find((process) => process.id === selectedProcessId);
  return (
    <section className="master-list-panel">
      <header className="master-list-header master-list-detail-header">
        <button className="icon-button" type="button" onClick={() => { setSelectedProcessId(null); setProcessFilter(""); setQuery(""); }} title="Volver a procesos" aria-label="Volver a procesos"><ArrowLeft size={17} /></button>
        <div><span className="detail-eyebrow"><TableProperties size={14} /> Lista Maestra</span><h3>{selectedProcess?.name ?? "Documentos"}</h3><p>{filteredDocuments.length} documentos encontrados</p></div>
      </header>
      <div className="master-list-filters">
        <label className="panel-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código, nombre, descripción o proceso" /></label>
        <select aria-label="Proceso" value={processFilter} onChange={(event) => { setProcessFilter(event.target.value); setSelectedProcessId(event.target.value || null); }}><option value="">Proceso</option>{authorizedProcesses.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}</select>
        <select aria-label="Tipo" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Tipo</option>{documentTypeCatalog.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
        <select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MasterStatusFilter)}><option value="current">Vigentes</option><option value="review">En revisión</option><option value="obsolete">Obsoletos</option><option value="all">Todos</option>{isAdministrator(session) ? <option value="deleted">Eliminados</option> : null}</select>
        <input aria-label="Versión" min={0} type="number" value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)} placeholder="Versión" />
        <select aria-label="Responsable" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="">Responsable</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select>
      </div>
      <div className="document-control-table-wrap master-list-table-wrap"><table className="document-control-table master-list-table"><thead><tr><th>Código</th><th>Documento</th><th>Tipo</th><th>Versión</th><th>Fecha</th><th>Estado</th><th>Responsable</th><th>Historial</th></tr></thead><tbody>
        {filteredDocuments.map((document) => { const version = getWorkingVersion(document); const type = documentTypeCatalog.find((item) => item.id === document.documentTypeId); const status = document.lifecycle?.isDeleted ? "Eliminado" : document.lifecycle?.status === "obsolete" ? "Obsoleto" : version?.status === "current" ? "Vigente" : "En revisión"; return <tr key={document.id}><td><span className="document-code-chip">{document.code}</span></td><td><strong>{document.name}</strong></td><td>{type?.name ?? document.documentTypeId}</td><td>Rev. {version?.revision ?? "—"}</td><td>{version ? formatDate(version.modifiedAt) : "—"}</td><td><span className={`document-status document-status-${document.lifecycle?.isDeleted ? "rejected" : version?.status ?? "draft"}`}>{status}</span></td><td>{document.owner}</td><td><button className="document-icon-action" type="button" onClick={() => setHistoryId(document.id)} title="Historial" aria-label={`Historial de ${document.name}`}><History size={15} /></button></td></tr>; })}
        {!filteredDocuments.length ? <tr className="document-empty-row"><td colSpan={8}><FileText size={22} /><strong>Sin documentos para estos filtros</strong><span>Ajusta el estado, proceso o búsqueda.</span></td></tr> : null}
      </tbody></table></div>
      {history ? <DocumentHistoryModal document={history} canRestore={getDocumentPermissions(session, history.processId).restore} onClose={() => setHistoryId(null)} onRestore={async () => { await restoreStoredDocument(history.id); onChangeDocument(restoreControlledDocument(history, session.name, new Date().toISOString())); setHistoryId(null); }} /> : null}
    </section>
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

      {view === "dashboard" ? <FormIntelligenceDashboard form={form} /> : null}
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
