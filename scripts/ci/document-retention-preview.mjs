import {readFile} from "node:fs/promises";
import {createManagementClient,parentProject} from "./indicator-global-preview.mjs";

function cloudOnly(env){
 if(env.GITHUB_ACTIONS!=="true"||env.RUNNER_ENVIRONMENT!=="github-hosted"||env.RUNNER_OS!=="Linux"||env.STB_GIT_BRANCH!=="codex/stb-02-document-retention"||!/^\d+$/.test(env.STB_PR_NUMBER??""))throw Error("STB2_CLOUD_PREVIEW_ONLY");
}
async function main(){
 cloudOnly(process.env);
 if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error("STB2_TOKEN_MISSING");
 const api=createManagementClient(process.env.SUPABASE_ACCESS_TOKEN);
 let ref;
 for(let n=0;n<20;n++){
  const data=await api("STB2-preview-identity",`/projects/${parentProject}/branches`);
  if(!Array.isArray(data))throw Error("STB2_BRANCH_RESPONSE_INVALID");
  const matches=data.filter(b=>b.git_branch===process.env.STB_GIT_BRANCH&&b.pr_number===Number(process.env.STB_PR_NUMBER)&&b.parent_project_ref===parentProject&&b.project_ref!==parentProject&&b.is_default===false&&b.persistent===false&&b.with_data!==true&&/^[a-z]{20}$/.test(b.project_ref));
  if(matches.length>1)throw Error("STB2_AMBIGUOUS_PREVIEW");
  if(matches.length===1){ref=matches[0].project_ref;break;}
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 if(!ref)throw Error("STB2_PREVIEW_NOT_IDENTIFIED");
 let ready=false;
 for(let n=0;n<20;n++){
  const r=await api("STB2-migration-readiness",`/projects/${ref}/database/query/read-only`,{query:"select pg_catalog.to_regprocedure('public.register_controlled_file(jsonb,jsonb,uuid)') is not null as ready"});
  if(Array.isArray(r)&&r[0]?.ready===true){ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 if(!ready)throw Error("STB2_MIGRATION_NOT_READY");
 const query=await readFile(new URL("../../supabase/tests/document-retention.sql",import.meta.url),"utf8");
 const result=await api("preview-transactional-fixtures",`/projects/${ref}/database/query`,{query});
 const report=Array.isArray(result)?result[0]?.report:null;
 if(report?.status!=="PASS"||report?.preserved!==true||report?.residualFixtures!==0){
  console.error(JSON.stringify({stage:/^STB2_[A-Z_]+$/.test(report?.stage??"")?report.stage:"STB2_ENVELOPE",sqlstate:/^[A-Z0-9]{5}$/.test(report?.sqlstate??"")?report.sqlstate:"XXXXX",code:/^STB2_[A-Z_]+$/.test(report?.code??"")?report.code:"STB2_ASSERTIONS_FAILED"}));
  throw Error("STB2_SQL_PREVIEW_FAILED");
 }
 console.log(JSON.stringify({STB02:"PASS",delete:"PASS",reuseCode:"PASS",restore:"PASS",retainedVersionsAndEvidence:"PASS",RLS:"PASS",rollback:"PASS",residualFixtures:0,productionModified:false}));
}
main().catch(e=>{console.error(JSON.stringify({stage:"STB2_GATE",sqlstate:/^[A-Z0-9]{5}$/.test(e?.sqlstate??"")?e.sqlstate:"XXXXX",code:/^STB2_[A-Z_]+$/.test(e?.message??"")?e.message:"STB2_PREVIEW_FAILED"}));process.exitCode=1;});
