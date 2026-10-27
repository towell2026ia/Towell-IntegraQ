"use client";


import {
  Download,
  Eye,
  FileImage,
  FileText,
  History,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DocumentPreviewViewer } from "@/components/modules/document-preview-viewer";

import {
  getAttachmentSignedUrl,
  getReferencedAttachment,
  mergeReferencedAttachment,
  listAttachments,
  softDeleteAttachment,
  uploadAttachment,
  type AttachmentRecord,
} from "@/lib/attachment-storage";
import type { WorkspaceModuleId } from "@/lib/navigation";

export interface EvidencePermissions {
  read: boolean;
  add: boolean;
  replace: boolean;
  delete: boolean;
  history: boolean;
}

export function EvidenceManager({
  moduleId,
  resourceType,
  resourceKey,
  processId,
  permissions,
  title = "Evidencias",
  description = "Consulta y carga son acciones independientes",
  addLabel = "Agregar evidencia",
  onChange,
  referencedFileId,
  viewLabel = "Ver",
}: {
  moduleId: WorkspaceModuleId;
  resourceType: string;
  resourceKey: string;
  processId?: string;
  permissions: EvidencePermissions;
  title?: string;
  description?: string;
  addLabel?: string;
  onChange?: (attachments: AttachmentRecord[]) => void;
  referencedFileId?: string;
  viewLabel?: string;
}) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [history, setHistory] = useState<AttachmentRecord[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [previewing, setPreviewing] = useState<AttachmentRecord | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const scope = { moduleId, resourceType, resourceKey, processId };

  const refresh = useCallback(async () => {
    if (!permissions.read) return;
    setError("");
    try {
      const listed = await listAttachments(scope);
      const referenced = referencedFileId ? await getReferencedAttachment(referencedFileId, moduleId) : null;
      const current = mergeReferencedAttachment(listed, referenced);
      setAttachments(current);
      onChange?.(current);
      if (historyVisible && permissions.history) setHistory(await listAttachments(scope, true));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible consultar las evidencias.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyVisible, moduleId, permissions.history, permissions.read, processId, resourceKey, resourceType, referencedFileId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function upload(file: File | undefined, replace?: AttachmentRecord) {
    if (!file) return;
    if ((replace && !permissions.replace) || (!replace && !permissions.add)) {
      setError("Solo el administrador puede cargar o editar documentos.");
      return;
    }
    setBusy(replace?.id ?? "add"); setError("");
    try {
      await uploadAttachment(scope, file, replace);
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No fue posible cargar la evidencia.");
    } finally { setBusy(""); }
  }

  async function remove(attachment: AttachmentRecord) {
    if (!permissions.delete) {
      setError("Solo el administrador puede eliminar documentos.");
      return;
    }
    if (!window.confirm(`¿Deseas eliminar ${attachment.originalName}? El registro se conservará en el histórico.`)) return;
    setBusy(attachment.id); setError("");
    try {
      await softDeleteAttachment(attachment);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar la evidencia.");
    } finally { setBusy(""); }
  }

  if (!permissions.read) return null;
  return (
    <section className="evidence-manager">
      <header>
        <div><Paperclip size={17} /><span><strong>{title} ({attachments.length})</strong><small>{description}</small></span></div>
        <div>
          {permissions.history ? <button className="button button-secondary" type="button" onClick={() => setHistoryVisible((visible) => !visible)}><History size={15} /> Histórico</button> : null}
          {permissions.add ? <label className={`button button-primary file-button ${busy === "add" ? "disabled" : ""}`}><Plus size={15} /> {busy === "add" ? "Cargando…" : addLabel}<input disabled={Boolean(busy)} type="file" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label> : null}
        </div>
      </header>
      {error ? <div className="evidence-error" role="alert">{error}<button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Reintentar</button></div> : null}
      <div className="evidence-list">
        {attachments.map((attachment) => (
          <EvidenceCard viewLabel={viewLabel} attachment={attachment} busy={busy === attachment.id} key={attachment.id} onDelete={() => void remove(attachment)} onPreview={() => setPreviewing(attachment)} onReplace={(file) => void upload(file, attachment)} permissions={permissions} />
        ))}
        {!attachments.length && !error ? <div className="evidence-empty"><Paperclip size={20} /><span><strong>No hay archivos cargados</strong><small>El archivo original seguirá disponible aunque falle su preview.</small></span></div> : null}
      </div>
      {historyVisible && permissions.history ? <EvidenceHistory attachments={history} /> : null}
      {previewing ? <EvidencePreview attachment={previewing} onClose={() => setPreviewing(null)} /> : null}
    </section>
  );
}

function EvidenceCard({ attachment, busy, onDelete, onPreview, onReplace, permissions, viewLabel }: { attachment: AttachmentRecord; busy: boolean; onDelete: () => void; onPreview: () => void; onReplace: (file?: File) => void; permissions: EvidencePermissions; viewLabel: string }) {
  const image = attachment.mimeType.startsWith("image/");
  async function download() {
    const url = await getAttachmentSignedUrl(attachment);
    if (!url) return;
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = attachment.originalName; anchor.click();
  }
  return <article className="evidence-card">
    <span className="evidence-card-icon">{image ? <FileImage size={22} /> : <FileText size={22} />}</span>
    <span className="evidence-card-copy"><strong>{attachment.originalName}</strong><small>{fileKind(attachment)} · {formatBytes(attachment.sizeBytes)} · V{attachment.version}</small>{previewLabel(attachment)}</span>
    <span className="evidence-card-actions">
      <button className="button button-secondary" type="button" onClick={onPreview}><Eye size={15} /> {viewLabel}</button>
      <button className="button button-secondary" type="button" onClick={() => void download()}><Download size={15} /> Descargar</button>
      {permissions.replace && attachment.isCurrent ? <label className={`button button-secondary file-button ${busy ? "disabled" : ""}`}><Upload size={15} /> {busy ? "Editando…" : "Editar / reemplazar"}<input disabled={busy} type="file" onChange={(event) => { onReplace(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label> : null}
      {permissions.delete ? <button className="icon-button danger" disabled={busy} title="Eliminar" type="button" onClick={onDelete}><Trash2 size={16} /></button> : null}
    </span>
  </article>;
}

function EvidenceHistory({ attachments }: { attachments: AttachmentRecord[] }) {
  const historical = attachments.filter((attachment) => !attachment.isCurrent || attachment.deletedAt);
  return <section className="evidence-history"><header><History size={15} /><strong>Histórico de versiones</strong></header>{historical.length ? historical.map((attachment) => <div key={attachment.id}><span><strong>{attachment.originalName}</strong><small>V{attachment.version} · {formatDate(attachment.createdAt)}</small></span><span>{attachment.deletedAt ? "Eliminada" : "Reemplazada"}</span></div>) : <p>No existen versiones históricas.</p>}</section>;
}

export function EvidencePreview({ attachment, onClose }: { attachment: AttachmentRecord; onClose: () => void }) {
  const [error, setError] = useState("");
  const sourceUrl = useCallback((target: "original" | "preview") => getAttachmentSignedUrl(attachment, target), [attachment]);
  const onReadyChange = useCallback(() => undefined, []);
  const version = useMemo(() => ({
    id: attachment.id, revision: attachment.version, status: "current" as const,
    fileName: attachment.originalName, uploadedBy: attachment.uploadedBy, validator: "Evidencia",
    modifiedAt: attachment.createdAt, changeReason: "Consulta de evidencia existente",
    mimeType: attachment.mimeType, previewPath: attachment.previewPath ?? undefined,
    previewStatus: attachment.previewStatus, previewError: attachment.previewError ?? undefined,
  }), [attachment]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  async function download() {
    try {
      const url = await getAttachmentSignedUrl(attachment);
      if (!url) throw new Error("El original no está disponible con tus permisos.");
      const link = document.createElement("a"); link.href = url; link.download = attachment.originalName; link.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible descargar la evidencia."); }
  }
  return <div className="evidence-preview-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="evidence-preview-dialog" role="dialog" aria-modal="true" aria-label={"Vista de " + attachment.originalName} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><Paperclip size={17} /><span><strong>{attachment.originalName}</strong><small>Original privado · V{attachment.version}</small></span></div><button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={18} /></button></header>
      <nav><button type="button" onClick={() => void download()}><Download size={15} /> Descargar original</button></nav>
      {error ? <p className="evidence-error" role="alert">{error}</p> : null}
      <DocumentPreviewViewer code={attachment.resourceKey || attachment.id} version={version} sourceUrl={sourceUrl} onReadyChange={onReadyChange} />
    </section>
  </div>;
}

function previewLabel(attachment: AttachmentRecord) {
  if (attachment.previewStatus === "pending") return <em>Sin procesar</em>;
  if (attachment.previewStatus === "processing") return <em>Procesando preview</em>;
  if (attachment.previewStatus === "ready") return <em className="ready">Preview disponible</em>;
  if (attachment.previewStatus === "error") return <em className="error">Error de conversión</em>;
  return null;
}

function fileKind(attachment: AttachmentRecord) {
  if (attachment.mimeType.startsWith("image/")) return "Imagen";
  if (attachment.mimeType === "application/pdf") return "PDF";
  if (attachment.mimeType.includes("spreadsheet") || attachment.mimeType.includes("excel")) return "Excel";
  if (attachment.mimeType.includes("word")) return "Word";
  if (attachment.mimeType.includes("presentation") || attachment.mimeType.includes("powerpoint")) return "PowerPoint";
  return "Documento";
}

function formatBytes(value: number | null) {
  if (value == null) return "Tamaño no disponible";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
