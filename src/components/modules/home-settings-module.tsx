"use client";

import {
  Check,
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
    </>
  );
}
