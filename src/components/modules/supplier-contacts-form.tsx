"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { auditCommand } from "@/lib/supplier-audits/client";
import { validateSupplierContacts, visibleSupplierContacts } from "@/lib/supplier-audits/contacts";
import type { AuditSupplier, SupplierContactEntry, SupplierContacts } from "@/lib/supplier-audits/model";
import styles from "./supplier-audit-calendar.module.css";

type Visibility = { scope: "company" } | { scope: "sites"; sites: string[] };
type PublicationSettings = { available?: true; sites: { id: string; name: string }[]; visibility: Record<string, Visibility> };

export function SupplierContactsForm({ supplier, contacts, canPublish, onClose, onChanged }: {
  supplier: AuditSupplier; contacts: SupplierContacts; canPublish: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [entries, setEntries] = useState(() => visibleSupplierContacts(contacts));
  const [revision] = useState(supplier.updated_at);
  const [settings, setSettings] = useState<PublicationSettings | null>(null);
  const [contractPending, setContractPending] = useState(false);
  const [changes, setChanges] = useState<Record<string, Visibility | null>>({});
  const [loadFailed, setLoadFailed] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => {
    if (!canPublish) return;
    const controller = new AbortController();
    fetch("/api/suppliers/portal-access?contactSettings=" + encodeURIComponent(supplier.id), {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error();
      const value: PublicationSettings | { available: false } = await response.json();
      if (controller.signal.aborted) return;
      if (value.available === false) setContractPending(true);
      else setSettings(value);
      setLoadFailed(false);
    }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [supplier.id, canPublish, attempt]);
  const visibility = (id: string) => Object.hasOwn(changes, id) ? changes[id] : settings?.visibility[id];
  function changeVisibility(id: string, value: Visibility | null) {
    setChanges(current => ({ ...current, [id]: value }));
    setDirty(true);
  }
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const close = () => { if (!busy && (!dirty || window.confirm("¿Cerrar sin guardar los contactos?"))) onClose(); };
  function update(id: string, patch: Partial<SupplierContactEntry>) {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    if (canPublish && visibility(id) && Object.keys(patch).some(key => key !== "notifyRncp")) changeVisibility(id, null);
    setDirty(true);
  }
  const add = () => { setEntries(current => [...current, { id: crypto.randomUUID(), name: "", position: "", email: "", phone: "", purpose: "", notifyRncp: false }]); setDirty(true); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    let validated: SupplierContactEntry[];
    try { validated = validateSupplierContacts(entries); } catch (cause) { setError((cause as Error).message); return; }
    if (reason.trim().length < 5) { setError("Indica un motivo de al menos cinco caracteres."); return; }
    if (Object.values(changes).some(v => v?.scope === "sites" && !v.sites.length)) {
      setError("Selecciona al menos una sucursal para cada contacto con alcance por sucursal."); return;
    }
    setBusy(true);
    try {
      await auditCommand({ command: "contacts", id: supplier.id, updatedAt: revision, reason: reason.trim(), payload: {
        contacts: validated, ...(canPublish && Object.keys(changes).length ? { visibilityChanges: changes } : {}),
      } });
      await onChanged(); setDirty(false); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se guardaron los contactos."); }
    finally { setBusy(false); }
  }
  return <div className={styles.backdrop} role="presentation"><section role="dialog" aria-modal="true" aria-label={`Contactos · ${supplier.code}`} className={styles.dialog}>
    <header><h3>Contactos · {supplier.code}</h3><button className="icon-button" type="button" aria-label="Cerrar" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div className={styles.body}><form onSubmit={submit} data-dirty={dirty}>
      <p>{supplier.name} · Los datos históricos se conservan. Seleccionar un destinatario no verifica su correo ni envía notificaciones.</p>
      {contacts.notes ? <p>Observaciones históricas: {contacts.notes}</p> : null}
      {contractPending && <p>La publicación de contactos aún no está disponible.</p>}
      {canPublish && !settings && !contractPending && (loadFailed
        ? <p role="alert">No se pudo consultar la visibilidad de los contactos. <button type="button" className="button button-secondary" onClick={() => { setLoadFailed(false); retry(n => n + 1); }}>Reintentar</button></p>
        : <progress aria-label="Cargando visibilidad de contactos" />)}
      {entries.map((entry, index) => {
        const access = visibility(entry.id);
        return <fieldset key={entry.id} disabled={busy || (canPublish && !settings && !contractPending)} className={styles.grid}><legend>Contacto {index + 1}</legend>
        {([['name','Nombre'],['position','Puesto'],['email','Correo'],['phone','Teléfono'],['purpose','Propósito']] as const).map(([key,label]) => <label key={key}>{label}<input type={key === 'email' ? 'email' : 'text'} value={entry[key]} maxLength={500} required={key === 'name' || key === 'email'} disabled={busy} onChange={e => update(entry.id, { [key]: e.target.value })} /></label>)}
        <label className={styles.check}><input type="checkbox" checked={entry.notifyRncp} disabled={busy || entry.retired} onChange={e => update(entry.id, { notifyRncp: e.target.checked })} />Seleccionar para futuras notificaciones RNCP</label>
        {canPublish && settings && <fieldset disabled={busy || entry.retired} className={styles.field}>
          <legend>Visibilidad en el portal</legend>
          <label className={styles.check}><input type="checkbox" checked={Boolean(access)} onChange={e => changeVisibility(entry.id, e.target.checked ? { scope: "sites", sites: [] } : null)} />Mostrar este contacto en el Portal de Proveedores</label>
          {access && <>
            <label>Alcance<select aria-label="Alcance de publicación" value={access.scope} onChange={e => changeVisibility(entry.id, e.target.value === "company" ? { scope: "company" } : { scope: "sites", sites: [] })}>
              <option value="sites">Sucursales concretas</option><option value="company">Toda la empresa</option>
            </select></label>
            {access.scope === "sites" && <fieldset><legend>Sucursales autorizadas</legend>
              {settings.sites.map(site => <label className={styles.check} key={site.id}>
                <input type="checkbox" checked={access.sites.includes(site.id)} onChange={e => {
                  const selected = settings.sites.filter(s => s.id === site.id ? e.target.checked : access.sites.includes(s.id));
                  changeVisibility(entry.id, { scope: "sites", sites: selected.map(s => s.id) });
                }} />{site.name}
              </label>)}
              {!settings.sites.length && <p>Sin sucursales activas para este proveedor.</p>}
            </fieldset>}
          </>}
        </fieldset>}
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => update(entry.id, { retired: !entry.retired, notifyRncp: false })}>{entry.retired ? "Reactivar contacto" : "Retirar de la selección activa"}</button>
      </fieldset>; })}
      <button className="button button-secondary" type="button" disabled={busy || (canPublish && !settings && !contractPending)} onClick={add}>Agregar contacto</button>
      <label className={styles.field}>Motivo de actualización<input value={reason} required minLength={5} maxLength={2000} disabled={busy} onChange={e => { setReason(e.target.value); setDirty(true); }} /></label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.footer}><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || (canPublish && !settings && !contractPending)}>{busy ? "Guardando…" : "Guardar contactos"}</button></footer>
    </form></div>
  </section></div>;
}
