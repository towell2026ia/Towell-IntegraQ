"use client";

import {
  ArrowLeft, Check, Clock3, Download, Eye, FileImage, FilePlus2, FileText,
  History, LayoutDashboard, MoreVertical, Pencil, RotateCcw, Send, ShieldCheck,
  Upload, X, XCircle,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { DocumentPreviewViewer, type DocumentPreviewViewerHandle } from "@/components/modules/document-preview-viewer";
import type { ProcessCatalogItem } from "@/lib/configuration-data";
import {
  approveDocumentVersion, documentAdvancedActionsEnabled, getWorkingVersion, obsoleteControlledDocument,
  rejectDocumentVersion, restoreControlledDocument, softDeleteControlledDocument,
  submitDocumentVersion, type ControlledDocument, type ControlledDocumentStatus,
  type DocumentAuditEventType, type DocumentPermissions,
} from "@/lib/document-control-data";
import type { DocumentType } from "@/lib/document-data";
import { documentValidatorByProcess } from "@/lib/document-data";
import {
  editStoredDocumentMetadata, obsoleteStoredDocument, restoreStoredDocument,
  reviewStoredDocumentVersion, softDeleteStoredDocument, submitStoredDocumentVersion,
  uploadNewControlledDocumentVersion, uploadPendingControlledDocument,
} from "@/lib/document-storage";
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
  const selected = (id: string | null) => documents.find((item) => item.id === id) ?? null;
  const preview = selected(previewId);
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
    if (!pending || reviewingId) return;
    setReviewingId(pending.id);
    try {
      await reviewStoredDocumentVersion(pending.id, "approve");
      onChangeDocument(approveDocumentVersion(document, session.name, now()));
      announce("Versión aprobada y publicada correctamente.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No fue posible autorizar el documento.");
    } finally { setReviewingId(null); }
  }

  async function rejectPendingDocument(document: ControlledDocument, reason: string) {
    const pending = document.versions.find((version) => version.status === "pending");
    if (!pending) return;
    await reviewStoredDocumentVersion(pending.id, "reject", reason);
    onChangeDocument(rejectDocumentVersion(document, reason, now()));
    setRejectId(null);
    announce("Versión rechazada con observación.");
  }

  async function submitWorkingVersion(document: ControlledDocument) {
    const working = getWorkingVersion(document);
    if (!working) return;
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
    <div className="document-control-summary"><span><strong>{documents.length}</strong> documentos</span><span><Clock3 size={14} /> La fecha de modificación se registra automáticamente</span></div>
    <div className="document-control-table-wrap"><table className="document-control-table">
      <thead><tr><th>Vista</th><th>Documento</th><th>Código</th><th>Revisión</th><th>Cargó</th><th>Validador</th><th>Fecha de modificación</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>
        {documents.map((document) => {
          const version = getWorkingVersion(document);
          if (!version) return null;
          const current = document.versions.find((item) => item.status === "current");
          const canCreateVersion = permissions.version && !document.versions.some((item) => ["draft", "pending"].includes(item.status));
          return <tr key={document.id}>
            <td><button className="document-icon-action" type="button" title="Vista rápida" aria-label={`Vista rápida de ${document.name}`} onClick={() => setPreviewId(document.id)}><Eye size={15} /></button></td>
            <td className="document-name-cell"><strong>{document.name}</strong><small>{document.owner}</small>{current && current.id !== version.id ? <em>Rev. {current.revision} continúa vigente</em> : null}</td>
            <td><span className="document-code-chip">{document.code}</span></td><td><strong>Rev. {version.revision}</strong></td><td>{version.uploadedBy}</td><td>{version.validator}</td><td>{formatDate(version.modifiedAt)}</td>
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
                  {permissions.version ? <button type="button" disabled={!canCreateVersion} onClick={() => { setVersionId(document.id); setMenuId(null); }}>Nueva versión</button> : null}
                  {permissions.obsolete ? <button type="button" disabled={!current} onClick={() => { setObsoleteId(document.id); setMenuId(null); }}>Obsoletizar</button> : null}
                  {permissions.delete ? <button className="danger" type="button" onClick={() => { setDeleteId(document.id); setMenuId(null); }}>Eliminar</button> : null}
                </div> : null}
              </div> : null}
            </div></td>
          </tr>;
        })}
        {!documents.length ? <tr className="document-empty-row"><td colSpan={9}><FileText size={22} /><strong>Sin {documentType.name.toLocaleLowerCase("es-MX")} en {process.name}</strong><span>La tabla pertenece únicamente a {process.id} y conserva sus propias columnas de control.</span></td></tr> : null}
      </tbody>
    </table></div>

    {uploadOpen ? <UploadDocumentModal process={process} documentType={documentType} session={session} onClose={() => setUploadOpen(false)} onSubmit={(document) => { onAddDocument(document); setUploadOpen(false); announce("Documento cargado correctamente."); }} /> : null}
    {preview ? <DocumentPreviewModal document={preview} canDownload={permissions.download} onClose={() => setPreviewId(null)} /> : null}
    {history && permissions.history ? <DocumentHistoryModal document={history} canRestore={permissions.restore} onClose={() => setHistoryId(null)} onRestore={async () => { await restoreStoredDocument(history.id); onChangeDocument(restoreControlledDocument(history, session.name, now())); announce("Documento restaurado correctamente."); }} /> : null}
    {rejecting ? <RejectDocumentModal document={rejecting} onClose={() => setRejectId(null)} onReject={(reason) => rejectPendingDocument(rejecting, reason)} /> : null}
    {editing ? <EditDocumentModal document={editing} documentType={documentType} onClose={() => setEditId(null)} onSave={async (values) => { await editStoredDocumentMetadata({ documentId: editing.id, ...values }); onChangeDocument({ ...editing, ...values, activity: [{ id: `${editing.id}-edit-${Date.now()}`, eventType: "DOCUMENT_EDITED", performedBy: session.name, performedAt: now() }, ...(editing.activity ?? [])] }); setEditId(null); announce("Metadata actualizada correctamente."); }} /> : null}
    {versioning ? <NewVersionModal document={versioning} session={session} onClose={() => setVersionId(null)} onCreate={async (version) => { onChangeDocument({ ...versioning, versions: [version, ...versioning.versions], activity: [{ id: `${versioning.id}-version-${Date.now()}`, eventType: "VERSION_CREATED", performedBy: session.name, performedAt: version.modifiedAt, reason: version.changeReason, versionId: version.id }, ...(versioning.activity ?? [])] }); setVersionId(null); announce("Nueva versión creada correctamente."); }} /> : null}
    {obsoleting ? <LifecycleReasonModal mode="obsolete" document={obsoleting} documents={documents} onClose={() => setObsoleteId(null)} onConfirm={async (reason, replacementId) => { await obsoleteStoredDocument(obsoleting.id, reason, replacementId); onChangeDocument(obsoleteControlledDocument(obsoleting, session.name, reason, now(), replacementId)); setObsoleteId(null); announce("Documento marcado como obsoleto."); }} /> : null}
    {deleting ? <LifecycleReasonModal mode="delete" document={deleting} documents={documents} onClose={() => setDeleteId(null)} onConfirm={async (reason) => { await softDeleteStoredDocument(deleting.id, reason); onChangeDocument(softDeleteControlledDocument(deleting, session.name, reason, now())); setDeleteId(null); announce("Documento eliminado de las vistas operativas. El historial permanece conservado."); }} /> : null}
  </>;
}

