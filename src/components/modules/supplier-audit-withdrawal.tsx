"use client";
import { useState, type FormEvent } from "react";
import { auditCommand, loadAuditData } from "@/lib/supplier-audits/client";
import { auditStates, type AuditWorkspace, type SupplierAudit } from "@/lib/supplier-audits/model";
import { canWithdrawAudit, isAuditWithdrawn, withdrawalReason } from "@/lib/supplier-audits/withdrawal";
import styles from "./supplier-audit-calendar.module.css";

export function SupplierAuditWithdrawal({ event, data, disabled = false, onChanged }: {
  event: SupplierAudit; data: AuditWorkspace; disabled?: boolean; onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [mustRefresh, setMustRefresh] = useState(false), [saved, setSaved] = useState(false);
  const withdrawn = isAuditWithdrawn(event), allowed = canWithdrawAudit(data);
  const label = withdrawn ? "Restaurar programación" : "Retirar de programación";
  const supplier = data.suppliers.find(s => s.id === event.supplier_id);
  const result = data.results.find(r => r.audit_event_id === event.id);
  const files = data.files.filter(f => f.resource_id === event.id);
  if (!allowed) return null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy || disabled || mustRefresh || saved || !confirmed) return;
    let cleanReason;
    try { cleanReason = withdrawalReason(reason); } catch (cause) { setError((cause as Error).message); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await auditCommand({ command: withdrawn ? "restore" : "withdraw", id: event.id, revision: event.revision, reason: cleanReason });
      setSaved(true);
      setNotice("Operación guardada con historial. Actualiza la consulta si todavía ves la situación anterior.");
      await onChanged();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "No se recibió confirmación."} Consulta el estado antes de reintentar.`);
      setMustRefresh(true);
    } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError("");
    try {
      const current = await loadAuditData();
      const latest = current.events.find(e => e.id === event.id && e.organization_id === event.organization_id);
      if (!latest || !canWithdrawAudit(current)) throw new Error("El expediente o la autorización ya no están disponibles.");
      await onChanged();
      if (latest.revision === event.revision && isAuditWithdrawn(latest) === withdrawn && !saved) {
        setMustRefresh(false); setConfirmed(false);
        setNotice("Se comprobó que el expediente no cambió. Puedes confirmar un nuevo intento.");
      } else {
        setMustRefresh(true);
        setNotice("El expediente cambió. Consulta la situación y la bitácora actualizadas antes de otra operación.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar."); }
    finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="button button-secondary" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>;
  return <section className={styles.withdrawal} aria-label={label}>
    <h4>{label}</h4>
    <p><strong>{supplier ? `${supplier.code} · ${supplier.name}` : event.historical_supplier_name ?? "Proveedor pendiente de conciliación"}</strong></p>
    <p className={styles.note}>Expediente {event.id} · revisión {event.revision}. Estado original: {auditStates[event.state]}.</p>
    <p>{withdrawn ? "El mismo expediente volverá al programa con su estado original. No se crearán auditorías nuevas." : "Usa esta operación sólo para un registro capturado por error. Una actividad válida que no se realizará debe cancelarse desde Gestionar agenda."}</p>
    <p>{files.length} documentos conservados · {result ? `Calificación conservada: ${result.score}%` : "Sin calificación capturada"}{event.actual_date ? ` · Realizada: ${event.actual_date}` : ""}.</p>
    <p>{withdrawn ? "La restauración quedará registrada con tu usuario, fecha y motivo." : "Se excluirá del calendario y de las estadísticas operativas. Se conservarán fechas, documentos, resultados e historial para consulta."}</p>
    <form onSubmit={submit} data-withdrawal data-dirty={!saved && Boolean(reason)} aria-busy={busy}>
      <label className={styles.field}>Motivo obligatorio<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={2000} disabled={busy || saved} /></label>
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required disabled={busy || saved || mustRefresh} />Confirmo la identidad de esta auditoría y la operación indicada.</label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <footer className={styles.footer}>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (saved || !reason || window.confirm("¿Cerrar sin enviar este motivo?")) setOpen(false); }}>Cerrar</button>
        {mustRefresh || saved ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void refresh()}>Consultar estado actualizado</button> : null}
        <button type="submit" className="button button-primary" disabled={busy || disabled || !confirmed || mustRefresh || saved || reason.trim().length < 5}>{busy ? "Verificando…" : `Confirmar ${withdrawn ? "restauración" : "retiro"}`}</button>
      </footer>
    </form>
  </section>;
}
