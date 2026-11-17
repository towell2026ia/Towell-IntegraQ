"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { auditRequest } from "@/lib/supplier-audits/client";
import { auditActionStates, auditClassifications, emptyManualRecord, manualCommand, type AuditCorrectiveAction, type ManualAuditRecord, type ManualAuditSnapshot } from "@/lib/supplier-audits/manual";
import type { AuditWorkspace, SupplierAudit } from "@/lib/supplier-audits/model";
import { isAuditWithdrawn } from "@/lib/supplier-audits/withdrawal";
import styles from "./supplier-audit-calendar.module.css";
import manualStyles from "./supplier-audit-manual.module.css";

export function SupplierAuditManual({ event, data, onChanged }: { event: SupplierAudit; data: AuditWorkspace; onChanged: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<ManualAuditSnapshot | null>(null), [record, setRecord] = useState(emptyManualRecord);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(""), [reading, setReading] = useState(true);
  const files = data.files.filter(f => f.resource_id === event.id);
  const existing = data.results.find(r => r.audit_event_id === event.id);
  const writable = data.canManage && !isAuditWithdrawn(event) && event.state !== "cancelled" && snapshot !== null;
  const read = useCallback(async (signal?: AbortSignal) => {
    setReading(true);
    try { const next = await auditRequest<ManualAuditSnapshot>(`/${event.id}/manual`, { signal }); if (signal?.aborted) return; setSnapshot(next); setRecord(next.record); setDirty(false); setUncertain(false); setError(""); setRequestId(crypto.randomUUID()); }
    catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar la captura manual."); }
    finally { if (!signal?.aborted) setReading(false); }
  }, [event.id]);
  useEffect(() => { const abort = new AbortController(); void Promise.resolve().then(() => read(abort.signal)); return () => abort.abort(); }, [read]);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function patch(changes: Partial<ManualAuditRecord>) { setRecord(r => ({ ...r, ...changes })); setDirty(true); }
  function actionPatch(id: string, changes: Partial<AuditCorrectiveAction>) { patch({ actions: record.actions.map(a => a.id === id ? { ...a, ...changes } : a) }); }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!snapshot || busy || reading || uncertain) return;
    const form = new FormData(e.currentTarget); let command;
    try { command = { revision: snapshot.revision, requestId, record, reason: String(form.get("reason") ?? ""), confirmed: form.get("confirmed") === "on" }; manualCommand(command); }
    catch (e) { setError((e as Error).message); return; }
    setBusy(true); setError(""); setNotice("");
    try { await auditRequest(`/${event.id}/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) }); setDirty(false); setUncertain(true); await onChanged(); await read(); setNotice("Captura guardada con trazabilidad. No se enviaron correos."); }
    catch (e) { setError(e instanceof Error ? e.message : "No se confirmó el guardado."); setUncertain(true); }
    finally { setBusy(false); }
  }
  return <section className={`${styles.section} ${manualStyles.manual}`} aria-label="Gestión manual de auditoría">
    <h4>Clasificación, expediente y acciones de auditoría</h4>
    <p className={styles.note}>Calidad selecciona la clasificación. La fuente histórica se conserva: {event.criteria || "Sin clasificación documentada en el calendario"}. Metodología y calificación se transcriben sin recalcular.</p>
    {!event.supplier_id ? <p className={styles.pending}>Proveedor pendiente de conciliación. La captura permanece interna; el portal está bloqueado.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button type="button" className="button button-secondary" disabled={busy || reading} onClick={() => { if (!dirty || window.confirm("Actualizar descarta sólo esta captura sin guardar. ¿Continuar?")) { setReading(true); void onChanged().then(() => read()).catch(e => { setError(e.message); setReading(false); }); } }}>Consultar estado actualizado</button>
    {snapshot ? <form onSubmit={save} data-dirty={dirty} aria-busy={busy}>
      <fieldset disabled={!writable || busy || reading || uncertain} style={{ border: 0, padding: 0, minWidth: 0 }}><div className={styles.grid}>
        <label>Clasificación manual<select aria-label="Clasificación manual" value={record.classification ?? ""} onChange={e => patch({ classification: e.target.value as ManualAuditRecord["classification"] || null })}><option value="">Pendiente de selección por Calidad</option>{Object.entries(auditClassifications).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Metodología original<select value={record.methodology ?? ""} onChange={e => patch({ methodology: e.target.value as ManualAuditRecord["methodology"] || null })}><option value="">No confirmada</option><option value="V1">F-CO-05 V1</option><option value="V2">F-CO-05 V2</option><option value="other">Otra metodología documentada</option></select></label>
        <label>Fecha de auditoría<input type="date" value={record.auditDate ?? ""} readOnly={Boolean(event.source_sha256 && event.actual_date)} onChange={e => patch({ auditDate: e.target.value || null })} /></label>
        <label>Evaluador, si está documentado<input maxLength={300} value={record.evaluatorName} onChange={e => patch({ evaluatorName: e.target.value })} /></label>
        <label className={styles.wide}>Discrepancia con la fuente, cuando exista<textarea maxLength={2000} value={record.discrepancy} onChange={e => patch({ discrepancy: e.target.value })} /></label>
      </div>
      {existing ? <p>Evaluación existente conservada: {existing.score} %. Su método y resultado no se sobrescriben desde esta captura.</p> : <div className={styles.grid}>
        <label>Calificación manual verificada (%)<input type="number" min={0} max={100} step="any" value={record.score?.value ?? ""} onChange={e => patch({ score: e.target.value === "" ? null : { value: Number(e.target.value), sourceFileId: record.score?.sourceFileId ?? "", reference: record.score?.reference ?? "", verified: record.score?.verified ?? false } })} /></label>
        {record.score ? <><label>Informe que acredita la calificación<select value={record.score.sourceFileId} onChange={e => patch({ score: { ...record.score!, sourceFileId: e.target.value } })}><option value="">Seleccionar informe real</option>{files.filter(f => f.resource_type === "supplier_audit_report").map(f => <option value={f.id} key={f.id}>{f.original_name} · v{f.version}</option>)}</select></label><label>Referencia documental / página<input value={record.score.reference} onChange={e => patch({ score: { ...record.score!, reference: e.target.value } })} /></label><label className={styles.check}><input type="checkbox" checked={record.score.verified === true} onChange={e => patch({ score: { ...record.score!, verified: e.target.checked } })} />Confirmo la calificación contra el documento original</label></> : <p>Sin calificación documental confirmada. No se calcula ni se completa con cero.</p>}
      </div>}
      <h4>Acciones correctivas de esta auditoría</h4>
      {record.actions.map((a, i) => <fieldset key={a.id} className={styles.section}><legend>Acción {i + 1}</legend><div className={styles.grid}>
        <label className={styles.wide}>Descripción de la acción<textarea required maxLength={5000} value={a.description} onChange={e => actionPatch(a.id, { description: e.target.value })} /></label>
        <label>Responsable<input required maxLength={300} value={a.responsibleName} onChange={e => actionPatch(a.id, { responsibleName: e.target.value })} /></label>
        <label>Fecha compromiso<input required type="date" value={a.commitmentDate} onChange={e => actionPatch(a.id, { commitmentDate: e.target.value })} /></label>
        <label>Estado de la acción<select value={a.status} onChange={e => actionPatch(a.id, { status: e.target.value as AuditCorrectiveAction["status"] })}>{Object.entries(auditActionStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Fecha real de conclusión, cuando exista<input type="date" value={a.completedDate ?? ""} onChange={e => actionPatch(a.id, { completedDate: e.target.value || null })} /></label>
        <label className={styles.wide}>PDF con evidencia de cumplimiento<select multiple value={a.evidenceFileIds} onChange={e => actionPatch(a.id, { evidenceFileIds: Array.from(e.target.selectedOptions, o => o.value) })}>{files.map(f => <option key={f.id} value={f.id}>{f.original_name} · v{f.version}</option>)}</select></label>
      </div>{!snapshot.record.actions.some(saved => saved.id === a.id) ? <button type="button" className="button button-secondary" onClick={() => patch({ actions: record.actions.filter(item => item.id !== a.id) })}>Quitar acción sin guardar</button> : null}</fieldset>)}
      <button type="button" className="button button-secondary" disabled={record.actions.length >= 100} onClick={() => patch({ actions: [...record.actions, { id: crypto.randomUUID(), description: "", responsibleName: "", commitmentDate: "", status: "pending", completedDate: null, evidenceFileIds: [] }] })}>Agregar acción correctiva</button>
      <h4>Publicación para el proveedor vinculado</h4>
      <p className={styles.note}>Los PDF se adjuntan en la sección existente del expediente. Puedes seleccionar varios planes y versiones originales; no se duplican. Una nueva carga queda interna hasta autorizarla aquí.</p>
      {files.map(f => <label className={styles.check} key={f.id}><input type="checkbox" checked={record.approvedFileIds.includes(f.id)} onChange={e => patch({ approvedFileIds: e.target.checked ? [...record.approvedFileIds, f.id] : record.approvedFileIds.filter(id => id !== f.id) })} />Autorizar {f.original_name} · v{f.version}</label>)}
      <label className={styles.check}><input type="checkbox" disabled={!event.supplier_id} checked={record.portalVisible} onChange={e => patch({ portalVisible: e.target.checked })} />Publicar datos, acciones y PDF autorizados para el proveedor vinculado</label>
      {writable ? <><div className={styles.grid}><label className={styles.wide}>Motivo de captura o corrección<textarea name="reason" required minLength={5} maxLength={2000} onChange={() => setDirty(true)} /></label></div><label className={styles.check}><input name="confirmed" type="checkbox" required />Confirmo la auditoría, su proveedor y el alcance de esta actualización</label><button type="submit" className="button button-primary">{busy ? "Guardando…" : "Guardar captura manual"}</button></> : null}
      </fieldset>
    </form> : <p>La captura se habilita sólo cuando el servidor confirma el contrato manual autorizado.</p>}
    {uncertain ? <p role="status">Consulta el estado actualizado antes de otra operación. No se reenvía automáticamente la solicitud.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {snapshot?.history.length ? <details><summary>Historial de captura manual</summary><ol>{snapshot.history.map(h => <li key={h.id}><strong>{h.actorName}</strong> · {h.at} · {h.reason}<details><summary>Valores anteriores y nuevos</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ antes: h.before, despues: h.after }, null, 2)}</pre></details></li>)}</ol></details> : null}
  </section>;
}
