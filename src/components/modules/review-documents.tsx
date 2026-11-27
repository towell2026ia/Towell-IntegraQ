"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Eye, Paperclip } from "lucide-react";
import { DocumentPreviewViewer } from "./document-preview-viewer";
import { getAttachmentSignedUrl } from "@/lib/attachment-storage";
import type { ControlledDocumentVersion } from "@/lib/document-control-data";
import { managementReviewGroups } from "@/lib/management-review-sections";
import { downloadReviewFile, listReviewFiles, reviewCategories, reviewDocuments, reviewMinutes, saveReviewFile,
  type ReviewFile, type ReviewKind, type ReviewMetadata } from "@/lib/review-document-storage";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { markDirty } from "@/lib/workspace-continuity";
import type { useReviewMinutes } from "./management-review-minutes";
import styles from "./management-review-portal.module.css";

const sections=managementReviewGroups.flatMap(group=>group.sections);
const categories=Object.entries(reviewCategories);
const categoryLabel=(id:string|null)=>categories.find(([key])=>key===id)?.[1] ?? "Otros documentos";
const lists=new WeakMap<ActiveSession,Map<string,{time:number;files:ReviewFile[]}>>();
type Editor={action:"add"|"edit"|"replace"; previous?:ReviewFile};
type Props={session:ActiveSession;period:number;kind?:ReviewKind;catalog:ReturnType<typeof useReviewMinutes>;onYear:(year:number)=>void;references?:{name:string;open:()=>void}[]};

