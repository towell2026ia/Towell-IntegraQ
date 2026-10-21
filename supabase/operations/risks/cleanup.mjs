// Run manually; never imported by a migration. Default is a read-only dry run.
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {canonicalRiskValue,classifyRisk} from "../../../src/lib/risk-classification.mjs";

const args=process.argv.slice(2);
const apply=args.includes("--apply");
function option(name){return args[args.indexOf(name)+1];}
if(!args.includes("--output"))throw Error("--output backup directory is required");
const root=resolve(option("--output"));await mkdir(root,{recursive:true});
if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw Error("Server-side Supabase configuration required");
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const definitions=await db.from("form_definitions").select("*").eq("registration_number","SYS-RYO-WORKSPACE-2025");
const records=await db.from("form_records").select("*").eq("record_number","RYO-WORKSPACE-2025");
if(definitions.error||records.error||definitions.data.length!==1||records.data.length!==1||records.data[0].form_id!==definitions.data[0].id)throw Error("Unique production workspace could not be verified");
let record=records.data[0];
const timestamp=new Date().toISOString();
const snapshot={timestamp,sourceHost:new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host,definitions:definitions.data,records:records.data};
const filename=join(root,`before-${timestamp.replace(/[:.]/g,"-")}.json`);
await writeFile(filename,JSON.stringify(snapshot,null,2),{flag:"wx"});
const bytes=await readFile(filename);const reopened=JSON.parse(bytes);
if(canonicalRiskValue(reopened)!==canonicalRiskValue(snapshot))throw Error("Backup reopen validation failed");
const inventory=record.values.risks.map(r=>({...Object.fromEntries(["id","kind","title","processId","source","status","owner"].map(k=>[k,r[k]])),actions:record.values.actions.filter(a=>a.riskId===r.id).map(a=>a.id),deletedAt:r.deletedAt??null,...classifyRisk(r)}));
const counts=state=>({risks:state.risks.filter(r=>r.kind==="risk"&&!r.deletedAt).length,opportunities:state.risks.filter(r=>r.kind==="opportunity"&&!r.deletedAt).length,actions:state.actions.length,swotItems:state.swotItems.length,contributions:state.contributions.length,directionCandidates:state.directionCandidates.length,importIssues:state.importIssues.length,cycle:state.cycle});
const manifest={timestamp,snapshot:filename,sha256:createHash("sha256").update(bytes).digest("hex"),reopenPass:true,counts:counts(record.values),updated_at:record.updated_at,inventory,apply,removed:[]};
const candidates=inventory.filter(r=>r.classification==="EXPLICIT_DEMO_TEST"&&!r.deletedAt);
if(apply){
  if(!args.includes("--gates"))throw Error("Verified release evidence --gates required");
  const gates=JSON.parse(await readFile(option("--gates"),"utf8"));
  for(const name of ["backup","tests","ci","supabasePreview","deployment","emailE2E"])if(gates[name]?.status!=="PASS"||!gates[name]?.evidence)throw Error(`Release gate not satisfied: ${name}`);
  if(!/^[a-f0-9]{40}$/.test(gates.commit??"")||gates.deployment.commit!==gates.commit||gates.ci.commit!==gates.commit)throw Error("Release commit mismatch");
  const actor=process.env.RISK_OPERATION_ACTOR_ID;if(!actor)throw Error("Authenticated administrator RISK_OPERATION_ACTOR_ID required");
  for(const candidate of candidates){
    // Re-read and reclassify immediately before the CAS transaction. Ambiguity stops this record.
    const latest=await db.from("form_records").select("*").eq("id",record.id).single();if(latest.error)throw latest.error;
    const risk=latest.data.values.risks.find(r=>r.id===candidate.id);
    if(!risk||classifyRisk(risk).classification!=="EXPLICIT_DEMO_TEST"||canonicalRiskValue(latest.data.values)!==canonicalRiskValue(record.values))throw Error(`STOP: workspace changed or ${candidate.id} became ambiguous`);
    const changed=await db.rpc("commit_risk_workspace",{p_record:record.id,p_actor:actor,p_expected:latest.data.updated_at,p_state:latest.data.values,p_events:[],p_operation:"delete",p_risk:candidate.id,p_reason:`IQ-PRD-RISK-02: ${candidate.evidence}; backup SHA-256 ${manifest.sha256}`,p_category:"test"});
    if(changed.error)throw changed.error;
    record={...record,values:changed.data.state,updated_at:changed.data.updatedAt};manifest.removed.push(candidate.id);
  }
}
const after=await db.from("form_records").select("*").eq("id",record.id).single();if(after.error)throw after.error;
manifest.after=counts(after.data.values);
manifest.productionModified=manifest.removed.length>0;
await writeFile(join(root,`report-${timestamp.replace(/[:.]/g,"-")}.json`),JSON.stringify(manifest,null,2),{flag:"wx"});
console.log(JSON.stringify({backup:filename,sha256:manifest.sha256,before:manifest.counts,after:manifest.after,candidates:candidates.map(r=>r.id),ambiguous:inventory.filter(r=>r.classification==="AMBIGUOUS").map(r=>r.id),productionModified:manifest.productionModified}));
