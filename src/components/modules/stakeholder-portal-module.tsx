"use client";

import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  ImagePlus,
  LockKeyhole,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { FormEvent, useState } from "react";

import { A3ActionReport } from "@/components/modules/a3-action-report";
import { useRncpReports } from "@/hooks/use-rncp-reports";
import { useSupplierAssessments } from "@/hooks/use-supplier-assessments";
import {
  getCustomerPortalData,
  resolvePortalCompany,
  type PortalCompany,
} from "@/lib/portal-access";
import type { ActiveSession } from "@/lib/session-data";
import { getRncpEvidenceUrl, saveRncpResponseAction, uploadRncpEvidence, type RncpReport } from "@/lib/rncp-data";
import { getSupplierAssessmentFileUrl, supplierAssessmentTypeLabel } from "@/lib/supplier-assessment-data";
import type { CorrectiveAction } from "@/lib/types";

type PortalKind = "customer" | "supplier";

export function StakeholderPortalModule({
  kind,
  actions,
  session,
}: {
  kind: PortalKind;
  actions: CorrectiveAction[];
  session: ActiveSession;
}) {
  const company = resolvePortalCompany(session, kind);
  if (!company) return <PortalAccessDenied />;
  return kind === "customer" ? (
    <CustomerPortal actions={actions} company={company} />
  ) : (
    <SupplierPortal company={company} />
  );
}

function CustomerPortal({
  actions,
  company,
}: {
  actions: CorrectiveAction[];
  company: PortalCompany;
}) {
  const [view, setView] = useState<"actions" | "audits" | "certifications">("actions");
  const [selectedActionId, setSelectedActionId] = useState("");
  const portalData = getCustomerPortalData(company.companyId, actions);
  const selectedAction = portalData.actions.find((action) => action.id === selectedActionId);
  return (
    <>
      <PortalHeading title="Portal del cliente" account={company.companyName} description="Reclamos, acciones, auditorías externas y certificaciones autorizadas." />
      <div className="quality-view-tabs portal-tabs" aria-label="Vistas del portal del cliente">
        <button className={view === "actions" ? "active" : ""} type="button" onClick={() => setView("actions")}>Mis reclamos y acciones</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Auditorías externas</button>
        <button className={view === "certifications" ? "active" : ""} type="button" onClick={() => setView("certifications")}>Certificaciones</button>
      </div>
      {view === "actions" ? (
        selectedAction ? (
          <A3ActionReport action={selectedAction} onBack={() => setSelectedActionId("")} />
        ) : <section className="portal-record-list">
          <header><div><h3>Mis reclamos, hallazgos y planes</h3><p>Vista de consulta compartida desde Root2Cause; no permite editar el análisis A3.</p></div><ClipboardCheck size={19} /></header>
          {portalData.actions.map((action) => (
            <article key={action.id}>
              <div><code>{action.folio}</code><h4>{action.title}</h4><p>{action.problem}</p><button className="button button-secondary portal-report-link" type="button" onClick={() => setSelectedActionId(action.id)}><FileText size={15} /> Ver reporte A3</button></div>
              <dl><div><dt>Avance</dt><dd>{action.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(action.dueDate)}</dd></div><div><dt>Planes</dt><dd>{action.a3?.plans.length ?? 0}</dd></div></dl>
              <span className="quality-state warning">{action.status}</span>
            </article>
          ))}
          {portalData.actions.length === 0 ? <PortalEmpty message="No hay reclamos ni acciones compartidas con esta empresa." /> : null}
        </section>
      ) : null}
      {view === "audits" ? <PortalTable title="Calendario de auditorías externas"><table className="quality-table"><thead><tr><th>Evento</th><th>Fecha</th><th>Alcance</th><th>Estado</th></tr></thead><tbody>{portalData.audits.map((audit) => <tr key={audit.id}><td><strong>{audit.id}</strong></td><td>{formatDate(audit.date)}</td><td>{audit.scope}</td><td><span className="quality-state success">{audit.status}</span></td></tr>)}</tbody></table>{portalData.audits.length === 0 ? <PortalEmpty message="No hay auditorías compartidas con esta empresa." /> : null}</PortalTable> : null}
      {view === "certifications" ? <PortalTable title="Certificaciones y certificados vigentes"><table className="quality-table"><thead><tr><th>Certificación</th><th>Documento</th><th>Vigente hasta</th><th>Estado</th></tr></thead><tbody>{portalData.certifications.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.certificate}</td><td>{formatDate(item.validUntil)}</td><td><span className="quality-state success">Vigente</span></td></tr>)}</tbody></table>{portalData.certifications.length === 0 ? <PortalEmpty message="No hay certificados compartidos con esta empresa." /> : null}</PortalTable> : null}
    </>
  );
}

