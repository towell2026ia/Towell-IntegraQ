"use client";

import {
  Check,
  BookOpenCheck,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  Save,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  HomeSectionConfiguration,
  HomeSectionScope,
} from "@/lib/home-visibility";
import { loadInstitutionalInformation, saveInstitutionalItem, type InstitutionalDocumentOption, type InstitutionalItem } from "@/lib/institutional-information-data";

type ProcessOption = {
  id: string;
  name: string;
  level: "process" | "subprocess";
  parent_id?: string | null;
};

type UserOption = {
  id: string;
  external_id: string;
  full_name: string;
  user_type: "administrator" | "internal";
};

type HomeConfigurationPayload = {
  configurations?: HomeSectionConfiguration[];
  processes?: ProcessOption[];
  users?: UserOption[];
  persisted?: boolean;
  error?: string;
};

const scopeOptions: Array<{
  id: HomeSectionScope;
  label: string;
  detail: string;
}> = [
  { id: "all-processes", label: "Todos los procesos", detail: "Visible para cualquier usuario interno con al menos un proceso autorizado." },
  { id: "selected-processes", label: "Procesos seleccionados", detail: "Visible cuando al menos uno de los procesos autorizados coincide." },
  { id: "specific-users", label: "Usuarios específicos", detail: "Visible solamente para las cuentas seleccionadas." },
];

