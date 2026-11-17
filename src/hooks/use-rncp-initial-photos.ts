"use client";
import { useEffect,useRef,useState } from "react";
import { MAX_INITIAL_PHOTOS,MAX_INITIAL_PHOTO_BYTES,MAX_INITIAL_PHOTO_TOTAL,validatePhotoEnvelope,initialPhotoUrl,type InitialPhotoManifest } from "@/lib/rncp/initial-photos";
import { readInitialPhotos,prepareInitialPhotos,stageInitialPhoto,commitInitialPhotos,PhotoCommitUncertain } from "@/lib/rncp/initial-photo-client";
import { preparePhoto,type PhotoPreparation,type PhotoPolicy } from "@/lib/images/prepare-photo";
export const RNCP_PHOTO_POLICY:PhotoPolicy={allowed:["image/jpeg","image/png","image/webp"],maxInputBytes:32*1024*1024,maxStoredBytes:MAX_INITIAL_PHOTO_BYTES,maxInputEdge:8192,maxInputPixels:25_000_000,maxEdge:2048,quality:0.8};
export interface PhotoSelection {key:string;name:string;sha256:string;size:number;preview:string;fullUrl?:string;file?:File;uploadedId?:string;originalFile?:File;sourceSha?:string;preparation?:PhotoPreparation;}
const hash=async(file:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,"0")).join("");
export function useRncpInitialPhotos(reportId?:string,enabled=true) {
 const [entries,setEntries]=useState<PhotoSelection[]>([]),ref=useRef(entries),revision=useRef(0),[dirty,setDirty]=useState(false);
 const [loading,setLoading]=useState(Boolean(reportId&&enabled)),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reason,setReason]=useState("Captura inicial del defecto");
 const [needsReconcile,setNeedsReconcile]=useState(false),[remoteManifest,setRemoteManifest]=useState<InitialPhotoManifest|null>(null);const savedId=useRef(reportId);
 const [fineDetail,setFineDetail]=useState(false),[progress,setProgress]=useState<{phase:string;current:number;total:number;percent?:number}|null>(null);
 const fullCache=useRef(new Map<string,Promise<Blob>>());
 const adding=useRef(false); const [ready,setReady]=useState(!reportId||!enabled);
 const urls=useRef(new Set<string>()),loaded=useRef(!reportId||!enabled);
 const replace=(items:PhotoSelection[])=>{ref.current=items;setEntries(items);};
 const apply=(id:string,m:InitialPhotoManifest)=>{revision.current=m.revision;replace(m.files.map(f=>({key:f.id,uploadedId:f.id,name:f.name,sha256:f.sha256,size:f.size,preview:initialPhotoUrl(id,f.id)+"&variant=thumbnail",fullUrl:initialPhotoUrl(id,f.id)})));for(const u of urls.current)URL.revokeObjectURL(u);urls.current.clear();setDirty(false);loaded.current=true;setReady(true);setError("");setNeedsReconcile(false);setRemoteManifest(null);};
 useEffect(()=>{let active=true;if(!reportId||!enabled)return;void readInitialPhotos(reportId).then(m=>{if(active){revision.current=m.revision;const items=m.files.map(f=>({key:f.id,uploadedId:f.id,name:f.name,sha256:f.sha256,size:f.size,preview:initialPhotoUrl(reportId,f.id)+"&variant=thumbnail",fullUrl:initialPhotoUrl(reportId,f.id)}));ref.current=items;setEntries(items);loaded.current=true;setReady(true);if(items.length)setReason("");}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reportId,enabled]);
 useEffect(()=>{const cache=fullCache.current,ownedUrls=urls.current;cache.clear();return()=>{cache.clear();for(const u of ownedUrls)URL.revokeObjectURL(u);};},[reportId]);
 async function add(files:FileList|File[]){if(adding.current||!loaded.current)return;adding.current=true;setBusy(true);setError("");const failures:string[]=[];try{
 const next=[...ref.current],batch=Array.from(files);let index=0;
 for(const original of batch){index++;try{
  if(next.length>=MAX_INITIAL_PHOTOS)throw new Error("Máximo 12 fotografías.");
  const preparation=await preparePhoto(original,{...RNCP_PHOTO_POLICY,...(fineDetail?{maxEdge:4096,quality:0.92}:{})},phase=>setProgress({phase,current:index,total:batch.length}));
  const file=preparation.file,bytes=new Uint8Array(await file.arrayBuffer());validatePhotoEnvelope(file.name,file.size,bytes,file.type);
  // SHA and identity belong to the exact prepared bytes that will be uploaded.
  const sha=await hash(file),sourceSha=file===original?sha:await hash(original);
  if(next.some(p=>p.sha256===sha||p.sourceSha===sourceSha||p.sha256===sourceSha))throw new Error("Fotografía duplicada.");
  if(next.reduce((n,p)=>n+p.size,0)+file.size>MAX_INITIAL_PHOTO_TOTAL)throw new Error("Máximo 24 MB en total.");
  const preview=URL.createObjectURL(preparation.thumbnail);urls.current.add(preview);
  next.push({key:crypto.randomUUID(),name:file.name,sha256:sha,sourceSha,size:file.size,file,preview,originalFile:original,preparation});
 }catch(e){failures.push(original.name+": "+(e instanceof Error?e.message:"Archivo no válido."));}}
 if(next.length!==ref.current.length){replace(next);setDirty(true);}if(failures.length)setError(failures.join(" "));
 }finally{adding.current=false;setBusy(false);setProgress(null);}}
 async function keepOriginal(key:string){const p=ref.current.find(p=>p.key===key);if(!p?.originalFile||p.uploadedId||busy)return;
 setBusy(true);setError("");try{const file=p.originalFile;
  validatePhotoEnvelope(file.name,file.size,new Uint8Array(await file.arrayBuffer()),file.type);
  if(ref.current.reduce((n,x)=>n+(x.key===key?file.size:x.size),0)>MAX_INITIAL_PHOTO_TOTAL)throw new Error("El original excede el límite total de 24 MB.");
  const sha=await hash(file);if(ref.current.some(x=>x.key!==key&&x.sha256===sha))throw new Error("Fotografía duplicada.");
  replace(ref.current.map(x=>x.key===key?{...x,name:file.name,size:file.size,sha256:sha,file,preparation:undefined}:x));setDirty(true);
 }catch(e){setError(e instanceof Error?e.message:"No se conservó el original.");}finally{setBusy(false);}}
 async function fullPhoto(key:string){const p=ref.current.find(p=>p.key===key);if(!p)throw new Error("Fotografía no disponible.");if(p.file)return p.file;
 if(!p.fullUrl)throw new Error("No se encontró la fotografía completa.");
 let pending=fullCache.current.get(p.fullUrl);if(!pending){pending=fetch(p.fullUrl,{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("No se pudo recuperar "+p.name+".");return r.blob();});fullCache.current.set(p.fullUrl,pending);const url=p.fullUrl;void pending.catch(()=>fullCache.current.delete(url));}return pending;
 }
 async function reload(){if(dirty)throw new Error("Conserva o guarda primero la selección local.");if(!reportId)return;setLoading(true);try{apply(reportId,await readInitialPhotos(reportId));}catch(e){setError(e instanceof Error?e.message:"No se consultaron las fotografías.");}finally{setLoading(false);}}
 function remove(key:string){const p=ref.current.find(p=>p.key===key);if(p?.preview.startsWith("blob:")){URL.revokeObjectURL(p.preview);urls.current.delete(p.preview);}replace(ref.current.filter(p=>p.key!==key));setDirty(true);}
 function move(key:string,delta:number){const next=[...ref.current],i=next.findIndex(p=>p.key===key),j=i+delta;if(i<0||j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];replace(next);setDirty(true);}
 async function prepare(){if(dirty){if(reason.trim().length<5)throw new Error("Indica un motivo de al menos cinco caracteres para guardar las fotografías.");await prepareInitialPhotos();}}
 async function save(id:string){if(!dirty)return;if(needsReconcile)throw new Error("Consulta la versión guardada y concilia antes de confirmar.");savedId.current=id;setBusy(true);try{
  const snapshot=[...ref.current];let sent=0;for(const p of snapshot){if(!p.uploadedId){if(!p.file)throw new Error("La fotografía local ya no está disponible.");setProgress({phase:"Subiendo fotografía",current:sent+1,total:snapshot.length,percent:0});p.uploadedId=await stageInitialPhoto(id,p.file,percent=>setProgress({phase:percent===100?"Verificando y registrando fotografía":"Subiendo fotografía",current:sent+1,total:snapshot.length,percent}));replace(ref.current.map(x=>x.key===p.key?{...x,uploadedId:p.uploadedId}:x));}sent++;}
  setProgress({phase:"Confirmando orden de fotografías",current:snapshot.length,total:snapshot.length});
  const current=await commitInitialPhotos(id,snapshot.map(p=>p.uploadedId!),revision.current,reason);
  if(current.files.length!==snapshot.length||current.files.some((p,i)=>p.id!==snapshot[i].uploadedId))throw new Error("El orden guardado no coincide; conserva la selección para revisar.");
  apply(id,current);setReason("");
 }catch(e){if(e instanceof PhotoCommitUncertain)setNeedsReconcile(true);setError(e instanceof Error?e.message:"No se guardaron las fotografías.");throw e;}finally{setBusy(false);setProgress(null);}}
 // Explicit user action; never silently treats an old commit as successful.
 async function reconcile(){const id=savedId.current;if(!id)return;setLoading(true);try{
  const current=await readInitialPhotos(id);setRemoteManifest(current);
  if(current.files.length!==ref.current.length || current.files.some((f,i)=>f.id!==ref.current[i].uploadedId)){
   throw new Error("La versión guardada es distinta. Revisa su listado y elige explícitamente qué selección conservar; no se ha sobrescrito ninguna fotografía.");
  }
  apply(id,current);setReason("");
 }catch(e){setError(e instanceof Error?e.message:"No se pudo conciliar.");}finally{setLoading(false);}}
 function useStoredVersion(){if(savedId.current&&remoteManifest){apply(savedId.current,remoteManifest);setReason("");}}
 function keepLocalSelection(){if(remoteManifest){revision.current=remoteManifest.revision;setNeedsReconcile(false);setRemoteManifest(null);setReason("");setError("Selección local conservada sobre la revisión consultada. Indica un motivo antes de confirmar su sustitución.");}}
 async function blobs(){if(!loaded.current)throw new Error("Consulta primero las fotografías guardadas; no se generará un PDF incompleto.");return Promise.all(ref.current.map(async p=>({name:p.name,blob:await fullPhoto(p.key)})));}
 return{entries,fineDetail,setFineDetail,progress,keepOriginal,fullPhoto,dirty,loading,busy,error,ready,reload,needsReconcile,reconcile,remoteManifest,useStoredVersion,keepLocalSelection,reason,setReason,add,remove,move,prepare,save,blobs};
}
