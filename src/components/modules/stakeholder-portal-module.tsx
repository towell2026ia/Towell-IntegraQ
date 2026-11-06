"use client";
import { rncpIdFromSearch } from "@/lib/rncp/link";
import { followupCommand, rncpRequest } from "@/lib/rncp/client";

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
import { FormEvent, useEffect, useState } from "react";

import { useRncpReports } from "@/hooks/use-rncp-reports";
import { useSupplierAssessments } from "@/hooks/use-supplier-assessments";
import {
  resolvePortalCompany,
  type PortalCompany,
} from "@/lib/portal-access";
import type { ActiveSession } from "@/lib/session-data";
import { getRncpEvidenceUrl, saveRncpResponseAction, uploadRncpEvidence, type RncpReport } from "@/lib/rncp-data";
import { getSupplierAssessmentFileUrl, supplierAssessmentTypeLabel } from "@/lib/supplier-assessment-data";
import type { CorrectiveAction } from "@/lib/types";
import { loadPublishedCorrectiveActions, type PublishedCorrectiveAction } from "@/lib/root-cause-publication";
import portalStyles from "@/components/modules/stakeholder-portal.module.css";

type PortalKind = "customer" | "supplier";

export function StakeholderPortalModule({
  kind,
  session,
}: {
  kind: PortalKind;
  actions: CorrectiveAction[];
  session: ActiveSession;
}) {
  if (kind === "customer" && session.userType === "Administrador" && session.workspaceMode === "production") {
    return <CustomerPortal isAdministrator />;
  }
  const company = resolvePortalCompany(session, kind);
  if (!company || (kind === "customer" && (session.userType !== "Cliente" || session.externalParty?.kind !== "customer"))) return <PortalAccessDenied />;
  return kind === "customer" ? (
    <CustomerPortal company={company} />
  ) : (
    <SupplierPortal company={company} actorId={session.authUserId ?? ""} />
  );
}

type CustomerPortalDocument = {
  id: string; folderId: string; name: string; originalName: string; mimeType: string; sizeBytes: number;
  referenceType: "internal" | "external"; validityStatus: "current" | "not_current";
  validFrom?: string | null; validUntil?: string | null; description?: string | null; version: number;
  fileHref?: string; managedInCertifications?: boolean;
};

