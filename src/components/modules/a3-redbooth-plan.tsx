"use client";
import {useEffect,useState} from "react";
import {ROOT2CAUSE_REDBOOTH_TARGET as target, readSyncRecords, getPlanSync, type SyncRecord} from "@/lib/root2cause/redbooth-target";
import type {CorrectiveAction} from "@/lib/types";

export function A3RedboothPlan({action}:{action:CorrectiveAction}) {
  const [review,setReview]=useState(false), [records,setRecords]=useState<SyncRecord[]|null>(null);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    if (!review) return;
    const controller=new AbortController();
    readSyncRecords(action.id,controller.signal).then(rows=>{
      if(!controller.signal.aborted) setRecords(rows);
    }).catch(()=>{if(!controller.signal.aborted) setMessage("No se pudo verificar el registro de sincronización.");});
    return ()=>controller.abort();
  },[action.id,review]);
  function link(item:string,previousUrl?:string) {
    const state=getPlanSync(records,item,previousUrl);
    return <p>{state.label} {state.url && <a href={state.url} target="_blank" rel="noreferrer">Ver en Redbooth</a>}</p>;
  }
  return <section className="print-hidden a3-stage-content"><h3>Plan de acción en Redbooth</h3>
    <p>Destino <a href={target.url} target="_blank" rel="noreferrer">QTW · lista {target.listId}</a>. Escritura pendiente de habilitación por el administrador del conector.</p>
    <button type="button" className="button button-secondary" aria-expanded={review} onClick={()=>{setRecords(null);setMessage("");setReview(v=>!v);}}>Revisar tareas propuestas</button>
    {review && <><h4>Tarea principal · {action.folio}</h4><p>{action.title}</p>{link("principal")}{message && <p role="alert">{message}</p>}
      <h5>Subtareas del plan</h5>{action.a3?.plans.map(p=><article key={p.id}><strong>{p.description}</strong>{link(p.id,p.redboothUrl)}
      <p>Responsable por conciliar: {p.owner||"Pendiente"} · Compromiso: {p.dueDate||"Pendiente"}</p><p>Causa: {p.cause||action.a3?.rootCause||"Pendiente"} · Resultado: {p.expectedResult||"Pendiente"}</p>
      <p>Evidencia: {p.completionEvidence||"Pendiente"} · Eficacia: {p.effectivenessMethod||"Pendiente"}</p></article>)}</>}
    </section>;
}
