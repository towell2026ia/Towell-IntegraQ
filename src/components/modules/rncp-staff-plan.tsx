"use client";
import { useState } from "react";
import { followupCommand, rncpRequest } from "@/lib/rncp/client";
import { uploadRncpEvidence } from "@/lib/rncp-data";

interface Plan {id:string;description:string;responsible_name:string;due_date:string;editable:boolean;}
export function RncpStaffPlan({reportId,canUpload}:{reportId:string;canUpload:boolean}) {
  const [plans,setPlans]=useState<Plan[]>([]), [id,setId]=useState(""), [active,setActive]=useState(false);
  const [description,setDescription]=useState(""), [owner,setOwner]=useState(""), [due,setDue]=useState("");
  const [file,setFile]=useState<File>(), [performedOn,setPerformedOn]=useState("");
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  async function load() {
    const result=await rncpRequest<{actions:Plan[]}>(`/follow-up?reportId=${encodeURIComponent(reportId)}`);
    setPlans(result.actions.filter(plan=>plan.editable));
  }
  function select(value:string) {
    const plan=plans.find(item=>item.id===value);
    setId(value);setDescription(plan?.description??"");setOwner(plan?.responsible_name??"");setDue(plan?.due_date??"");
  }
  async function save() {
    setBusy(true);setMessage("");
    try {
      const saved=await followupCommand<{actionId:string}>("manage_plan",{reportId,payload:{actionId:id||null,description,owner,due}});
      setId(saved.actionId); await load();setMessage("Plan guardado.");
    } catch(e){setMessage(e instanceof Error?e.message:"No se pudo guardar el plan.");}
    finally{setBusy(false);}
  }
  return <details onToggle={event=>{if(event.currentTarget.open && !active){setActive(true);void load().catch(()=>{setActive(false);setMessage("No se pudieron consultar los planes.");});}}}>
    <summary>Gestionar planes de acción</summary>
    <form onSubmit={event=>{event.preventDefault();void save();}}>
      <label>Plan<select value={id} onChange={event=>select(event.target.value)}><option value="">Nuevo plan</option>{plans.map(plan=><option key={plan.id} value={plan.id}>{plan.description}</option>)}</select></label>
      <label>Acción correctiva<textarea required minLength={10} value={description} onChange={event=>setDescription(event.target.value)}/></label>
      <label>Responsable<input required value={owner} onChange={event=>setOwner(event.target.value)}/></label>
      <label>Fecha compromiso<input required type="date" value={due} onChange={event=>setDue(event.target.value)}/></label>
      <button type="submit" disabled={busy}>Guardar plan</button>
    </form>
    {canUpload && id && <form onSubmit={async event=>{event.preventDefault();if(!file)return;setBusy(true);try{await uploadRncpEvidence(id,file,performedOn);setFile(undefined);setMessage("Evidencia registrada.");}catch(e){setMessage(e instanceof Error?e.message:"No se pudo guardar la evidencia.");}finally{setBusy(false);}}}>
      <label>Fecha de la evidencia<input type="date" required value={performedOn} onChange={event=>setPerformedOn(event.target.value)}/></label>
      <label>Archivo<input type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx" onChange={event=>setFile(event.target.files?.[0])}/></label>
      <button type="submit" disabled={!file||busy}>Adjuntar evidencia</button></form>}
    {message && <p role="status">{message}</p>}</details>;
}
