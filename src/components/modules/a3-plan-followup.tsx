"use client";
import { useEffect, useState } from "react";

interface Plan {
  plan_id: string; folio: string; description: string; owner_name: string; due_date: string;
  status: string; note: string | null; effectiveness: string | null; review_note: string | null;
  revision: number; evidence: {id:string; name:string}[];
}
type Member = {id:string;fullName:string};
const statuses: Record<string,string> = {pending:"Pendiente", in_progress:"En curso", completed:"Cumplida"};
async function readPlans(): Promise<Plan[]> {
  const response = await fetch("/api/root2cause/plan-followup",{cache:"no-store"});
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.plans)) throw new Error(result.error ?? "No se pudo consultar el seguimiento.");
  return result.plans;
}
export function A3PlanFollowup({write,quality,openPlan}:{write:boolean;quality:boolean;openPlan?:(id:string)=>(()=>void)|undefined}) {
  const [plans,setPlans] = useState<Plan[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [owner,setOwner] = useState(""), [status,setStatus] = useState(""), [date,setDate] = useState("");
  const [members,setMembers] = useState<Member[]>([]), [catalogError,setCatalogError] = useState("");
  useEffect(() => {
    if (!quality || !write) return;
    let current = true;
    fetch("/api/root2cause/responsible-users",{cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (current) setMembers(data.users);
    }).catch(() => { if (current) setCatalogError("No se pudo consultar el catálogo para reasignar."); });
    return () => { current=false; };
  },[quality,write]);
  const [refresh,setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    readPlans().then(items => { if (current) { setPlans(items); setError(""); } })
      .catch(e => { if (current) { setError(e.message); setPlans([]); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  },[refresh]);
  const rows = plans.filter(p => (!owner || p.owner_name === owner) && (!status || p.status === status) && (!date || p.due_date === date));
  return <section className="records-panel"><h3>Seguimiento de acciones</h3>
    <label>Responsable <select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Todos</option>{[...new Set(plans.map(p=>p.owner_name).filter(Boolean))].map(name=><option key={name}>{name}</option>)}</select></label>
    <label>Estado <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(statuses).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
    <label>Compromiso <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <button type="button" className="button button-secondary" onClick={()=>{setLoading(true);setRefresh(v=>v+1);}}>Actualizar</button>
    {catalogError && <p role="alert">{catalogError}</p>}{error && <p role="alert">{error}</p>}{loading ? <p role="status">Consultando acciones…</p> : rows.map(p=><PlanProgress key={p.plan_id+":"+p.revision} openReport={openPlan?.(p.plan_id)} plan={p} members={members} write={write} quality={quality} onUpdate={()=>{setLoading(true);setRefresh(v=>v+1);}}/>)}
    {!loading && !error && !rows.length && <p>Sin acciones para esta consulta.</p>}</section>;
}
function PlanProgress({plan,members,write,quality,onUpdate,openReport}:{openReport?:()=>void;plan:Plan;members:Member[];write:boolean;quality:boolean;onUpdate:()=>void}) {
  const [note,setNote]=useState(""),[fileId,setFileId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [ownerId,setOwnerId]=useState("");
  async function record(command: string) {
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/root2cause/plan-followup",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:plan.plan_id,revision:plan.revision,command,note,fileId,ownerId})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error ?? "No se confirmó el avance.");
      onUpdate();
    } catch(e) { setError(e instanceof Error ? e.message : "No se confirmó el avance."); }
    finally { setBusy(false); }
  }
  return <article><h4>{plan.folio} · {plan.description}</h4>{openReport && <button type="button" className="button button-secondary" onClick={openReport}>Ver expediente A3</button>}<p>{plan.owner_name || "Sin responsable"} · {plan.due_date} · {statuses[plan.status]}</p>
    <p>Avance: {plan.note || "Sin registrar"}</p><p>Eficacia: {plan.effectiveness==="effective" ? "Verificada" : plan.effectiveness==="ineffective" ? "Insuficiente" : "Pendiente"} {plan.review_note}</p>
    {write && <fieldset disabled={busy}><label>Nota de seguimiento <textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      {quality && plan.status !== "completed" && <><label>Reasignar a <select value={ownerId} onChange={e=>setOwnerId(e.target.value)}><option value="">Seleccionar responsable interno</option>{members.map(m=><option key={m.id} value={m.id}>{m.fullName}</option>)}</select></label><button type="button" disabled={!ownerId || !note.trim()} onClick={()=>void record("assign")}>Confirmar asignación</button></>}
      <button type="button" disabled={!note.trim()} onClick={()=>void record("progress")}>Registrar avance</button>
      <label>Evidencia final del plan <select value={fileId} onChange={e=>setFileId(e.target.value)}><option value="">Seleccionar evidencia vigente</option>{plan.evidence.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button type="button" disabled={!note.trim() || !fileId} onClick={()=>void record("complete")}>Registrar cumplimiento</button>
      {quality && plan.status==="completed" && <><button type="button" disabled={!note.trim()} onClick={()=>void record("effective")}>Confirmar eficacia</button><button type="button" disabled={!note.trim()} onClick={()=>void record("ineffective")}>Registrar eficacia insuficiente</button></>}
    </fieldset>}{error && <p role="alert">{error}</p>}</article>;
}
