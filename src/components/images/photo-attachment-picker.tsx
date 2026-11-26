"use client";
/* eslint-disable @next/next/no-img-element -- Local blob previews; no external/public image optimizer. */
import {useEffect,useRef,useState} from "react";
import {preparePhoto,type PhotoPreparation} from "@/lib/images/prepare-photo";
import {attachmentPhotoPolicy,type AttachmentPhotoScope} from "@/lib/images/attachment-photo-policy";
import { attachmentDescription } from "@/lib/attachment-description";
import styles from "./photo-attachment-picker.module.css";
type Selected={key:string;source:File;prepared:PhotoPreparation;file:File;preview:string;sourceSha:string};
const sha=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,"0")).join("");
export function PhotoAttachmentPicker({scope,disabled=false,onAccept,onPendingChange,label="Agregar fotografías",confirmLabel="Usar fotografías",camera=false}:{scope:AttachmentPhotoScope;disabled?:boolean;onAccept:(file:File)=>Promise<void>|void;onPendingChange?:(pending:boolean)=>void;label?:string;confirmLabel?:string;camera?:boolean}) {
 const [items,setItems]=useState<Selected[]>([]),current=useRef(items),[working,setWorking]=useState(false),workingRef=useRef(false),[fine,setFine]=useState(false),[phase,setPhase]=useState(""),[error,setError]=useState("");
 const [preparingPhotos, setPreparingPhotos] = useState<File[]>([]);
 const urls=useRef(new Set<string>()),alive=useRef(true),dialog=useRef<HTMLDialogElement>(null),[view,setView]=useState<{url:string;original:string;name:string}|null>(null);
 useEffect(()=>{alive.current=true;const owned=urls.current;return()=>{alive.current=false;for(const u of owned)URL.revokeObjectURL(u);owned.clear();};},[]);
 useEffect(()=>{onPendingChange?.(working||items.length>0);},[working,items.length,onPendingChange]);
 useEffect(()=>()=>onPendingChange?.(false),[onPendingChange]);
 useEffect(()=>{if(view){dialog.current?.showModal();return()=>{URL.revokeObjectURL(view.url);URL.revokeObjectURL(view.original);};}},[view]);
 const replace=(next:Selected[])=>{current.current=next;setItems(next);};
 async function add(files: File[], replacing?: Selected) {
   if (workingRef.current || disabled) return;
   workingRef.current = true;
   setWorking(true);
   setError("");
   const next = [...current.current], failures: string[] = [];
   if (scope === "supplier-response") setPreparingPhotos(files);
   try {
     let n = 0;
     for (const source of files) {
       n++;
       if (!alive.current) break;
       try {
         if (!replacing && next.length >= 12) {
           throw new Error(
             "Confirma este lote de hasta 12 fotografías antes de agregar otro.",
           );
         }
         const prepared = await preparePhoto(
           source,
           attachmentPhotoPolicy(scope, fine),
           (p) => {
             if (alive.current) setPhase(`${p} · ${n}/${files.length}`);
           },
         );
         const sourceSha = await sha(source);
         if (
           next.some((p) =>
             p.key !== replacing?.key && p.sourceSha === sourceSha
           )
         ) throw new Error("Fotografía duplicada en la selección.");
         if (!alive.current) break;
         const preview = URL.createObjectURL(prepared.thumbnail);
         urls.current.add(preview);
         const item = {
           key: replacing?.key ?? crypto.randomUUID(),
           source,
           prepared,
           file: prepared.file,
           preview,
           sourceSha,
         };
         if (replacing) {
           next[next.indexOf(replacing)] = item;
           URL.revokeObjectURL(replacing.preview);
           urls.current.delete(replacing.preview);
         } else {
           next.push(item);
         }
       } catch (e) {
         failures.push(
           `${source.name}: ${
             e instanceof Error ? e.message : "Fotografía no válida."
           }`,
         );
       }
     }
     if (alive.current) {
       replace(next);
       setError(failures.join(" "));
       if (scope === "supplier-response") setPreparingPhotos([]);
     }
   } finally {
     workingRef.current = false;
     if (alive.current) {
       setWorking(false);
       setPhase("");
     }
   }
 }
 function remove(key:string){const p=current.current.find(p=>p.key===key);if(p){URL.revokeObjectURL(p.preview);urls.current.delete(p.preview);}replace(current.current.filter(p=>p.key!==key));}
 function original(p:Selected){if(p.source.size>attachmentPhotoPolicy(scope).maxStoredBytes){setError("El original supera el límite de carga de este formulario; conserva la versión preparada o selecciona otra fotografía.");return;}replace(current.current.map(x=>x.key===p.key?{...x,file:x.source}:x));setError("");}
 async function accept(){if(workingRef.current||disabled)return;workingRef.current=true;setWorking(true);setError("");try{
  const batch=[...current.current];for(let n=0;n<batch.length;n++){const p=batch[n];setPhase(`Confirmando fotografía · ${n+1}/${batch.length}`);await onAccept(p.file);if(!alive.current)return;remove(p.key);}
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:"No se confirmó la carga. Se conservan únicamente las fotografías pendientes para reintentar.");}
 finally{workingRef.current=false;if(alive.current){setWorking(false);setPhase("");}}}
 const blocked=disabled||working;
 return <section className={styles.panel} aria-label={label}>
 <strong>{label}</strong><p>Fotos nuevas JPG, JPEG, PNG o WEBP. Se preparan antes de transferir; los originales locales no cambian. Para documentos oficiales, logotipos o archivos exactos utiliza la carga de documentos sin compresión.</p>
 <label className={styles.option}><input type="checkbox" checked={fine} disabled={blocked} onChange={e=>setFine(e.target.checked)}/>Mayor detalle para etiquetas, lotes y defectos (hasta 4096 px / calidad 92 %)</label>
 <label>Seleccionar fotografías<input aria-label={`${label}: seleccionar`} accept=".jpg,.jpeg,.png,.webp" multiple type="file" disabled={blocked} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void add(files);}}/></label>
 {camera?<label>Tomar fotografía<input aria-label={`${label}: cámara`} accept="image/jpeg,image/png,image/webp" capture="environment" type="file" disabled={blocked} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void add(files);}}/></label>:null}
 {phase?<p role="status" aria-live="polite">{phase}</p>:null}{error?<p role="alert">{error}</p>:null}
 {preparingPhotos.length > 0 && <ul aria-label="Fotos en preparación">{preparingPhotos.map((file,i) =>
   <li key={i}><strong>{file.name}</strong><small>{attachmentDescription(file)} · Pendiente de guardar</small></li>
 )}</ul>}
 <ul>{items.map(p=><li key={p.key}><button type="button" disabled={blocked} aria-label={`Comparar ${p.source.name}`} onClick={()=>setView({url:URL.createObjectURL(p.file),original:URL.createObjectURL(p.source),name:p.source.name})}><img src={p.preview} width={384} height={384} loading="lazy" decoding="async" alt={`Miniatura de ${p.source.name}`}/></button><strong>{p.file.name}</strong>
 {scope === "supplier-response" && <>
   <small>{attachmentDescription(p.file)} · Pendiente de guardar</small>
   <label className="button button-secondary file-button">
     Sustituir fotografía
     <input aria-label={`Sustituir ${p.file.name}`} type="file" accept=".jpg,.jpeg,.png,.webp" disabled={blocked}
       onChange={({currentTarget}) => {
         const replacement = currentTarget.files?.[0];
         currentTarget.value = "";
         if (replacement) void add([replacement], p);
       }} />
   </label>
 </>}
 <small>{Math.round(p.source.size/1024)} a {Math.round(p.file.size/1024)} KB · reducción {((1-p.file.size/p.source.size)*100).toFixed(1)} %</small><button type="button" disabled={blocked||p.file===p.source} onClick={()=>original(p)}>Conservar original de {p.source.name}</button><button type="button" disabled={blocked} onClick={()=>remove(p.key)}>Quitar {p.source.name}</button></li>)}</ul>
 {items.length?<><p>Revisa letras y defectos en «Comparar». Confirma las fotos antes de guardar el formulario; hasta entonces sólo están en este navegador.</p><button className="button button-secondary" type="button" disabled={blocked} onClick={()=>void accept()}>{confirmLabel} ({items.length})</button></>:null}
 {view?<dialog ref={dialog} className={styles.viewer} onClose={()=>setView(null)}><header><strong>{view.name}</strong><button type="button" onClick={()=>dialog.current?.close()}>Cerrar comparación</button></header><figure><figcaption>Archivo seleccionado para cargar</figcaption><img src={view.url} alt="Fotografía preparada completa"/></figure><figure><figcaption>Original local sin modificar</figcaption><img src={view.original} alt="Fotografía original completa"/></figure></dialog>:null}
 </section>;
}
