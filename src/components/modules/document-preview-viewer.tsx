"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import type { WorkSheet } from "xlsx";
import { officeXml, loadPreviewBytes, previewIsPdf, previewScale, sheetWindow, wordPageSize, type PreviewFit } from "@/lib/document-preview";

import type { ControlledDocumentVersion } from "@/lib/document-control-data";
import { getControlledDocumentDownloadUrl } from "@/lib/document-storage";

export interface DocumentPreviewViewerHandle {
  downloadImage: () => Promise<void>;
  downloadPdf: () => Promise<void>;
}

interface DocumentPreviewViewerProps {
  code: string;
  version: ControlledDocumentVersion;
  onReadyChange: (ready: boolean) => void;
  sourceUrl?: (target: "original" | "preview") => Promise<string | null>;
}

type PreviewKind = "pdf" | "document" | "spreadsheet" | "image";
type SpreadsheetData = Record<string, WorkSheet>;

const spreadsheetExtensions = new Set(["xlsx", "xls", "xlsm", "xlsb"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

function fileExtension(fileName: string) {
  return fileName.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
}

function safeExportName(value: string) {
  return value.replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ._-]+/g, "-");
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const DocumentPreviewViewer = forwardRef<
  DocumentPreviewViewerHandle,
  DocumentPreviewViewerProps
>(function DocumentPreviewViewer({ code, version, onReadyChange, sourceUrl }, ref) {
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [documentHtml, setDocumentHtml] = useState("");
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetData>({});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [fit, setFit] = useState<PreviewFit>("width");
  const [viewportSize, setViewportSize] = useState({ width: 760, height: 600 });
  const [surfaceSize, setSurfaceSize] = useState({ width: 816, height: 1056 });
  const [pageSize, setPageSize] = useState<{ width: number; minHeight: number } | undefined>();
  const [sheetHtml, setSheetHtml] = useState("");
  const [sheetRow, setSheetRow] = useState(0);
  const [sheetColumn, setSheetColumn] = useState(0);
  const [sheetEnd, setSheetEnd] = useState({ r: 0, c: 0 });
  const [retry, setRetry] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sourceBytesRef = useRef<ArrayBuffer | null>(null);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let localImageUrl = "";
    let loadingTask: PDFDocumentLoadingTask | null = null;
    onReadyChange(false);
    setLoading(true);
    setError("");

    void (async () => {
      const normalizedPreview = version.previewStatus === "ready" && Boolean(version.previewPath || sourceUrl);
      const loaded = await loadPreviewBytes(normalizedPreview, (target) => sourceUrl ? sourceUrl(target) : getControlledDocumentDownloadUrl(version, target));
      const bytes = loaded.bytes;
      if (!active) return;
      sourceBytesRef.current = bytes;
      const extension = previewIsPdf(bytes, version.mimeType) ? "pdf" : fileExtension(version.fileName);

      if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
        const loadedPdf = await loadingTask.promise;
        if (!active) { void loadingTask.destroy(); return; }
        setPdfDocument(loadedPdf);
        setPdfPage(1);
        setKind("pdf");
      } else if (extension === "docx") {
        const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([
          import("mammoth"),
          import("dompurify"),
        ]);
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.slice(0) });
        if (!active) return;
        const metadata = await officeXml(bytes, "word/document.xml").catch(() => undefined);
        if (!active) return;
        setPageSize(metadata ? wordPageSize(metadata) : undefined);
        setDocumentHtml(DOMPurify.sanitize(result.value));
        setKind("document");
      } else if (spreadsheetExtensions.has(extension)) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellStyles: true });
        if (!active) return;
        setSpreadsheetData(workbook.Sheets);
        setSheetRow(0); setSheetColumn(0);
        setSheetNames(workbook.SheetNames);
        setActiveSheet(workbook.SheetNames[0] ?? "");
        setKind("spreadsheet");
      } else if (imageExtensions.has(extension)) {
        localImageUrl = URL.createObjectURL(new Blob([bytes], {
          type: version.mimeType || `image/${extension === "jpg" ? "jpeg" : extension}`,
        }));
        setImageUrl(localImageUrl);
        setKind("image");
      } else {
        throw new Error(`La vista rápida no admite todavía archivos .${extension || "sin extensión"}.`);
      }
      setLoading(false);
      if (extension !== "pdf" && !imageExtensions.has(extension)) onReadyChange(true);
    })().catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "No fue posible generar la vista rápida.");
      setLoading(false);
      onReadyChange(false);
    });

    return () => {
      active = false;
      sourceBytesRef.current = null;
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
      if (loadingTask) void loadingTask.destroy();
    };
  }, [onReadyChange, sourceUrl, version, retry]);

  useEffect(() => {
    if (loading || !viewportRef.current || !previewSurfaceRef.current) return;
    const viewport = viewportRef.current, surface = previewSurfaceRef.current;
    const measure = () => {
      const width = Math.max(1, viewport.clientWidth - 36), height = Math.max(1, viewport.clientHeight - 36);
      setViewportSize((old) => old.width === width && old.height === height ? old : { width, height });
      const natural = { width: surface.scrollWidth || 1, height: surface.scrollHeight || 1 };
      setSurfaceSize((old) => old.width === natural.width && old.height === natural.height ? old : natural);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); observer.observe(surface);
    const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [loading, kind]);

  useEffect(() => {
    const sheet = spreadsheetData[activeSheet];
    if (kind !== "spreadsheet" || !sheet) return;
    let active = true;
    void Promise.all([import("xlsx"), import("dompurify")]).then(([XLSX, { default: DOMPurify }]) => {
      const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
      const window = sheetWindow(sheetRow, sheetColumn, range.e.r, range.e.c);
      const html = XLSX.utils.sheet_to_html({ ...sheet, "!ref": XLSX.utils.encode_range(window) }, { header: "", footer: "", editable: false });
      if (active) { setSheetHtml(DOMPurify.sanitize(html)); setSheetEnd(range.e); }
    }).catch(() => { if (active) setError("No fue posible mostrar esta hoja."); });
    return () => { active = false; };
  }, [activeSheet, spreadsheetData, kind, sheetRow, sheetColumn]);

  useEffect(() => {
    if (loading || !pdfDocument || !pdfCanvasRef.current) return;
    let active = true;
    let task: RenderTask | undefined;
    void pdfDocument.getPage(pdfPage).then(async (page) => {
      if (!active || !pdfCanvasRef.current) return;
      setPdfRendering(true);
      const natural = page.getViewport({ scale: 1 });
      const scale = previewScale(natural.width, natural.height, viewportSize.width, viewportSize.height, fit, pdfZoom);
      const viewport = page.getViewport({ scale });
      const canvas = pdfCanvasRef.current, context = canvas.getContext("2d");
      if (!context) throw new Error("No fue posible preparar la página.");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = page.render({ canvas, canvasContext: context, viewport });
      await task.promise;
      if (active) { setPdfRendering(false); onReadyChange(true); }
    }).catch((failure: Error) => {
      if (active && failure.name !== "RenderingCancelledException") { setPdfRendering(false); setError(failure.message); onReadyChange(false); }
    });
    return () => { active = false; task?.cancel(); };
  }, [pdfDocument, pdfPage, pdfZoom, fit, viewportSize, loading, onReadyChange]);

  async function capturePreview() {
    const surface = previewSurfaceRef.current;
    if (!surface) throw new Error("La vista todavía no está lista.");
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(surface, {
      backgroundColor: "#ffffff",
      logging: false,
      scale: 1.5,
      useCORS: true,
      width: surface.scrollWidth,
      height: surface.scrollHeight,
      windowWidth: surface.scrollWidth,
      windowHeight: surface.scrollHeight,
    });
  }

  useImperativeHandle(ref, () => ({
    downloadImage: async () => {
      const canvas = await capturePreview();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No fue posible crear la imagen.")), "image/png");
      });
      triggerDownload(blob, `${safeExportName(code)}-Rev${version.revision}.png`);
    },
    downloadPdf: async () => {
      if (kind === "pdf" && sourceBytesRef.current) {
        triggerDownload(
          new Blob([sourceBytesRef.current], { type: "application/pdf" }),
          `${safeExportName(code)}-Rev${version.revision}.pdf`,
        );
        return;
      }
      const canvas = await capturePreview();
      const { jsPDF } = await import("jspdf");
      const orientation = canvas.width > canvas.height ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = canvas.height * imageWidth / canvas.width;
      const availableHeight = pageHeight - margin * 2;
      let offset = 0;
      let pageIndex = 0;
      const image = canvas.toDataURL("image/jpeg", 0.92);
      while (offset < imageHeight) {
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(image, "JPEG", margin, margin - offset, imageWidth, imageHeight);
        offset += availableHeight;
        pageIndex += 1;
      }
      pdf.save(`${safeExportName(code)}-Rev${version.revision}.pdf`);
    },
  }), [code, kind, version.revision]);

  return (
    <section className="secure-document-viewer" aria-busy={loading}>
      {loading ? (
        <div className="secure-document-state"><LoaderCircle className="spin" size={28} /><strong>Generando vista de solo lectura</strong><span>El archivo original permanece protegido.</span></div>
      ) : null}
      {error ? (
        <div className="secure-document-state secure-document-error"><FileWarning size={28} /><strong>No se pudo generar la vista</strong><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar vista</button></div>
      ) : null}
      {!loading && !error ? (
        <>
          <nav className="secure-preview-navigation" aria-label="Navegación y ajuste de la vista">
            {kind === "pdf" && pdfDocument ? <>
              <button type="button" disabled={pdfPage <= 1} onClick={() => setPdfPage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /> Anterior</button>
              <span>Página {pdfPage} de {pdfDocument.numPages}</span>
              <button type="button" disabled={pdfPage >= pdfDocument.numPages} onClick={() => setPdfPage((page) => Math.min(pdfDocument.numPages, page + 1))}>Siguiente <ChevronRight size={15} /></button>
            </> : null}
            <button type="button" onClick={() => setPdfZoom((value) => Math.max(.25, value - .25))}><ZoomOut size={15} /> Zoom -</button>
            <span>{Math.round(pdfZoom * 100)}%</span>
            <button type="button" onClick={() => setPdfZoom((value) => Math.min(4, value + .25))}><ZoomIn size={15} /> Zoom +</button>
            <button type="button" onClick={() => { setFit("width"); setPdfZoom(1); }}><Maximize2 size={15} /> Ajustar ancho</button>
            <button type="button" onClick={() => { setFit("page"); setPdfZoom(1); }}><Maximize2 size={15} /> Ajustar página</button>
            <button type="button" onClick={() => { setFit("manual"); setPdfZoom(1); }}>Tamaño original</button>
          </nav>
          {kind === "document" || kind === "spreadsheet" ? <p className="document-preview-processing">Vista Office simplificada: conserva contenido y tablas cuando es posible; no garantiza estilos, impresión ni cortes de página del original. Se prefiere el PDF convertido cuando está disponible.</p> : null}
          {kind === "spreadsheet" ? <nav className="secure-preview-navigation" aria-label="Filas y columnas de la hoja">
            <button type="button" disabled={sheetRow === 0} onClick={() => setSheetRow((row) => Math.max(0, row - 250))}>Filas anteriores</button>
            <span>Filas {sheetRow + 1}–{Math.min(sheetEnd.r + 1, sheetRow + 250)} de {sheetEnd.r + 1}</span>
            <button type="button" disabled={sheetRow + 250 > sheetEnd.r} onClick={() => setSheetRow((row) => row + 250)}>Más filas</button>
            <button type="button" disabled={sheetColumn === 0} onClick={() => setSheetColumn((column) => Math.max(0, column - 60))}>Columnas anteriores</button>
            <span>Columnas {sheetColumn + 1}–{Math.min(sheetEnd.c + 1, sheetColumn + 60)} de {sheetEnd.c + 1}</span>
            <button type="button" disabled={sheetColumn + 60 > sheetEnd.c} onClick={() => setSheetColumn((column) => column + 60)}>Más columnas</button>
          </nav> : null}
          {version.previewStatus && version.previewStatus !== "not_required" ? <div className={`document-preview-processing ${version.previewStatus}`}><strong>{version.previewStatus === "ready" && kind === "pdf" ? "Vista PDF disponible" : version.previewStatus === "processing" ? "Procesando preview" : version.previewStatus === "error" ? "Error de conversión" : "Sin procesar"}</strong><span>{kind === "pdf" ? "Se respetan las páginas y orientación del PDF disponible." : version.previewError || "Se muestra una vista provisional. El original permanece disponible."}</span></div> : null}
          {kind === "spreadsheet" && sheetNames.length > 1 ? (
            <nav className="secure-preview-navigation secure-sheet-tabs" aria-label="Hojas del libro">
              {sheetNames.map((sheetName) => <button className={activeSheet === sheetName ? "active" : ""} key={sheetName} type="button" onClick={() => { setActiveSheet(sheetName); setSheetRow(0); setSheetColumn(0); }}>{sheetName}</button>)}
            </nav>
          ) : null}
          <div className={`secure-preview-viewport secure-preview-${kind}`} ref={viewportRef}>
            <div className="secure-preview-surface" style={{ zoom: kind === "pdf" ? 1 : previewScale(surfaceSize.width, surfaceSize.height, viewportSize.width, viewportSize.height, fit, pdfZoom) }} ref={previewSurfaceRef}>
              {kind === "pdf" ? <canvas aria-label={`Página ${pdfPage}`} className={pdfRendering ? "rendering" : ""} ref={pdfCanvasRef} /> : null}
              {kind === "document" ? <article className="secure-docx-content" style={pageSize} dangerouslySetInnerHTML={{ __html: documentHtml }} /> : null}
              {kind === "spreadsheet" ? <div className="secure-sheet-content" dangerouslySetInnerHTML={{ __html: sheetHtml }} /> : null}
              {/* La fuente es un blob privado generado en memoria; next/image no puede optimizarlo. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {kind === "image" ? <img alt={`Vista de ${version.fileName}`} src={imageUrl} onLoad={() => onReadyChange(true)} onError={() => { setError("No fue posible mostrar la imagen."); onReadyChange(false); }} /> : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
});
