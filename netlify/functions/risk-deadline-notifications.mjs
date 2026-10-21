import {createClient} from "@supabase/supabase-js";
export const config={schedule:"0 12 * * *"};
export function deadlineEvents(state,now=new Date()) {
  const day=now.toISOString().slice(0,10);
  const soon=new Date(now.getTime()+3*86400000).toISOString().slice(0,10);
  const events=[];
  for(const action of state.actions??[]) {
    const risk=state.risks?.find(r=>r.id===action.riskId&&!r.deletedAt&&r.status!=="closed");
    if(!risk || action.status==="completed" || !action.dueDate || action.dueDate>soon)continue;
    const type=action.dueDate<day?"risk.action_overdue":"risk.action_due";
    events.push({type,resourceId:action.id,processId:risk.processId,ownerId:action.ownerId,title:`${type} · ${risk.id}`,body:`${risk.kind}: ${risk.title}\nProceso: ${risk.processId}\nResponsable: ${action.owner}\nAcción requerida: ${action.title}\nFecha compromiso: ${action.dueDate}`,targetUrl:`/?risk=${encodeURIComponent(risk.id)}#risks`,occurrence:action.dueDate});
  }
  return events;
}
export default async function handler() {
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const found=await db.from("form_records").select("id,values,form_id").in("record_number",["RYO-WORKSPACE-2025","RYO-WORKSPACE-PRODUCTION"]);
  if(found.error)throw Error("RISK_REMINDER_WORKSPACE_FAILED");
  let notified=0;
  for(const record of found.data??[]) {
    const definition=await db.from("form_definitions").select("process_id").eq("id",record.form_id).single();
    if(definition.error)throw Error("RISK_REMINDER_DEFINITION_FAILED");
    const process=await db.from("processes").select("organization_id").eq("id",definition.data.process_id).single();
    if(process.error||!process.data.organization_id)throw Error("RISK_REMINDER_ORGANIZATION_REQUIRED");
    const result=await db.rpc("enqueue_risk_notifications",{p_workspace:record.id,p_org:process.data.organization_id,p_mode:"production",p_events:deadlineEvents(record.values)});
    if(result.error)throw Error("RISK_REMINDER_ENQUEUE_FAILED");
    notified+=result.data;
  }
  return new Response(JSON.stringify({notified}));
}
