import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const parentProject='yptrqowmviixlkrxjrqr';
export const previewBranch='codex/stb-01-global-capture-windows';
export function assertCloud(env){if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.RUNNER_OS!=='Linux'||!env.STB_GIT_BRANCH?.startsWith('codex/stb-01-'))throw Error('CLOUD_HOSTED_PREVIEW_ONLY');}
export function selectPreview(branches,branch,prNumber){
  if(!Array.isArray(branches))throw Error('PREVIEW_BRANCH_RESPONSE_INVALID');
  if(branch!==previewBranch||Number(prNumber)!==4)throw Error('PREVIEW_PR_IDENTITY_INVALID');
  const matches=branches.filter(b=>b&&b.git_branch===branch&&b.pr_number===4&&b.parent_project_ref===parentProject&&b.project_ref!==parentProject&&b.is_default===false&&b.persistent===false&&/^[a-z]{20}$/.test(b.project_ref));
  if(matches.length!==1)throw Error('ISOLATED_PREVIEW_NOT_IDENTIFIED');return matches[0].project_ref;
}
// Deliberately allowlist diagnostic vocabulary: arbitrary response text can contain
// credentials or echoed SQL. Never log response objects, request bodies or headers.
const safeWords=new Set(('a an the this that is are was be been not no only and or to for with without of on in from as by must has have does do can cannot could should required missing invalid valid malformed unsupported supported support endpoint api request response error bad unauthorized forbidden access denied permission permissions insufficient scope scopes token tokens personal fine grained fine-grained granular project ref reference branch branches database read write query sql failed failure internal server unexpected message detail details provided specify include includes enabled disabled allowed using use legacy new currently please contact organization resource found expired limit exceeded too many requests timeout timed out validation read_only true false').split(' '));
const safeCodes=new Set(['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','INTERNAL_SERVER_ERROR','VALIDATION_ERROR','invalid_grant','invalid_request','insufficient_scope']);
export function safeDiagnostic(endpoint,method,response,data,token=''){
  if(endpoint==='preview-transactional-fixtures'){
    const state=typeof data?.code==='string'&&/^[0-9A-Z]{5}$/.test(data.code)?data.code:String(data?.message??'').match(/\bERROR:\s*([0-9A-Z]{5}):/)?.[1]??'XXXXX';
    return {stage:'STB_00_SQL_ENVELOPE',sqlstate:state,errorCode:'SQL_ENVELOPE_FAILURE',classification:classifySqlstate(state)};
  }
  const redact=value=>typeof value==='string'&&token?value.split(token).join('[redacted]'):value;
  const rawCode=redact(data?.code??data?.error_code);
  const code=typeof rawCode==='string'&&(safeCodes.has(rawCode)||/^[0-9A-Z]{5}$/.test(rawCode))?rawCode:'API_ERROR';
  const raw=redact(typeof data?.message==='string'?data.message:typeof data?.error==='string'?data.error:'');
  const words=raw?.slice(0,2000).replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+|['"`][^'"`]*['"`]/gi,' REDACTED ').split(/\r?\n/)[0].match(/[A-Za-z0-9_./:+@=-]+/g)??[];
  const message=words.map(word=>safeWords.has(word.toLowerCase())?word:'[redacted]').join(' ').replace(/(?:\[redacted\] *)+/g,'[redacted] ').slice(0,240).trim()||'Error details withheld';
  const requestId=redact(response.headers.get('x-request-id')??response.headers.get('sb-request-id')??response.headers.get('cf-ray'));
  return {endpoint,method,status:response.status,errorCode:code,errorMessage:message,...(typeof requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(requestId)?{requestId}:{})};
}
export function createManagementClient(token,fetchImpl=fetch,log=console.log){
  return async function api(endpoint,path,body){
    const method=body===undefined?'GET':'POST';
    let r;
    try{r=await fetchImpl('https://api.supabase.com/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});}
    catch{throw Error('SUPABASE_PREVIEW_TRANSPORT_ERROR');}
    const data=await r.json().catch(()=>null);
    log(JSON.stringify(r.ok?{endpoint,method,status:r.status}:safeDiagnostic(endpoint,method,r,data,token)));
    if(!r.ok)throw Error(`SUPABASE_PREVIEW_HTTP_${r.status}`);
    if(data===null)throw Error('SUPABASE_PREVIEW_RESPONSE_INVALID');
    return data;
  };
}
export const fixtureStages=['STB_01_IDENTITIES','STB_02_PROCESS_PERMISSIONS','STB_03_52_DEFINITIONS_PERIODS','STB_04_CAPTURE_EXCEPTION','STB_05_GLOBAL_RULE','STB_06_RESTORE_AUDIT','STB_07_PERMISSIONS_CONCURRENCY_RLS','STB_08_ROLLBACK_RESIDUE'];
export function classifySqlstate(state){return ({'42702':'AMBIGUOUS_REFERENCE','42703':'SCHEMA_COLUMN_MISMATCH','42P01':'SCHEMA_RELATION_MISMATCH','42883':'SCHEMA_FUNCTION_MISMATCH','42501':'AUTHORIZATION','23503':'FOREIGN_KEY','23505':'UNIQUENESS','23514':'CHECK_CONSTRAINT','23502':'NOT_NULL','40P01':'DEADLOCK','40001':'CONCURRENT_MODIFICATION','P0001':'FIXTURE_ASSERTION'})[state]??'SQL_EXECUTION';}
export function fixtureDiagnostic(report,knownCodes=new Set()){
  const stage=[...fixtureStages,'STB_00_SCHEMA'].includes(report?.failed_stage)?report.failed_stage:'STB_00_SQL_ENVELOPE';
  const state=typeof report?.sqlstate==='string'&&/^[0-9A-Z]{5}$/.test(report.sqlstate)?report.sqlstate:'XXXXX';
  const classification=classifySqlstate(state);
  return {stage,sqlstate:state,errorCode:knownCodes.has(report?.error_code)?report.error_code:`SQL_${classification}`,classification};
}
export function readFixtureReport(result){
  const report=Array.isArray(result)&&result.length===1?result[0]?.fixture_report:null;
  if(!report||typeof report!=='object'||!['STB_01_PREVIEW_PASS','STB_01_PREVIEW_FAIL'].includes(report.status))throw Error('PREVIEW_REPORT_INVALID');
  return report;
}
export function assertFixtureResult(result){
  const r=readFixtureReport(result);
  if(r.status!=='STB_01_PREVIEW_PASS'||r.fixture_indicators!==52||r.rollback!==true||r.residual_fixture_records!==0||r.ambiguity_reproduced!==true||JSON.stringify(r.completed_stages)!==JSON.stringify(fixtureStages))throw Error('PREVIEW_ASSERTIONS_NOT_CONFIRMED');
  return r;
}
export function residueParameters(report){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if(!Array.isArray(report.fixture_organizations)||report.fixture_organizations.length!==2||!report.fixture_organizations.every(id=>uuid.test(id))||!Array.isArray(report.fixture_users)||report.fixture_users.length!==5||!report.fixture_users.every(id=>uuid.test(id))||typeof report.fixture_process!=='string'||!/^STB-CI-[0-9a-f-]{36}$/.test(report.fixture_process))throw Error('PREVIEW_RESIDUE_SCOPE_INVALID');
  return [report.fixture_organizations,report.fixture_users,report.fixture_process];
}
async function main(){
  assertCloud(process.env);const token=process.env.SUPABASE_ACCESS_TOKEN;if(!token)throw Error('SUPABASE_CLOUD_PREVIEW_TOKEN_MISSING');
  if(process.env.STB_GIT_BRANCH!==previewBranch||process.env.STB_PR_NUMBER!=='4')throw Error('PREVIEW_PR_IDENTITY_INVALID');
  const api=createManagementClient(token);
  let ref;for(let attempt=0;attempt<20;attempt++){const branches=await api('list-preview-branches',`/projects/${parentProject}/branches`);try{ref=selectPreview(branches,process.env.STB_GIT_BRANCH,process.env.STB_PR_NUMBER);break;}catch(e){if(e.message!=='ISOLATED_PREVIEW_NOT_IDENTIFIED')throw e;if(attempt===19)throw Error('ISOLATED_PREVIEW_NOT_READY');await new Promise(r=>setTimeout(r,15000));}}
  // Readiness query only. Never apply migrations here; Git integration owns migration deployment.
  let ready=false;for(let attempt=0;attempt<20;attempt++){const data=await api('preview-migration-readiness',`/projects/${ref}/database/query/read-only`,{query:"select pg_catalog.to_regprocedure('public.apply_indicator_capture_windows(jsonb,boolean,text,uuid,text,boolean)') is not null as ready"});if(!Array.isArray(data))throw Error('PREVIEW_QUERY_RESPONSE_INVALID');if(data[0]?.ready===true){ready=true;break;}await new Promise(r=>setTimeout(r,15000));}if(!ready)throw Error('PREVIEW_MIGRATION_NOT_READY');
  const query=await readFile(new URL('../../supabase/tests/indicator-global-capture.sql',import.meta.url),'utf8');
  const result=await api('preview-transactional-fixtures',`/projects/${ref}/database/query`,{query});
  const report=readFixtureReport(result);
  const knownCodes=new Set([...query.matchAll(/raise exception '([A-Z0-9_]+)'/g)].map(match=>match[1]));
  if(report.status==='STB_01_PREVIEW_FAIL')console.error(JSON.stringify(fixtureDiagnostic(report,knownCodes)));
  // A separate cloud request verifies that rollback survived release of the SQL connection.
  const residueQuery=await readFile(new URL('../../supabase/tests/indicator-global-residue.sql',import.meta.url),'utf8');
  const residue=await api('preview-post-rollback-residue',`/projects/${ref}/database/query/read-only`,{query:residueQuery,parameters:residueParameters(report)});
  if(!Array.isArray(residue)||residue.length!==1||residue[0]?.residual_fixture_records!==0)throw Error('PREVIEW_RESIDUAL_FIXTURES_FOUND');
  console.log(JSON.stringify({rollback:report.rollback===true,residualFixtureRecords:0}));
  if(report.status==='STB_01_PREVIEW_FAIL')throw Error('PREVIEW_FIXTURE_STAGE_FAILED');
  assertFixtureResult(result);
  console.log(JSON.stringify({status:'PASS',fixtureIndicators:52,productionModified:false,localPostgresConnection:false,commit:process.env.GITHUB_SHA}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
