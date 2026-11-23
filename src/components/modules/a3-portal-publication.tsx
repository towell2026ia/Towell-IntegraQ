"use client";
import {useEffect,useState} from "react";
import {listAttachments} from "@/lib/attachment-storage";
import {a3EvidenceKey} from "./a3-step-evidence";
import type {CorrectiveAction} from "@/lib/types";

export function A3PortalPublication({action,busy,onPublish,onWithdraw}:{action:CorrectiveAction;busy:boolean;onPublish:(ids:string[])=>void;onWithdraw:()=>void}) {
  const [files,setFiles]=useState<{id:string;originalName:string}[]>([]);
  const [checked,setChecked]=useState<string[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const group=action.a3?.evidenceId;
    if (!action.portalVisible && group && action.a3) {
      const sections=[...Array.from({length:8},(_,i)=>i),...action.a3.plans.map(plan=>plan.id)];
      void Promise.all(sections.map(step=>listAttachments({moduleId:"corrective-actions",resourceType:"root2cause_evidence",
        resourceKey:a3EvidenceKey(group,step),processId:action.processId}))).then(results=>{
        if(active)setFiles([...new Map(results.flat().map(f=>[f.id,f])).values()]);
      }).catch(()=>{if(active)setError("No se pudieron consultar los adjuntos para incluirlos.");});
    }
    return ()=>{active=false;};
  },[action]);
  return <div className="party-detail-section">
    <p>{action.portalVisible ? "Expediente publicado para su cliente." : "Expediente privado hasta autorizar su publicación para el cliente."}</p>
    {!action.portalVisible && files.length>0 && <fieldset><legend>Evidencias que se incluirán en el portal</legend>{files.map(f=><label key={f.id}>
      <input type="checkbox" checked={checked.includes(f.id)} disabled={busy} onChange={e=>setChecked(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/>{f.originalName}
    </label>)}</fieldset>}
    {error && <p role="status">{error}</p>}
    <button className="button button-secondary" type="button" disabled={busy || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(action.relatedPartyId ?? "")} onClick={()=>action.portalVisible?onWithdraw():onPublish(checked.filter(id=>files.some(f=>f.id===id)))}>
      {action.portalVisible?"Retirar del portal":"Autorizar publicación"}
    </button>
  </div>;
}
