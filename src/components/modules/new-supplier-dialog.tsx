"use client";

import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { saveExternalCompany, type ExternalCompany } from "@/lib/external-company-data";

export function NewSupplierDialog({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (company: ExternalCompany, companies: ExternalCompany[]) => void;
}) {
  const titleId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const close = () => { if (!saving) onClose(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!code.trim() || !name.trim()) { setError("Código y nombre del proveedor son obligatorios."); return; }
    setError(""); setSaving(true);
    try {
      const result = await saveExternalCompany({ code: code.trim(), name: name.trim(), category: category.trim(), kind: "supplier", active: true });
      onSaved(result.company, result.companies);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible registrar el proveedor.");
      setSaving(false);
    }
  }

  return <div className="quality-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="quality-modal external-company-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving}>
      <header><h3 id={titleId}>Nuevo proveedor</h3><button className="icon-button" type="button" aria-label="Cerrar" disabled={saving} onClick={close}><X size={17} /></button></header>
      <form onSubmit={submit}>
        <p className="wide">Registra el código oficial y el nombre del proveedor.</p>
        <label><span>Código del proveedor</span><input required autoFocus autoComplete="off" value={code} disabled={saving} onChange={event => setCode(event.target.value)} /></label>
        <label className="wide"><span>Nombre del proveedor</span><input required value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        <label className="wide"><span>Categoría</span><input placeholder="Hilaza, químicos, avíos…" value={category} disabled={saving} onChange={event => setCategory(event.target.value)} /></label>
        {error ? <p className="form-error wide" role="alert">{error}</p> : null}
        <footer><button className="button button-secondary" type="button" disabled={saving} onClick={close}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar proveedor"}</button></footer>
      </form>
    </section>
  </div>;
}