"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import styles from "./continuous-pdf-pages.module.css";

export function ContinuousPdfPages({ document, zoom }: { document: PDFDocumentProxy; zoom: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.floor(entry.contentRect.width))));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className={styles.pages} aria-label="Todas las páginas del PDF">
    {width > 0 ? Array.from({ length: document.numPages }, (_, i) => <PdfPage key={`${i + 1}:${width}:${zoom}`} document={document} number={i + 1} width={width} zoom={zoom} />) : <p role="status">Preparando páginas…</p>}
  </div>;
}
function PdfPage({ document, number, width, zoom }: { document: PDFDocumentProxy; number: number; width: number; zoom: number }) {
  const host = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "600px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    let active = true, task: RenderTask | undefined;
    void document.getPage(number).then(async page => {
      if (!active || !canvas.current) return;
      const node = canvas.current, unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / unscaled.width * zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      node.width = Math.ceil(viewport.width * ratio); node.height = Math.ceil(viewport.height * ratio);
      node.style.width = viewport.width + "px"; node.style.height = viewport.height + "px";
      const context = node.getContext("2d"); if (!context) throw new Error("No se pudo preparar la página.");
      task = page.render({ canvas: node, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (active) setReady(true);
    }).catch(cause => { if (active && cause?.name !== "RenderingCancelledException") setError("No fue posible mostrar esta página."); });
    return () => { active = false; task?.cancel(); };
  }, [document, number, width, zoom, visible]);
  return <figure ref={host} className={styles.page} data-pdf-page={number} aria-busy={!ready && !error} style={{ minHeight: ready ? undefined : width * zoom * 1.3 }}>
    {!ready && !error ? <p role="status">Cargando página {number}…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <canvas ref={canvas} role="img" aria-label={`Página ${number} del PDF`} className={styles.canvas} hidden={!ready} />
    <figcaption>Página {number} de {document.numPages}</figcaption>
  </figure>;
}
