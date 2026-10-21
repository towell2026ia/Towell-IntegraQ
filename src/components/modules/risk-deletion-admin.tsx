"use client";
import {useState} from "react";
import {changeRiskDeletion} from "@/lib/risk-workspace-storage";
import type {RiskWorkspaceState} from "@/lib/risk-opportunity-data";

export function RiskDeletionAdmin({state,onChange,connected}:{state:RiskWorkspaceState;onChange:(state:RiskWorkspaceState)=>void;connected:boolean}) {
  const [id,setId]=useState("");
  const [reason,setReason]=useState("");
  const [category,setCategory]=useState("capture_error");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function run(action:"delete"|"restore",riskId:string) {
    if(!reason.trim()||!connected||busy)return;
    setBusy(true);setError("");
    try{onChange(await changeRiskDeletion(action,riskId,reason,category));setReason("");setId("");}
    catch(e){setError(e instanceof Error?e.message:"Operación fallida");}
    finally{setBusy(false);}
  }
  return <section className="work-panel"><h3>Registros eliminados</h3><p>La eliminación administrativa conserva el registro, sus acciones y la bitácora. Se requiere motivo también para restaurar.</p>
    {error?<p role="alert">{error}</p>:null}
    <label>Motivo obligatorio<textarea value={reason} onChange={e=>setReason(e.target.value)} required maxLength={1000}/></label>
    <label>Categoría<select value={category} onChange={e=>setCategory(e.target.value)}><option value="test">Prueba</option><option value="duplicate">Duplicado</option><option value="capture_error">Error de captura</option></select></label>
    <label>Registro activo<select value={id} onChange={e=>setId(e.target.value)}><option value="">Seleccionar registro</option>{state.risks.filter(r=>!r.deletedAt).map(r=><option key={r.id} value={r.id}>{r.id} · {r.title}</option>)}</select></label>
    <button className="button button-secondary" type="button" disabled={!id||!reason.trim()||!connected||busy} onClick={()=>void run("delete",id)}>Eliminar con trazabilidad</button>
    {state.risks.filter(r=>r.deletedAt).map(r=><article key={r.id}><h4>{r.id} · {r.title}</h4><p>{r.processId} · {r.deletedAt} · {r.deletedBy}</p><p>{r.deletionCategory}: {r.deletionReason}</p><button className="button button-secondary" type="button" disabled={!reason.trim()||!connected||busy} onClick={()=>void run("restore",r.id)}>Restaurar</button></article>)}
  </section>;
}