export function ReviewDocuments({session,period,kind=reviewDocuments,catalog,onYear,references}:Props) {
  const minutes=kind===reviewMinutes;
  const admin=isAdministrator(session);
  const [history,setHistory]=useState(false);
  const [category,setCategory]=useState("");
  const [attempt,setAttempt]=useState(0);
  const key=[kind,period,history,attempt].join("/");
  const [result,setResult]=useState<{key:string;files:ReviewFile[];error?:boolean}>();
  const [preview,setPreview]=useState<ReviewFile>();
  const [editor,setEditor]=useState<Editor>();
  const [message,setMessage]=useState("");
  const [removing,setRemoving]=useState(false);
  const enabled=minutes || catalog.installed;
  useEffect(()=>{
    let active=true;
    if(!enabled)return;
    const cache=lists.get(session) ?? new Map();
    lists.set(session,cache);
    const cacheKey=[kind,period,history].join("/");
    const cached=cache.get(cacheKey);
    const fresh=cached && Date.now()-cached.time<30000;
    const read=fresh ? Promise.resolve(cached.files) : listReviewFiles(kind,period,history);
    void read.then(files=>{if(active){if(!fresh)cache.set(cacheKey,{time:Date.now(),files});setResult({key,files});}})
      .catch(()=>{if(active)setResult({key,files:[],error:true});});
    return ()=>{active=false;};
  },[enabled,key,session,period,kind,history]);
  function refresh(){lists.delete(session);setAttempt(n=>n+1);catalog.reload();}
  async function retire(file:ReviewFile){
    if(removing || !admin || !window.confirm("¿Retirar este documento del expediente activo? Se conservará su historial."))return;
    const reason=window.prompt("Indica el motivo del retiro.")?.trim();
    if(!reason)return;
    setRemoving(true);setMessage("");
    try { await saveReviewFile({kind,year:period,action:"retire",previous:file,documentId:"",uploadId:"",metadata:metadataOf(file,minutes),reason});refresh(); }
    catch {setMessage("No se confirmó el retiro. Actualiza el expediente antes de reintentar.");}
    finally {setRemoving(false);}
  }
  async function download(file:ReviewFile){try{await downloadReviewFile(file);}catch{setMessage("No se pudo descargar el original. Vuelve a intentar.");}}
  const files=result?.key===key && enabled ? result.files : undefined;
  const visible=files?.filter(file=>minutes || !category || file.category===category);
  const heading=minutes?"Actas históricas adjuntas":"Documentación de la revisión";
  return <section className={styles.records} aria-label={heading}>
    <header className={styles.recordTools}><h3>{heading}</h3>
      {admin && catalog.installed && <button type="button" className="button button-secondary" onClick={()=>setEditor({action:"add"})}><Paperclip size={15}/> {minutes?"Adjuntar acta":"Adjuntar documento"}</button>}
    </header>
    <div className={styles.recordTools}>
      {!minutes && <label>Categoría <select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas</option>{categories.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>}
      <label><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/> {admin?"Incluir versiones anteriores y retirados":"Incluir versiones anteriores"}</label>
    </div>
    {catalog.loadError && <p role="alert">{catalog.loadError} <button type="button" onClick={catalog.reload}>Reintentar</button></p>}
    {!enabled && !catalog.loading && !catalog.loadError ? <p>El registro de documentos complementarios está pendiente de habilitación.</p> :
      result?.key===key && result.error ? <p role="alert">No se pudo consultar el expediente. <button type="button" onClick={refresh}>Reintentar</button></p> :
      !visible ? <progress aria-label="Actualizando documentos"/> :
      visible.length===0 ? <p>No hay documentos para esta selección.</p> :
      visible.map(file=><article key={file.id} className={styles.record}>
        <div><strong>{minutes?file.originalName:file.displayName}</strong>
          <p>{minutes?file.description:categoryLabel(file.category)} · {period} · Versión {file.version} · {file.deletedAt?"Retirado":file.isCurrent?"Actual":"Histórica"}</p>
          <p>{[file.validFrom,file.responsible,sections.find(s=>s.id===file.section)?.title].filter(Boolean).join(" · ")}</p></div>
        <div className={styles.recordTools}><button className="button button-secondary" type="button" onClick={()=>setPreview(file)}><Eye size={15}/>Ver</button>
          <button className="button button-secondary" type="button" onClick={()=>void download(file)}><Download size={15}/>Descargar original</button></div>
        <details><summary>Información del archivo</summary><p>{file.originalName} · {file.mimeType} · {file.sizeBytes ?? "—"} bytes</p>
          {!minutes && file.description && <p>{file.description}</p>}{file.reason && <p>Motivo del retiro · {file.reason}</p>}</details>
        {admin && catalog.installed && file.isCurrent && !file.deletedAt && <details><summary>Administrar</summary><div className={styles.recordTools}>
          <button type="button" onClick={()=>setEditor({action:"edit",previous:file})}>Editar metadatos</button>
          <button type="button" onClick={()=>setEditor({action:"replace",previous:file})}>Nueva versión</button>
          <button type="button" disabled={removing} onClick={()=>void retire(file)}>Retirar</button></div></details>}
      </article>)}
    {!!references?.length && <details><summary>Referencias a Información Documentada</summary><p>Vigencia a la fecha de consulta.</p><div className={styles.recordTools}>{references.map(ref=><button key={ref.name} type="button" className="button button-secondary" onClick={ref.open}>{ref.name}</button>)}</div></details>}
    {!minutes && <aside className={styles.followup}>Evidencias de cumplimiento de acuerdos · Previstas para RE-06</aside>}
    {message && <p role="alert">{message}</p>}
    {editor && admin && <ReviewEditor editor={editor} period={period} kind={kind} onClose={()=>setEditor(undefined)}
      onSaved={year=>{setEditor(undefined);setCategory("");refresh();onYear(year);}}/>}
    {preview && <ReviewPreview file={preview} onClose={()=>setPreview(undefined)} onDownload={()=>void download(preview)}/>}
  </section>;
}
function metadataOf(file:ReviewFile|undefined,minutes:boolean):ReviewMetadata{
  return {title:file?.displayName ?? "",responsible:file?.responsible ?? "",date:file?.validFrom ?? "",notes:file?.description ?? (minutes?"En revisión":""),
    category:file?.category ?? "support",section:file?.section ?? ""};
}

function ReviewEditor({editor,period,kind,onClose,onSaved}:{editor:Editor;period:number;kind:ReviewKind;onClose:()=>void;onSaved:(year:number)=>void}){
  const minutes=kind===reviewMinutes;
  const [year,setYear]=useState(period);
  const [meta,setMeta]=useState(()=>metadataOf(editor.previous,minutes));
  const [file,setFile]=useState<File>();
  const fileInput=useRef<HTMLInputElement>(null);
  const [documentId]=useState(()=>crypto.randomUUID());
  const [uploadId,setUploadId]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const dirty=useRef(false);
  useEffect(()=>()=>markDirty("review:document",false),[]);
  function field(name:keyof ReviewMetadata,value:string){setMeta(current=>({...current,[name]:value}));}
  function cancel(){if(!busy && (!dirty.current || window.confirm("¿Descartar los cambios sin guardar?")))onClose();}
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");
    try{await saveReviewFile({kind,year,...editor,documentId,uploadId,file,metadata:minutes?{...meta,title:meta.responsible}:meta});onSaved(year);}
    catch(cause){setError(cause instanceof Error && !/fetch|network|supabase|postgres|api|http/i.test(cause.message)?cause.message:"No se confirmó el guardado. Vuelve a intentar.");}
    finally{setBusy(false);}
  }
  return <div className={styles.backdrop}><section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Registro documental">
    <h3>{editor.action==="edit"?"Editar metadatos":editor.action==="replace"?"Nueva versión":minutes?"Adjuntar acta":"Adjuntar documento"}</h3>
    <form onSubmit={submit} onChange={()=>{dirty.current=true;markDirty("review:document",true);}}><fieldset disabled={busy} className={styles.fields}>
      <label>Año de revisión<input type="number" required min="1900" max={new Date().getFullYear()} value={year || ""} readOnly={!!editor.previous} onChange={e=>setYear(Number(e.target.value))}/></label>
      {!minutes && <><label>Título<input required maxLength={250} value={meta.title} onChange={e=>field("title",e.target.value)}/></label>
        <label>Categoría<select value={meta.category} onChange={e=>field("category",e.target.value)}>{categories.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>Apartado relacionado<select value={meta.section} onChange={e=>field("section",e.target.value)}><option value="">Sin asociación</option>{sections.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label></>}
      <label>Fecha del documento<input type="date" required value={meta.date} onChange={e=>field("date",e.target.value)}/></label>
      <label>Responsable<input required value={meta.responsible} onChange={e=>field("responsible",e.target.value)}/></label>
      {minutes?<label>Estado<select value={meta.notes} onChange={e=>field("notes",e.target.value)}><option>Finalizada</option><option>En revisión</option></select></label>:
        <label>Observaciones<textarea value={meta.notes} onChange={e=>field("notes",e.target.value)}/></label>}
      {editor.action!=="edit" && <label>Archivo<input ref={fileInput} type="file" required accept={minutes?".pdf,.docx":undefined} onChange={e=>{setFile(e.target.files?.[0]);setUploadId(crypto.randomUUID());}}/></label>}
      {file && <div><p>{file.name} · {file.size.toLocaleString("es-MX")} bytes · Pendiente de guardar</p><button type="button" onClick={()=>{setFile(undefined);if(fileInput.current)fileInput.current.value="";}}>Retirar selección</button></div>}
      {editor.previous && <p>Documento seleccionado · {editor.previous.originalName} · Versión {editor.previous.version}</p>}
      {error && <p role="alert">{error}</p>}<div className={styles.recordTools}><button className="button button-primary" type="submit">Guardar</button><button className="button button-secondary" type="button" onClick={cancel}>Cancelar</button></div>
    </fieldset></form></section></div>;
}
function ReviewPreview({file,onClose,onDownload}:{file:ReviewFile;onClose:()=>void;onDownload:()=>void}){
  const sourceUrl=useCallback(async () => {
    try {
      return await getAttachmentSignedUrl(file,file.previewStatus==="ready"&&file.previewPath&&!/\.(xlsx?|csv)$/i.test(file.originalName)?"preview":"original");
    } catch {
      throw new Error("No se pudo abrir el documento. Comprueba tu acceso y vuelve a intentar.");
    }
  },[file]);
  const ready=useCallback(()=>{},[]);
  const [version]=useState<ControlledDocumentVersion>(()=>({id:file.id,revision:file.version,status:file.isCurrent?"current":"obsolete",fileName:file.originalName,
    uploadedBy:file.responsible,validator:"",modifiedAt:file.createdAt,changeReason:"",mimeType:file.mimeType,sizeBytes:file.sizeBytes??undefined,
    previewStatus:file.previewStatus,previewPath:file.previewPath??undefined}));
  return <div className="historical-minutes-backdrop"><section role="dialog" aria-modal="true" aria-label={"Vista de "+file.originalName}>
    <div className={styles.recordTools}><button type="button" className="button button-secondary" onClick={onClose}>Cerrar</button>
    <button type="button" className="button button-secondary" onClick={onDownload}>Descargar original</button></div>
    <DocumentPreviewViewer code={file.displayName || file.originalName} version={version} sourceUrl={sourceUrl} onReadyChange={ready}/></section></div>;
}
