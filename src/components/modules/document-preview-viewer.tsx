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
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContinuousPdfPages } from "./continuous-pdf-pages";
import continuousStyles from "./continuous-pdf-pages.module.css";

import type { ControlledDocumentVersion } from "@/lib/document-control-data";
import { getControlledDocumentDownloadUrl } from "@/lib/document-storage";
import { describeSpreadsheet, getSpreadsheetPage, isSpreadsheetFileName, SPREADSHEET_PAGE_COLUMNS, SPREADSHEET_PAGE_ROWS, type SpreadsheetSheet } from "@/lib/spreadsheet-preview";
import type * as XLSXType from "xlsx";

export interface DocumentPreviewViewerHandle {
  downloadImage: () => Promise<void>;
  downloadPdf: () => Promise<void>;
}

interface DocumentPreviewViewerProps {
  code: string;
  version: ControlledDocumentVersion;
  onReadyChange: (ready: boolean) => void;
  sourceUrl?: () => Promise<string | null>;
  pdfLayout?: "single-page" | "continuous";
}

type PreviewKind = "pdf" | "document" | "spreadsheet" | "image";

const spreadsheetExtensions = new Set(["xlsx", "xls", "xlsm", "xlsb"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

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
>(function DocumentPreviewViewer({ code, version, onReadyChange, sourceUrl, pdfLayout = "single-page" }, ref) {
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [documentHtml, setDocumentHtml] = useState("");
  const [sheets, setSheets] = useState<SpreadsheetSheet[]>([]);
  const [spreadsheetUtils, setSpreadsheetUtils] = useState<typeof XLSXType.utils | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [sheetRowStart, setSheetRowStart] = useState(0);
  const [sheetColumnStart, setSheetColumnStart] = useState(0);
  const [imageUrl, setImageUrl] = useState("");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfZoom, setPdfZoom] = useState(1);
  const sourceBytesRef = useRef<ArrayBuffer | null>(null);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let localImageUrl = "";
    let loadedPdf: PDFDocumentProxy | null = null;
    onReadyChange(false);
    setLoading(true);
    setError("");

    void (async () => {
      const spreadsheetOriginal = isSpreadsheetFileName(version.fileName);
      const normalizedPreview = !spreadsheetOriginal && version.previewStatus === "ready" && Boolean(version.previewPath);
      const signedUrl = sourceUrl
        ? await sourceUrl()
        : await getControlledDocumentDownloadUrl(version, normalizedPreview ? "preview" : "original");
      if (!signedUrl) throw new Error("Este registro todavía no tiene un archivo consultable.");
      const response = await fetch(signedUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("No fue posible abrir el archivo privado.");
      const bytes = await response.arrayBuffer();
      if (!active) return;
      sourceBytesRef.current = bytes;
      const extension = normalizedPreview ? "pdf" : fileExtension(version.fileName);

      if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadedPdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
        if (!active) return;
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
        setDocumentHtml(DOMPurify.sanitize(result.value));
        setKind("document");
      } else if (spreadsheetExtensions.has(extension)) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellStyles: true });
        if (!active) return;
        setSheets(describeSpreadsheet(workbook, XLSX.utils));
        setSpreadsheetUtils(XLSX.utils);
        setActiveSheet(workbook.SheetNames[0] ?? "");
        setSheetRowStart(0);
        setSheetColumnStart(0);
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
      onReadyChange(true);
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
      if (loadedPdf) void loadedPdf.cleanup();
    };
  }, [onReadyChange, sourceUrl, version]);

  useEffect(() => {
    if (pdfLayout !== "single-page" || !pdfDocument || !pdfCanvasRef.current) return;
    let active = true;
    setPdfRendering(true);
    void pdfDocument.getPage(pdfPage).then(async (page) => {
      if (!active || !pdfCanvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.35 * pdfZoom });
      const canvas = pdfCanvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      if (active) setPdfRendering(false);
    }).catch((renderError) => {
      if (active) {
        setPdfRendering(false);
        setError(renderError instanceof Error ? renderError.message : "No fue posible mostrar esta página.");
      }
    });
    return () => {
      active = false;
    };
  }, [pdfDocument, pdfPage, pdfZoom, pdfLayout]);

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
      if (kind === "spreadsheet") throw new Error("La hoja de cálculo se descarga en su formato original.");
      const canvas = await capturePreview();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No fue posible crear la imagen.")), "image/png");
      });
      triggerDownload(blob, `${safeExportName(code)}-Rev${version.revision}.png`);
    },
    downloadPdf: async () => {
      if (kind === "spreadsheet") throw new Error("La hoja de cálculo se descarga en su formato original.");
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

  const selectedSheet = sheets.find(sheet => sheet.name === activeSheet);
  const sheetPage = selectedSheet && spreadsheetUtils ? getSpreadsheetPage(selectedSheet, spreadsheetUtils, sheetRowStart, sheetColumnStart) : null;

  return (
    <section className={`secure-document-viewer ${pdfLayout === "continuous" ? continuousStyles.continuousViewer : ""}`} aria-busy={loading}>
      {loading ? (
        <div className="secure-document-state"><LoaderCircle className="spin" size={28} /><strong>Generando vista de solo lectura</strong><span>El archivo original permanece protegido.</span></div>
      ) : null}
      {error ? (
        <div className="secure-document-state secure-document-error"><FileWarning size={28} /><strong>No se pudo generar la vista</strong><span>{error}</span></div>
      ) : null}
      {!loading && !error ? (
        <>
          {kind === "pdf" && pdfDocument ? (
            <nav className="secure-preview-navigation" aria-label="Páginas del PDF">
              {pdfLayout === "continuous" ? <span>{pdfDocument.numPages} páginas · Desplazamiento vertical</span> : <>
              <button type="button" disabled={pdfPage <= 1} onClick={() => setPdfPage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /> Anterior</button>
              <span>Página {pdfPage} de {pdfDocument.numPages}</span>
              <button type="button" disabled={pdfPage >= pdfDocument.numPages} onClick={() => setPdfPage((page) => Math.min(pdfDocument.numPages, page + 1))}>Siguiente <ChevronRight size={15} /></button></>}
              <button type="button" onClick={() => setPdfZoom((value) => Math.max(.5, value - .25))}><ZoomOut size={15} /> Zoom -</button>
              <span>{Math.round(pdfZoom * 100)}%</span>
              <button type="button" onClick={() => setPdfZoom((value) => Math.min(3, value + .25))}><ZoomIn size={15} /> Zoom +</button>
              <button type="button" onClick={() => setPdfZoom(pdfLayout === "continuous" ? 1 : 1.45)}><Maximize2 size={15} /> Ajustar ancho</button>
              {pdfLayout === "single-page" ? <button type="button" onClick={() => setPdfZoom(.85)}><Maximize2 size={15} /> Ajustar página</button> : null}
            </nav>
          ) : null}
          {kind !== "spreadsheet" && version.previewStatus && version.previewStatus !== "not_required" ? <div className={`document-preview-processing ${version.previewStatus}`}><strong>{version.previewStatus === "ready" ? "Preview PDF normalizado" : version.previewStatus === "processing" ? "Procesando preview" : version.previewStatus === "error" ? "Error de conversión" : "Sin procesar"}</strong><span>{version.previewStatus === "ready" ? "La orientación y paginación provienen del motor documental." : version.previewError || "Se muestra una vista provisional. El original permanece disponible."}</span></div> : null}
          {kind === "spreadsheet" ? (
            <nav className="secure-preview-navigation secure-sheet-tabs" aria-label="Hojas del libro">
              {sheets.map(sheet => <button className={activeSheet === sheet.name ? "active" : ""} key={sheet.name} type="button" onClick={() => { setActiveSheet(sheet.name); setSheetRowStart(0); setSheetColumnStart(0); }}>{sheet.name}</button>)}
            </nav>
          ) : null}
          {kind === "spreadsheet" && selectedSheet ? <nav className="secure-preview-navigation" aria-label="Navegación de la hoja">
            <button type="button" disabled={sheetRowStart === 0} onClick={() => setSheetRowStart(value => Math.max(0, value - SPREADSHEET_PAGE_ROWS))}>Filas anteriores</button>
            <span>Filas {selectedSheet.rowCount ? sheetRowStart + 1 : 0}–{Math.min(selectedSheet.rowCount, sheetRowStart + SPREADSHEET_PAGE_ROWS)} de {selectedSheet.rowCount}</span>
            <button type="button" disabled={sheetRowStart + SPREADSHEET_PAGE_ROWS >= selectedSheet.rowCount} onClick={() => setSheetRowStart(value => value + SPREADSHEET_PAGE_ROWS)}>Filas siguientes</button>
            <button type="button" disabled={sheetColumnStart === 0} onClick={() => setSheetColumnStart(value => Math.max(0, value - SPREADSHEET_PAGE_COLUMNS))}>Columnas anteriores</button>
            <span>Columnas {sheetColumnStart + 1}–{Math.min(selectedSheet.columnCount, sheetColumnStart + SPREADSHEET_PAGE_COLUMNS)} de {selectedSheet.columnCount}</span>
            <button type="button" disabled={sheetColumnStart + SPREADSHEET_PAGE_COLUMNS >= selectedSheet.columnCount} onClick={() => setSheetColumnStart(value => value + SPREADSHEET_PAGE_COLUMNS)}>Columnas siguientes</button>
          </nav> : null}
          <div className={`secure-preview-viewport secure-preview-${kind}`}>
            <div className="secure-preview-surface" ref={previewSurfaceRef}>
              {kind === "pdf" && pdfDocument ? pdfLayout === "continuous" ? <ContinuousPdfPages document={pdfDocument} zoom={pdfZoom} /> : <canvas aria-label={`Página ${pdfPage}`} className={pdfRendering ? "rendering" : ""} ref={pdfCanvasRef} /> : null}
              {kind === "document" ? <article className="secure-docx-content" dangerouslySetInnerHTML={{ __html: documentHtml }} /> : null}
              {kind === "spreadsheet" && sheetPage ? (
                <div className="secure-sheet-content">
                  <table>
                    <colgroup><col className="secure-sheet-row-column" />{sheetPage.columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                    <thead><tr><th aria-label="Fila y columna" scope="col" />{sheetPage.columnLabels.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                    <tbody>
                      {sheetPage.rows.map((row, rowIndex) => (
                        <tr key={sheetPage.rowNumbers[rowIndex]}>
                          <th scope="row">{sheetPage.rowNumbers[rowIndex]}</th>
                          {row.map((cell, columnIndex) => cell ? <td key={columnIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={`secure-sheet-align-${cell.align}`}>{cell.text}</td> : null)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>Vista de solo lectura. Se conservan las pestañas, celdas combinadas y formatos numéricos compatibles; descarga el original para funciones avanzadas de Excel.</p>
                </div>
              ) : null}
              {/* La fuente es un blob privado generado en memoria; next/image no puede optimizarlo. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {kind === "image" ? <img alt={`Vista de ${version.fileName}`} src={imageUrl} /> : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
});
