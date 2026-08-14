"use client";

import {
  ArrowLeft,
  Check,
  Clock3,
  Download,
  Eye,
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
import { useState, type FormEvent } from "react";

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
  const preview = documents.find((item) => item.id === previewId) ?? null;
  const history = documents.find((item) => item.id === historyId) ?? null;
  const rejecting = documents.find((item) => item.id === rejectId) ?? null;

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
                          <button className="approve" type="button" title="Aprobar y publicar" aria-label="Aprobar y publicar" onClick={() => onChangeDocument(approveDocumentVersion(document, session.name, now()))}>
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
          onReject={(reason) => {
            onChangeDocument(rejectDocumentVersion(rejecting, reason, now()));
            setRejectId(null);
          }}
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
  const [validator, setValidator] = useState("Gerencia de Calidad");
  const [fileName, setFileName] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !code.trim() || !fileName) return;
    const timestamp = now();
    const id = `DOC-${process.id}-${documentType.code}-${Date.now()}`;
    onSubmit({
      id,
      processId: process.id,
      documentTypeId: documentType.id,
      code: code.trim().toLocaleUpperCase("es-MX"),
      name: name.trim(),
      owner: session.department,
      versions: [{
        id: `${id}-R${revision}`,
        revision,
        status: "draft",
        fileName,
        uploadedBy: session.name,
        validator,
        modifiedAt: timestamp,
        changeReason: revision === 0 ? "Emisión inicial" : "Documento cargado para revisión",
      }],
    });
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
            <label className="wide">Validador<select value={validator} onChange={(event) => setValidator(event.target.value)}><option>Gerencia de Calidad</option><option>Dirección General</option><option>Responsable del proceso</option></select></label>
            <label>Responsable de carga<input readOnly value={session.name} /></label>
            <label>Fecha de modificación<input readOnly value="Se asigna al cargar" /></label>
            <label className="wide document-file-input"><span>Archivo</span><input required type="file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} /><small>{fileName || "Selecciona el archivo controlado"}</small></label>
          </div>
          <footer><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit"><FilePlus2 size={16} /> Crear borrador</button></footer>
        </form>
      </section>
    </div>
  );
}

function DocumentPreviewModal({ document, canDownload, onClose }: { document: ControlledDocument; canDownload: boolean; onClose: () => void }) {
  const version = getWorkingVersion(document);
  if (!version) return null;
  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-preview-modal" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{document.code} · Rev. {version.revision}</span><h3 id="document-preview-title">Vista rápida</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <div className="document-preview-body">
          <div className="document-preview-file"><FileText size={34} /><strong>{version.fileName}</strong><span>Vista documental</span></div>
          <dl>
            <div><dt>Documento</dt><dd>{document.name}</dd></div>
            <div><dt>Estado</dt><dd><span className={`document-status document-status-${version.status}`}>{statusLabels[version.status]}</span></dd></div>
            <div><dt>Responsable de carga</dt><dd>{version.uploadedBy}</dd></div>
            <div><dt>Validador</dt><dd>{version.validator}</dd></div>
            <div><dt>Fecha de modificación</dt><dd>{formatDate(version.modifiedAt)}</dd></div>
            <div><dt>Autorizó</dt><dd>{version.authorizedBy ?? "Pendiente"}</dd></div>
          </dl>
          {version.rejectionReason ? <div className="document-rejection-note"><XCircle size={16} /><span><strong>Observación de rechazo</strong>{version.rejectionReason}</span></div> : null}
        </div>
        <footer><button className="button button-secondary" type="button" onClick={onClose}>Cerrar</button>{canDownload ? <button className="button button-primary" type="button" onClick={() => downloadVersion(document, version)}><Download size={16} /> Descargar</button> : null}</footer>
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
              <button className="document-icon-action" type="button" title="Descargar esta versión" aria-label={`Descargar revisión ${version.revision}`} onClick={() => downloadVersion(document, version)}><Download size={15} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function RejectDocumentModal({ document, onClose, onReject }: { document: ControlledDocument; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal document-reject-modal" role="dialog" aria-modal="true" aria-labelledby="reject-document-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{document.code}</span><h3 id="reject-document-title">Rechazar revisión</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onReject(reason); }}>
          <div className="document-reject-copy"><ShieldCheck size={21} /><p>La revisión regresará al responsable de carga. La versión vigente, si existe, no cambia.</p></div>
          <label>Observación obligatoria<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica qué debe corregirse antes de volver a validar" /></label>
          <footer><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button document-reject-button" type="submit" disabled={!reason.trim()}><XCircle size={16} /> Rechazar</button></footer>
        </form>
      </section>
    </div>
  );
}

function downloadVersion(document: ControlledDocument, version: ReturnType<typeof getWorkingVersion>) {
  if (!version) return;
  const content = [document.name, document.code, `Revisión ${version.revision}`, `Archivo: ${version.fileName}`, `Estado: ${statusLabels[version.status]}`].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.code}-Rev${version.revision}.txt`;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function now() {
  return new Date().toISOString();
}
