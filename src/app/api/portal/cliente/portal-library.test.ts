import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GET as documents } from "./documents/route";
import { GET as documentFile } from "./documents/[documentId]/file/route";
import { validatePortalEvidenceSelection } from "@/lib/customer-portal-a3-detail";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET as actions } from "./actions/route";
import { GET as detail } from "./actions/[actionId]/route";
import { GET as evidence } from "./actions/[actionId]/evidence/[fileId]/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const id = (n:number) => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
const workspace = id(1), companyA = id(2), companyB = id(3), actionId = id(10), group = id(11);
const tokenA = "a".repeat(43), tokenB = "b".repeat(43);
const digest = (token:string) => createHash("sha256").update(token).digest("hex");
const sign = vi.fn(async () => ({data:{signedUrl:"https://storage.example.test/fixture"},error:null}));
const request = (token:string, query="") => new Request("https://fixture.invalid/portal"+query,{headers:{authorization:"Bearer "+token}});
function table(name:string) {
  const filters: ((row:Row)=>boolean)[] = [];
  const rows=()=> (tables[name] ?? []).filter(row=>filters.every(filter=>filter(row)));
  const query={
    select:()=>query, order:()=>query, range:()=>query, limit:()=>query,
    eq:(key:string,value:unknown)=>{ filters.push(row=>row[key]===value); return query; },
    neq:(key:string,value:unknown)=>{ filters.push(row=>row[key]!==value); return query; },
    is:(key:string,value:unknown)=>query.eq(key,value),
    in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return query;},
    maybeSingle:async()=>({data:rows()[0]??null,error:null}),
    then:(resolve:(result:{data:Row[],error:null})=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve),
    insert:async(row:Row)=>{(tables[name]??=[]).push(row);return {error:null};},
  };
  return query;
}
const database={
  from:table, storage:{from:()=>({createSignedUrl:sign})},
  rpc:(name:string, args?:{p_digest:string})=>{
    if(name==="iq_u01_publication_ready_v2")return Promise.resolve({data:true,error:null});
    if(name!=="iq_customer_portal_access")throw Error("Unexpected RPC "+name);
    const company=args?.p_digest===digest(tokenA)?companyA:args?.p_digest===digest(tokenB)?companyB:null;
    return {maybeSingle:async()=>({data:company?{workspace_id:workspace,customer_id:company,grant_id:id(70),company_name:"Fixture"}:null,error:null})};
  }
};
const documentParams=(n:number)=>({params:Promise.resolve({documentId:id(n)})});
const actionParams=(action=actionId)=>({params:Promise.resolve({actionId:action})});
const fileParams=(fileId:string)=>({params:Promise.resolve({actionId,fileId})});
async function listed(token:string) {
  const response=await documents(request(token));
  expect(response.status).toBe(200);
  const data=await response.json();expect(data.sectionErrors.documents).toBeNull();
  return data.documents.map((row:{id:string})=>row.id);
}

beforeEach(()=>{
  for(const key of Object.keys(tables))delete tables[key];
  sign.mockClear();
  tables.file_objects=[];tables.customer_portal_document_publications=[];
  for(const [n,customer,scope,status] of [[20,companyA,"individual","published"],[21,null,"general","draft"],[22,null,null,"published"]] as const) {
    tables.customer_portal_document_publications.push({id:id(n),file_id:id(n+10),workspace_id:workspace,customer_id:customer,publication_scope:scope,status});
    tables.file_objects.push({id:id(n+10),resource_id:id(n),workspace_id:workspace,external_organization_id:customer,resource_type:"customer_portal_document",
      bucket_id:"integraq-private",object_path:"customer-portal/"+workspace+"/"+(customer??"general")+"/file.pdf",deleted_at:null});
  }
  const plan={id:id(40),corrective_action_id:actionId,description:"Acción vinculada",evidence_file_id:null};
  const metadata={evidenceId:group,portalEvidence:{actionId,customerId:companyA,ids:[id(41),id(44),id(45)]}};
  const action={id:actionId,organization_id:workspace,external_organization_id:companyA,source:"customer",deleted_at:null,portal_visible:false,
    title:"A3 seleccionado",corrective_action_plans:[plan,{...plan,corrective_action_id:id(39)}],corrective_action_a3:{workflow_metadata:metadata,five_w_two_h:{what:"Prueba",private_note:"Interno"},root_cause_whys:["Causa"],ai_draft:"Privado"}};
  tables.corrective_action_a3=[{corrective_action_id:actionId,workflow_metadata:metadata}];
  tables.corrective_action_plans=[plan];
  tables.corrective_actions=[action,{...action,id:id(12),portal_visible:true,source:"internal"},{...action,id:id(13),portal_visible:true,source:"sgc"},
    {...action,id:id(14),portal_visible:true,external_organization_id:companyB}];
  for(const [n,key,owner] of [[41,group+"_plan_"+plan.id,workspace],[42,group+"_step_0",workspace],
    [44,id(90)+"_step_0",workspace],[45,group+"_step_1",id(90)]] as const) {
    tables.file_objects.push({id:id(n),workspace_id:owner,external_organization_id:null,resource_key:key,uploaded_by:id(50),audience:"internal",
      module_id:"corrective-actions",resource_type:"root2cause_evidence",original_name:"evidencia-"+n,is_current:true,deleted_at:null,bucket_id:"integraq-private",
      object_path:id(50)+"/attachments/corrective-actions/root2cause_evidence/"+key+"/adjunto.pdf"});
  }
});

