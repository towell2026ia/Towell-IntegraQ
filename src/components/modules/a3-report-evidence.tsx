"use client";
/* eslint-disable @next/next/no-img-element -- Private evidence, never public image optimization. */
import {useEffect,useState} from "react";
import {listAttachments,getAttachmentSignedUrl,type AttachmentRecord} from "@/lib/attachment-storage";
import {a3EvidenceKey} from "./a3-step-evidence";
import type {A3Analysis} from "@/lib/types";
export function A3ReportEvidence({analysis,onBusyChange}:{analysis:A3Analysis;onBusyChange?:(busy:boolean)=>void}){
 const [files,setFiles]=useState<AttachmentRecord[]>([]),[pages,setPages]=useState<Record<string,string[]>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void (async()=>{const status=await fetch('/api/root2cause/capabilities',{cache:'no-store'});if(!status.ok||!(await status.json()).enabled||!analysis.evidenceId)return;
 const keys=[...Array.from({length:8},(_,n)=>n),...analysis.plans.map(p=>p.id)];
 const result=await Promise.all(keys.map(step=>listAttachments({moduleId:'corrective-actions',resourceType:'root2cause_evidence',resourceKey:a3EvidenceKey(analysis.evidenceId!,step)})));if(active)setFiles(result.flat());
 })().catch(()=>{if(active)setError('No fue posible consultar las evidencias autorizadas.');});return()=>{active=false;};},[analysis.evidenceId,analysis.plans]);
 async function include(file:AttachmentRecord){setBusy(true);onBusyChange?.(true);setError('');try{
  const signed=await getAttachmentSignedUrl(file);if(!signed)throw new Error('Archivo no disponible.');
  const response=await fetch(signed,{cache:'no-store'});if(!response.ok)throw new Error('No se autorizó la lectura.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>20*1024*1024)throw new Error('Incluye este documento mediante su referencia; supera 20 MB.');
  const images:string[]=[];
  if(file.mimeType.startsWith('image/')){const url=URL.createObjectURL(new Blob([bytes],{type:file.mimeType}));try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');if(img.naturalWidth*img.naturalHeight>40000000)throw new Error('La imagen requiere revisión por su resolución. Conserva el original descargable.');const ratio=Math.min(1,4096/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);images.push(canvas.toDataURL('image/png'));}finally{URL.revokeObjectURL(url);}}
  else if(file.mimeType==='application/pdf'){
   const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';const loading=pdfjs.getDocument({data:bytes});const pdf=await loading.promise;
   try{if(pdf.numPages>30)throw new Error('Documento mayor a 30 páginas: conserva su referencia y descarga original.');for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),view=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport:view}).promise;images.push(canvas.toDataURL('image/png'));}}finally{await loading.destroy();}
  }else if(!['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.mimeType))throw new Error('Formato no apto para inclusión en el reporte. Conserva el original descargable.');
  setPages(current=>({...current,[file.id]:images}));
 }catch(e){setError(e instanceof Error?e.message:'No se pudo incluir la evidencia.');}finally{setBusy(false);onBusyChange?.(false); }}
 return <section className="a3-report-section"><h3>Evidencias autorizadas para el PDF</h3><div className="print-hidden"><p>Selecciona expresamente los documentos y fotografías que incluirás. Sus originales no se modifican.</p>{error?<p role="alert">{error}</p>:null}{files.map(f=><div key={f.id}><span>{f.originalName} · V{f.version}</span><button type="button" disabled={busy} onClick={()=>void include(f)}>Incluir en PDF</button><button type="button" disabled={busy||!pages[f.id]} onClick={()=>setPages(p=>{const n={...p};delete n[f.id];return n;})}>Quitar del PDF</button></div>)}{busy?<p role="status">Preparando páginas autorizadas. Espera antes de imprimir.</p>:null}</div>{Object.entries(pages).map(([id,images])=><section key={id}><h4>{files.find(f=>f.id===id)?.originalName}</h4>{images.length===0?<p>Referencia documental: archivo original conservado en el expediente; ID {id}. El contenido no se convirtió ni se insertó en este PDF.</p>:images.map((src,i)=><figure key={i} style={{breakInside:'avoid',margin:0}}><img src={src} alt={`Evidencia, página ${i+1}`} style={{maxWidth:'100%',maxHeight:'250mm',objectFit:'contain'}}/><figcaption>Página {i+1}</figcaption></figure>)}</section>)}</section>;
}
