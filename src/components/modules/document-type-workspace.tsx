"use client";

import {
  ArrowLeft,
  Check,
  Clock3,
  Download,
  Eye,
  FileImage,
  FilePlus2,
  FileText,
  History,
  LayoutDashboard,
  Pencil,
  Send,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import {
  DocumentPreviewViewer,
  type DocumentPreviewViewerHandle,
} from "@/components/modules/document-preview-viewer";

import {
  approveDocumentVersion,
  createDocumentRevision,
  getWorkingVersion,
  rejectDocumentVersion,
  submitDocumentVersion,
  type ControlledDocument,
  type ControlledDocumentStatus,
  type DocumentPermissions,
} from "@/lib/document-control-data";
import type { DocumentType } from "@/lib/document-data";
import { documentValidatorByProcess } from "@/lib/document-data";
import {
  reviewStoredDocumentVersion,
  uploadPendingControlledDocument,
} from "@/lib/document-storage";
import type { ProcessCatalogItem } from "@/lib/configuration-data";
import type { ActiveSession } from "@/lib/session-data";

const statusLabels: Record<ControlledDocumentStatus, string> = {
  draft: "Borrador",
  pending: "En validación",
  current: "Vigente",
  rejected: "Rechazado",
  obsolete: "Obsoleto",
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Mexico_City",
});