it("conserva la publicación individual y exige alcance general explícito y publicación para ambos portales",async()=>{
  expect(await listed(tokenA)).toEqual([id(20)]);expect(await listed(tokenB)).toEqual([]);
  tables.customer_portal_document_publications[1].status="published";
  expect(await listed(tokenA)).toEqual([id(20),id(21)]);expect(await listed(tokenB)).toEqual([id(21)]);
  expect((await documentFile(request(tokenB),documentParams(20))).status).toBe(404);
  expect((await documentFile(request(tokenB,"?scope=general"),documentParams(20))).status).toBe(404);
  expect(sign).not.toHaveBeenCalled();
  for(const token of [tokenA,tokenB])expect((await documentFile(request(token,"?scope=general"),documentParams(21))).status).toBe(200);
  expect(sign.mock.calls).toHaveLength(2);
  expect(tables.customer_portal_document_events.map(r=>r.customer_id)).toEqual([companyA,companyB]);
  tables.customer_portal_document_publications[1].status="withdrawn";
  expect((await documentFile(request(tokenA,"?scope=general"),documentParams(21))).status).toBe(404);
  expect(await listed(tokenA)).toEqual([id(20)]);expect(tables.file_objects.filter(r=>r.id===id(31))).toHaveLength(1);
});

it("exige el mismo cliente y expediente publicado para listado, detalle y cada firma de evidencia",async()=>{
  const list=async(token:string)=>(await (await actions(request(token))).json()).actions.map((row:Row)=>row.id);
  expect(await list(tokenA)).toEqual([]);
  expect((await detail(request(tokenA),actionParams())).status).toBe(404);
  tables.corrective_actions[0].portal_visible=true;
  expect(await list(tokenA)).toEqual([actionId]);expect(await list(tokenB)).toEqual([id(14)]);
  const data=await (await detail(request(tokenA),actionParams())).json();
  expect(data.characterization).toEqual([{label:"Qué ocurrió",value:"Prueba"}]);expect(data.causeAnalysis).toEqual(["Causa"]);
  expect(JSON.stringify(data)).not.toContain("Interno");expect(JSON.stringify(data)).not.toContain("Privado");
  expect(data.plans.map((row:Row)=>row.id)).toEqual([id(40)]);
  expect(data.evidence).toEqual([{id:id(41),name:"evidencia-41"}]);
  expect((await detail(request(tokenB),actionParams())).status).toBe(404);
  for(const n of [12,13,14])expect((await detail(request(tokenA),actionParams(id(n)))).status).toBe(404);
  for(const n of [42,44,45])expect((await evidence(request(tokenA),fileParams(id(n)))).status).toBe(404);
  expect((await evidence(request(tokenB),fileParams(id(41)))).status).toBe(404);
  expect((await evidence(request(""),fileParams(id(41)))).status).toBe(403);
  expect(sign).not.toHaveBeenCalled();
  expect((await evidence(request(tokenA),fileParams(id(41)))).status).toBe(200);
  tables.corrective_actions[0].portal_visible=false;
  expect((await evidence(request(tokenA),fileParams(id(41)))).status).toBe(404);
  expect(sign).toHaveBeenCalledTimes(1);expect(tables.file_objects.some(r=>r.id===id(41))).toBe(true);
});


it("verifica los adjuntos seleccionados antes de confirmar la publicación del A3",async()=>{
  const verify=(selected:string[])=>validatePortalEvidenceSelection(createAdminClient(),workspace,companyA,actionId,group,selected);
  expect(await verify([id(41)])).toBe(true);
  expect(await verify([id(41),id(44)])).toBe(false);
  expect(await verify([id(45)])).toBe(false);
  expect(sign).not.toHaveBeenCalled();
});
