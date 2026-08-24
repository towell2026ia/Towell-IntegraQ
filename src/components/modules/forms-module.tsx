"use client";

import {
  Bot,
  ChevronRight,
  Code2,
  Database,
  Download,
  FileInput,
  FileSpreadsheet,
  Image as ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { FormIntelligenceDashboard } from "@/components/modules/form-intelligence-dashboard";
import { processCatalog } from "@/lib/configuration-data";
import {
  createDraftAppForm,
  createImportedAppForm,
  generateDashboardDefinition,
  serializeFormRecordsToCsv,
  type AppFormDefinition,
  type AppFormField,
  type AppFormFieldType,
  type AppFormValue,
} from "@/lib/form-data";
import type { FormImportDraft } from "@/lib/form-import-data";

type FormsView = "dashboard" | "structure" | "history";

const fieldTypeLabels: Record<AppFormFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  select: "Lista",
  textarea: "Texto largo",
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function FormsModule({
  forms,
  onFormsChange,
}: {
  forms: AppFormDefinition[];
  onFormsChange: (forms: AppFormDefinition[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(forms[0]?.id ?? "");
  const [view, setView] = useState<FormsView>("dashboard");
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [agentInstruction, setAgentInstruction] = useState(
    forms[0]?.dashboard.objective ?? "",
  );
  const [categoryFieldId, setCategoryFieldId] = useState(
    forms[0]?.dashboard.categoryField ?? "",
  );
  const [metricFieldId, setMetricFieldId] = useState(
    forms[0]?.dashboard.metricField ?? "",
  );
  const [notice, setNotice] = useState("");

  const filteredForms = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-MX");
    return forms.filter((form) => {
      const process = processCatalog.find((item) => item.id === form.processId);
      return (
        !normalized ||
        [form.registrationNumber, form.name, process?.name ?? ""].some((value) =>
          value.toLocaleLowerCase("es-MX").includes(normalized),
        )
      );
    });
  }, [forms, query]);

  const selectedForm =
    forms.find((form) => form.id === selectedId) ?? filteredForms[0] ?? forms[0];
  const selectedProcess = processCatalog.find(
    (process) => process.id === selectedForm?.processId,
  );

  function updateSelected(
    updater: (form: AppFormDefinition) => AppFormDefinition,
  ) {
    if (!selectedForm) return;
    onFormsChange(
      forms.map((form) => (form.id === selectedForm.id ? updater(form) : form)),
    );
  }

  function generateDashboard() {
    if (!selectedForm) return;
    updateSelected((form) => ({
      ...form,
      dashboard: generateDashboardDefinition(
        form,
        agentInstruction,
        new Date().toISOString(),
        {
          categoryField: categoryFieldId,
          metricField: metricFieldId || undefined,
        },
      ),
    }));
    setNotice("Dashboard actualizado");
    setConfigurationOpen(false);
  }

  function saveStructure() {
    updateSelected((form) => ({
      ...form,
      version: form.version + 1,
      dashboard: {
        ...form.dashboard,
        generatedAt: new Date().toISOString(),
      },
    }));
    setNotice("Nueva versión guardada");
  }

  function addField() {
    updateSelected((form) => {
      const ids = new Set(form.fields.map((field) => field.id));
      let index = form.fields.length + 1;
      while (ids.has(`campo${index}`)) index += 1;
      return {
        ...form,
        fields: [
          ...form.fields,
          {
            id: `campo${index}`,
            label: "Nuevo campo",
            type: "text",
            required: false,
          },
        ],
      };
    });
  }

  function updateField(fieldId: string, changes: Partial<AppFormField>) {
    updateSelected((form) => ({
      ...form,
      fields: form.fields.map((field) =>
        field.id === fieldId ? { ...field, ...changes } : field,
      ),
    }));
  }

  function removeField(fieldId: string) {
    const remainingFields = selectedForm?.fields.filter(
      (field) => field.id !== fieldId,
    ) ?? [];
    if (categoryFieldId === fieldId) {
      setCategoryFieldId(
        remainingFields.find((field) => field.type === "select")?.id ?? "",
      );
    }
    if (metricFieldId === fieldId) {
      setMetricFieldId(
        remainingFields.find((field) => field.type === "number")?.id ?? "",
      );
    }
    updateSelected((form) => {
      const fields = form.fields.filter((field) => field.id !== fieldId);
      const dashboard = [
        form.dashboard.categoryField,
        form.dashboard.metricField,
        ...form.dashboard.insights.map((insight) => insight.fieldId),
      ].includes(fieldId)
        ? generateDashboardDefinition(
            { ...form, fields },
            form.dashboard.objective,
          )
        : form.dashboard;
      return { ...form, fields, dashboard };
    });
  }

  function selectForm(formId: string) {
    const target = forms.find((form) => form.id === formId);
    setSelectedId(formId);
    setView("dashboard");
    setConfigurationOpen(false);
    setAgentInstruction(target?.dashboard.objective ?? "");
    setCategoryFieldId(target?.dashboard.categoryField ?? "");
    setMetricFieldId(target?.dashboard.metricField ?? "");
    setNotice("");
  }

  function addCreatedForm(form: AppFormDefinition) {
    onFormsChange([...forms, form]);
    setSelectedId(form.id);
    setView("structure");
    setAgentInstruction(form.dashboard.objective);
    setCategoryFieldId(form.dashboard.categoryField);
    setMetricFieldId(form.dashboard.metricField ?? "");
    setNotice("");
  }

  return (
    <>
      <section className="module-heading forms-module-heading">
        <div>
          <p className="module-kicker">Configuración</p>
          <h2>Formularios y dashboards</h2>
          <p>Diseño central de formularios, resultados e historial.</p>
        </div>
        <div className="forms-heading-actions">
          <button className="button button-secondary" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Importar con IA
          </button>
          <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> Nuevo formulario
          </button>
        </div>
      </section>

      <section className="metric-grid" aria-label="Resumen de formularios">
        <FormMetric label="Formularios" value={forms.length} />
        <FormMetric label="Activos" value={forms.filter((form) => form.status === "Activo").length} />
        <FormMetric label="Procesos vinculados" value={new Set(forms.map((form) => form.processId)).size} />
        <FormMetric label="Dashboards configurados" value={forms.filter((form) => form.dashboard.insights.length > 0).length} />
      </section>

      <section className="forms-studio-layout">
        <aside className="forms-catalog-panel">
          <label className="panel-search forms-search">
            <Search size={16} />
            <input
              aria-label="Buscar formulario"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar formulario"
            />
          </label>
          <div className="configuration-count">{filteredForms.length} formularios</div>
          <div className="forms-catalog-list">
            {filteredForms.map((form) => {
              const process = processCatalog.find((item) => item.id === form.processId);
              return (
                <button
                  className={form.id === selectedForm?.id ? "selected" : ""}
                  key={form.id}
                  type="button"
                  onClick={() => selectForm(form.id)}
                >
                  <span className="forms-catalog-code">{form.registrationNumber}</span>
                  <span>
                    <strong>{form.name}</strong>
                    <small>{process?.id} · {process?.name}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              );
            })}
          </div>
        </aside>

        <div className="forms-studio-workspace">
          {selectedForm ? (
            <>
              <header className="forms-studio-header">
                <div>
                  <span className="detail-eyebrow"><FileInput size={14} /> {selectedForm.registrationNumber}</span>
                  <h3>{selectedForm.name}</h3>
                  <p>{selectedProcess?.id} · {selectedProcess?.name} · Versión {selectedForm.version}</p>
                </div>
                <span className={`quality-state ${selectedForm.status === "Activo" ? "success" : "warning"}`}>{selectedForm.status}</span>
              </header>

              <nav className="forms-studio-tabs" aria-label="Vistas de diseño del formulario">
                <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => setView("dashboard")}>
                  <LayoutDashboard size={15} /> Dashboard
                </button>
                <button className={view === "structure" ? "active" : ""} type="button" onClick={() => setView("structure")}>
                  <Code2 size={15} /> Estructura
                </button>
                <button className={view === "history" ? "active" : ""} type="button" onClick={() => setView("history")}>
                  <Database size={15} /> Historial
                </button>
              </nav>

              {notice ? <div className="forms-save-notice">{notice}</div> : null}

              {view === "dashboard" ? (
                <div className="forms-dashboard-designer">
                  <div className="forms-view-toolbar">
                    <div>
                      <small>Dashboard individual</small>
                      <strong>Resultados y hallazgos</strong>
                    </div>
                    <button className="button button-secondary" type="button" onClick={() => setConfigurationOpen((open) => !open)}>
                      <Settings2 size={16} /> Configurar
                    </button>
                  </div>

                  {configurationOpen ? (
                    <section className="form-agent-studio">
                      <header>
                        <span><Bot size={18} /></span>
                        <div><small>Agente vibecoding</small><strong>Configurar dashboard inteligente</strong></div>
                        <button className="icon-button" type="button" onClick={() => setConfigurationOpen(false)} title="Cerrar" aria-label="Cerrar configuración"><X size={16} /></button>
                      </header>
                      <div className="form-agent-fields">
                        <label className="form-agent-objective">
                          <span>Instrucción y objetivo</span>
                          <textarea value={agentInstruction} onChange={(event) => setAgentInstruction(event.target.value)} />
                        </label>
                        <label>
                          <span>Campo de resultado</span>
                          <select value={categoryFieldId} onChange={(event) => setCategoryFieldId(event.target.value)}>
                            {selectedForm.fields.filter((field) => field.type === "select").map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>Métrica numérica</span>
                          <select value={metricFieldId} onChange={(event) => setMetricFieldId(event.target.value)}>
                            <option value="">Sin métrica numérica</option>
                            {selectedForm.fields.filter((field) => field.type === "number").map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}
                          </select>
                        </label>
                      </div>
                      <footer>
                        <span>Versión actual: {selectedForm.dashboard.version}</span>
                        <button className="button button-primary" type="button" onClick={generateDashboard} disabled={!categoryFieldId}>
                          <Bot size={16} /> Generar dashboard
                        </button>
                      </footer>
                    </section>
                  ) : null}

                  <FormIntelligenceDashboard form={selectedForm} />
                </div>
              ) : null}

              {view === "structure" ? (
                <FormStructureEditor
                  form={selectedForm}
                  onAddField={addField}
                  onRemoveField={removeField}
                  onSave={saveStructure}
                  onUpdateField={updateField}
                  onUpdateForm={(changes) => updateSelected((form) => ({ ...form, ...changes }))}
                />
              ) : null}

              {view === "history" ? <FormHistory form={selectedForm} /> : null}
            </>
          ) : (
            <div className="forms-empty-state"><FileInput size={24} /><strong>Sin formularios</strong></div>
          )}
        </div>
      </section>

      {createOpen ? (
        <CreateFormDialog
          onClose={() => setCreateOpen(false)}
          onCreate={(form) => {
            addCreatedForm(form);
            setCreateOpen(false);
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportFormDialog
          onClose={() => setImportOpen(false)}
          onCreate={(form) => {
            addCreatedForm(form);
            setImportOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function FormStructureEditor({
  form,
  onAddField,
  onRemoveField,
  onSave,
  onUpdateField,
  onUpdateForm,
}: {
  form: AppFormDefinition;
  onAddField: () => void;
  onRemoveField: (fieldId: string) => void;
  onSave: () => void;
  onUpdateField: (fieldId: string, changes: Partial<AppFormField>) => void;
  onUpdateForm: (changes: Partial<AppFormDefinition>) => void;
}) {
  return (
    <div className="forms-structure-editor">
      <div className="forms-view-toolbar">
        <div><small>Definición</small><strong>Estructura del formulario</strong></div>
        <div className="forms-toolbar-actions">
          <button className="button button-secondary" type="button" onClick={onAddField}><Plus size={16} /> Campo</button>
          <button className="button button-primary" type="button" onClick={onSave}><Save size={16} /> Guardar versión</button>
        </div>
      </div>

      <div className="forms-metadata-grid">
        <label><span>Número de registro</span><input value={form.registrationNumber} onChange={(event) => onUpdateForm({ registrationNumber: event.target.value.toLocaleUpperCase("es-MX") })} /></label>
        <label className="forms-metadata-name"><span>Nombre</span><input value={form.name} onChange={(event) => onUpdateForm({ name: event.target.value })} /></label>
        <label><span>Proceso</span><select value={form.processId} onChange={(event) => onUpdateForm({ processId: event.target.value })}>{processCatalog.map((process) => <option value={process.id} key={process.id}>{process.id} · {process.name}</option>)}</select></label>
        <label><span>Estado</span><select value={form.status} onChange={(event) => onUpdateForm({ status: event.target.value as AppFormDefinition["status"] })}><option>Activo</option><option>Borrador</option></select></label>
      </div>

      <div className="forms-field-list">
        {form.fields.map((field, index) => (
          <article key={field.id}>
            <span className="forms-field-index">{index + 1}</span>
            <label><span>Etiqueta</span><input value={field.label} onChange={(event) => onUpdateField(field.id, { label: event.target.value })} /></label>
            <label><span>Tipo</span><select value={field.type} onChange={(event) => {
              const type = event.target.value as AppFormFieldType;
              onUpdateField(field.id, { type, options: type === "select" ? field.options ?? ["Opción 1", "Opción 2"] : undefined, unit: type === "number" ? field.unit : undefined });
            }}>{Object.entries(fieldTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {field.type === "select" ? <label className="forms-field-options"><span>Opciones</span><input value={field.options?.join(", ") ?? ""} onChange={(event) => onUpdateField(field.id, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} /></label> : null}
            {field.type === "number" ? <label className="forms-field-unit"><span>Unidad</span><input value={field.unit ?? ""} onChange={(event) => onUpdateField(field.id, { unit: event.target.value })} /></label> : null}
            <label className="forms-required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => onUpdateField(field.id, { required: event.target.checked })} /><span>Obligatorio</span></label>
            <code>{field.id}</code>
            <button className="icon-button" type="button" onClick={() => onRemoveField(field.id)} disabled={form.fields.length === 1} title="Eliminar campo" aria-label={`Eliminar ${field.label}`}><Trash2 size={15} /></button>
          </article>
        ))}
      </div>
    </div>
  );
}

function FormHistory({ form }: { form: AppFormDefinition }) {
  return (
    <div className="forms-history-view">
      <div className="forms-view-toolbar">
        <div><small>Historial de llenado</small><strong>{form.records.length} registros</strong></div>
        <button className="button button-secondary" type="button" onClick={() => exportRecords(form)}><Download size={16} /> Exportar CSV</button>
      </div>
      {form.records.length ? (
        <div className="form-data-table-wrap">
          <table className="form-data-table">
            <thead><tr><th>Registro</th><th>Captura</th><th>Estado</th>{form.fields.map((field) => <th key={field.id}>{field.label}</th>)}</tr></thead>
            <tbody>{form.records.map((record) => <tr key={record.id}><td><strong>{record.id}</strong></td><td>{dateFormatter.format(new Date(record.createdAt))}</td><td><span className="form-record-status">{record.status}</span></td>{form.fields.map((field) => <td key={field.id}>{formatValue(record.values[field.id], field)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <div className="forms-empty-state"><Database size={22} /><strong>Sin registros capturados</strong></div>}
    </div>
  );
}

function CreateFormDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (form: AppFormDefinition) => void;
}) {
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [name, setName] = useState("");
  const [processId, setProcessId] = useState(processCatalog[0]?.id ?? "");

  return (
    <div className="form-structure-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="form-create-dialog" onSubmit={(event) => {
        event.preventDefault();
        const createdAt = new Date().toISOString();
        onCreate(createDraftAppForm({ id: `FORM-${Date.now()}`, registrationNumber, name, processId, createdAt }));
      }}>
        <header className="form-structure-dialog-header">
          <span><FileInput size={18} /></span>
          <div><small>Alta</small><h4>Nuevo formulario</h4></div>
          <button className="icon-button" type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar"><X size={17} /></button>
        </header>
        <div className="form-create-fields">
          <label><span>Número de registro</span><input autoFocus value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} placeholder="F-XX-00" required /></label>
          <label><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label><span>Proceso</span><select value={processId} onChange={(event) => setProcessId(event.target.value)}>{processCatalog.map((process) => <option value={process.id} key={process.id}>{process.id} · {process.name}</option>)}</select></label>
        </div>
        <footer className="form-create-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit"><Plus size={16} /> Crear formulario</button></footer>
      </form>
    </div>
  );
}

function ImportFormDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (form: AppFormDefinition) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<FormImportDraft | null>(null);
  const [processId, setProcessId] = useState(processCatalog[0]?.id ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  async function analyzeFile() {
    if (!file) return;
    setAnalyzing(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/ai/form-import", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as {
        draft?: FormImportDraft;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "No fue posible interpretar el archivo.");
      }
      setDraft(payload.draft);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible interpretar el archivo.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function updateDraft(changes: Partial<FormImportDraft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function updateDraftField(fieldId: string, changes: Partial<AppFormField>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === fieldId ? { ...field, ...changes } : field,
            ),
          }
        : current,
    );
  }

  function removeDraftField(fieldId: string) {
    setDraft((current) =>
      current && current.fields.length > 1
        ? { ...current, fields: current.fields.filter((field) => field.id !== fieldId) }
        : current,
    );
  }

  function addDraftField() {
    setDraft((current) => {
      if (!current) return current;
      const index = current.fields.length + 1;
      return {
        ...current,
        fields: [
          ...current.fields,
          {
            id: `campoImportado${index}`,
            label: "Nuevo campo",
            type: "text",
            required: false,
          },
        ],
      };
    });
  }

  function createImportedForm() {
    if (!draft) return;
    const createdAt = new Date().toISOString();
    onCreate(
      createImportedAppForm({
        id: `FORM-${Date.now()}`,
        registrationNumber: draft.registrationNumber,
        name: draft.name,
        processId,
        fields: draft.fields,
        createdAt,
      }),
    );
  }

  return (
    <div className="form-structure-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="form-import-dialog" role="dialog" aria-modal="true" aria-labelledby="form-import-title">
        <header className="form-structure-dialog-header">
          <span><Bot size={18} /></span>
          <div><small>Agente importador</small><h4 id="form-import-title">Generar desde Excel o fotografía</h4></div>
          <button className="icon-button" type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar importación"><X size={17} /></button>
        </header>

        <div className="form-import-body">
          {!draft ? (
            <>
              <label className={`form-import-drop ${file ? "has-file" : ""}`}>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setDraft(null);
                    setError("");
                  }}
                />
                <span className="form-import-drop-icon">
                  {file?.type.startsWith("image/") ? <ImageIcon size={22} /> : <FileSpreadsheet size={22} />}
                </span>
                <div>
                  <strong>{file?.name ?? "Seleccionar archivo"}</strong>
                  <small>XLSX, XLSM, JPG, PNG o WEBP · Máximo 15 MB</small>
                </div>
                <span className="button button-secondary"><Upload size={15} /> Examinar</span>
              </label>
              {error ? <div className="form-import-error">{error}</div> : null}
            </>
          ) : (
            <>
              <div className="form-import-result-header">
                <span className="form-import-source-icon">{draft.sourceType === "excel" ? <FileSpreadsheet size={18} /> : <ImageIcon size={18} />}</span>
                <div><small>{draft.sourceName}{draft.sheetName ? ` · ${draft.sheetName}` : ""}</small><strong>{draft.fields.length} campos interpretados</strong></div>
                <span className="form-import-confidence">{Math.round(draft.confidence * 100)}% confianza</span>
              </div>

              <div className="form-import-metadata">
                <label><span>Número de registro</span><input value={draft.registrationNumber} onChange={(event) => updateDraft({ registrationNumber: event.target.value.toLocaleUpperCase("es-MX") })} /></label>
                <label className="form-import-name"><span>Nombre</span><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
                <label><span>Proceso</span><select value={processId} onChange={(event) => setProcessId(event.target.value)}>{processCatalog.map((process) => <option value={process.id} key={process.id}>{process.id} · {process.name}</option>)}</select></label>
              </div>

              <div className="form-import-fields-heading">
                <div><small>Estructura detectada</small><strong>Campos del formulario</strong></div>
                <button className="button button-secondary" type="button" onClick={addDraftField}><Plus size={15} /> Campo</button>
              </div>
              <div className="form-import-field-list">
                {draft.fields.map((field, index) => (
                  <article key={field.id}>
                    <span>{index + 1}</span>
                    <label><small>Etiqueta</small><input value={field.label} onChange={(event) => updateDraftField(field.id, { label: event.target.value })} /></label>
                    <label><small>Tipo</small><select value={field.type} onChange={(event) => {
                      const type = event.target.value as AppFormFieldType;
                      updateDraftField(field.id, { type, options: type === "select" ? field.options ?? ["Opción 1", "Opción 2"] : undefined });
                    }}>{Object.entries(fieldTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                    <label className="forms-required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => updateDraftField(field.id, { required: event.target.checked })} /><span>Obligatorio</span></label>
                    <button className="icon-button" type="button" onClick={() => removeDraftField(field.id)} disabled={draft.fields.length === 1} title="Eliminar campo" aria-label={`Eliminar ${field.label}`}><Trash2 size={15} /></button>
                  </article>
                ))}
              </div>
              {draft.warnings.length ? <div className="form-import-warnings">{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
            </>
          )}
        </div>

        <footer className="form-import-actions">
          {draft ? <button className="button button-secondary" type="button" onClick={() => setDraft(null)}>Cambiar archivo</button> : <button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button>}
          {draft ? (
            <button className="button button-primary" type="button" onClick={createImportedForm} disabled={!draft.name.trim() || !draft.registrationNumber.trim()}><Plus size={16} /> Crear borrador</button>
          ) : (
            <button className="button button-primary" type="button" onClick={analyzeFile} disabled={!file || analyzing}>
              {analyzing ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}
              {analyzing ? "Interpretando" : "Interpretar archivo"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function FormMetric({ label, value }: { label: string; value: number }) {
  return <div className="metric metric-neutral"><span className="metric-icon"><FileInput size={18} /></span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function exportRecords(form: AppFormDefinition) {
  const url = URL.createObjectURL(new Blob([serializeFormRecordsToCsv(form)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${form.registrationNumber}-datos.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatValue(value: AppFormValue | undefined, field: AppFormField) {
  if (value === undefined || value === "") return "—";
  if (field.type === "date" && typeof value === "string") return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
  if (typeof value === "number") return `${value.toLocaleString("es-MX", { maximumFractionDigits: 1 })}${field.unit ? ` ${field.unit}` : ""}`;
  return value;
}
