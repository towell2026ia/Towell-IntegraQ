"use client";
import {useCallback,useMemo} from "react";
import {DocumentPreviewViewer} from "./document-preview-viewer";
import styles from "./rncp-initial-photos.module.css";
export function RncpGeneratedPreview({url,name,folio,onClose}:{url:string;name:string;folio?:string;onClose:()=>void}) {
 const source=useCallback(async()=>url,[url]),ready=useCallback(()=>undefined,[]);
 const version=useMemo(()=>({id:url,revision:1,status:"draft" as const,fileName:name,uploadedBy:"",validator:"",modifiedAt:"",changeReason:"Vista previa generada; no sustituye un original.",mimeType:"application/pdf"}),[url,name]);
 return <section className={styles.preview} role="dialog" aria-modal="true" aria-label="Vista PDF F-CA-25"><header><strong>F-CA-25 · {folio??"Vista previa sin folio"}</strong><a className="button button-secondary" href={url} download={name}>Descargar PDF</a><button type="button" className="button button-secondary" onClick={onClose}>Cerrar vista PDF</button></header><p>Reporte generado para revisión y envío posterior. No envía correos, no registra una notificación y no sustituye PDFs originales.</p><div className={styles.viewer}><DocumentPreviewViewer code={folio??"F-CA-25"} version={version} sourceUrl={source} onReadyChange={ready} pdfLayout="continuous"/></div></section>;
}
