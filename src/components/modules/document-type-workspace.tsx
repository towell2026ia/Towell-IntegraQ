"use client";

import {
  ArrowLeft, Check, Clock3, Download, Eye, FileImage, FileText,
  History, LayoutDashboard, MoreVertical, Pencil, RotateCcw, Send, ShieldCheck,
  Upload, X, XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DocumentPreviewViewer, type DocumentPreviewViewerHandle } from "@/components/modules/document-preview-viewer";
import { isSpreadsheetFileName } from "@/lib/spreadsheet-preview";
import type { ProcessCatalogItem } from "@/lib/configuration-data";
import {
  getDocumentPermissions, getDocumentPreviewVersions, documentAdvancedActionsEnabled, getWorkingVersion, obsoleteControlledDocument,
  rejectDocumentVersion, softDeleteControlledDocument,
  submitDocumentVersion, type ControlledDocument, type ControlledDocumentStatus,
  type DocumentAuditEventType, type DocumentPermissions,
} from "@/lib/document-control-data";
import type { DocumentType } from "@/lib/document-data";
import { documentValidatorByProcess } from "@/lib/document-data";
import {
  editStoredDocumentMetadata, obsoleteStoredDocument, restoreStoredDocument,
  getControlledDocumentDownloadUrl,
  reviewStoredDocumentVersion, softDeleteStoredDocument, submitStoredDocumentVersion,
  uploadPendingControlledDocument, inspectControlledDocumentCode, loadStoredControlledDocument, type DocumentCodeMatch,
} from "@/lib/document-storage";
import { documentVersionLabel, type DocumentReplacementKind } from "@/lib/document-replacement";
import styles from "./document-replacement.module.css";
import type { ActiveSession } from "@/lib/session-data";

const statusLabels: Record<ControlledDocumentStatus, string> = {
  draft: "Borrador", pending: "En validación", current: "Vigente",
  rejected: "Rechazado", obsolete: "Obsoleto",
};

const eventLabels: Record<DocumentAuditEventType, string> = {
  DOCUMENT_CREATED: "Creó el documento", DOCUMENT_EDITED: "Editó metadata",
  VERSION_CREATED: "Creó una nueva versión", VERSION_SUBMITTED: "Envió la versión a validación",
  VERSION_APPROVED: "Aprobó la versión", VERSION_REJECTED: "Rechazó la versión",
  DOCUMENT_OBSOLETED: "Declaró el documento obsoleto", DOCUMENT_DELETED: "Eliminó lógicamente el documento",
  DOCUMENT_RESTORED: "Restauró el documento", DOCUMENT_VIEWED: "Consultó el documento",
  FILE_REPLACED: "Reemplazó el archivo",
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "America/Mexico_City",
});

