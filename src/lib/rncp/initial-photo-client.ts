import { rncpRequest } from "./client";
import { type InitialPhotoManifest } from "./initial-photos";
export const readInitialPhotos=(id:string)=>rncpRequest<InitialPhotoManifest>("/photos?reportId="+encodeURIComponent(id));
export const prepareInitialPhotos=()=>rncpRequest<{available:boolean}>("/photos");
export async function stageInitialPhoto(id:string,file:File,onProgress?:(percent:number)=>void) {
 const body=new FormData();body.set("reportId",id);body.set("file",file);
 if(!onProgress)return (await rncpRequest<{id:string}>("/photos",{method:"POST",body})).id;
 return new Promise<string>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open("POST","/api/suppliers/rncp/photos");xhr.responseType="json";xhr.timeout=120000;
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(100,Math.round(event.loaded/event.total*100)));};
  xhr.onload=()=>{const result=xhr.response;if(xhr.status>=200&&xhr.status<300&&typeof result?.id==="string")resolve(result.id);else reject(new Error(result?.error??"No se pudo confirmar la fotografía. Conserva la selección para reintentar."));};
  xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(new Error("La transferencia se interrumpió. Conserva la selección para reintentar sin duplicarla."));
  xhr.send(body);
 });
}
export class PhotoCommitUncertain extends Error {
 constructor(message:string,public current:InitialPhotoManifest|null){super(message);}
}
export async function commitInitialPhotos(id:string,ids:string[],revision:number,reason:string) {
 try {return await rncpRequest<InitialPhotoManifest>("/photos",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reportId:id,fileIds:ids,revision,reason})});}
 catch(error){
  let current:InitialPhotoManifest|null=null;try{current=await readInitialPhotos(id);}catch{}
  throw new PhotoCommitUncertain((error instanceof Error?error.message:"No se confirmó el guardado.")+" Consulta la versión guardada para conciliar; no se repetirá una confirmación antigua.",current);
 }
}
