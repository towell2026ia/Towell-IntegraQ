"use client";
import {useEffect,useState} from "react";
import {ROOT2CAUSE_REDBOOTH_TARGET as target} from "@/lib/root2cause/redbooth-target";
import type {CorrectiveAction} from "@/lib/types";
type RecordState={item:string;sync_state:"synced"|"error"|"pending";remote_id:string|null};

export function A3RedboothPlan({action}:{action:CorrectiveAction}) {
  const [review,setReview]=useState(false),[records,setRecords]=useState<RecordState[]>([]);
  const [message,setMessage]=useState(""),[loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if (!review) return;
    let active=true;
    fetch("/api/root2cause/plan-followup?action="+encodeURIComponent(action.id),{cache:"no-store"}).then(async response=>{
      if(!response.ok) throw new Error();
      const result=await response.json();
      if(active){setRecords(result.records); setLoaded(true); setMessage("");}
    }).catch(()=>{if(active){setLoaded(false);setRecords([]);setMessage("No se pudo verificar el registro de sincronización.");}});
    return ()=>{active=false;};
  },[action.id,review]);
  function state(item:string) {
    if (!loaded) return "Sin verificar";
    const record=records.find(r=>r.item===item);
    if(record?.sync_state==="synced" && record.remote_id) return "Sincronizado · tarea "+record.remote_id;
    if(record?.sync_state==="error") return "Error · requiere conciliación antes de reintentar";
    return "Pendiente";
  }
  return <section className="print-hidden a3-stage-content"><h3>Plan de acción en Redbooth</h3>
    <p>Destino <a href={target.url} target="_blank" rel="noreferrer">QTW · proyecto {target.projectId} · lista {target.listId}</a>. Escritura desde producción pendiente de verificar.</p>
    <button type="button" className="button button-secondary" onClick={()=>setReview(v=>!v)}>Revisar tareas propuestas</button>
    {review && <><h4>Tarea principal · {action.folio}</h4><p>{action.title} · {state("principal")}</p>{message && <p role="status">{message}</p>}
      <h5>Subtareas del plan</h5>{action.a3?.plans.map(p=><article key={p.id}><strong>{p.description}</strong><p>{state(p.id)}</p>
      <p>Responsable por conciliar: {p.owner||"Pendiente"} · Compromiso: {p.dueDate||"Pendiente"}</p><p>Causa: {p.cause||action.a3?.rootCause||"Pendiente"} · Resultado: {p.expectedResult||"Pendiente"}</p>
      <p>Evidencia: {p.completionEvidence||"Pendiente"} · Eficacia: {p.effectivenessMethod||"Pendiente"}</p>
      {p.redboothUrl && /^https:\/\/(www\.)?redbooth\.com\//.test(p.redboothUrl) && <a href={p.redboothUrl} rel="noreferrer" target="_blank">Ver tarea vinculada</a>}</article>)}</>}
    </section>;
}