export function DocumentTypeWorkspace({
  process, documentType, documents, permissions, session, onBack, onOpenForm,
  onChangeDocument, onAddDocument,
}: {
  process: ProcessCatalogItem;
  documentType: DocumentType;
  documents: ControlledDocument[];
  permissions: DocumentPermissions;
  session: ActiveSession;
  onBack: () => void;
  onOpenForm: (formId: string) => void;
  onChangeDocument: (document: ControlledDocument) => void;
  onAddDocument: (document: ControlledDocument) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [obsoleteId, setObsoleteId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const visibleDocuments = documents.filter((document) => getDocumentPermissions(session, document.processId).view);
  const selected = (id: string | null) => visibleDocuments.find((item) => item.id === id) ?? null;
  const selectedPreview = selected(previewId);
  const preview = selectedPreview ? { ...selectedPreview, versions: getDocumentPreviewVersions(selectedPreview, session) } : null;
  const history = selected(historyId);
  const rejecting = selected(rejectId);
  const editing = selected(editId);
  const versioning = selected(versionId);
  const obsoleting = selected(obsoleteId);
  const deleting = selected(deleteId);

  function announce(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 5000);
  }

  async function approvePendingDocument(document: ControlledDocument) {
    const pending = document.versions.find((version) => version.status === "pending");
    if (!pending || reviewingId || !getDocumentPermissions(session, document.processId).validate) return;
    setReviewingId(pending.id);
    try {
      await reviewStoredDocumentVersion(pending.id, "approve");
      onChangeDocument(await loadStoredControlledDocument(document.id));
      announce("Versión aprobada y publicada correctamente.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No fue posible autorizar el documento.");
    } finally { setReviewingId(null); }
  }

  async function rejectPendingDocument(document: ControlledDocument, reason: string) {
    const pending = document.versions.find((version) => version.status === "pending");
    if (!pending || !getDocumentPermissions(session, document.processId).validate) return;
    await reviewStoredDocumentVersion(pending.id, "reject", reason);
    onChangeDocument(rejectDocumentVersion(document, reason, now()));
    setRejectId(null);
    announce("Versión rechazada con observación.");
  }

  async function submitWorkingVersion(document: ControlledDocument) {
    const working = getWorkingVersion(document);
    if (!working || !getDocumentPermissions(session, document.processId).submit) return;
    try {
      await submitStoredDocumentVersion(working.id);
      onChangeDocument(submitDocumentVersion(document, now()));
      announce("Versión enviada a validación.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No fue posible enviar la versión.");
    }
  }

  return <>
    <header className="document-subview-header document-control-header">
      <button className="icon-button" type="button" onClick={onBack} title="Volver al expediente" aria-label="Volver al expediente"><ArrowLeft size={17} /></button>
      <div><span className="detail-eyebrow"><FileText size={14} /> {documentType.name} · {process.id}</span><h3>{documentType.name}</h3><p>{process.name} · Listado exclusivo de este tipo documental</p></div>
      {permissions.upload ? <button className="button button-primary" type="button" onClick={() => setUploadOpen(true)}><Upload size={16} /> Cargar</button> : null}
    </header>
    {notice ? <div className="document-action-notice" role="status"><Check size={15} /> {notice}</div> : null}
    <div className="document-control-summary"><span><strong>{visibleDocuments.length}</strong> documentos</span><span><Clock3 size={14} /> La fecha de modificación se registra automáticamente</span></div>
    <div className="document-control-table-wrap"><table className="document-control-table">
      <thead><tr><th>Vista</th><th>Documento</th><th>Código</th><th>Versión / revisión</th><th>Cargó</th><th>Validador</th><th>Fecha de modificación</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>
        {visibleDocuments.map((document) => {
          const permissions = getDocumentPermissions(session, document.processId);
          const version = getWorkingVersion(document);
          if (!version) return null;
          const current = document.versions.find((item) => item.status === "current");
          const canCreateVersion = permissions.version && !document.versions.some((item) => item.status === "pending");
          return <tr key={document.id}>
            <td><button className="document-icon-action" type="button" title="Vista rápida" aria-label={`Vista rápida de ${document.name}`} onClick={() => setPreviewId(document.id)}><Eye size={15} /></button></td>
            <td className="document-name-cell"><strong>{document.name}</strong><small>{document.owner}</small>{current && current.id !== version.id ? <em>{documentVersionLabel(current)} continúa vigente</em> : null}</td>
            <td><span className="document-code-chip">{document.code}</span></td><td><strong>{documentVersionLabel(version)}</strong></td><td>{version.uploadedBy}</td><td>{version.validator}</td><td>{formatDate(version.modifiedAt)}</td>
            <td><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span></td>
            <td><div className="document-row-actions">
              {document.appFormId ? <button type="button" title="Abrir dashboard del formulario" aria-label="Abrir dashboard del formulario" onClick={() => onOpenForm(document.appFormId!)}><LayoutDashboard size={15} /></button> : null}
              {documentAdvancedActionsEnabled && permissions.edit ? <button type="button" title="Editar metadata" aria-label="Editar metadata" onClick={() => setEditId(document.id)}><Pencil size={15} /></button> : null}
              {permissions.submit && ["draft", "rejected"].includes(version.status) ? <button type="button" title="Enviar a validación" aria-label="Enviar a validación" onClick={() => void submitWorkingVersion(document)}><Send size={15} /></button> : null}
              {permissions.validate && version.status === "pending" ? <><button className="approve" type="button" title="Aprobar y publicar" aria-label="Aprobar y publicar" disabled={reviewingId === version.id} onClick={() => void approvePendingDocument(document)}><Check size={15} /></button><button className="reject" type="button" title="Rechazar con observación" aria-label="Rechazar con observación" onClick={() => setRejectId(document.id)}><XCircle size={15} /></button></> : null}
              {permissions.history ? <button type="button" title="Historial" aria-label="Historial" onClick={() => setHistoryId(document.id)}><History size={15} /></button> : null}
              {documentAdvancedActionsEnabled && (permissions.version || permissions.obsolete || permissions.delete) ? <div className="document-more-actions">
                <button type="button" title="Más acciones" aria-label="Más acciones" aria-expanded={menuId === document.id} onClick={() => setMenuId(menuId === document.id ? null : document.id)}><MoreVertical size={15} /></button>
                {menuId === document.id ? <div className="document-actions-menu">
                  {permissions.version ? <button type="button" disabled={!canCreateVersion} onClick={() => { setVersionId(document.id); setMenuId(null); }}>Reemplazar archivo</button> : null}
                  {permissions.obsolete ? <button type="button" disabled={!current} onClick={() => { setObsoleteId(document.id); setMenuId(null); }}>Obsoletizar</button> : null}
                  {permissions.delete ? <button className="danger" type="button" onClick={() => { setDeleteId(document.id); setMenuId(null); }}>Eliminar</button> : null}
                </div> : null}
              </div> : null}
            </div></td>
          </tr>;
        })}
        {!visibleDocuments.length ? <tr className="document-empty-row"><td colSpan={9}><FileText size={22} /><strong>Sin {documentType.name.toLocaleLowerCase("es-MX")} en {process.name}</strong><span>La tabla pertenece únicamente a {process.id} y conserva sus propias columnas de control.</span></td></tr> : null}
      </tbody>
    </table></div>

    {uploadOpen && permissions.upload ? <UploadDocumentModal process={process} documentType={documentType} session={session} onClose={() => setUploadOpen(false)} onSubmit={(document) => { if (documents.some(item => item.id === document.id)) onChangeDocument(document); else onAddDocument(document); setUploadOpen(false); announce("Documento cargado correctamente."); }} /> : null}
    {preview ? <DocumentPreviewModal document={preview} canDownload={getDocumentPermissions(session, preview.processId).download} onClose={() => setPreviewId(null)} /> : null}
    {history && getDocumentPermissions(session, history.processId).history ? <DocumentHistoryModal document={history} canRestore={getDocumentPermissions(session, history.processId).restore} onClose={() => setHistoryId(null)} onRestore={async () => { await restoreStoredDocument(history.id); onChangeDocument(await loadStoredControlledDocument(history.id)); setHistoryId(null); announce("Recuperación enviada a autorización; el archivo anterior permanece retirado."); }} /> : null}
    {rejecting && getDocumentPermissions(session, rejecting.processId).validate ? <RejectDocumentModal document={rejecting} onClose={() => setRejectId(null)} onReject={(reason) => rejectPendingDocument(rejecting, reason)} /> : null}
    {editing && getDocumentPermissions(session, editing.processId).edit ? <EditDocumentModal document={editing} documentType={documentType} onClose={() => setEditId(null)} onSave={async (values) => { await editStoredDocumentMetadata({ documentId: editing.id, ...values }); onChangeDocument({ ...editing, ...values, activity: [{ id: `${editing.id}-edit-${now()}`, eventType: "DOCUMENT_EDITED", performedBy: session.name, performedAt: now() }, ...(editing.activity ?? [])] }); setEditId(null); announce("Metadata actualizada correctamente."); }} /> : null}
    {versioning && getDocumentPermissions(session, versioning.processId).version ? <UploadDocumentModal process={{ ...process, id: versioning.processId }} documentType={documentType} session={session} initialDocument={versioning} onClose={() => setVersionId(null)} onSubmit={(document) => { onChangeDocument(document); setVersionId(null); announce("Reemplazo enviado a autorización."); }} /> : null}
    {obsoleting && getDocumentPermissions(session, obsoleting.processId).obsolete ? <LifecycleReasonModal mode="obsolete" document={obsoleting} documents={documents} onClose={() => setObsoleteId(null)} onConfirm={async (reason, replacementId) => { await obsoleteStoredDocument(obsoleting.id, reason, replacementId); onChangeDocument(obsoleteControlledDocument(obsoleting, session.name, reason, now(), replacementId)); setObsoleteId(null); announce("Documento marcado como obsoleto."); }} /> : null}
    {deleting && getDocumentPermissions(session, deleting.processId).delete ? <LifecycleReasonModal mode="delete" document={deleting} documents={documents} onClose={() => setDeleteId(null)} onConfirm={async (reason) => { await softDeleteStoredDocument(deleting.id, reason); onChangeDocument(softDeleteControlledDocument(deleting, session.name, reason, now())); setDeleteId(null); announce("Documento eliminado de las vistas operativas. El historial permanece conservado."); }} /> : null}
  </>;
}

export function UploadDocumentModal({ process, documentType, session, initialDocument, onClose, onSubmit }: { process: ProcessCatalogItem; documentType: DocumentType; session: ActiveSession; initialDocument?: ControlledDocument; onClose: () => void; onSubmit: (document: ControlledDocument) => void }) {
  const [name, setName] = useState(initialDocument?.name ?? "");
  const [code, setCode] = useState(initialDocument?.code ?? "");
  const [replace, setReplace] = useState(Boolean(initialDocument));
  const [kind, setKind] = useState<DocumentReplacementKind>("version");
  const [reason, setReason] = useState("");
  const [match, setMatch] = useState<DocumentCodeMatch | null>(null);
  const [checkedCode, setCheckedCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const normalizedCode = code.trim().toUpperCase();
  const checking = Boolean(normalizedCode) && checkedCode !== normalizedCode;
  useEffect(() => {
    if (!normalizedCode) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void inspectControlledDocumentCode(normalizedCode, process.id, documentType.id).then(result => {
        if (!cancelled) { setMatch(result); setCheckedCode(normalizedCode); setUploadError(""); }
      }).catch(error => { if (!cancelled) { setMatch(null); setUploadError(error instanceof Error ? error.message : "No se pudo consultar el código. Reintenta."); } });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [normalizedCode, process.id, documentType.id, lookupAttempt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || submitting || checking) return;
    setSubmitting(true); setUploadError("");
    try {
      onSubmit(await uploadPendingControlledDocument({ processId: process.id, documentTypeId: documentType.id,
        code, name: match?.title ?? name, file, session, replacementKind: replace ? kind : undefined,
        expectedDocumentId: replace ? match?.id : undefined, expectedBaseVersionId: replace ? match?.baseVersionId : undefined,
        changeReason: reason,
      }));
    } catch (error) { setUploadError(error instanceof Error ? error.message : "No fue posible cargar el documento."); setSubmitting(false); }
  }
  const blocked = checking || Boolean(match && (!replace || !match.compatible || match.pending)) || (replace && (!match || !reason.trim()));
  return <ModalShell title="Cargar documento" eyebrow={process.id + " · " + documentType.name} onClose={() => { if (!submitting) onClose(); }} className="document-control-modal"><form onSubmit={submit}>
    <div className="document-modal-grid">
      <label className="wide">Nombre oficial<input name="documentTitle" required readOnly={Boolean(match && replace)} value={match && replace ? match.title : name} onChange={event => setName(event.target.value)} /></label>
      <label className="wide">Código<input name="documentCode" autoComplete="off" required readOnly={Boolean(initialDocument)} value={code} onChange={event => { setCode(event.target.value); setMatch(null); setCheckedCode(""); setUploadError(""); }} /><small>Sólo el identificador, por ejemplo AV-SGC-04. El nombre oficial se captura por separado; los códigos históricos no se cambian automáticamente.</small></label>
      {checking ? <p className="wide" role="status">Consultando código…</p> : null}
      {match ? <div className={"wide " + styles.match} role="status"><strong>{match.code} · {match.title}</strong><span>Proceso {match.processId} · {match.documentTypeId} · {match.deleted ? "Retirado; requiere autorización para volver a estar vigente" : "Expediente existente"}</span>{!match.compatible ? <span>Este código pertenece a otro proceso o tipo documental. Abre su expediente correspondiente.</span> : null}{match.pending ? <span>Ya hay una versión pendiente de autorización.</span> : null}</div> : null}
      <fieldset className={"wide " + styles.selection}><legend>¿Requiere reemplazo?</legend><div className={styles.controls}>
        <label><input type="radio" name="requires-replacement" checked={!replace} onChange={() => setReplace(false)} /> No: documento nuevo</label>
        <label><input type="radio" name="requires-replacement" checked={replace} onChange={() => setReplace(true)} /> Sí</label>
        {replace ? <label>Tipo de reemplazo<select value={kind} onChange={event => setKind(event.target.value as DocumentReplacementKind)}><option value="version">Nueva versión</option><option value="revision">Nueva revisión</option></select></label> : null}
      </div><small>{replace ? kind === "version" ? "El sistema asignará la siguiente versión disponible. Los antecedentes conservan su numeración histórica." : "Se conserva el número de versión o la revisión histórica identificada. Sólo el archivo autorizado pasará a estar vigente." : "Un código existente no puede registrarse como documento nuevo."}</small></fieldset>
      {replace ? <label className="wide">Motivo del reemplazo<textarea required value={reason} onChange={event => setReason(event.target.value)} /></label> : null}
      <label className="wide">Autoriza<input readOnly value={documentValidatorByProcess[process.id]?.name ?? "Jefatura del área"} /></label>
      <label>Responsable de carga<input readOnly value={session.name} /></label><label>Fecha de modificación<input readOnly value="Se asigna al cargar" /></label>
      <label className="wide document-file-input"><span>Archivo</span><input required type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /><small>{file?.name ?? "Archivo privado · máximo 50 MB"}</small></label>
      {match && !replace ? <p className="wide document-upload-error" role="alert">Ya existe un documento con este código. Selecciona reemplazo para conservar su expediente.</p> : null}
    </div>{uploadError ? <div className="document-upload-error" role="alert">{uploadError}{checking ? <button type="button" className="button button-secondary" onClick={() => setLookupAttempt(value => value + 1)}>Reintentar consulta</button> : null}</div> : null}
    <ModalFooter onClose={onClose} submitting={submitting} submitLabel={submitting ? "Enviando…" : "Cargar y enviar a autorización"} icon={<Upload size={16} />} disabled={blocked || !file || !(match && replace ? match.title : name).trim() || !normalizedCode} />
  </form></ModalShell>;
}

function EditDocumentModal({ document, documentType, onClose, onSave }: { document: ControlledDocument; documentType: DocumentType; onClose: () => void; onSave: (values: { name: string; description?: string; processId: string; documentTypeId: string; ownerId?: string; owner: string; code: string }) => Promise<void> }) {
  const [name, setName] = useState(document.name); const [description, setDescription] = useState(document.description ?? ""); const [owner, setOwner] = useState(document.owner); const [code, setCode] = useState(document.code); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  return <ModalShell title="Editar documento" eyebrow={document.code} onClose={onClose} className="document-control-modal"><form onSubmit={(event) => { event.preventDefault(); setSubmitting(true); setError(""); void onSave({ name: name.trim(), description: description.trim() || undefined, processId: document.processId, documentTypeId: documentType.id, ownerId: document.ownerId, owner: owner.trim(), code: code.trim().toUpperCase() }).catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible editar el documento."); setSubmitting(false); }); }}><div className="document-modal-grid"><label className="wide">Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Código<input required value={code} onChange={(event) => setCode(event.target.value)} /></label><label>Responsable<input required value={owner} onChange={(event) => setOwner(event.target.value)} /></label><label className="wide">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="wide document-version-warning"><ShieldCheck size={18} /><span><strong>El archivo vigente no se modificará.</strong> Para sustituir el archivo, utiliza Reemplazar archivo.</span></div></div>{error ? <p className="document-upload-error" role="alert">{error}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel="Guardar cambios" icon={<Pencil size={16} />} disabled={!name.trim() || !owner.trim() || !code.trim()} /></form></ModalShell>;
}


function LifecycleReasonModal({ mode, document, documents, onClose, onConfirm }: { mode: "obsolete" | "delete"; document: ControlledDocument; documents: ControlledDocument[]; onClose: () => void; onConfirm: (reason: string, replacementId?: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [replacementId, setReplacementId] = useState(""); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const version = document.versions.find((item) => item.status === "current") ?? getWorkingVersion(document); const obsolete = mode === "obsolete";
  return <ModalShell title={obsolete ? "Declarar documento obsoleto" : "Eliminar documento"} eyebrow={document.code} onClose={onClose} className="document-reject-modal"><form onSubmit={(event) => { event.preventDefault(); setSubmitting(true); setError(""); void onConfirm(reason, replacementId || undefined).catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible completar la acción."); setSubmitting(false); }); }}><div className="document-lifecycle-copy"><ShieldCheck size={21} /><p>{obsolete ? "El documento dejará de mostrarse como vigente, pero permanecerá disponible en el historial." : "Esta acción retirará el documento de las vistas operativas. El registro y sus archivos permanecerán conservados para trazabilidad y auditoría."}</p></div><div className="document-modal-grid"><label>Código<input readOnly value={document.code} /></label><label>Versión<input readOnly value={documentVersionLabel(version)} /></label><label className="wide">Nombre<input readOnly value={document.name} /></label><label className="wide">Motivo {obsolete ? "de obsolescencia" : "de eliminación"}<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label>{obsolete ? <label className="wide">Documento que lo sustituye (opcional)<select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">Ninguno</option>{documents.filter((item) => item.id !== document.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label> : null}</div>{error ? <p className="document-upload-error" role="alert">{error}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel={obsolete ? "Obsoletizar" : "Eliminar"} icon={obsolete ? <History size={16} /> : <XCircle size={16} />} disabled={!reason.trim()} danger={!obsolete} /></form></ModalShell>;
}

export function DocumentPreviewModal({ document, canDownload, onClose }: { document: ControlledDocument; canDownload: boolean; onClose: () => void }) {
  const version = getWorkingVersion(document); const viewerRef = useRef<DocumentPreviewViewerHandle>(null); const [previewReady, setPreviewReady] = useState(false); const [exporting, setExporting] = useState<"image" | "pdf" | null>(null); if (!version) return null;
  const spreadsheet = isSpreadsheetFileName(version.fileName);
  async function exportPreview(format: "image" | "pdf") { if (!viewerRef.current || exporting) return; setExporting(format); try { if (format === "image") await viewerRef.current.downloadImage(); if (format === "pdf") await viewerRef.current.downloadPdf(); } catch (error) { window.alert(error instanceof Error ? error.message : "No fue posible exportar la vista."); } finally { setExporting(null); } }
  async function downloadOriginal() { const url = await getControlledDocumentDownloadUrl(version); if (!url) return; const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = version.fileName; anchor.click(); }
  return <ModalShell title="Vista rápida" eyebrow={`${document.code} · ${documentVersionLabel(version)}`} onClose={onClose} className="document-preview-modal"><div className="secure-document-preview-body"><div className="secure-preview-metadata"><span><strong>{document.name}</strong><small>{version.fileName}</small></span><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span><span><small>Autoriza</small><strong>{version.validator}</strong></span><span><small>Modificación</small><strong>{formatDate(version.modifiedAt)}</strong></span></div><DocumentPreviewViewer code={document.code} onReadyChange={setPreviewReady} ref={viewerRef} version={version} />{version.rejectionReason ? <div className="document-rejection-note"><XCircle size={16} /><span><strong>Observación de rechazo</strong>{version.rejectionReason}</span></div> : null}</div><footer><span className="secure-preview-protection">Solo lectura · {spreadsheet ? "Hoja de cálculo original" : "Preview PDF normalizado cuando está disponible"}</span><button className="button button-secondary" type="button" onClick={onClose}>Cerrar</button>{canDownload ? <button className="button button-secondary" type="button" onClick={() => void downloadOriginal()}><Download size={16} /> Descargar original</button> : null}{canDownload && !spreadsheet ? <button className="button button-secondary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("image")}><FileImage size={16} /> {exporting === "image" ? "Generando…" : "Descargar imagen"}</button> : null}{canDownload && !spreadsheet ? <button className="button button-primary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("pdf")}><Download size={16} /> {exporting === "pdf" ? "Generando…" : "Descargar PDF preview"}</button> : null}</footer></ModalShell>;
}

export function DocumentHistoryModal({ document, canRestore, onClose, onRestore }: { document: ControlledDocument; canRestore: boolean; onClose: () => void; onRestore: () => Promise<void> }) {
  const [restoring, setRestoring] = useState(false); const [error, setError] = useState(""); const [historicalId, setHistoricalId] = useState<string | null>(null);
  const historical = document.versions.find(version => version.id === historicalId);
  if (historical) return <DocumentPreviewModal document={{ ...document, versions: [historical] }} canDownload onClose={() => setHistoricalId(null)} />;
  return <ModalShell title="Historial" eyebrow={document.code} onClose={onClose} className="document-history-modal"><div className="document-history-sections"><section><h4>Versiones</h4><div className="document-history-list">{[...document.versions].sort((a, b) => b.revision - a.revision).map((version) => <article key={version.id}><span className="document-history-revision">{documentVersionLabel(version)}</span><div><strong>{version.fileName}</strong><small>{version.changeReason}</small>{version.changeSummary ? <small>{version.changeSummary}</small> : null}<small>{version.uploadedBy} · {formatDate(version.modifiedAt)}</small></div><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span><button type="button" className="document-icon-action" aria-label={"Consultar archivo histórico " + version.fileName} title="Consultar archivo histórico" onClick={() => setHistoricalId(version.id)}><Eye size={15} /></button></article>)}</div></section><section><h4>Actividad</h4><div className="document-activity-list">{(document.activity ?? []).map((event) => <article key={event.id}><span>{formatDate(event.performedAt)}</span><strong>{event.performedBy}</strong><span>{eventLabels[event.eventType]}</span>{event.reason ? <small>{event.reason}</small> : null}</article>)}{!document.activity?.length ? <p>La actividad ampliada aparecerá al sincronizar la migración.</p> : null}</div></section>{document.lifecycle?.isDeleted ? <section className="document-restore-panel"><div><strong>Documento eliminado</strong><span>Motivo: {document.lifecycle.deleteReason}</span><span>Usuario: {document.lifecycle.deletedBy}</span><span>Fecha: {document.lifecycle.deletedAt ? formatDate(document.lifecycle.deletedAt) : "—"}</span></div>{canRestore ? <button className="button button-secondary" type="button" disabled={restoring} onClick={() => { setRestoring(true); setError(""); void onRestore().catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible restaurar."); setRestoring(false); }); }}><RotateCcw size={16} /> {restoring ? "Enviando…" : "Solicitar recuperación"}</button> : null}</section> : null}{error ? <p className="document-upload-error" role="alert">{error}</p> : null}</div></ModalShell>;
}

function RejectDocumentModal({ document, onClose, onReject }: { document: ControlledDocument; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [submitting, setSubmitting] = useState(false); const [rejectError, setRejectError] = useState("");
  return <ModalShell title="Rechazar revisión" eyebrow={document.code} onClose={onClose} className="document-reject-modal"><form onSubmit={(event) => { event.preventDefault(); if (!reason.trim() || submitting) return; setSubmitting(true); setRejectError(""); void onReject(reason).catch((error) => { setRejectError(error instanceof Error ? error.message : "No fue posible rechazar el documento."); setSubmitting(false); }); }}><div className="document-reject-copy"><ShieldCheck size={21} /><p>La revisión regresará al responsable de carga. La versión vigente, si existe, no cambia.</p></div><label>Observación obligatoria<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica qué debe corregirse antes de volver a validar" /></label>{rejectError ? <p className="document-upload-error" role="alert">{rejectError}</p> : null}<footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className="button document-reject-button" type="submit" disabled={!reason.trim() || submitting}><XCircle size={16} /> {submitting ? "Rechazando…" : "Rechazar"}</button></footer></form></ModalShell>;
}

function ModalShell({ title, eyebrow, onClose, className, children }: { title: string; eyebrow: string; onClose: () => void; className: string; children: React.ReactNode }) { return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className={`quality-modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><span>{eyebrow}</span><h3>{title}</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>{children}</section></div>; }
function ModalFooter({ onClose, submitting, submitLabel, icon, disabled, danger = false }: { onClose: () => void; submitting: boolean; submitLabel: string; icon: React.ReactNode; disabled?: boolean; danger?: boolean }) { return <footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className={`button ${danger ? "document-reject-button" : "button-primary"}`} type="submit" disabled={submitting || disabled}>{icon} {submitLabel}</button></footer>; }
function formatDate(value: string) { return dateFormatter.format(new Date(value)); }
function now() { return new Date().toISOString(); }