function UploadDocumentModal({ process, documentType, session, onClose, onSubmit }: { process: ProcessCatalogItem; documentType: DocumentType; session: ActiveSession; onClose: () => void; onSubmit: (document: ControlledDocument) => void }) {
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [revision, setRevision] = useState(0); const [file, setFile] = useState<File | null>(null); const [submitting, setSubmitting] = useState(false); const [uploadError, setUploadError] = useState("");
  const validator = documentValidatorByProcess[process.id]?.name ?? "Jefatura del área";
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!name.trim() || !code.trim() || !file || submitting) return; setSubmitting(true); setUploadError(""); try { onSubmit(await uploadPendingControlledDocument({ processId: process.id, documentTypeId: documentType.id, code, name, revision, file, session })); } catch (error) { setUploadError(error instanceof Error ? error.message : "No fue posible cargar el documento."); setSubmitting(false); } }
  return <ModalShell title="Cargar documento" eyebrow={`${process.id} · ${documentType.name}`} onClose={onClose} className="document-control-modal"><form onSubmit={submit}><div className="document-modal-grid"><label className="wide">Nombre oficial<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Código<input required value={code} onChange={(event) => setCode(event.target.value)} placeholder={`${documentType.code}-${process.id.slice(2)}-01`} /></label><label>Revisión<input required min={0} type="number" value={revision} onChange={(event) => setRevision(Number(event.target.value))} /></label><label className="wide">Autoriza<input readOnly value={validator} /></label><label>Responsable de carga<input readOnly value={session.name} /></label><label>Fecha de modificación<input readOnly value="Se asigna al cargar" /></label><label className="wide document-file-input"><span>Archivo</span><input required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{file?.name || "Selecciona el archivo controlado (máximo 50 MB)"}</small></label></div>{uploadError ? <p className="document-upload-error" role="alert">{uploadError}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel={submitting ? "Cargando…" : "Cargar y enviar a autorización"} icon={<FilePlus2 size={16} />} disabled={!file} /></form></ModalShell>;
}

