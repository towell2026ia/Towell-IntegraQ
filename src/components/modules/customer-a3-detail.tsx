"use client";
import {useEffect,useState} from "react";
import {readCustomerLink} from "@/lib/customer-portal-link-client";

type Detail = {folio:string;title:string;area:string;problem:string;eventType?:string;rootCause?:string;nonDetection?:string;status:string;dueDate:string;progress:number;
  characterization:{label:string;value:string}[]; causeAnalysis:string[]; detectionAnalysis:string[];
  plans:{id:string;description:string;dueDate:string;status:string}[];evidence:{id:string;name:string}[]};
function read(path:string, key?:string, signal?:AbortSignal) {
  return key ? readCustomerLink(path,key,signal) : fetch("/api/customer-portal"+path,{cache:"no-store", signal});
}
export function CustomerA3Detail({id,accessKey,back}:{id:string;accessKey?:string;back:()=>void}) {
  const [item,setItem]=useState<Detail|null>(null), [error,setError]=useState("");
  const path="/actions/"+encodeURIComponent(id);
  useEffect(()=>{
    const controller=new AbortController();
    void read(path,accessKey,controller.signal).then(async r=>{
      if (!r.ok) throw new Error(); const data=await r.json(); if (!controller.signal.aborted) setItem(data);
    }).catch(()=>{if(!controller.signal.aborted)setError("Expediente no disponible.");});
    return ()=>controller.abort();
  },[path,accessKey]);
  async function openEvidence(fileId:string) {
    const tab=window.open("about:blank","_blank");
    if(!tab){setError("Permite abrir una pestaña para consultar el archivo.");return;}
    tab.opener=null;
    try{
      const r=await read(path+"/evidence/"+encodeURIComponent(fileId),accessKey);
      if(!r.ok)throw new Error();
      const {url}=await r.json();if(new URL(url).protocol!=="https:")throw new Error();
      tab.location.replace(url);
    }catch{tab.close();setError("Evidencia no disponible.");}
  }
  return <section className="party-detail-section"><button className="button button-secondary" type="button" onClick={back}>Volver a Mis análisis A3</button>
    {error && <p role="alert">{error}</p>}{!item && !error && <p role="status">Consultando expediente…</p>}
    {item && <><header><code>{item.folio}</code><h3>{item.title}</h3></header>
      <p>{item.problem}</p><dl>{[["Área",item.area],["Tipo de evento",item.eventType],["Causa raíz",item.rootCause],["Causa de no detección",item.nonDetection],
        ["Estado",item.status],["Avance",item.progress+"%"],["Vencimiento",item.dueDate]].map(([label,value])=>value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {item.characterization.length>0 && <><h4>Descripción del problema</h4><dl>{item.characterization.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></>}
      {[["Análisis de causa raíz",item.causeAnalysis],["Análisis de no detección",item.detectionAnalysis]].map(([heading,answers]) =>
        Array.isArray(answers) && answers.length>0 && <div key={String(heading)}><h4>{String(heading)}</h4><ol>{answers.map((answer,i)=><li key={i}>{answer}</li>)}</ol></div>)}
      <h4>Planes de acción</h4>{item.plans.length ? item.plans.map(p=><article key={p.id}><strong>{p.description}</strong><p>{p.status} · {p.dueDate}</p></article>) : <p>Sin planes registrados.</p>}
      <h4>Evidencias autorizadas</h4>{item.evidence.length ? item.evidence.map(f=><button key={f.id} className="button button-secondary" type="button" onClick={()=>void openEvidence(f.id)}>{f.name}</button>) : <p>Sin evidencias autorizadas para este expediente.</p>}</>}
  </section>;
}