function CustomerPortal({ company, isAdministrator = false }: { company?: PortalCompany; isAdministrator?: boolean }) {
  const [view, setView] = useState<"documents" | "actions">("documents");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [actions, setActions] = useState<PublishedCorrectiveAction[]>([]);
  const [documents, setDocuments] = useState<CustomerPortalDocument[]>([]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [replaceDocumentId, setReplaceDocumentId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const loadDocuments = fetch("/api/customer-portal/documents", { cache: "no-store" }).then(async response => {
      const body = await response.json() as { documents?: CustomerPortalDocument[]; folders?: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) throw new Error(body.error || "No fue posible consultar los documentos.");
      return body;
    });
    const loadActions = isAdministrator ? Promise.resolve([] as PublishedCorrectiveAction[]) : loadPublishedCorrectiveActions();
    void Promise.all([loadDocuments, loadActions]).then(([documentResult, actionResult]) => {
      if (active) { setDocuments(documentResult.documents ?? []); setFolders(documentResult.folders ?? []); setActions(actionResult); setError(""); }
    }).catch(cause => {
      if (active) { setDocuments([]); setActions([]); setError(cause instanceof Error ? cause.message : "No fue posible consultar la información autorizada."); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdministrator, retry]);

  const handleDocumentUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdministrator) return;
    const formElement = event.currentTarget;
    const file = (formElement.elements.namedItem("documentFile") as HTMLInputElement | null)?.files?.[0];
    const folderId = selectedFolderId;
    const name = displayName.trim();
    if (!(file instanceof File) || !folderId) { setUploadError("Selecciona una carpeta y un archivo."); return; }
    setUploading(true); setUploadError("");
    const body = new FormData();
    body.append("files", file);
    body.append("manifest", JSON.stringify([{ folderId, name: name || file.name, referenceType: "external", validityStatus: "current" }]));
    if (replaceDocumentId) body.append("replaceDocumentId", replaceDocumentId);
    try {
      const response = await fetch("/api/information-general", { method: "POST", body });
      const result = await response.json() as { successCount?: number; results?: Array<{ ok?: boolean; error?: string }>; error?: string };
      if (!response.ok || !result.successCount) throw new Error(result.error || result.results?.[0]?.error || "No fue posible publicar el documento.");
      formElement.reset(); setReplaceDocumentId(""); setSelectedFolderId(""); setDisplayName(""); setLoading(true); setRetry(value => value + 1);
    } catch (cause) { setUploadError(cause instanceof Error ? cause.message : "No fue posible publicar el documento."); }
    finally { setUploading(false); }
  };

  const changePublication = async (document: CustomerPortalDocument, publish: boolean) => {
    if (!publish && !window.confirm(`Retirar «${document.name}» de la biblioteca de clientes? El archivo y su historial se conservarán.`)) return;
    const response = await fetch("/api/information-general", { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "document", action: "update", id: document.id,
        referenceType: "external", validityStatus: publish ? "current" : "not_current" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setUploadError(result.error || "No fue posible actualizar la publicación."); return; }
    setLoading(true); setRetry(value => value + 1);
  };

  const selectedAction = actions.find((action) => action.id === selectedActionId);
  return (
    <>
      <PortalHeading title="Portal del cliente" account={isAdministrator ? "Biblioteca para todos los clientes" : company?.companyName ?? "Cliente"} description="Documentos vigentes y análisis A3 autorizados para esta empresa." />
      <div className="quality-view-tabs portal-tabs" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} aria-label="Secciones del Portal de Clientes">
        <button className={view === "documents" ? "active" : ""} type="button" onClick={() => setView("documents")}>Documentos</button>
        <button className={view === "actions" ? "active" : ""} type="button" onClick={() => setView("actions")}>Mis análisis A3</button>
      </div>
      {view === "documents" ? <section className="portal-record-list">
        <header><div><h3>Documentos vigentes</h3><p>{isAdministrator ? "Administra la publicación para todas las cuentas de clientes." : "Consulta y descarga documentos publicados y vigentes."}</p></div><FileText size={19} /></header>
        {isAdministrator ? <form className={portalStyles.documentUpload} onSubmit={(event) => void handleDocumentUpload(event)}>
          <label><span>Carpeta</span><select name="folderId" required value={selectedFolderId} onChange={event => setSelectedFolderId(event.target.value)}><option value="" disabled>Seleccionar carpeta existente</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          <label><span>Nombre del documento</span><input name="displayName" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Nombre visible para clientes" /></label>
          <label><span>Archivo {replaceDocumentId ? "de reemplazo" : "para publicar"}</span><input key={replaceDocumentId || "new-document"} name="documentFile" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt" /></label>
          {replaceDocumentId ? <button className="button button-secondary" type="button" onClick={() => { setReplaceDocumentId(""); setSelectedFolderId(""); setDisplayName(""); }}>Cancelar reemplazo</button> : null}
          <button className="button button-primary" disabled={uploading || !folders.length} type="submit">{uploading ? "Guardando…" : replaceDocumentId ? "Sustituir y publicar versión" : "Cargar y publicar"}</button>
          {!folders.length ? <small>Se requiere una carpeta documental existente en Información General.</small> : null}
          {uploadError ? <div className="form-error" role="alert">{uploadError}</div> : null}
        </form> : null}
        {loading ? <PortalEmpty message="Consultando documentos autorizados…" /> : null}
        {error ? <div role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Reintentar</button></div> : null}
        {!loading && !error ? documents.map(document => <article key={document.id}>
          <div><code>Versión {document.version}</code><h4>{document.name}</h4>{document.description ? <p>{document.description}</p> : null}<small>{document.originalName} · {formatFileSize(document.sizeBytes)}</small></div>
          <div className={portalStyles.documentLinks}><a className="button button-secondary" href={document.fileHref ?? `/api/customer-portal/documents/${document.id}/file`} target="_blank" rel="noreferrer">Ver documento</a><a className="button button-secondary" href={`${document.fileHref ?? `/api/customer-portal/documents/${document.id}/file`}?disposition=download`}>Descargar</a>
            {isAdministrator && document.managedInCertifications ? <small>Publicación y versiones: Gestión de Clientes → Certificaciones.</small> : isAdministrator ? document.referenceType === "external" && document.validityStatus === "current" ? <><button className="button button-ghost" type="button" onClick={() => { setReplaceDocumentId(document.id); setSelectedFolderId(document.folderId); setDisplayName(document.name); }}>Sustituir</button><button className="button button-ghost" type="button" onClick={() => void changePublication(document, false)}>Retirar publicación</button></> : <button className="button button-ghost" type="button" onClick={() => void changePublication(document, true)}>Publicar para clientes</button> : null}
          </div>
        </article>) : null}
        {!loading && !error && documents.length === 0 ? <PortalEmpty message={isAdministrator ? "No hay documentos vigentes en el catálogo." : "No hay documentos publicados y vigentes para clientes."} /> : null}
      </section> : null}
      {view === "actions" ? (isAdministrator ? <PortalEmpty message="Los clientes sólo ven aquí los análisis A3 publicados expresamente para su propia cuenta." /> :
        selectedAction ? (
          <section className="portal-record-list"><button className="button button-secondary" type="button" onClick={() => setSelectedActionId("")}>Volver</button><article><div><code>{selectedAction.folio}</code><h4>{selectedAction.title}</h4></div><dl><div><dt>Avance</dt><dd>{selectedAction.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(selectedAction.dueDate)}</dd></div></dl><span className="quality-state warning">{selectedAction.status}</span></article></section>
        ) : <section className="portal-record-list">
          <header><div><h3>Mis análisis A3</h3><p>Únicamente análisis autorizados para esta cuenta; este portal permite consulta.</p></div><ClipboardCheck size={19} /></header>
          {loading ? <PortalEmpty message="Consultando acciones autorizadas…" /> : null}
          {error ? <div role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Reintentar</button></div> : null}
          {actions.map((action) => (
            <article key={action.id}>
              <div><code>{action.folio}</code><h4>{action.title}</h4><button className="button button-secondary portal-report-link" type="button" onClick={() => setSelectedActionId(action.id)}><FileText size={15} /> Ver información compartida</button></div>
              <dl><div><dt>Avance</dt><dd>{action.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(action.dueDate)}</dd></div></dl>
              <span className="quality-state warning">{action.status}</span>
            </article>
          ))}
          {!loading && !error && actions.length === 0 ? <PortalEmpty message="No hay análisis A3 publicados para esta empresa." /> : null}
        </section>
      ) : null}
    </>
  );
}

function SupplierPortal({ company, actorId }: { company: PortalCompany; actorId: string }) {
  const [view, setView] = useState<"rncp" | "audits" | "plans">(() => typeof window !== "undefined" && rncpIdFromSearch(window.location.search) ? "plans" : "rncp");
  const [selectedReportId, setSelectedReportId] = useState(() => typeof window === "undefined" ? "" : rncpIdFromSearch(window.location.search));
  const [savedResponseIds, setSavedResponseIds] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rncpDirectory = useRncpReports();
  const assessmentDirectory = useSupplierAssessments();
  const reports = rncpDirectory.reports.filter((report) => !report.deletedAt);
  const selectedReport = selectedReportId ? reports.find((report) => report.id === selectedReportId) : reports[0];
  const nextCommitment = reports.filter((report) => report.responseDueDate && report.status !== "closed").sort((left, right) => (left.responseDueDate ?? "").localeCompare(right.responseDueDate ?? ""))[0];

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedReport) return;
    setSaving(true); setError(""); setNotice("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      if (selectedReport.origin === "historical") throw new Error("El registro importado conserva su seguimiento histórico.");
      if (selectedReport.origin === "native") {
        if (!selectedReport.notifiedAt) throw new Error("Calidad todavía no ha registrado la comunicación formal y su plazo. No se guardó ningún avance.");
        const documentTypes = Object.fromEntries((selectedReport.responseRequirements?.documents ?? []).map(name => [name, String(form.get(`document:${name}`) ?? "")]));
        const result = await followupCommand<{ actionId: string }>("save_response", { reportId: selectedReport.id, actionId: savedResponseIds[selectedReport.id] ?? selectedReport.actions.find(action => action.createdBy === actorId && !["accepted", "closed"].includes(action.status))?.id, payload: {
          description: String(form.get("description") ?? ""), responsibleName: String(form.get("responsibleName") ?? ""), dueDate: String(form.get("dueDate") ?? ""),
          rootCause: String(form.get("rootCause") ?? ""), actionPlan: String(form.get("actionPlan") ?? ""), containment: String(form.get("containment") ?? ""), commitments: String(form.get("commitments") ?? ""), documentTypes } });
        setSavedResponseIds(current => ({ ...current, [selectedReport.id]: result.actionId }));
        for (const file of files) await uploadRncpEvidence(result.actionId, file);
        setFiles([]);
        if (form.get("status") === "submitted") await followupCommand("submit_delivery", { reportId: selectedReport.id, payload: { actionId: result.actionId } });
        await rncpDirectory.refresh();
        setNotice(form.get("status") === "submitted" ? "Entrega completa enviada a inspectormp para validación; no implica cierre." : "Avance guardado. El plazo original continúa vigente.");
        return;
      }
      const result = await saveRncpResponseAction({
        reportId: selectedReport.id, description: String(form.get("description") ?? ""),
        responsibleName: String(form.get("responsibleName") ?? ""), dueDate: String(form.get("dueDate") ?? ""),
        executedAt: String(form.get("executedAt") ?? "") || undefined, comment: String(form.get("comment") ?? ""),
        status: String(form.get("status") ?? "submitted") as "pending" | "in_progress" | "submitted",
      });
      for (const file of files) await uploadRncpEvidence(result.action.id, file);
      await rncpDirectory.refresh(); setFiles([]); element.reset();
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
        <SupplierRncpResponse actorId={actorId} error={error || rncpDirectory.error} files={files} onAddFiles={addFiles} onOpenEvidence={openEvidence} onSelectReport={setSelectedReportId} notice={notice} onSubmit={submitPlan} report={selectedReport} reports={reports} saving={saving} />
      ) : null}
    </>
  );
}