function EditDocumentModal({ document, documentType, onClose, onSave }: { document: ControlledDocument; documentType: DocumentType; onClose: () => void; onSave: (values: { name: string; description?: string; processId: string; documentTypeId: string; ownerId?: string; owner: string; code: string }) => Promise<void> }) {
  const [name, setName] = useState(document.name); const [description, setDescription] = useState(document.description ?? ""); const [owner, setOwner] = useState(document.owner); const [code, setCode] = useState(document.code); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  return <ModalShell title="Editar documento" eyebrow={document.code} onClose={onClose} className="document-control-modal"><form onSubmit={(event) => { event.preventDefault(); setSubmitting(true); setError(""); void onSave({ name: name.trim(), description: description.trim() || undefined, processId: document.processId, documentTypeId: documentType.id, ownerId: document.ownerId, owner: owner.trim(), code: code.trim().toUpperCase() }).catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible editar el documento."); setSubmitting(false); }); }}><div className="document-modal-grid"><label className="wide">Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Código<input required value={code} onChange={(event) => setCode(event.target.value)} /></label><label>Responsable<input required value={owner} onChange={(event) => setOwner(event.target.value)} /></label><label className="wide">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="wide document-version-warning"><ShieldCheck size={18} /><span><strong>El archivo vigente no se modificará.</strong> Para reemplazarlo, utiliza Nueva versión.</span></div></div>{error ? <p className="document-upload-error" role="alert">{error}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel="Guardar cambios" icon={<Pencil size={16} />} disabled={!name.trim() || !owner.trim() || !code.trim()} /></form></ModalShell>;
}

function NewVersionModal({ document, session, onClose, onCreate }: { document: ControlledDocument; session: ActiveSession; onClose: () => void; onCreate: (version: Awaited<ReturnType<typeof uploadNewControlledDocumentVersion>>) => Promise<void> }) {
  const current = document.versions.find((version) => version.status === "current") ?? document.versions[0];
  const [revision, setRevision] = useState(Math.max(...document.versions.map((version) => version.revision), 0) + 1); const [file, setFile] = useState<File | null>(null); const [reason, setReason] = useState(""); const [summary, setSummary] = useState(""); const [comments, setComments] = useState(""); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  return <ModalShell title="Crear nueva versión" eyebrow={document.code} onClose={onClose} className="document-control-modal"><form onSubmit={(event) => { event.preventDefault(); if (!file) return; setSubmitting(true); setError(""); void uploadNewControlledDocumentVersion({ document, revision, file, changeReason: reason, changeSummary: summary, comments, session }).then(onCreate).catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible crear la versión."); setSubmitting(false); }); }}><div className="document-modal-grid"><label className="wide">Documento<input readOnly value={document.name} /></label><label>Código<input readOnly value={document.code} /></label><label>Versión vigente<input readOnly value={`Rev. ${current?.revision ?? "—"}`} /></label><label>Nueva versión<input required min={0} type="number" value={revision} onChange={(event) => setRevision(Number(event.target.value))} /></label><label>Proceso<input readOnly value={document.processId} /></label><label>Responsable<input readOnly value={document.owner} /></label><label className="wide document-file-input"><span>Archivo</span><input required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{file?.name || "Cada versión conserva un archivo independiente"}</small></label><label className="wide">Motivo del cambio<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="wide">Resumen de cambios<textarea required value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label className="wide">Comentarios (opcional)<textarea value={comments} onChange={(event) => setComments(event.target.value)} /></label></div>{error ? <p className="document-upload-error" role="alert">{error}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel={submitting ? "Creando…" : "Crear nueva versión"} icon={<FilePlus2 size={16} />} disabled={!file || !reason.trim() || !summary.trim()} /></form></ModalShell>;
}

function LifecycleReasonModal({ mode, document, documents, onClose, onConfirm }: { mode: "obsolete" | "delete"; document: ControlledDocument; documents: ControlledDocument[]; onClose: () => void; onConfirm: (reason: string, replacementId?: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [replacementId, setReplacementId] = useState(""); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const version = document.versions.find((item) => item.status === "current") ?? getWorkingVersion(document); const obsolete = mode === "obsolete";
  return <ModalShell title={obsolete ? "Declarar documento obsoleto" : "Eliminar documento"} eyebrow={document.code} onClose={onClose} className="document-reject-modal"><form onSubmit={(event) => { event.preventDefault(); setSubmitting(true); setError(""); void onConfirm(reason, replacementId || undefined).catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible completar la acción."); setSubmitting(false); }); }}><div className="document-lifecycle-copy"><ShieldCheck size={21} /><p>{obsolete ? "El documento dejará de mostrarse como vigente, pero permanecerá disponible en el historial." : "Esta acción retirará el documento de las vistas operativas. El registro y sus archivos permanecerán conservados para trazabilidad y auditoría."}</p></div><div className="document-modal-grid"><label>Código<input readOnly value={document.code} /></label><label>Versión<input readOnly value={`Rev. ${version?.revision ?? "—"}`} /></label><label className="wide">Nombre<input readOnly value={document.name} /></label><label className="wide">Motivo {obsolete ? "de obsolescencia" : "de eliminación"}<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label>{obsolete ? <label className="wide">Documento que lo sustituye (opcional)<select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">Ninguno</option>{documents.filter((item) => item.id !== document.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label> : null}</div>{error ? <p className="document-upload-error" role="alert">{error}</p> : null}<ModalFooter onClose={onClose} submitting={submitting} submitLabel={obsolete ? "Obsoletizar" : "Eliminar"} icon={obsolete ? <History size={16} /> : <XCircle size={16} />} disabled={!reason.trim()} danger={!obsolete} /></form></ModalShell>;
}

function DocumentPreviewModal({ document, canDownload, onClose }: { document: ControlledDocument; canDownload: boolean; onClose: () => void }) {
  const version = getWorkingVersion(document); const viewerRef = useRef<DocumentPreviewViewerHandle>(null); const [previewReady, setPreviewReady] = useState(false); const [exporting, setExporting] = useState<"image" | "pdf" | null>(null); if (!version) return null;
  async function exportPreview(format: "image" | "pdf") { if (!viewerRef.current || exporting) return; setExporting(format); try { if (format === "image") await viewerRef.current.downloadImage(); if (format === "pdf") await viewerRef.current.downloadPdf(); } catch (error) { window.alert(error instanceof Error ? error.message : "No fue posible exportar la vista."); } finally { setExporting(null); } }
  return <ModalShell title="Vista rápida" eyebrow={`${document.code} · Rev. ${version.revision}`} onClose={onClose} className="document-preview-modal"><div className="secure-document-preview-body"><div className="secure-preview-metadata"><span><strong>{document.name}</strong><small>{version.fileName}</small></span><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span><span><small>Autoriza</small><strong>{version.validator}</strong></span><span><small>Modificación</small><strong>{formatDate(version.modifiedAt)}</strong></span></div><DocumentPreviewViewer code={document.code} onReadyChange={setPreviewReady} ref={viewerRef} version={version} />{version.rejectionReason ? <div className="document-rejection-note"><XCircle size={16} /><span><strong>Observación de rechazo</strong>{version.rejectionReason}</span></div> : null}</div><footer><span className="secure-preview-protection">Solo lectura · El formato original no se descarga</span><button className="button button-secondary" type="button" onClick={onClose}>Cerrar</button>{canDownload ? <button className="button button-secondary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("image")}><FileImage size={16} /> {exporting === "image" ? "Generando…" : "Descargar imagen"}</button> : null}{canDownload ? <button className="button button-primary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("pdf")}><Download size={16} /> {exporting === "pdf" ? "Generando…" : "Descargar PDF"}</button> : null}</footer></ModalShell>;
}

export function DocumentHistoryModal({ document, canRestore, onClose, onRestore }: { document: ControlledDocument; canRestore: boolean; onClose: () => void; onRestore: () => Promise<void> }) {
  const [restoring, setRestoring] = useState(false); const [error, setError] = useState("");
  return <ModalShell title="Historial" eyebrow={document.code} onClose={onClose} className="document-history-modal"><div className="document-history-sections"><section><h4>Versiones</h4><div className="document-history-list">{[...document.versions].sort((a, b) => b.revision - a.revision).map((version) => <article key={version.id}><span className="document-history-revision">Rev. {version.revision}</span><div><strong>{version.fileName}</strong><small>{version.changeReason}</small>{version.changeSummary ? <small>{version.changeSummary}</small> : null}<small>{version.uploadedBy} · {formatDate(version.modifiedAt)}</small></div><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span></article>)}</div></section><section><h4>Actividad</h4><div className="document-activity-list">{(document.activity ?? []).map((event) => <article key={event.id}><span>{formatDate(event.performedAt)}</span><strong>{event.performedBy}</strong><span>{eventLabels[event.eventType]}</span>{event.reason ? <small>{event.reason}</small> : null}</article>)}{!document.activity?.length ? <p>La actividad ampliada aparecerá al sincronizar la migración.</p> : null}</div></section>{document.lifecycle?.isDeleted ? <section className="document-restore-panel"><div><strong>Documento eliminado</strong><span>Motivo: {document.lifecycle.deleteReason}</span><span>Usuario: {document.lifecycle.deletedBy}</span><span>Fecha: {document.lifecycle.deletedAt ? formatDate(document.lifecycle.deletedAt) : "—"}</span></div>{canRestore ? <button className="button button-secondary" type="button" disabled={restoring} onClick={() => { setRestoring(true); setError(""); void onRestore().catch((caught) => { setError(caught instanceof Error ? caught.message : "No fue posible restaurar."); setRestoring(false); }); }}><RotateCcw size={16} /> {restoring ? "Restaurando…" : "Restaurar"}</button> : null}</section> : null}{error ? <p className="document-upload-error" role="alert">{error}</p> : null}</div></ModalShell>;
}

function RejectDocumentModal({ document, onClose, onReject }: { document: ControlledDocument; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [submitting, setSubmitting] = useState(false); const [rejectError, setRejectError] = useState("");
  return <ModalShell title="Rechazar revisión" eyebrow={document.code} onClose={onClose} className="document-reject-modal"><form onSubmit={(event) => { event.preventDefault(); if (!reason.trim() || submitting) return; setSubmitting(true); setRejectError(""); void onReject(reason).catch((error) => { setRejectError(error instanceof Error ? error.message : "No fue posible rechazar el documento."); setSubmitting(false); }); }}><div className="document-reject-copy"><ShieldCheck size={21} /><p>La revisión regresará al responsable de carga. La versión vigente, si existe, no cambia.</p></div><label>Observación obligatoria<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica qué debe corregirse antes de volver a validar" /></label>{rejectError ? <p className="document-upload-error" role="alert">{rejectError}</p> : null}<footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className="button document-reject-button" type="submit" disabled={!reason.trim() || submitting}><XCircle size={16} /> {submitting ? "Rechazando…" : "Rechazar"}</button></footer></form></ModalShell>;
}

function ModalShell({ title, eyebrow, onClose, className, children }: { title: string; eyebrow: string; onClose: () => void; className: string; children: React.ReactNode }) { return <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}><section className={`quality-modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><span>{eyebrow}</span><h3>{title}</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>{children}</section></div>; }
function ModalFooter({ onClose, submitting, submitLabel, icon, disabled, danger = false }: { onClose: () => void; submitting: boolean; submitLabel: string; icon: React.ReactNode; disabled?: boolean; danger?: boolean }) { return <footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className={`button ${danger ? "document-reject-button" : "button-primary"}`} type="submit" disabled={submitting || disabled}>{icon} {submitLabel}</button></footer>; }
function formatDate(value: string) { return dateFormatter.format(new Date(value)); }
function now() { return new Date().toISOString(); }
