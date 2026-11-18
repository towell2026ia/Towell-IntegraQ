"use client";
import { useEffect, useState } from "react";
import { A3ActionReport } from "@/components/modules/a3-action-report";
import { mapStoredAction, loadStoredCorrectiveActions } from "@/lib/corrective-action-storage";
import type { CorrectiveAction } from "@/lib/types";
type Retired = Record<string, unknown> & { id: string; folio: string; title: string; source: string; status: string; process_id: string | null; deleted_at: string; deleted_by: string | null; deletion_reason: string | null; quality_case_id: string | null; audit_finding_id: string | null };
export function RetiredCorrectiveActions({ onActionsChange }: { onActionsChange: (actions: CorrectiveAction[]) => void }) {
  const [report, setReport] = useState<Retired | null>(null);
  const [rows, setRows] = useState<Retired[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Retired | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true;
    void fetch("/api/root2cause/retired-actions", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No fue posible consultar los registros.");
      if (active) { setRows(body.actions); setEnabled(body.recoveryEnabled); setLoaded(true); }
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [retry]);
  async function restore() {
    if (!selected || busy || confirmation !== selected.folio || !reason.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/root2cause/retired-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, reason, expectedDeletedAt: selected.deleted_at, confirmed: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No fue posible recuperar el registro.");
      setSelected(null); setReason(""); setConfirmation(""); setRetry(value => value + 1);
      setMessage("Recuperación registrada. Actualizando listados…");
      onActionsChange(await loadStoredCorrectiveActions());
      setMessage("Registro recuperado con su mismo folio e historial. La publicación externa requiere una autorización independiente.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No fue posible actualizar la vista; recarga antes de reintentar."); }
    finally { setBusy(false); }
  }
  if (report) return <A3ActionReport action={mapStoredAction(report)} onBack={() => setReport(null)}><p>Expediente retirado. Consulta de sólo lectura; la recuperación requiere una confirmación independiente.</p></A3ActionReport>;
  return <section className="records-panel" aria-label="Registros retirados">
    <h3>Registros retirados</h3>
    <p>Acciones correctivas y análisis A3 de esta organización. Los casos de calidad y hallazgos conservan sus tipos y vínculos.</p>
    <button type="button" disabled={busy} onClick={() => { setMessage(""); setLoaded(false); setRetry(value => value + 1); }}>Actualizar</button>
    {!enabled ? <p>Recuperación pendiente de autorización y validación aislada.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {!loaded ? <p role="status">Consulta pendiente. Usa Actualizar si la consulta falló.</p> : rows.length === 0 ? <p>No hay acciones retiradas en esta organización.</p> : rows.map(row => <article key={row.id}>
      <h4>{row.folio} — {row.title}</h4>
      <p>Tipo: acción correctiva / A3. Origen: {row.source}. Estado conservado: {row.status}. Proceso: {row.process_id || "Sin proceso registrado"}.</p>
      <p>Retiro: <time dateTime={row.deleted_at}>{new Date(row.deleted_at).toLocaleString("es-MX")}</time>. Motivo: {row.deletion_reason || "No registrado"}. Responsable del retiro: {row.deleted_by || "No registrado"}.</p>
      <p>Caso de calidad: {row.quality_case_id || "Sin vínculo"}. Hallazgo: {row.audit_finding_id || "Sin vínculo"}.</p>
      <button type="button" disabled={busy} onClick={() => setReport(row)}>Consultar expediente</button>
      <button type="button" disabled={!enabled || busy} onClick={() => { setSelected(row); setReason(""); setConfirmation(""); }}>Revisar recuperación</button>
    </article>)}
    {selected ? <form onSubmit={event => { event.preventDefault(); void restore(); }}>
      <h4>Recuperar {selected.folio}</h4>
      <p>Verifica que este es el expediente solicitado. Se conservarán su identidad, estado, A3, planes y evidencias. No se reabre un cierre ni se publica al cliente.</p>
      <label>Motivo de recuperación<textarea required maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <label>Confirma el expediente escribiendo {selected.folio}<input required value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
      <button type="submit" disabled={busy || !enabled || !reason.trim() || confirmation !== selected.folio}>Confirmar recuperación</button>
      <button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button>
    </form> : null}
  </section>;
}