export function DocumentTypeWorkspace({
  process,
  documentType,
  documents,
  permissions,
  session,
  onBack,
  onOpenForm,
  onChangeDocument,
  onAddDocument,
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const preview = documents.find((item) => item.id === previewId) ?? null;
  const history = documents.find((item) => item.id === historyId) ?? null;
  const rejecting = documents.find((item) => item.id === rejectId) ?? null;

  async function approvePendingDocument(document: ControlledDocument) {
    const pending = document.versions.find((version) => version.status === "pending");
    if (!pending || reviewingId) return;
    setReviewingId(pending.id);
    try {
      await reviewStoredDocumentVersion(pending.id, "approve");
      onChangeDocument(approveDocumentVersion(document, session.name, now()));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No fue posible autorizar el documento.");
    } finally {
      setReviewingId(null);
    }
  }

  async function rejectPendingDocument(document: ControlledDocument, reason: string) {
    const pending = document.versions.find((version) => version.status === "pending");
    if (!pending) return;
    await reviewStoredDocumentVersion(pending.id, "reject", reason);
    onChangeDocument(rejectDocumentVersion(document, reason, now()));
    setRejectId(null);
  }

  return (
    <>
      <header className="document-subview-header document-control-header">
        <button className="icon-button" type="button" onClick={onBack} title="Volver al expediente" aria-label="Volver al expediente">
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className="detail-eyebrow"><FileText size={14} /> {documentType.name} · {process.id}</span>
          <h3>{documentType.name}</h3>
          <p>{process.name} · Listado exclusivo de este tipo documental</p>
        </div>
        {permissions.upload ? (
          <button className="button button-primary" type="button" onClick={() => setUploadOpen(true)}>
            <Upload size={16} /> Cargar
          </button>
        ) : null}
      </header>

      <div className="document-control-summary">
        <span><strong>{documents.length}</strong> documentos</span>
        <span><Clock3 size={14} /> La fecha de modificación se registra automáticamente</span>
      </div>

      <div className="document-control-table-wrap">
        <table className="document-control-table">
          <thead>
            <tr>
              <th>Vista</th>
              <th>Documento</th>
              <th>Código</th>
              <th>Revisión</th>
              <th>Cargó</th>
              <th>Validador</th>
              <th>Fecha de modificación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => {
              const version = getWorkingVersion(document);
              if (!version) return null;
              const current = document.versions.find((item) => item.status === "current");
              return (
                <tr key={document.id}>
                  <td>
                    <button className="document-icon-action" type="button" title="Vista rápida" aria-label={`Vista rápida de ${document.name}`} onClick={() => setPreviewId(document.id)}>
                      <Eye size={15} />
                    </button>
                  </td>
                  <td className="document-name-cell">
                    <strong>{document.name}</strong>
                    <small>{document.owner}</small>
                    {current && current.id !== version.id ? <em>Rev. {current.revision} continúa vigente</em> : null}
                  </td>
                  <td><span className="document-code-chip">{document.code}</span></td>
                  <td><strong>Rev. {version.revision}</strong></td>
                  <td>{version.uploadedBy}</td>
                  <td>{version.validator}</td>
                  <td>{formatDate(version.modifiedAt)}</td>
                  <td><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span></td>
                  <td>
                    <div className="document-row-actions">
                      {document.appFormId ? (
                        <button type="button" title="Abrir dashboard del formulario" aria-label="Abrir dashboard del formulario" onClick={() => onOpenForm(document.appFormId!)}>
                          <LayoutDashboard size={15} />
                        </button>
                      ) : null}
                      {permissions.edit && version.status === "current" ? (
                        <button type="button" title="Crear nueva revisión" aria-label="Crear nueva revisión" onClick={() => onChangeDocument(createDocumentRevision(document, session.name, now()))}>
                          <Pencil size={15} />
                        </button>
                      ) : null}
                      {permissions.submit && ["draft", "rejected"].includes(version.status) ? (
                        <button type="button" title="Enviar a validación" aria-label="Enviar a validación" onClick={() => onChangeDocument(submitDocumentVersion(document, now()))}>
                          <Send size={15} />
                        </button>
                      ) : null}
                      {permissions.validate && version.status === "pending" ? (
                        <>
                          <button className="approve" type="button" title="Aprobar y publicar" aria-label="Aprobar y publicar" disabled={reviewingId === version.id} onClick={() => void approvePendingDocument(document)}>
                            <Check size={15} />
                          </button>
                          <button className="reject" type="button" title="Rechazar con observación" aria-label="Rechazar con observación" onClick={() => setRejectId(document.id)}>
                            <XCircle size={15} />
                          </button>
                        </>
                      ) : null}
                      {permissions.history ? (
                        <button type="button" title="Historial de versiones" aria-label="Historial de versiones" onClick={() => setHistoryId(document.id)}>
                          <History size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!documents.length ? (
              <tr className="document-empty-row">
                <td colSpan={9}>
                  <FileText size={22} />
                  <strong>Sin {documentType.name.toLocaleLowerCase("es-MX")} en {process.name}</strong>
                  <span>La tabla pertenece únicamente a {process.id} y conserva sus propias columnas de control.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {uploadOpen ? (
        <UploadDocumentModal
          process={process}
          documentType={documentType}
          session={session}
          onClose={() => setUploadOpen(false)}
          onSubmit={(document) => {
            onAddDocument(document);
            setUploadOpen(false);
          }}
        />
      ) : null}
      {preview ? <DocumentPreviewModal document={preview} canDownload={permissions.download} onClose={() => setPreviewId(null)} /> : null}
      {history && permissions.history ? <DocumentHistoryModal document={history} onClose={() => setHistoryId(null)} /> : null}
      {rejecting ? (
        <RejectDocumentModal
          document={rejecting}
          onClose={() => setRejectId(null)}
          onReject={(reason) => rejectPendingDocument(rejecting, reason)}
        />
      ) : null}
    </>
  );
}

function UploadDocumentModal({
  process,
  documentType,
  session,
  onClose,
  onSubmit,
}: {
  process: ProcessCatalogItem;
  documentType: DocumentType;
  session: ActiveSession;
  onClose: () => void;
  onSubmit: (document: ControlledDocument) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const validator = documentValidatorByProcess[process.id]?.name ?? "Jefatura del área";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !code.trim() || !file || submitting) return;
    setSubmitting(true);
    setUploadError("");
    try {
      onSubmit(await uploadPendingControlledDocument({
        processId: process.id,
        documentTypeId: documentType.id,
        code,
        name,
        revision,
        file,
        session,
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No fue posible cargar el documento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-control-modal" role="dialog" aria-modal="true" aria-labelledby="upload-document-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{process.id} · {documentType.name}</span><h3 id="upload-document-title">Cargar documento</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={submit}>
          <div className="document-modal-grid">
            <label className="wide">Nombre oficial<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Código<input required value={code} onChange={(event) => setCode(event.target.value)} placeholder={`${documentType.code}-${process.id.slice(2)}-01`} /></label>
            <label>Revisión<input required min={0} type="number" value={revision} onChange={(event) => setRevision(Number(event.target.value))} /></label>
            <label className="wide">Autoriza<input readOnly value={validator} /></label>
            <label>Responsable de carga<input readOnly value={session.name} /></label>
            <label>Fecha de modificación<input readOnly value="Se asigna al cargar" /></label>
            <label className="wide document-file-input"><span>Archivo</span><input required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{file?.name || "Selecciona el archivo controlado (máximo 50 MB)"}</small></label>
          </div>
          {uploadError ? <p className="document-upload-error" role="alert">{uploadError}</p> : null}
          <footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting || !file}><FilePlus2 size={16} /> {submitting ? "Cargando…" : "Cargar y enviar a autorización"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function DocumentPreviewModal({ document, canDownload, onClose }: { document: ControlledDocument; canDownload: boolean; onClose: () => void }) {
  const version = getWorkingVersion(document);
  const viewerRef = useRef<DocumentPreviewViewerHandle>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  if (!version) return null;

  async function exportPreview(format: "image" | "pdf") {
    if (!viewerRef.current || exporting) return;
    setExporting(format);
    try {
      if (format === "image") await viewerRef.current.downloadImage();
      if (format === "pdf") await viewerRef.current.downloadPdf();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No fue posible exportar la vista.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-preview-modal" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{document.code} · Rev. {version.revision}</span><h3 id="document-preview-title">Vista rápida</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <div className="secure-document-preview-body">
          <div className="secure-preview-metadata">
            <span><strong>{document.name}</strong><small>{version.fileName}</small></span>
            <span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span>
            <span><small>Autoriza</small><strong>{version.validator}</strong></span>
            <span><small>Modificación</small><strong>{formatDate(version.modifiedAt)}</strong></span>
          </div>
          <DocumentPreviewViewer
            code={document.code}
            onReadyChange={setPreviewReady}
            ref={viewerRef}
            version={version}
          />
          {version.rejectionReason ? <div className="document-rejection-note"><XCircle size={16} /><span><strong>Observación de rechazo</strong>{version.rejectionReason}</span></div> : null}
        </div>
        <footer>
          <span className="secure-preview-protection">Solo lectura · El formato original no se descarga</span>
          <button className="button button-secondary" type="button" onClick={onClose}>Cerrar</button>
          {canDownload ? <button className="button button-secondary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("image")}><FileImage size={16} /> {exporting === "image" ? "Generando…" : "Descargar imagen"}</button> : null}
          {canDownload ? <button className="button button-primary" type="button" disabled={!previewReady || exporting !== null} onClick={() => void exportPreview("pdf")}><Download size={16} /> {exporting === "pdf" ? "Generando…" : "Descargar PDF"}</button> : null}
        </footer>
      </section>
    </div>
  );
}

function DocumentHistoryModal({ document, onClose }: { document: ControlledDocument; onClose: () => void }) {
  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-history-modal" role="dialog" aria-modal="true" aria-labelledby="document-history-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Solo administrador · {document.code}</span><h3 id="document-history-title">Historial de versiones</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <div className="document-history-list">
          {[...document.versions].sort((a, b) => b.revision - a.revision).map((version) => (
            <article key={version.id}>
              <span className="document-history-revision">Rev. {version.revision}</span>
              <div><strong>{version.fileName}</strong><small>{version.changeReason}</small><small>{version.uploadedBy} · {formatDate(version.modifiedAt)}</small></div>
              <span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function RejectDocumentModal({ document, onClose, onReject }: { document: ControlledDocument; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState("");
  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-reject-modal" role="dialog" aria-modal="true" aria-labelledby="reject-document-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{document.code}</span><h3 id="reject-document-title">Rechazar revisión</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim() || submitting) return;
          setSubmitting(true);
          setRejectError("");
          void onReject(reason).catch((error) => {
            setRejectError(error instanceof Error ? error.message : "No fue posible rechazar el documento.");
            setSubmitting(false);
          });
        }}>
          <div className="document-reject-copy"><ShieldCheck size={21} /><p>La revisión regresará al responsable de carga. La versión vigente, si existe, no cambia.</p></div>
          <label>Observación obligatoria<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica qué debe corregirse antes de volver a validar" /></label>
          {rejectError ? <p className="document-upload-error" role="alert">{rejectError}</p> : null}
          <footer><button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>Cancelar</button><button className="button document-reject-button" type="submit" disabled={!reason.trim() || submitting}><XCircle size={16} /> {submitting ? "Rechazando…" : "Rechazar"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function now() {
  return new Date().toISOString();
}