function SupplierPortal({ company }: { company: PortalCompany }) {
  const [view, setView] = useState<"rncp" | "audits" | "plans">("rncp");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rncpDirectory = useRncpReports();
  const assessmentDirectory = useSupplierAssessments();
  const reports = rncpDirectory.reports.filter((report) => !report.deletedAt);
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0];
  const nextCommitment = reports.filter((report) => report.responseDueDate && report.status !== "closed").sort((left, right) => (left.responseDueDate ?? "").localeCompare(right.responseDueDate ?? ""))[0];

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedReport) return;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await saveRncpResponseAction({
        reportId: selectedReport.id, description: String(form.get("description") ?? ""),
        responsibleName: String(form.get("responsibleName") ?? ""), dueDate: String(form.get("dueDate") ?? ""),
        executedAt: String(form.get("executedAt") ?? "") || undefined, comment: String(form.get("comment") ?? ""),
        status: String(form.get("status") ?? "submitted") as "pending" | "in_progress" | "submitted",
      });
      for (const file of files) await uploadRncpEvidence(result.action.id, file);
      await rncpDirectory.refresh(); setFiles([]); event.currentTarget.reset();
      setNotice("Acción y evidencias enviadas a Calidad para revisión.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible enviar la respuesta."); }
    finally { setSaving(false); }
  }

  async function openEvidence(fileId: string) {
    setError("");
    try { const result = await getRncpEvidenceUrl(fileId); window.open(result.signedUrl, "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible abrir la evidencia."); }
  }

  async function openAssessmentFile(assessmentId: string) {
    setError("");
    try { const result = await getSupplierAssessmentFileUrl(assessmentId); window.open(result.signedUrl, "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible abrir el archivo."); }
  }

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    setFiles((current) => [...current, ...Array.from(selected)]);
  }
  return (
    <>
      <PortalHeading title="Portal de proveedores" account={`${company.companyName}${company.siteName ? ` · ${company.siteName}` : ""}`} description="RNCP, auditorías, planes de acción, plazos y evidencias de la cuenta." />
      {nextCommitment ? <section className="portal-deadline-band"><CalendarDays size={18} /><div><strong>Próximo compromiso: {formatDate(nextCommitment.responseDueDate!)}</strong><p>Respuesta pendiente para {nextCommitment.folio}.</p></div><span className={`quality-state ${nextCommitment.late ? "danger" : "warning"}`}>{nextCommitment.late ? "Tardío" : "En tiempo"}</span></section> : null}
      <div className="quality-view-tabs portal-tabs" aria-label="Vistas del portal de proveedores">
        <button className={view === "rncp" ? "active" : ""} type="button" onClick={() => setView("rncp")}>Mis RNCP</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Auditorías y evaluaciones</button>
        <button className={view === "plans" ? "active" : ""} type="button" onClick={() => setView("plans")}>Planes y evidencias</button>
      </div>
      {view === "rncp" ? (
        <section className="portal-record-list">
          <header><div><h3>Reportes de no calidad asignados</h3><p>Publicados desde Gestión de calidad de proveedores.</p></div><FileText size={19} /></header>
          {rncpDirectory.loading ? <PortalEmpty message="Consultando RNCP autorizadas…" /> : reports.map((record) => <article key={record.id}><div><code>{record.folio}</code><h4>{record.findingType ?? "Reporte de no calidad"}</h4><p>{record.materialOrService ?? "Material pendiente"}{record.siteName ? ` · ${record.siteName}` : ""}</p><button className="button button-secondary portal-report-link" type="button" onClick={() => { setSelectedReportId(record.id); setView("plans"); }}><Send size={14} /> Responder RNCP</button></div><dl><div><dt>Fecha</dt><dd>{record.reportDate ? formatDate(record.reportDate) : "Pendiente"}</dd></div><div><dt>Plazo</dt><dd>{record.responseDueDate ? formatDate(record.responseDueDate) : "Pendiente"}</dd></div><div><dt>Evidencias</dt><dd>{record.actions.reduce((total, action) => total + action.evidences.length, 0)}</dd></div></dl><span className={`quality-state ${record.late ? "danger" : record.status === "closed" ? "success" : "warning"}`}>{record.late ? "Tardía" : portalStatus(record)}</span></article>)}
          {!rncpDirectory.loading && reports.length === 0 ? <PortalEmpty message="No hay reportes de no calidad asignados a esta empresa y sucursal." /> : null}
        </section>
      ) : null}
      {view === "audits" ? (
        <section className="supplier-portal-audit"><header><div><h3>Auditorías y evaluaciones autorizadas</h3><p>Resultados publicados por Calidad para esta empresa y sucursal.</p></div><FileCheck2 size={19} /></header>{assessmentDirectory.loading ? <PortalEmpty message="Consultando resultados autorizados…" /> : <div className="quality-table-wrap"><table className="quality-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Resultado</th><th>Clasificación</th><th>Archivo</th></tr></thead><tbody>{assessmentDirectory.assessments.map((assessment) => <tr key={assessment.id}><td>{formatDate(assessment.assessmentDate)}</td><td>{supplierAssessmentTypeLabel(assessment.assessmentType)}</td><td><strong>{assessment.score === undefined ? "Sin puntuación" : `${assessment.score}%`}</strong></td><td>{assessment.classification ?? "Sin clasificación"}</td><td>{assessment.sourceFile ? <button className="evidence-link" onClick={() => void openAssessmentFile(assessment.id)} type="button"><FileText size={14} /> Ver archivo</button> : "Sin archivo"}</td></tr>)}</tbody></table>{!assessmentDirectory.assessments.length ? <PortalEmpty message="No hay resultados autorizados para esta empresa y sucursal." /> : null}</div>}{error || assessmentDirectory.error ? <div className="form-error" role="alert">{error || assessmentDirectory.error}</div> : null}</section>
      ) : null}
      {view === "plans" ? (
        <SupplierRncpResponse error={error || rncpDirectory.error} files={files} onAddFiles={addFiles} onOpenEvidence={openEvidence} onSelectReport={setSelectedReportId} notice={notice} onSubmit={submitPlan} report={selectedReport} reports={reports} saving={saving} />
      ) : null}
    </>
  );
}

