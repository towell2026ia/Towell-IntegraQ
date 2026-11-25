"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, CircleDot, Clock, MoreHorizontal, Search } from "lucide-react";
import type { CorrectiveAction } from "@/lib/types";
import { A3StepEvidence } from "./a3-step-evidence";
import { ROOT2CAUSE_REDBOOTH_ENABLED, getPlanSync, readSyncRecords, type PlanSync } from "@/lib/root2cause/redbooth-target";
import styles from "./a3-plan-followup.module.css";

interface Plan {
  plan_id: string; folio: string; description: string; owner_name: string; due_date: string;
  status: string; note: string | null; effectiveness: string | null; review_note: string | null;
  revision: number; evidence: { id: string; name: string }[];
}
type Member = {id: string; fullName: string};
type Operation = "progress" | "assign" | "evidence" | "complete" | "review" | "history";
const statuses: Record<string, string> = {pending:"Pendiente", in_progress:"En curso", completed:"Cumplida", overdue:"Vencida"};
const metrics = [
  ["pending", "Pendientes", Clock, "neutral"], ["in_progress", "En curso", CircleDot, "warning"],
  ["completed", "Cumplidas", CheckCircle2, "success"], ["overdue", "Vencidas", CalendarClock, "warning"],
] as const;
const queue = "/api/root2cause/plan-followup";
async function loadJson(path: string, options?: RequestInit) {
  const response = await fetch(path, {cache:"no-store", ...options});
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "No fue posible consultar el seguimiento.");
  return result;
}
function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"), String(now.getDate()).padStart(2,"0")].join("-");
}
function matchesState(plan: Plan, state: string, today: string) {
  return state === "overdue" ? Boolean(plan.due_date && plan.due_date < today && plan.status !== "completed") : !state || state === plan.status;
}
export function A3PlanFollowup({write, quality, openPlan, actions}:{
  write:boolean; quality:boolean; actions:CorrectiveAction[]; openPlan?:(id:string)=>(()=>void)|undefined;
}) {
  const [plans,setPlans] = useState<Plan[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [owner,setOwner] = useState(""), [status,setStatus] = useState(""), [date,setDate] = useState("");
  const [folio,setFolio] = useState(""), [search,setSearch] = useState(""), [refresh,setRefresh] = useState(0);
  const [sync,setSync] = useState<Record<string, PlanSync>>({});
  const actionsByPlan = useMemo(() => new Map(actions.flatMap(action => (action.a3?.plans ?? []).map(plan => [plan.id,action] as const))), [actions]);
  function reload() { setLoading(true); setSync({}); setError(""); setRefresh(v=>v+1); }
  useEffect(() => {
    const controller = new AbortController();
    loadJson(queue, {signal: controller.signal}).then(result => {
      if (!Array.isArray(result.plans)) throw new Error("Respuesta de seguimiento incompleta.");
      if (!controller.signal.aborted) setPlans(result.plans);
    }).catch(e => {if (!controller.signal.aborted) {setError(e.message);setPlans([]);}})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[refresh]);
  useEffect(() => {
    if (loading || !ROOT2CAUSE_REDBOOTH_ENABLED) return;
    const controller = new AbortController();
    const grouped = new Map<string, Plan[]>();
    for (const plan of plans) {
      const action = actionsByPlan.get(plan.plan_id);
      if (action) grouped.set(action.id, [...grouped.get(action.id) ?? [], plan]);
    }
    async function resolve() {
      for (const [actionId, items] of grouped) {
        if (controller.signal.aborted) return;
        const records = await readSyncRecords(actionId, controller.signal).catch(()=>null);
        if (controller.signal.aborted) return;
        const entries = items.map(p => [p.plan_id, getPlanSync(records,p.plan_id,actionsByPlan.get(p.plan_id)?.a3?.plans.find(item=>item.id===p.plan_id)?.redboothUrl)]);
        setSync(previous=>({...previous,...Object.fromEntries(entries)}));
      }
    }
    void resolve();
    return () => controller.abort();
  },[plans,actionsByPlan,loading]);
  const today = localDate();
  const query = search.trim().toLocaleLowerCase("es");
  const scoped = plans.filter(p => (!owner || p.owner_name === owner) && (!date || p.due_date === date) &&
    (!folio || folio === p.folio) && (p.folio+" "+p.description).toLocaleLowerCase("es").includes(query));
  const rows = scoped.filter(p=>matchesState(p,status,today));
  return <section aria-label="Seguimiento de acciones" className={styles.followup}>
    <div className={"metric-grid "+styles.metrics} aria-label="Filtrar seguimiento por estado">
      {metrics.map(([value,label,Icon,tone])=><button type="button" className={"metric metric-action metric-"+tone}
        aria-pressed={status===value} key={value} onClick={()=>setStatus(status===value?"":value)}>
        <div className="metric-icon"><Icon size={18} aria-hidden="true"/></div><div><strong>{loading || error ? "—" : scoped.filter(p=>matchesState(p,value,today)).length}</strong><span>{label}</span></div>
      </button>)}
    </div>
    <section className="records-panel"><div className={styles.filters}>
      <label className="panel-search"><Search size={16}/><input aria-label="Buscar por folio o descripción" placeholder="Buscar por folio o descripción" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Responsable<select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Todos</option>{[...new Set(plans.map(p=>p.owner_name).filter(Boolean))].sort().map(name=><option key={name}>{name}</option>)}</select></label>
      <label>Estado<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(statuses).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      <label>Compromiso<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>Folio AC<select value={folio} onChange={e=>setFolio(e.target.value)}><option value="">Todos</option>{[...new Set(plans.map(p=>p.folio))].sort().map(f=><option key={f}>{f}</option>)}</select></label>
      <button className="button button-secondary" type="button" disabled={loading} onClick={reload}>Actualizar</button>
    </div>
    {loading ? <p role="status">Consultando acciones…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>Sin acciones para esta consulta.</p> :
      rows.map(p=><PlanProgress key={p.plan_id+":"+p.revision} plan={p} write={write} quality={quality} openReport={openPlan?.(p.plan_id)}
        action={actionsByPlan.get(p.plan_id)} sync={sync[p.plan_id]} overdue={matchesState(p,"overdue",today)} onUpdate={reload}/>)}
    </section>
  </section>;
}
function PlanProgress({plan,action,write,quality,openReport,sync,overdue,onUpdate}:{
  plan:Plan; action?:CorrectiveAction; write:boolean; quality:boolean; openReport?:()=>void; sync?:PlanSync; overdue:boolean; onUpdate:()=>void;
}) {
  const [op,setOp] = useState<Operation|null>(null), [more,setMore] = useState(false);
  const [note,setNote] = useState(""), [owner,setOwner] = useState(""), [file,setFile] = useState("");
  const [members,setMembers] = useState<Member[]>([]), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [history,setHistory] = useState<{created_at:string; reason:string|null}[]|null>(null);
  const closed = plan.status === "completed";
  function show(next: Operation) {setOp(next);setMore(false);setNote("");setOwner("");setFile("");setError("");setHistory(null);}
  useEffect(()=>{
    const controller = new AbortController();
    const options = {signal:controller.signal};
    if (op === "assign" || op === "history") {
      const assigning = op === "assign";
      loadJson(assigning ? "/api/root2cause/responsible-users" : queue+"?history="+encodeURIComponent(plan.plan_id), options).then(data=>{
        if (controller.signal.aborted) return;
        const items = assigning ? data.users : data.events;
        if (!Array.isArray(items)) throw new Error("Respuesta incompleta.");
        if (assigning) setMembers(items); else setHistory(items);
      }).catch(e=>{if (!controller.signal.aborted) setError(e.message);});
    }
    return ()=>controller.abort();
  },[op,plan.plan_id]);
  async function record(command:string) {
    if (busy) return;
    setBusy(true);setError("");
    try {
      await loadJson(queue,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        id:plan.plan_id, revision:plan.revision, command, note, ownerId:owner, fileId:file,
      })});
      onUpdate();
    } catch(e) {setError(e instanceof Error ? e.message : "No se confirmó el cambio.");}
    finally {setBusy(false);}
  }
  const canNote = Boolean(note.trim()) && !busy;
  return <article className={styles.card}><header><strong>{plan.folio}</strong><span>{statuses[plan.status] ?? plan.status}{overdue && " · Vencida"}</span></header>
    <h3>{plan.description}</h3><dl className={styles.details}>
      <div><dt>Responsable</dt><dd>{plan.owner_name || "Sin asignar"}</dd></div><div><dt>Compromiso</dt><dd>{plan.due_date || "Sin fecha"}</dd></div>
      <div><dt>Avance</dt><dd>{plan.note || "Sin registrar"}</dd></div><div><dt>Eficacia</dt><dd>{plan.effectiveness==="effective"?"Verificada":plan.effectiveness==="ineffective"?"Insuficiente":"Pendiente"} {plan.review_note}</dd></div>
      <div><dt>Redbooth</dt><dd>{ROOT2CAUSE_REDBOOTH_ENABLED ? sync?.label ?? "Sin verificar" : "En espera"}</dd></div></dl>
    <div className={styles.controls}>
      {openReport && <button className="button button-secondary" type="button" onClick={openReport}>Ver expediente A3</button>}
      {write && !closed && <button className="button button-primary" type="button" disabled={busy} onClick={()=>show("progress")}>Registrar avance</button>}
      {ROOT2CAUSE_REDBOOTH_ENABLED && sync?.url && <a className="button button-secondary" href={sync.url} target="_blank" rel="noreferrer">Ver en Redbooth</a>}
      <button className="button button-secondary" type="button" disabled={busy} aria-expanded={more} onClick={()=>setMore(v=>!v)}><MoreHorizontal size={16}/>Más acciones</button>
    </div>
    {more && <div className={styles.controls}>
      {quality && write && !closed && <button type="button" onClick={()=>show("assign")}>Reasignar responsable</button>}
      {write && !closed && action?.processId && <button type="button" onClick={()=>show("evidence")}>Adjuntar evidencia final</button>}
      {write && !closed && <button type="button" onClick={()=>show("complete")}>Registrar cumplimiento</button>}
      {quality && write && closed && <button type="button" onClick={()=>show("review")}>Verificar eficacia</button>}
      <button type="button" onClick={()=>show("history")}>Consultar historial</button>
    </div>}
    {op && <fieldset className={styles.form} disabled={busy}><legend>{{progress:"Registrar avance",assign:"Reasignar responsable",evidence:"Adjuntar evidencia final",complete:"Registrar cumplimiento",review:"Verificar eficacia",history:"Historial del plan · últimos 100 eventos visibles"}[op]}</legend>
      {op==="evidence" && action && <A3StepEvidence evidenceId={action.a3?.evidenceId || action.id} step={plan.plan_id} processId={action.processId}/>}
      {op==="history" && (history ? history.length ? <ul>{history.map((event,i)=><li key={i}><time>{new Date(event.created_at).toLocaleString("es-MX")}</time> · {event.reason}</li>)}</ul> : <p>Sin eventos visibles.</p> : !error && <p role="status">Consultando historial…</p>)}
      {op!=="history" && op!=="evidence" && <label>Nota de seguimiento<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>}
      {op==="assign" && <label>Responsable interno<select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Seleccionar</option>{members.map(m=><option key={m.id} value={m.id}>{m.fullName}</option>)}</select></label>}
      {op==="complete" && <label>Evidencia vigente<select value={file} onChange={e=>setFile(e.target.value)}><option value="">Seleccionar</option>{plan.evidence.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      <div className={styles.controls}>{(op==="progress" || op==="assign" || op==="complete") &&
        <button className="button button-primary" type="button" disabled={!canNote || (op==="assign"&&!owner) || (op==="complete"&&!file)} onClick={()=>void record(op)}>Confirmar</button>}
        {op==="review" && <><button type="button" disabled={!canNote} onClick={()=>void record("effective")}>Confirmar eficacia</button><button type="button" disabled={!canNote} onClick={()=>void record("ineffective")}>Registrar eficacia insuficiente</button></>}
        <button type="button" className="button button-secondary" onClick={()=>{setOp(null); if(op==="evidence") onUpdate();}}>Cerrar</button>
      </div>{error && <p role="alert">{error}</p>}
    </fieldset>}
  </article>;
}
