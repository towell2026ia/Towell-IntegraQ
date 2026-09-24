"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  History,
  LoaderCircle,
  Maximize2,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import {
  getAttachmentSignedUrl,
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
  onChange,
}: {
  moduleId: WorkspaceModuleId;
  resourceType: string;
  resourceKey: string;
  processId?: string;
  permissions: EvidencePermissions;
  onChange?: (attachments: AttachmentRecord[]) => void;
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
      const current = await listAttachments(scope);
      setAttachments(current);
      onChange?.(current);
      if (historyVisible && permissions.history) setHistory(await listAttachments(scope, true));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible consultar las evidencias.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyVisible, moduleId, permissions.history, permissions.read, processId, resourceKey, resourceType]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function upload(file: File | undefined, replace?: AttachmentRecord) {
    if (!file) return;
    setBusy(replace?.id ?? "add"); setError("");
    try {
      await uploadAttachment(scope, file, replace);
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No fue posible cargar la evidencia.");
    } finally { setBusy(""); }
  }

  async function remove(attachment: AttachmentRecord) {
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
        <div><Paperclip size={17} /><span><strong>Evidencias ({attachments.length})</strong><small>Consulta y carga son acciones independientes</small></span></div>
        <div>
          {permissions.history ? <button className="button button-secondary" type="button" onClick={() => setHistoryVisible((visible) => !visible)}><History size={15} /> Histórico</button> : null}
          {permissions.add ? <label className={`button button-primary file-button ${busy === "add" ? "disabled" : ""}`}><Plus size={15} /> {busy === "add" ? "Cargando…" : "Agregar evidencia"}<input disabled={Boolean(busy)} type="file" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label> : null}
        </div>
      </header>
      {error ? <div className="evidence-error" role="alert">{error}<button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Reintentar</button></div> : null}
      <div className="evidence-list">
        {attachments.map((attachment) => (
          <EvidenceCard attachment={attachment} busy={busy === attachment.id} key={attachment.id} onDelete={() => void remove(attachment)} onPreview={() => setPreviewing(attachment)} onReplace={(file) => void upload(file, attachment)} permissions={permissions} />
        ))}
        {!attachments.length && !error ? <div className="evidence-empty"><Paperclip size={20} /><span><strong>No hay evidencias cargadas</strong><small>El archivo original seguirá disponible aunque falle su preview.</small></span></div> : null}
      </div>
      {historyVisible && permissions.history ? <EvidenceHistory attachments={history} /> : null}
      {previewing ? <EvidencePreview attachment={previewing} onClose={() => setPreviewing(null)} /> : null}
    </section>
  );
}

