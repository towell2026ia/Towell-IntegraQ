import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {assertCloud,parentProject,selectPreview,createManagementClient} from './indicator-global-preview.mjs';
import {validateScope,setupSql,cleanupSql,residueSql} from './indicator-concurrency-sql.mjs';

const manifestPath='.stb-concurrency-scope.json';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value,code)=>{if(!value)throw Error(code);};
const allowedCodes=new Set(['CAPTURE_PREVIEW_STALE','CAPTURE_OPERATION_CONFLICT','INDICATOR_CAPTURE_WINDOW_CLOSED','INDICATOR_PROCESS_FORBIDDEN','INDICATOR_CAPTURE_PERMISSION_REQUIRED','CAPTURE_ADMIN_REQUIRED','UNEXPECTED_SQL_ERROR']);
export function requireOverlap(a,b){
  check(Number.isInteger(a?.pid)&&Number.isInteger(b?.pid)&&a.pid!==b.pid,'CONCURRENCY_SESSIONS_NOT_INDEPENDENT');
  check(a.authenticated===true&&b.authenticated===true,'CONCURRENCY_SESSIONS_NOT_AUTHENTICATED');
  check(Date.parse(a.started)<Date.parse(b.ended)&&Date.parse(b.started)<Date.parse(a.ended),'CONCURRENCY_TRANSACTIONS_DID_NOT_OVERLAP');
}
export function safeFailure(scenario,error){
  const state=typeof error?.sqlstate==='string'&&/^[0-9A-Z]{5}$/.test(error.sqlstate)?error.sqlstate:'XXXXX';
  const code=allowedCodes.has(error?.code)?error.code:/^CONCURRENCY_[A-Z_]+$/.test(error?.message??'')?error.message:'CONCURRENCY_GATE_FAILED';
  return {scenario:/^C[1-6]$/.test(scenario)?scenario:'SETUP_OR_CLEANUP',sqlstate:state,code};
}
export async function runCloud(env=process.env,cleanupOnly=false){
  assertCloud(env);
  check(env.SUPABASE_ACCESS_TOKEN,'CONCURRENCY_TOKEN_MISSING');
  const api=createManagementClient(env.SUPABASE_ACCESS_TOKEN);
  const branches=await api('concurrency-preview-identity',`/projects/${parentProject}/branches`);
  const ref=selectPreview(branches,env.STB_GIT_BRANCH,env.STB_PR_NUMBER);
  const sql=(query,parameters=[])=>api('concurrency-preview-query',`/projects/${ref}/database/query`,{query,parameters});
  let c;
  if(cleanupOnly){
    try{c=JSON.parse(await readFile(manifestPath,'utf8'));}catch(e){if(e.code==='ENOENT'){console.log('CONCURRENCY_NO_SCOPE_CREATED');return;}throw Error('CONCURRENCY_MANIFEST_INVALID');}
    validateScope(c);check(c.ref===ref,'CONCURRENCY_PREVIEW_CHANGED');
  }else{
    const run=randomUUID();c={run,org:randomUUID(),users:[randomUUID(),randomUUID(),randomUUID()],schema:`stb_ms_${run.replaceAll('-','')}`,process:`STB-MS-${run}`,ref};
    await writeFile(manifestPath,JSON.stringify(c),{mode:0o600});
  }
  async function cleanup(){
    const exists=await sql('select pg_catalog.to_regnamespace($1::text) is not null as present',[c.schema]);
    if(exists[0]?.present===true){
      const result=await sql(cleanupSql(c));
      check(result[0]?.cleanup_report?.preserved===true,'CONCURRENCY_UNRELATED_DATA_CHANGED');
      check(result[0]?.cleanup_report?.auditGuardEnabled===true,'CONCURRENCY_AUDIT_GUARD_NOT_RESTORED');
    }
    const residue=await sql(residueSql(c),[c.org,c.users,c.process]);
    check(residue[0]?.residual_fixture_records===0,'CONCURRENCY_RESIDUAL_FIXTURES');
    console.log(JSON.stringify({concurrencyCleanup:'PASS',residualFixtures:0}));
  }
  if(cleanupOnly){await cleanup();return;}
  let scenario='SETUP';
  let successful=false;
  const errors=[];
  try{
    await sql(setupSql(c)); // Committed before either competing actor session starts.
    async function action(label,actor,kind,args,hold=false){
      const result=await sql(`select ${c.schema}.run_action($1::text,$2::uuid,$3::text,$4::jsonb,$5::boolean) as action_report`,[label,actor,kind,args,hold]);
      check(result.length===1&&result[0]?.action_report,'CONCURRENCY_ACTION_RESPONSE_INVALID');return result[0].action_report;
    }
    function expectSuccess(r){if(r.sqlstate!=='00000')throw r;check(r.authenticated===true,'CONCURRENCY_ACTOR_AUTH_FAILED');return r.result;}
    function expectConflict(r,code,state='P0001'){check(r.sqlstate===state&&r.code===code,'CONCURRENCY_CONFLICT_NOT_EXPLICIT');}
    async function state(){
      const result=await sql(`select jsonb_build_object('definitions',(select count(*) from public.indicator_definitions d where d.organization_id=$1::uuid),'periods',(select count(*) from public.indicator_periods p join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=$1::uuid),'results',(select count(*) from public.indicator_results r join public.indicator_periods p on p.id=r.period_id join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=$1::uuid),'periodRows',(select jsonb_agg(to_jsonb(p) order by d.code) from public.indicator_periods p join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=$1::uuid),'resultValue',(select r.value from public.indicator_results r join public.indicator_periods p on p.id=r.period_id join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=$1::uuid order by d.code limit 1)) as snapshot`,[c.org]);
      const r=result[0]?.snapshot;check(r?.definitions===52&&r.periods===52&&r.results<=1,'CONCURRENCY_PARTIAL_OR_DUPLICATE_STATE');return r;
    }
    const now=Date.now();
    const scope=offset=>[{year:2030,quarter:'Q1',opensAt:new Date(now-86400000+offset).toISOString(),closesAt:new Date(now+86400000+offset).toISOString()}];
    const closed=[{year:2030,quarter:'Q1',opensAt:new Date(now+5*86400000).toISOString(),closesAt:new Date(now+6*86400000).toISOString()}];
    async function preview(requestScope,include=true){return expectSuccess(await action('preview',c.users[0],'preview',{scope:requestScope,include}));}
    async function globalArgs(requestScope,operation=randomUUID(),include=true){const p=await preview(requestScope,include);check(p.indicators===52,'CONCURRENCY_PREVIEW_COUNT');return {scope:requestScope,include,token:p.token,operation};}
    async function assertWindows(requestScope){const s=await state();check(s.periodRows.every(p=>p.capture_rule_source==='global'&&Date.parse(p.opens_at)===Date.parse(requestScope[0].opensAt)&&Date.parse(p.closes_at)===Date.parse(requestScope[0].closesAt)),'CONCURRENCY_PARTIAL_WINDOW_UPDATE');return s;}
    async function assertOperation(operation,count){const r=await sql('select (select count(*) from public.indicator_capture_operations o where o.id=$1::uuid)::integer as operations,(select count(*) from public.audit_log a where a.resource_id=$1::text and a.action=\'indicator_capture.global_applied\')::integer as audit',[operation]);check(r[0]?.operations===count&&r[0]?.audit===count,'CONCURRENCY_DUPLICATE_OPERATION_OR_AUDIT');}
    async function activity(){return sql('select a.pid,a.application_name,a.wait_event,pg_catalog.pg_blocking_pids(a.pid) as blockers from pg_catalog.pg_stat_activity a where a.application_name=any($1::text[])',[[`${c.schema}:a`,`${c.schema}:b`]]);}
    async function until(predicate,earlyFailure){const deadline=Date.now()+15000;while(Date.now()<deadline){earlyFailure?.();const rows=await activity();if(predicate(rows))return rows;await wait(150);}throw Error('CONCURRENCY_OVERLAP_NOT_OBSERVED');}
    async function race(a,b){
      await sql(`update ${c.schema}.control set released=false`);
      let aPromise,bPromise,aOutcome,bOutcome,observed;
      try{
        // Catch immediately to prevent an unhandled rejection while the observer polls.
        const settle=p=>p.then(value=>({value}),error=>({error}));
        const failEarly=()=>{for(const outcome of [aOutcome,bOutcome]){if(outcome?.error)throw outcome.error;if(outcome?.value&&outcome.value.sqlstate!=='00000')throw outcome.value;}};
        aPromise=settle(action('a',...a,true)).then(outcome=>{aOutcome=outcome;return outcome;});
        const ready=await until(rows=>rows.some(r=>r.application_name===`${c.schema}:a`&&r.wait_event==='PgSleep'),failEarly);
        const aPid=ready.find(r=>r.application_name===`${c.schema}:a`).pid;
        bPromise=settle(action('b',...b,false)).then(outcome=>{bOutcome=outcome;return outcome;});
        observed=await until(rows=>rows.some(r=>r.application_name===`${c.schema}:b`&&r.pid!==aPid&&r.blockers?.includes(aPid)),failEarly);
        check(observed.some(r=>r.application_name===`${c.schema}:a`),'CONCURRENCY_HOLDER_NOT_ACTIVE');
      }finally{
        // Release is committed by a third cloud session, even if observing a race failed.
        await sql(`update ${c.schema}.control set released=true`);
        const settled=await Promise.all([aPromise,bPromise].filter(Boolean));
        for(const result of settled)if(result.error)errors.push(result.error);
      }
      check(errors.length===0,'CONCURRENCY_TRANSPORT_FAILURE');
      const [ar,br]=await Promise.all([aPromise,bPromise]);check(ar?.value&&br?.value,'CONCURRENCY_ACTOR_RESPONSE_MISSING');
      requireOverlap(ar.value,br.value);return [ar.value,br.value];
    }
    expectSuccess(await action('open',c.users[0],'global',await globalArgs(scope(0))));
    let s=await state();const period=s.periodRows[0].id;
    expectSuccess(await action('baseline',c.users[0],'capture',{period,value:1}));

    scenario='C1'; // Two administrators, same quarter and stale preview token.
    const args1=await globalArgs(scope(1000)),args2=await globalArgs(scope(2000));
    let [a,b]=await race([c.users[0],'global',args1],[c.users[1],'global',args2]);
    expectSuccess(a);expectConflict(b,'CAPTURE_PREVIEW_STALE');await assertWindows(scope(1000));await assertOperation(args1.operation,1);await assertOperation(args2.operation,0);
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));

    scenario='C2'; // Administrator changes the window while an authorized user captures that period.
    [a,b]=await race([c.users[0],'global',await globalArgs(scope(2500))],[c.users[2],'capture',{period,value:202}]);
    expectSuccess(a);expectSuccess(b);s=await assertWindows(scope(2500));check(s.results===1&&s.resultValue===202,'CONCURRENCY_RESULT_LOST_OR_DUPLICATED');
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));

    scenario='C3'; // Global update vs an individual exception with the old period version.
    s=await state();const args3=await globalArgs(scope(3000));
    const exception={period,stamp:s.periodRows[0].updated_at,opens:new Date(now-2*86400000).toISOString(),closes:new Date(now+2*86400000).toISOString(),operation:randomUUID()};
    [a,b]=await race([c.users[0],'global',args3],[c.users[1],'exception',exception]);
    expectSuccess(a);expectConflict(b,'CAPTURE_PREVIEW_STALE');s=await assertWindows(scope(3000));
    expectSuccess(await action('fresh_exception',c.users[1],'exception',{...exception,stamp:s.periodRows[0].updated_at,operation:randomUUID()}));
    s=await state();check(s.periodRows[0].capture_rule_source==='exception','CONCURRENCY_EXCEPTION_NOT_PRESERVED');
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));

    scenario='C4'; // Date closes while a capture has already read the former open window.
    [a,b]=await race([c.users[0],'global',await globalArgs(closed)],[c.users[2],'capture',{period,value:303}]);
    expectSuccess(a);expectConflict(b,'INDICATOR_CAPTURE_WINDOW_CLOSED','42501');s=await assertWindows(closed);check(s.resultValue===202&&s.results===1,'CONCURRENCY_BLOCKED_CAPTURE_CHANGED_RESULT');
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));

    scenario='C5'; // Same operation id, payload, actor, and preview in two independent sessions.
    const retry=await globalArgs(scope(4000));
    [a,b]=await race([c.users[0],'global',retry],[c.users[0],'global',retry]);
    check(expectSuccess(a).replayed===false&&expectSuccess(b).replayed===true,'CONCURRENCY_RETRY_NOT_IDEMPOTENT');await assertOperation(retry.operation,1);await assertWindows(scope(4000));
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));

    scenario='C6'; // Reverse ordering: committed exception invalidates a global preview.
    s=await state();const stale=await globalArgs(scope(5000),randomUUID(),false);
    [a,b]=await race([c.users[1],'exception',{...exception,stamp:s.periodRows[0].updated_at,operation:randomUUID()}],[c.users[0],'global',stale]);
    expectSuccess(a);expectConflict(b,'CAPTURE_PREVIEW_STALE');s=await state();check(s.periodRows[0].capture_rule_source==='exception'&&Date.parse(s.periodRows[0].closes_at)===Date.parse(exception.closes)&&s.resultValue===202&&s.results===1,'CONCURRENCY_EXCEPTION_OR_RESULT_LOST');await assertOperation(stale.operation,0);
    console.log(JSON.stringify({scenario,status:'PASS',independentSessions:true,blockingObserved:true}));
    successful=true;
  }catch(error){console.error(JSON.stringify(safeFailure(scenario,error)));throw Error('CONCURRENCY_ACCEPTANCE_FAILED');}
  finally{await cleanup();}
  check(successful,'CONCURRENCY_ACCEPTANCE_NOT_COMPLETED');
  console.log(JSON.stringify({multiSessionConcurrency:'PASS',scenarios:6,fixtureIndicators:52,productionModified:false}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runCloud(process.env,process.argv.includes('--cleanup')).catch(()=>{console.error('CONCURRENCY_CLOUD_GATE_FAILED');process.exitCode=1;});