function SupplierRncpResponse({ actorId, error, files, notice, onAddFiles, onOpenEvidence, onSelectReport, onSubmit, report, reports, saving }: { actorId: string; error: string; files: File[]; notice: string; onAddFiles: (files: FileList | null) => void; onOpenEvidence: (id: string) => Promise<void>; onSelectReport: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>; report?: RncpReport; reports: RncpReport[]; saving: boolean }) {
  const [originals, setOriginals] = useState<{ reportId: string; files: Array<{id:string;fileName:string}> } | null>(null);
  const [originalError, setOriginalError] = useState("");
  const locked = report?.origin === "historical" || report?.status === "closed" || report?.origin === "native" && (!report.notifiedAt || report.actions.some(action=>action.status === "submitted"));
  const previous = report?.actions.find(action => action.createdBy === actorId && !["accepted", "closed"].includes(action.status));
  return <section className="portal-action-form"><header><div><h3>Acciones y evidencias</h3><p>Registra lo realizado y adjunta fotografías o documentos directamente a la RNCP.</p></div><ShieldCheck size={19} /></header>{report ? <><div className="portal-rncp-selector"><label>RNCP<select value={report.id} onChange={(event) => onSelectReport(event.target.value)}>{reports.map((item) => <option key={item.id} value={item.id}>{item.folio} · {item.findingType ?? "Sin descripción"}</option>)}</select></label><span className={`quality-state ${report.late ? "danger" : "warning"}`}>{report.late ? "Tardía" : portalStatus(report)}</span></div><div><button className="button button-secondary" type="button" onClick={()=>{void rncpRequest<{originalFiles:Array<{id:string;fileName:string}>}>(`/follow-up?reportId=${report.id}`).then(result=>{setOriginalError("");setOriginals({reportId:report.id,files:result.originalFiles});}).catch(error=>setOriginalError(error.message));}}>Consultar PDF original del RNCP</button>{originals?.reportId===report.id ? originals.files.length ? originals.files.map(file=><button key={file.id} className="button button-secondary" type="button" onClick={()=>{void rncpRequest<{url:string}>(`/originals/${file.id}`).then(result=>window.open(result.url,"_blank","noopener,noreferrer")).catch(error=>setOriginalError(error.message));}}>{file.fileName}</button>):<p>Sin PDF original asociado.</p>:null}{originalError?<p role="alert">{originalError}</p>:null}</div>{locked?<p>Expediente de sólo consulta: histórico, sin notificación formal, cerrado o con entrega en validación.</p>:null}<form onSubmit={(event) => void onSubmit(event)}><div className="rncp-form-grid"><label className="wide"><span>Descripción *</span><textarea name="description" rows={4} required placeholder="Describe la acción realizada o propuesta" /></label><label><span>Responsable *</span><input name="responsibleName" required /></label><label><span>Fecha compromiso *</span><input name="dueDate" type="date" defaultValue={previous?.dueDate ?? report.responseDueDate} readOnly={Boolean(previous)} required /></label><label><span>Fecha de ejecución</span><input name="executedAt" type="date" /></label><label><span>Estatus</span><select name="status" defaultValue="in_progress"><option value="pending">Pendiente</option><option value="in_progress">En proceso</option><option value="submitted">Realizada · enviar a Calidad</option></select></label>{report.origin === "native" ? <><label className="wide"><span>Análisis de causa</span><textarea name="rootCause" defaultValue={previous?.rootCause} rows={3} /></label><label className="wide"><span>Plan de acciones</span><textarea name="actionPlan" defaultValue={previous?.actionPlan} rows={3} /></label>{report.responseRequirements?.containment ? <label className="wide"><span>Contención requerida</span><textarea name="containment" defaultValue={previous?.containment} rows={3} /></label> : null}<label className="wide"><span>Observaciones y compromisos</span><textarea name="commitments" defaultValue={previous?.commitments} rows={3} /></label>{report.responseRequirements?.documents?.map(name => <label key={name}><span>Documento requerido: {name}</span><select name={`document:${name}`} defaultValue={previous?.documentTypes?.[name] ?? ""}><option value="">Seleccionar evidencia guardada</option>{report.actions.flatMap(action => action.evidences).map(file => <option key={file.id} value={file.id}>{file.fileName}</option>)}</select></label>)}<p className="wide">Puedes guardar avances parciales. Para enviar a validación se requieren causa, plan, compromisos, contención cuando aplique y evidencias válidas. Los documentos obligatorios se seleccionan después de adjuntarlos. Ninguna carga cierra el reporte.</p></> : null}<label className="wide"><span>Comentario</span><textarea name="comment" rows={3} /></label><div className="wide rncp-upload-actions"><label className="button button-secondary file-button"><Camera size={15} /> Tomar foto<input accept="image/jpeg,image/png,image/webp" capture="environment" type="file" onChange={(event) => { onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label><label className="button button-secondary file-button"><ImagePlus size={15} /> Seleccionar archivo<input accept=".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx" multiple type="file" onChange={(event) => { onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label><small>JPG, JPEG, PNG, WEBP, PDF, XLS o XLSX · máximo configurado por archivo.</small></div>{files.length ? <div className="wide rncp-selected-files">{files.map((file, index) => <span key={`${file.name}-${index}`}><FileText size={13} /> {file.name} · {formatFileSize(file.size)}</span>)}</div> : null}</div>{notice ? <div className="form-success"><CheckCircle2 size={17} /> {notice}</div> : null}{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="configuration-actions"><button className="button button-primary" disabled={saving || locked} type="submit"><Send size={16} /> {saving ? "Enviando…" : "Guardar acción"}</button></div></form><div className="portal-rncp-actions"><h4>Acciones registradas</h4>{report.actions.map((action) => <article key={action.id}><div><strong>{action.description}</strong><small>{action.responsibleName} · compromiso {formatDate(action.dueDate)}</small>{action.validationComment ? <p>Calidad: {action.validationComment}</p> : null}</div><span className={`quality-state ${action.status === "accepted" ? "success" : action.status === "rejected" ? "danger" : "warning"}`}>{actionStatusLabel(action.status)}</span><div className="rncp-evidence-links">{action.evidences.map((evidence) => <button key={evidence.id} onClick={() => void onOpenEvidence(evidence.id)} type="button"><FileText size={13} /> {evidence.fileName}</button>)}</div></article>)}{!report.actions.length ? <p>Esta RNCP todavía no tiene acciones.</p> : null}</div></> : <PortalEmpty message="No hay RNCP disponibles para responder." />}</section>;
}

function PortalHeading({ title, account, description }: { title: string; account: string; description: string }) {
  return <section className="module-heading portal-heading"><div><p className="module-kicker">Acceso externo</p><h2>{title}</h2><p>{description}</p></div><div className="portal-account"><UserRoundCheck size={18} /><span><small>Cuenta activa</small><strong>{account}</strong></span></div></section>;
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