function EvidenceCard({ attachment, busy, onDelete, onPreview, onReplace, permissions }: { attachment: AttachmentRecord; busy: boolean; onDelete: () => void; onPreview: () => void; onReplace: (file?: File) => void; permissions: EvidencePermissions }) {
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
      <button className="button button-secondary" type="button" onClick={onPreview}><Eye size={15} /> Ver</button>
      <button className="button button-secondary" type="button" onClick={() => void download()}><Download size={15} /> Descargar</button>
      {permissions.replace ? <label className={`button button-secondary file-button ${busy ? "disabled" : ""}`}><Upload size={15} /> {busy ? "Reemplazando…" : "Reemplazar"}<input disabled={busy} type="file" onChange={(event) => { onReplace(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label> : null}
      {permissions.delete ? <button className="icon-button danger" disabled={busy} title="Eliminar" type="button" onClick={onDelete}><Trash2 size={16} /></button> : null}
    </span>
  </article>;
}

function EvidenceHistory({ attachments }: { attachments: AttachmentRecord[] }) {
  const historical = attachments.filter((attachment) => !attachment.isCurrent || attachment.deletedAt);
  return <section className="evidence-history"><header><History size={15} /><strong>Histórico de versiones</strong></header>{historical.length ? historical.map((attachment) => <div key={attachment.id}><span><strong>{attachment.originalName}</strong><small>V{attachment.version} · {formatDate(attachment.createdAt)}</small></span><span>{attachment.deletedAt ? "Eliminada" : "Reemplazada"}</span></div>) : <p>No existen versiones históricas.</p>}</section>;
}

function EvidencePreview({ attachment, onClose }: { attachment: AttachmentRecord; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf" || attachment.previewStatus === "ready";

  useEffect(() => {
    let active = true; let loadedPdf: PDFDocumentProxy | null = null;
    void (async () => {
      const signed = await getAttachmentSignedUrl(attachment, attachment.previewStatus === "ready" ? "preview" : "original");
      if (!signed) throw new Error("La vista previa aún no está disponible.");
      if (!active) return;
      setUrl(signed);
      if (isPdf) {
        const response = await fetch(signed, { cache: "no-store" });
        if (!response.ok) throw new Error("No fue posible abrir el PDF privado.");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadedPdf = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise;
        if (active) setPdf(loadedPdf);
      }
      if (active) setLoading(false);
    })().catch((loadError) => { if (active) { setError(loadError instanceof Error ? loadError.message : "No fue posible abrir la evidencia."); setLoading(false); } });
    return () => { active = false; if (loadedPdf) void loadedPdf.cleanup(); };
  }, [attachment, isPdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let active = true;
    void pdf.getPage(page).then(async (pdfPage) => {
      if (!active || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.35 * zoom });
      const canvas = canvasRef.current; const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width; canvas.height = viewport.height;
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    });
    return () => { active = false; };
  }, [page, pdf, zoom]);

  async function download() {
    const signed = await getAttachmentSignedUrl(attachment);
    if (!signed) return;
    const anchor = document.createElement("a"); anchor.href = signed; anchor.download = attachment.originalName; anchor.click();
  }

  return <div className="evidence-preview-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="evidence-preview-dialog" role="dialog" aria-modal="true" aria-label={`Vista de ${attachment.originalName}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><Paperclip size={17} /><span><strong>{attachment.originalName}</strong><small>{fileKind(attachment)} · Original privado</small></span></div><button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={18} /></button></header>
      <nav>
        {pdf ? <><button disabled={page <= 1} type="button" onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} /></button><span>Página {page} de {pdf.numPages}</span><button disabled={page >= pdf.numPages} type="button" onClick={() => setPage((current) => current + 1)}><ChevronRight size={15} /></button></> : null}
        {(pdf || isImage) ? <><button type="button" onClick={() => setZoom((current) => Math.max(.5, current - .25))}><ZoomOut size={15} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((current) => Math.min(3, current + .25))}><ZoomIn size={15} /></button><button type="button" onClick={() => setZoom(1)}><RotateCcw size={15} /> Restablecer</button><button type="button" onClick={() => setZoom(.85)}><Maximize2 size={15} /> Ajustar</button></> : null}
        <button type="button" onClick={() => void download()}><Download size={15} /> Descargar original</button>
        {url ? <a href={url} rel="noreferrer" target="_blank"><ExternalLink size={15} /> Nueva pestaña</a> : null}
      </nav>
      <div className="evidence-preview-viewport">
        {loading ? <div className="evidence-preview-state"><LoaderCircle className="spin" size={26} /> Preparando vista previa…</div> : null}
        {error ? <div className="evidence-preview-state"><FileText size={26} /><strong>No fue posible generar la vista previa</strong><span>{error} Puedes descargar el archivo original.</span></div> : null}
        {!loading && !error && isImage ? <img alt={attachment.originalName} src={url} style={{ transform: `scale(${zoom})` }} /> : null}
        {!loading && !error && pdf ? <canvas ref={canvasRef} /> : null}
        {!loading && !error && !isImage && !pdf ? <div className="evidence-preview-state"><FileText size={28} /><strong>{previewStateTitle(attachment)}</strong><span>{attachment.previewError || "El original está disponible para descarga mientras se genera el PDF normalizado."}</span></div> : null}
      </div>
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

function previewStateTitle(attachment: AttachmentRecord) {
  if (attachment.previewStatus === "processing") return "Preparando vista previa…";
  if (attachment.previewStatus === "error") return "Error de conversión";
  return "Vista previa pendiente";
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
