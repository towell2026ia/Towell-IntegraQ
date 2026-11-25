"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { auditCommand } from "@/lib/supplier-audits/client";
import { validateSupplierContacts, visibleSupplierContacts } from "@/lib/supplier-audits/contacts";
import type { AuditSupplier, SupplierContactEntry, SupplierContacts } from "@/lib/supplier-audits/model";
import styles from "./supplier-audit-calendar.module.css";

export function SupplierContactsForm({ supplier, contacts, onClose, onChanged }: {
  supplier: AuditSupplier; contacts: SupplierContacts; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [entries, setEntries] = useState(() => visibleSupplierContacts(contacts));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const close = () => { if (!busy && (!dirty || window.confirm("¿Cerrar sin guardar los contactos?"))) onClose(); };
  const update = (id: string, patch: Partial<SupplierContactEntry>) => { setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry)); setDirty(true); };
  const add = () => { setEntries(current => [...current, { id: crypto.randomUUID(), name: "", position: "", email: "", phone: "", purpose: "", notifyRncp: false }]); setDirty(true); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    let validated: SupplierContactEntry[];
    try { validated = validateSupplierContacts(entries); } catch (cause) { setError((cause as Error).message); return; }
    if (reason.trim().length < 5) { setError("Indica un motivo de al menos cinco caracteres."); return; }
    setBusy(true);
    try {
      await auditCommand({ command: "contacts", id: supplier.id, updatedAt: supplier.updated_at, reason: reason.trim(), payload: { contacts: validated } });
      await onChanged(); setDirty(false); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se guardaron los contactos."); }
    finally { setBusy(false); }
  }
  return <div className={styles.backdrop} role="presentation"><section role="dialog" aria-modal="true" aria-label={`Contactos · ${supplier.code}`} className={styles.dialog}>
    <header><h3>Contactos · {supplier.code}</h3><button className="icon-button" type="button" aria-label="Cerrar" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div className={styles.body}><form onSubmit={submit} data-dirty={dirty}>
      <p>{supplier.name} · Los datos históricos se conservan. Seleccionar un destinatario no verifica su correo ni envía notificaciones.</p>
      {contacts.notes ? <p>Observaciones históricas: {contacts.notes}</p> : null}
      {entries.map((entry, index) => <fieldset key={entry.id} className={styles.grid}><legend>Contacto {index + 1}</legend>
        {([['name','Nombre'],['position','Puesto'],['email','Correo'],['phone','Teléfono'],['purpose','Propósito']] as const).map(([key,label]) => <label key={key}>{label}<input type={key === 'email' ? 'email' : 'text'} value={entry[key]} maxLength={500} required={key === 'name' || key === 'email'} disabled={busy} onChange={e => update(entry.id, { [key]: e.target.value })} /></label>)}
        <label className={styles.check}><input type="checkbox" checked={entry.notifyRncp} disabled={busy || entry.retired} onChange={e => update(entry.id, { notifyRncp: e.target.checked })} />Seleccionar para futuras notificaciones RNCP</label>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => update(entry.id, { retired: !entry.retired, notifyRncp: false })}>{entry.retired ? "Reactivar contacto" : "Retirar de la selección activa"}</button>
      </fieldset>)}
      <button className="button button-secondary" type="button" disabled={busy} onClick={add}>Agregar contacto</button>
      <label className={styles.field}>Motivo de actualización<input value={reason} required minLength={5} maxLength={2000} disabled={busy} onChange={e => { setReason(e.target.value); setDirty(true); }} /></label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.footer}><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar contactos"}</button></footer>
    </form></div>
  </section></div>;
}
