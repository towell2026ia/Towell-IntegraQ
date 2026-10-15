import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildDemoRiskWorkspace, buildProductionRiskWorkspace, type RiskWorkspaceState } from "@/lib/risk-opportunity-data";
import { riskEvents, validateRiskHistory } from "@/lib/risk-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processCatalog } from "@/lib/configuration-data";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

async function context(action: "view" | "update") {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("id,user_type,status,organization_id").eq("id",data.user.id).single();
  if (profile.error || profile.data.status !== "active" || !["administrator","internal"].includes(profile.data.user_type) || !profile.data.organization_id) throw new Error("FORBIDDEN");
  const allowed=await admin.rpc("risk_has_access",{p_user:data.user.id,p_action:action});
  if(allowed.error) throw allowed.error;
  if(!allowed.data) throw new Error("FORBIDDEN");
  const mode=data.user.app_metadata.workspace_mode === "demo" ? "demo" : "production";
  const process=await admin.from("processes").select("organization_id").eq("id","P-03").single();
  if(process.error || process.data.organization_id!==profile.data.organization_id) throw new Error("FORBIDDEN");
  const recordNumber= mode==="demo" ? "RYO-WORKSPACE-DEMO" : "RYO-WORKSPACE-2025";
  const existing=await admin.from("form_records").select("id,values,updated_at").eq("record_number",recordNumber).maybeSingle();
  if(existing.error) throw existing.error;
  let record=existing.data;
  if(!record) {
    if(profile.data.user_type!=="administrator") throw new Error("WORKSPACE_NOT_INITIALIZED");
    const registrationNumber=mode==="demo" ? "SYS-RYO-WORKSPACE-DEMO" : "SYS-RYO-WORKSPACE-2025";
    const definition=await admin.from("form_definitions").upsert({registration_number:registrationNumber,name:"Riesgos y oportunidades",process_id:"P-03",version:1,status:"active",source_type:"manual",created_by:data.user.id},{onConflict:"registration_number",ignoreDuplicates:true});
    if(definition.error) throw definition.error;
    const selected=await admin.from("form_definitions").select("id").eq("registration_number",registrationNumber).single();
    if(selected.error) throw selected.error;
    const inserted=await admin.from("form_records").upsert({form_id:selected.data.id,record_number:recordNumber,status:"active",values:mode==="demo"?buildDemoRiskWorkspace():buildProductionRiskWorkspace(),created_by:data.user.id},{onConflict:"record_number",ignoreDuplicates:true});
    if(inserted.error) throw inserted.error;
    const loaded=await admin.from("form_records").select("id,values,updated_at").eq("record_number",recordNumber).single();
    if(loaded.error) throw loaded.error;
    record=loaded.data;
  }
  return {admin,profile:profile.data,record,mode};
}

function isState(value: unknown): value is RiskWorkspaceState {
  if(!value || typeof value!=="object") return false;
  const v=value as RiskWorkspaceState;
  return Number.isInteger(v.cycle) && ["preparation","active","closed"].includes(v.cycleStatus) && [v.axes,v.risks,v.actions,v.swotItems,v.contributions,v.directionCandidates,v.importIssues].every(Array.isArray)
    && v.risks.every(r=>typeof r.id==="string" && typeof r.processId==="string" && typeof r.title==="string" && typeof r.source==="string" && !!r.initial && ["risk","opportunity"].includes(r.kind))
    && v.actions.every(a=>typeof a.id==="string" && typeof a.riskId==="string" && typeof a.dueDate==="string");
}

function failure(error: unknown) {
  const message=error instanceof Error ? error.message : (error as {message?:string})?.message ?? "Error de persistencia";
  const status=message==="FORBIDDEN"?403:message.includes("STALE_WORKSPACE")?409:message==="WORKSPACE_NOT_INITIALIZED"?404:500;
  console.error("Risk workspace operation failed", {message});
  return NextResponse.json({error:status===409?"La matriz cambió. Recarga antes de guardar.":status===403?"Acceso denegado.":"No fue posible completar la operación de riesgos."},{status});
}

