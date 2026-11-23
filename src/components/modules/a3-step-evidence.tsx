"use client";
import {useEffect,useState} from "react";
import {EvidenceManager} from "@/components/evidence/evidence-manager";
import {PhotoAttachmentPicker} from "@/components/images/photo-attachment-picker";
import {uploadAttachment} from "@/lib/attachment-storage";
export function a3EvidenceKey(id:string,step:number|string){return `${id}_${typeof step==='number'?'step':'plan'}_${step}`;}
export function A3StepEvidence({evidenceId,step,processId,readOnly=false,persisted=true}:{evidenceId?:string;step:number|string;processId?:string;readOnly?:boolean;persisted?:boolean}){
 const [access,setAccess]=useState<{enabled:boolean;write:boolean}|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void fetch('/api/root2cause/capabilities',{cache:'no-store'}).then(r=>r.ok?r.json():{enabled:false,write:false}).then(v=>{if(active)setAccess(v);}).catch(()=>{if(active)setAccess({enabled:false,write:false});});return()=>{active=false;};},[]);
 if(!evidenceId)return <p>Las evidencias por etapa requieren vincular este expediente; no se modificó su historial.</p>;
 if(!persisted)return <p role="status">Guarda primero el análisis. Después podrás vincular aquí las evidencias al expediente persistido.</p>;
 if(!processId)return <p role="status">Selecciona un proceso autorizado para consultar o cargar evidencias de esta etapa.</p>;
 if(!access?.enabled)return <p role="status">Evidencias por etapa pendientes de activar los controles de acceso. No se cargaron archivos.</p>;
 const resourceKey=a3EvidenceKey(evidenceId,step),write=access.write&&!readOnly;
 const scope={moduleId:'corrective-actions' as const,resourceType:'root2cause_evidence',resourceKey,processId};
 return (
   <section className="print-hidden">
     <EvidenceManager key={`${resourceKey}:${revision}`} {...scope}
       permissions={{read:true,add:write,replace:false,delete:false,history:true}}
       title="Evidencias de esta etapa" addLabel="Agregar documento original"
       description="Los documentos se conservan sin transformar. Fotografías y documentos quedan vinculados únicamente a esta etapa o acción." />
     {typeof step === "string" && write && (
       <PhotoAttachmentPicker camera scope="indicator-evidence" label="Fotografías de la acción"
         confirmLabel="Cargar fotografías" onAccept={async file => {
           await uploadAttachment(scope, file);
           setRevision(n => n + 1);
         }} />
     )}
   </section>
 );
}
