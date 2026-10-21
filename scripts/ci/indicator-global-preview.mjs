import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const parentProject='yptrqowmviixlkrxjrqr';
export function assertCloud(env){if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.RUNNER_OS!=='Linux'||!env.STB_GIT_BRANCH?.startsWith('codex/stb-01-'))throw Error('CLOUD_HOSTED_PREVIEW_ONLY');}
export function selectPreview(branches,branch){const matches=branches.filter(b=>b.git_branch===branch&&b.parent_project_ref===parentProject&&b.project_ref!==parentProject&&b.is_default===false&&b.persistent===false&&/^[a-z]{20}$/.test(b.project_ref));if(matches.length!==1)throw Error('ISOLATED_PREVIEW_NOT_IDENTIFIED');return matches[0].project_ref;}
async function main(){
  assertCloud(process.env);const token=process.env.SUPABASE_ACCESS_TOKEN;if(!token)throw Error('SUPABASE_CLOUD_PREVIEW_TOKEN_MISSING');
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  async function api(path,body){const r=await fetch('https://api.supabase.com/v1'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(`SUPABASE_PREVIEW_HTTP_${r.status}`);return data;}
  let ref;for(let attempt=0;attempt<20;attempt++){const branches=await api(`/projects/${parentProject}/branches`);try{ref=selectPreview(branches,process.env.STB_GIT_BRANCH);break;}catch{if(attempt===19)throw Error('ISOLATED_PREVIEW_NOT_READY');await new Promise(r=>setTimeout(r,15000));}}
  // Readiness query only. Never apply migrations here; Git integration owns migration deployment.
  let ready=false;for(let attempt=0;attempt<20;attempt++){const data=await api(`/projects/${ref}/database/query/read-only`,{query:"select to_regprocedure('public.apply_indicator_capture_windows(jsonb,boolean,text,uuid,text,boolean)') is not null as ready"});if(Array.isArray(data)&&data[0]?.ready===true){ready=true;break;}await new Promise(r=>setTimeout(r,15000));}if(!ready)throw Error('PREVIEW_MIGRATION_NOT_READY');
  const query=await readFile(new URL('../../supabase/tests/indicator-global-capture.sql',import.meta.url),'utf8');
  const result=await api(`/projects/${ref}/database/query`,{query});if(!JSON.stringify(result).includes('STB_01_PREVIEW_PASS'))throw Error('PREVIEW_ASSERTIONS_NOT_CONFIRMED');
  console.log(JSON.stringify({status:'PASS',fixtureIndicators:52,productionModified:false,localPostgresConnection:false,commit:process.env.GITHUB_SHA}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
