"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

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
}

type PreviewKind = "pdf" | "document" | "spreadsheet" | "image";
type SpreadsheetData = Record<string, Array<Array<string | number | boolean | null>>>;

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
>(function DocumentPreviewViewer({ code, version, onReadyChange }, ref) {
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
      const signedUrl = await getControlledDocumentDownloadUrl(version);
      if (!signedUrl) throw new Error("Este registro todavía no tiene un archivo consultable.");
      const response = await fetch(signedUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("No fue posible abrir el archivo privado.");
      const bytes = await response.arrayBuffer();
      if (!active) return;
      sourceBytesRef.current = bytes;
      const extension = fileExtension(version.fileName);

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
        const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
        const data = Object.fromEntries(
          workbook.SheetNames.map((sheetName) => [
            sheetName,
            XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(
              workbook.Sheets[sheetName],
              { header: 1, raw: false, defval: null },
            ),
          ]),
        );
        if (!active) return;
        setSpreadsheetData(data);
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
  }, [onReadyChange, version]);

  useEffect(() => {
    if (!pdfDocument || !pdfCanvasRef.current) return;
    let active = true;
    setPdfRendering(true);
    void pdfDocument.getPage(pdfPage).then(async (page) => {
      if (!active || !pdfCanvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.35 });
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
  }, [pdfDocument, pdfPage]);

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

  const activeRows = spreadsheetData[activeSheet] ?? [];
  const visibleRows = activeRows.slice(0, 250);
  const visibleColumnCount = Math.min(
    60,
    visibleRows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
  );

  return (
    <section className="secure-document-viewer" aria-busy={loading}>
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
              <button type="button" disabled={pdfPage <= 1} onClick={() => setPdfPage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /> Anterior</button>
              <span>Página {pdfPage} de {pdfDocument.numPages}</span>
              <button type="button" disabled={pdfPage >= pdfDocument.numPages} onClick={() => setPdfPage((page) => Math.min(pdfDocument.numPages, page + 1))}>Siguiente <ChevronRight size={15} /></button>
            </nav>
          ) : null}
          {kind === "spreadsheet" && sheetNames.length > 1 ? (
            <nav className="secure-preview-navigation secure-sheet-tabs" aria-label="Hojas del libro">
              {sheetNames.map((sheetName) => <button className={activeSheet === sheetName ? "active" : ""} key={sheetName} type="button" onClick={() => setActiveSheet(sheetName)}>{sheetName}</button>)}
            </nav>
          ) : null}
          <div className={`secure-preview-viewport secure-preview-${kind}`}>
            <div className="secure-preview-surface" ref={previewSurfaceRef}>
              {kind === "pdf" ? <canvas aria-label={`Página ${pdfPage}`} className={pdfRendering ? "rendering" : ""} ref={pdfCanvasRef} /> : null}
              {kind === "document" ? <article className="secure-docx-content" dangerouslySetInnerHTML={{ __html: documentHtml }} /> : null}
              {kind === "spreadsheet" ? (
                <div className="secure-sheet-content">
                  <table>
                    <tbody>
                      {visibleRows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {Array.from({ length: visibleColumnCount }, (_, columnIndex) => (
                            <td key={columnIndex}>{row[columnIndex] == null ? "" : String(row[columnIndex])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {activeRows.length > visibleRows.length ? <p>Vista rápida limitada a 250 filas. La exportación conserva esta vista.</p> : null}
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
