"use client";
import { useCallback, useEffect, useState } from "react";
import { auditActionStates, auditClassifications, type PortalAudit } from "@/lib/supplier-audits/manual";
import type { SupplierAuditFile } from "@/lib/supplier-audits/model";
import { SupplierAuditDocument } from "./supplier-audit-document";
import { SupplierActionEvidence } from "./supplier-action-evidence";
import styles from "./supplier-audit-calendar.module.css";
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/suppliers/audit-portal${path}`, { cache: "no-store", signal });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudieron consultar las auditorías autorizadas."); return body;
}
function PortalDocument({ eventId, file }: { eventId: string; file: SupplierAuditFile }) {
  const resolveUrl = useCallback(async () => (await request<{ signedUrl: string }>(`/${eventId}/files/${file.id}`)).signedUrl, [eventId, file.id]);
  return <SupplierAuditDocument eventId={eventId} file={file} resolveUrl={resolveUrl} />;
}
export function SupplierAuditPortal({ identity,year,onDates,evidenceOnly=false,onEvidenceChange }: { identity: string;evidenceOnly?:boolean;onEvidenceChange?:()=>void;year?:string;onDates?:(dates:string[])=>void }) {
  const [audits, setAudits] = useState<PortalAudit[]>([]), [loadedFor, setLoadedFor] = useState("");
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [preview, setPreview] = useState<{ eventId: string; file: SupplierAuditFile } | null>(null);
  useEffect(() => { const controller = new AbortController(); void request<{ audits: PortalAudit[] }>("", controller.signal).then(result => { if (!controller.signal.aborted) { setAudits(result.audits);onDates?.(result.audits.flatMap(a=>a.auditDate?[a.auditDate]:[])); setLoadedFor(identity); setError(""); setPreview(null); } }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoadedFor(""); setPreview(null); } }); return () => controller.abort(); }, [identity, attempt,onDates]);
  const [chosen,setChosen]=useState("");
  const visible=audits.filter(a=>!year || year==="all" || a.auditDate?.slice(0,4)===year);
  async function download(eventId: string, file: SupplierAuditFile) {
    try { const { signedUrl } = await request<{ signedUrl: string }>(`/${eventId}/files/${file.id}?download=true`); const a = document.createElement("a"); a.href = signedUrl; a.download = file.original_name; a.rel = "noopener"; a.click(); }
    catch (e) { setError((e as Error).message); }
  }
  return <section className={styles.section} aria-label="Expedientes y acciones de mis auditorías"><h3>Expedientes y planes de acción</h3><p>Información autorizada por Calidad para tu proveedor. Las acciones no se cierran automáticamente.</p>
    <button type="button" className="button button-secondary" onClick={() => { setLoadedFor(""); setPreview(null); setAttempt(a => a + 1); }}>Actualizar auditorías</button>
    {error ? <p role="alert">{error}</p> : loadedFor !== identity ? <p role="status">Consultando expedientes autorizados…</p> : !visible.length ? <p>No hay auditorías publicadas para este proveedor.</p> : null}
    {evidenceOnly&&<label>Expediente de auditoría <select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Seleccionar evento</option>{visible.map(a=><option key={a.eventId} value={a.eventId}>{a.auditDate} · {a.methodology} · {a.classification}</option>)}</select></label>}
    {loadedFor === identity ? visible.filter(a=>!evidenceOnly||a.eventId===chosen).map(a => <article key={a.eventId} className={styles.section}>
      <h4>Auditoría · {a.auditDate ?? "Fecha pendiente"}</h4><p>{auditClassifications[a.classification]} · {a.methodology ?? "Metodología no confirmada"} · Calificación: {a.score === null ? "No confirmada" : `${a.score} %`}</p>
      {a.files.map(f => <div key={f.id} className={styles.fileRow}><span>{f.resource_type === "supplier_audit_report" ? "Informe" : "Plan de acción"}: {f.original_name} · v{f.version}</span><div className={styles.actions}><button className="button button-secondary" type="button" onClick={() => setPreview({ eventId: a.eventId, file: f })}>Ver PDF</button><button className="button button-secondary" type="button" onClick={() => void download(a.eventId, f)}>Descargar PDF</button></div></div>)}
      {!a.files.length ? <p>PDF pendiente de carga o autorización.</p> : null}
      {a.actions.map(action => <div key={action.id} className={styles.section}><strong>{action.description}</strong><p>Responsable: {action.responsibleName} · Compromiso: {action.commitmentDate} · {auditActionStates[action.status]}</p><p>Conclusión real: {action.completedDate ?? "No registrada"}</p>{action.evidenceFileIds.map(id => { const f = a.files.find(file => file.id === id); return f ? <button key={id} type="button" className="button button-secondary" onClick={() => setPreview({ eventId: a.eventId, file: f })}>Evidencia: {f.original_name}</button> : null; })}</div>)}
      <SupplierActionEvidence event={a.eventId} actions={a.actions.filter(x=>x.status!=="closed")} onChange={onEvidenceChange}/>
      {!a.actions.length ? <p>Sin acciones capturadas.</p> : null}
    </article>) : null}
    {preview && loadedFor === identity ? <section aria-label="PDF autorizado de auditoría"><button type="button" className="button button-secondary" onClick={() => setPreview(null)}>Cerrar PDF</button><PortalDocument eventId={preview.eventId} file={preview.file} /></section> : null}
  </section>;
}