function SupplierRncpResponse({ error, files, notice, onAddFiles, onOpenEvidence, onSelectReport, onSubmit, report, reports, saving }: { error: string; files: File[]; notice: string; onAddFiles: (files: FileList | null) => void; onOpenEvidence: (id: string) => Promise<void>; onSelectReport: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>; report?: RncpReport; reports: RncpReport[]; saving: boolean }) {
  return <section className="portal-action-form"><header><div><h3>Acciones y evidencias</h3><p>Registra lo realizado y adjunta fotografías o documentos directamente a la RNCP.</p></div><ShieldCheck size={19} /></header>{report ? <><div className="portal-rncp-selector"><label>RNCP<select value={report.id} onChange={(event) => onSelectReport(event.target.value)}>{reports.map((item) => <option key={item.id} value={item.id}>{item.folio} · {item.findingType ?? "Sin descripción"}</option>)}</select></label><span className={`quality-state ${report.late ? "danger" : "warning"}`}>{report.late ? "Tardía" : portalStatus(report)}</span></div><form onSubmit={(event) => void onSubmit(event)}><div className="rncp-form-grid"><label className="wide"><span>Descripción *</span><textarea name="description" rows={4} required placeholder="Describe la acción realizada o propuesta" /></label><label><span>Responsable *</span><input name="responsibleName" required /></label><label><span>Fecha compromiso *</span><input name="dueDate" type="date" defaultValue={report.responseDueDate} required /></label><label><span>Fecha de ejecución</span><input name="executedAt" type="date" /></label><label><span>Estatus</span><select name="status" defaultValue="submitted"><option value="pending">Pendiente</option><option value="in_progress">En proceso</option><option value="submitted">Realizada · enviar a Calidad</option></select></label><label className="wide"><span>Comentario</span><textarea name="comment" rows={3} /></label><div className="wide rncp-upload-actions"><label className="button button-secondary file-button"><Camera size={15} /> Tomar foto<input accept="image/jpeg,image/png,image/webp" capture="environment" type="file" onChange={(event) => { onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label><label className="button button-secondary file-button"><ImagePlus size={15} /> Seleccionar archivo<input accept=".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx" multiple type="file" onChange={(event) => { onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label><small>JPG, JPEG, PNG, WEBP, PDF, XLS o XLSX · máximo configurado por archivo.</small></div>{files.length ? <div className="wide rncp-selected-files">{files.map((file, index) => <span key={`${file.name}-${index}`}><FileText size={13} /> {file.name} · {formatFileSize(file.size)}</span>)}</div> : null}</div>{notice ? <div className="form-success"><CheckCircle2 size={17} /> {notice}</div> : null}{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="configuration-actions"><button className="button button-primary" disabled={saving} type="submit"><Send size={16} /> {saving ? "Enviando…" : "Guardar acción"}</button></div></form><div className="portal-rncp-actions"><h4>Acciones registradas</h4>{report.actions.map((action) => <article key={action.id}><div><strong>{action.description}</strong><small>{action.responsibleName} · compromiso {formatDate(action.dueDate)}</small>{action.validationComment ? <p>Calidad: {action.validationComment}</p> : null}</div><span className={`quality-state ${action.status === "accepted" ? "success" : action.status === "rejected" ? "danger" : "warning"}`}>{actionStatusLabel(action.status)}</span><div className="rncp-evidence-links">{action.evidences.map((evidence) => <button key={evidence.id} onClick={() => void onOpenEvidence(evidence.id)} type="button"><FileText size={13} /> {evidence.fileName}</button>)}</div></article>)}{!report.actions.length ? <p>Esta RNCP todavía no tiene acciones.</p> : null}</div></> : <PortalEmpty message="No hay RNCP disponibles para responder." />}</section>;
}

function PortalHeading({ title, account, description }: { title: string; account: string; description: string }) {
  return <section className="module-heading portal-heading"><div><p className="module-kicker">Acceso externo</p><h2>{title}</h2><p>{description}</p></div><div className="portal-account"><UserRoundCheck size={18} /><span><small>Cuenta activa</small><strong>{account}</strong></span></div></section>;
}

function PortalTable({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="quality-table-panel"><header><div><h3>{title}</h3><p>Contenido autorizado para esta cuenta.</p></div><FileCheck2 size={19} /></header><div className="quality-table-wrap">{children}</div></section>;
}

function PortalEmpty({ message }: { message: string }) {
  return <div className="access-empty portal-empty"><LockKeyhole size={22} /><p>{message}</p></div>;
}

function PortalAccessDenied() {
  return <section className="access-empty portal-access-denied"><LockKeyhole size={28} /><h2>Acceso no disponible</h2><p>La sesión no tiene una empresa válida vinculada para este portal.</p></section>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function portalStatus(report: RncpReport) {
  return { draft: "Borrador", submitted: "Enviada", in_progress: "En proceso", closed: "Cerrada" }[report.status];
}

function actionStatusLabel(status: RncpReport["actions"][number]["status"]) {
  return { pending: "Pendiente", in_progress: "En proceso", submitted: "Realizada", accepted: "Validada", rejected: "Rechazada", closed: "Validada" }[status];
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