export async function GET() {
  try {
    const {record}=await context("view");
    return NextResponse.json({state:record.values,updatedAt:record.updated_at,storage:"supabase"});
  } catch(error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    const {admin,profile,record,mode}=await context("update");
    const body=await request.json() as {state?:unknown;updatedAt?:string};
    if(!isState(body.state) || !body.updatedAt || !isState(record.values)) return NextResponse.json({error:"Matriz o versión inválida."},{status:400});
    let next=body.state;
    if(profile.user_type!=="administrator") {
      const permissions=await admin.from("user_process_permissions").select("process_id").eq("user_id",profile.id);
      if(permissions.error) throw permissions.error;
      const allowed=new Set<string>((permissions.data??[]).map(p=>p.process_id));
      const riskIds=new Set([...record.values.risks.filter(r=>allowed.has(r.processId)),...next.risks.filter(r=>allowed.has(r.processId)&&!record.values.risks.some((old:RiskWorkspaceState["risks"][number])=>old.id===r.id))].map(r=>r.id));
      const merge=<T extends {id:string}>(old:T[],proposed:T[],canEdit:(v:T)=>boolean)=>[
        ...old.filter(v=>!canEdit(v)),...proposed.filter(v=>canEdit(v) && (!old.some(o=>o.id===v.id) || old.some(o=>o.id===v.id && canEdit(o))))];
      next={...record.values,
        risks:merge(record.values.risks,next.risks,r=>allowed.has(r.processId)),
        actions:merge(record.values.actions,next.actions,a=>riskIds.has(a.riskId)),
        swotItems:merge(record.values.swotItems,next.swotItems,s=>allowed.has(s.processId)),
        contributions:merge(record.values.contributions,next.contributions,c=>allowed.has(c.sourceProcessId)||allowed.has(c.targetProcessId))};
    }
    try {validateRiskHistory(record.values,next);} catch(error) {return NextResponse.json({error:(error as Error).message},{status:400});}
    for(const action of next.actions) {
      const previous=record.values.actions.find(a=>a.id===action.id);
      if(previous?.ownerId===action.ownerId && previous?.owner===action.owner)continue;
      if(!action.ownerId || !/^[0-9a-f-]{36}$/i.test(action.ownerId))return NextResponse.json({error:"Selecciona un usuario responsable autorizado."},{status:400});
      const assignee=await admin.from("profiles").select("id,organization_id,status,user_type,full_name").eq("id",action.ownerId).single();
      const assigneeAuth=await admin.auth.admin.getUserById(action.ownerId);
      const permission=await admin.rpc("risk_has_access",{p_user:action.ownerId,p_action:"view"});
      if(assignee.error||assigneeAuth.error||permission.error)throw Error("Assignee lookup failed");
      if(assignee.data.status!=="active"||!["internal","administrator"].includes(assignee.data.user_type)||assignee.data.organization_id!==profile.organization_id||(assigneeAuth.data.user.app_metadata.workspace_mode??"production")!==mode||!permission.data)return NextResponse.json({error:"Responsable fuera del alcance autorizado."},{status:400});
      action.owner=assignee.data.full_name;
    }
    const events=riskEvents(record.values,next).map(e=>({...e,occurrence:e.type.includes("action_due") || e.type.includes("action_overdue") ? e.occurrence : createHash("sha256").update(record.updated_at+e.occurrence).digest("hex")}));
    const result=await admin.rpc("commit_risk_workspace",{p_record:record.id,p_actor:profile.id,p_expected:body.updatedAt,p_state:next,p_events:events});
    if(result.error) throw result.error;
    return NextResponse.json({ok:true,...result.data});
  } catch(error) {return failure(error);}
}

export async function POST(request: Request) {
  try {
    const {admin,profile,record}=await context("view");
    if(profile.user_type!=="administrator") throw new Error("FORBIDDEN");
    const body=await request.json() as {action?:string;riskId?:string;reason?:string;category?:string;updatedAt?:string};
    if(!isState(record.values) || !body.updatedAt) return NextResponse.json({error:"Versión requerida."},{status:400});
    const operation=body.action==="delete"?"delete":body.action==="restore"?"restore":body.action==="start_analysis"?"update":null;
    if(!operation) return NextResponse.json({error:"Operación inválida."},{status:400});
    if(operation!=="update" && (!body.reason?.trim() || !body.riskId || (operation==="delete" && !["test","duplicate","capture_error"].includes(body.category??"")))) return NextResponse.json({error:"Registro, motivo y categoría requeridos."},{status:400});
    const next:RiskWorkspaceState=operation==="update"?{...record.values,cycleStatus:"active"}:record.values;
    const result=await admin.rpc("commit_risk_workspace",{p_record:record.id,p_actor:profile.id,p_expected:body.updatedAt,p_state:next,p_events:riskEvents(record.values,next),p_operation:operation,p_risk:body.riskId??null,p_reason:body.reason??null,p_category:body.category??null});
    if(result.error) throw result.error;
    return NextResponse.json({ok:true,...result.data,processCount:processCatalog.filter(p=>p.level==="process").length,uncoveredProcessIds:[]});
  } catch(error) {return failure(error);}
}