export function HomeSettingsModule() {
  const [configurations, setConfigurations] = useState<HomeSectionConfiguration[]>([]);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/home/config", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as HomeConfigurationPayload;
        if (!response.ok || !payload.configurations) {
          throw new Error(payload.error ?? "No fue posible cargar la configuración.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setConfigurations(payload.configurations ?? []);
        setProcesses(payload.processes ?? []);
        setUsers(payload.users ?? []);
        setSelectedId(payload.configurations?.[0]?.id ?? "");
        if (payload.persisted === false) {
          setError("La migración de Configuración de Inicio aún no está aplicada en Supabase.");
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "No fue posible cargar la configuración.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = configurations.find((item) => item.id === selectedId);

  function updateSelected(change: Partial<HomeSectionConfiguration>) {
    setConfigurations((current) => current.map((item) =>
      item.id === selectedId ? { ...item, ...change } : item,
    ));
    setNotice("");
  }

  function toggleProcess(processId: string) {
    if (!selected) return;
    updateSelected({
      processIds: selected.processIds.includes(processId)
        ? selected.processIds.filter((id) => id !== processId)
        : [...selected.processIds, processId],
    });
  }

  function toggleUser(userId: string) {
    if (!selected) return;
    updateSelected({
      userIds: selected.userIds.includes(userId)
        ? selected.userIds.filter((id) => id !== userId)
        : [...selected.userIds, userId],
    });
  }

  async function saveSelected() {
    if (!selected) return;
    if (selected.scope === "selected-processes" && !selected.processIds.length) {
      setError("Selecciona por lo menos un proceso para este bloque.");
      return;
    }
    if (selected.scope === "specific-users" && !selected.userIds.length) {
      setError("Selecciona por lo menos un usuario para este bloque.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/home/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar el bloque.");
      setNotice(`La visibilidad de “${selected.label}” quedó actualizada.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar el bloque.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Administración</p>
          <h2>Configuración de Inicio</h2>
          <p>Define qué bloques aparecen y para qué procesos o usuarios se encuentran habilitados.</p>
        </div>
        <button className="button button-primary" type="button" disabled={!selected || saving} onClick={() => void saveSelected()}>
          {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Guardar bloque
        </button>
      </section>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="form-success" role="status"><Check size={16} /> {notice}</div> : null}

      {loading ? (
        <section className="home-settings-loading"><LoaderCircle className="spin" size={24} /> Cargando configuración...</section>
      ) : (
        <section className="home-settings-workspace">
          <aside className="home-settings-list" aria-label="Bloques de Inicio">
            <header><LayoutDashboard size={17} /><span><strong>Bloques de Inicio</strong><small>{configurations.length} configurados</small></span></header>
            {configurations.map((configuration) => (
              <button className={configuration.id === selectedId ? "selected" : ""} key={configuration.id} type="button" onClick={() => { setSelectedId(configuration.id); setNotice(""); setError(""); }}>
                <span>{configuration.active ? <Eye size={15} /> : <EyeOff size={15} />}</span>
                <span><strong>{configuration.label}</strong><small>{scopeOptions.find((scope) => scope.id === configuration.scope)?.label}</small></span>
              </button>
            ))}
          </aside>

          {selected ? (
            <div className="home-settings-editor">
              <header>
                <span><Settings2 size={20} /></span>
                <div><small>Bloque seleccionado</small><h3>{selected.label}</h3><p>{selected.description}</p></div>
                <label className="home-settings-switch"><input type="checkbox" checked={selected.active} onChange={(event) => updateSelected({ active: event.target.checked })} /><span>{selected.active ? "Activo" : "Oculto"}</span></label>
              </header>

              <section>
                <h4>Visible para</h4>
                <label className="home-settings-admin-check"><input type="checkbox" checked={selected.visibleToAdministrators} onChange={(event) => updateSelected({ visibleToAdministrators: event.target.checked })} /> Administradores</label>
                <div className="home-settings-scope-grid">
                  {scopeOptions.map((scope) => (
                    <label className={selected.scope === scope.id ? "selected" : ""} key={scope.id}>
                      <input type="radio" name="home-section-scope" checked={selected.scope === scope.id} onChange={() => updateSelected({ scope: scope.id })} />
                      <span><strong>{scope.label}</strong><small>{scope.detail}</small></span>
                    </label>
                  ))}
                </div>
              </section>

              {selected.scope === "selected-processes" ? (
                <section>
                  <h4>Catálogo maestro de procesos <span>{selected.processIds.length} seleccionados</span></h4>
                  <div className="home-settings-option-grid">
                    {processes.map((process) => (
                      <label key={process.id}><input type="checkbox" checked={selected.processIds.includes(process.id)} onChange={() => toggleProcess(process.id)} /><span><strong>{process.name}</strong><small>{process.id} · {process.level === "process" ? "Proceso" : "Subproceso"}</small></span></label>
                    ))}
                  </div>
                </section>
              ) : null}

              {selected.scope === "specific-users" ? (
                <section>
                  <h4><Users size={15} /> Usuarios autorizados <span>{selected.userIds.length} seleccionados</span></h4>
                  <div className="home-settings-option-grid">
                    {users.map((user) => (
                      <label key={user.id}><input type="checkbox" checked={selected.userIds.includes(user.id)} onChange={() => toggleUser(user.id)} /><span><strong>{user.full_name}</strong><small>{user.external_id} · {user.user_type === "administrator" ? "Administrador" : "Usuario interno"}</small></span></label>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
      <InstitutionalSettings />
    </>
  );
}

function InstitutionalSettings() {
  const [items, setItems] = useState<InstitutionalItem[]>([]);
  const [documents, setDocuments] = useState<InstitutionalDocumentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadInstitutionalInformation().then((result) => { if (!cancelled) { setItems(result.items); setDocuments(result.documents ?? []); } }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No fue posible consultar la información institucional."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function update(position: InstitutionalItem["position"], change: Partial<InstitutionalItem>) {
    setItems((current) => current.map((item) => item.position === position ? { ...item, ...change } : item)); setError(""); setNotice("");
  }

  async function save(item: InstitutionalItem) {
    setSaving(item.position); setError(""); setNotice("");
    try { const result = await saveInstitutionalItem(item); setItems((current) => current.map((value) => value.position === result.item.position ? result.item : value)); setNotice(`${item.title} quedó actualizado.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar la referencia institucional."); }
    finally { setSaving(""); }
  }

  return <section className="institutional-settings-panel">
    <header><span><BookOpenCheck size={20} /></span><div><p className="module-kicker">Documentos controlados</p><h3>Información institucional</h3><p>Configura referencias a la versión vigente; no se copian archivos en Inicio.</p></div></header>
    {error ? <div className="form-error" role="alert">{error}</div> : null}{notice ? <div className="form-success" role="status"><Check size={15} /> {notice}</div> : null}
    {loading ? <div className="home-settings-loading"><LoaderCircle className="spin" size={22} /> Cargando referencias…</div> : <div className="institutional-settings-grid">{items.map((item) => <article key={item.position}><header><div><strong>{item.title}</strong><small>{item.position}</small></div><label className="home-settings-switch"><input checked={item.active} type="checkbox" onChange={(event) => update(item.position, { active: event.target.checked })} /><span>{item.active ? "Activo" : "Oculto"}</span></label></header>{item.position === "CONFIDENTIALITY" ? <label>Contenido<select value={item.contentKind} onChange={(event) => update(item.position, { contentKind: event.target.value as "document" | "text", documentId: undefined, shortText: undefined })}><option value="text">Texto configurable</option><option value="document">Documento controlado</option></select></label> : null}{item.contentKind === "document" ? <label>Documento controlado<select value={item.documentId ?? ""} onChange={(event) => update(item.position, { documentId: event.target.value || undefined })}><option value="">Seleccionar documento</option>{documents.map((document) => <option disabled={document.currentRevision === undefined} key={document.id} value={document.id}>{document.code} · {document.title}{document.currentRevision === undefined ? " · sin versión vigente" : ` · Rev. ${document.currentRevision}`}</option>)}</select></label> : <label>Leyenda corta<textarea rows={4} value={item.shortText ?? ""} onChange={(event) => update(item.position, { shortText: event.target.value })} /></label>}<div className="institutional-visibility"><label><input checked={item.visibleToInternal} type="checkbox" onChange={(event) => update(item.position, { visibleToInternal: event.target.checked })} /> Usuarios internos</label><label><input checked={item.visibleToExternal} type="checkbox" onChange={(event) => update(item.position, { visibleToExternal: event.target.checked })} /> Usuarios externos</label></div><footer><span>{item.document ? `${item.document.code} · revisión ${item.document.revision}` : item.contentKind === "text" && item.shortText ? "Texto administrado" : "Sin contenido vigente"}</span><button className="button button-secondary" disabled={saving === item.position} onClick={() => void save(item)} type="button">{saving === item.position ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} Guardar</button></footer></article>)}</div>}
  </section>;
}
