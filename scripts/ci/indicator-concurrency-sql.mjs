// Test infrastructure only. These statements are never migrations and may run only
// after the GitHub-hosted runner has resolved PR #4's isolated Supabase branch.
export function validateScope(c){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if(!uuid.test(c?.run)||!uuid.test(c?.org)||!Array.isArray(c?.users)||c.users.length!==3||new Set(c.users).size!==3||!c.users.every(v=>uuid.test(v))||c.schema!==`stb_ms_${c.run.replaceAll('-','')}`||c.process!==`STB-MS-${c.run}`)throw Error('CONCURRENCY_SCOPE_INVALID');
  return c;
}
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
export function setupSql(input){
  const c=validateScope(input),s=c.schema;
  return `
create schema ${s};
revoke all on schema ${s} from public,anon,authenticated;
create table ${s}.control(released boolean not null, baseline jsonb not null, run uuid not null, organization_id uuid not null, users uuid[] not null, process_id text not null);
create function ${s}.snapshot() returns jsonb language plpgsql set search_path=pg_catalog as $snapshot$
declare v_table record;v_digest text;v_result jsonb:='{}';
begin
  for v_table in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth') order by n.nspname,c.relname loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(stb_row) order by to_jsonb(stb_row)::text)::text,''[]'')) from %I.%I stb_row',v_table.nspname,v_table.relname) into v_digest;
    v_result:=v_result||jsonb_build_object(v_table.nspname||'.'||v_table.relname,v_digest);
  end loop;
  return v_result;
end;$snapshot$;
insert into ${s}.control values(false,${s}.snapshot(),${literal(c.run)}::uuid,${literal(c.org)}::uuid,${literal(`{${c.users.join(',')}}`)}::uuid[],${literal(c.process)});
do $setup$
declare v_org uuid:=${literal(c.org)};v_users uuid[]:=${literal(`{${c.users.join(',')}}`)};v_user uuid;v_def uuid;v_period uuid;v_n integer;v_preview jsonb;
begin
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgname='indicator_capture_operations_immutable' and t.tgenabled='O') then raise exception 'CONCURRENCY_AUDIT_GUARD_MISSING';end if;
  insert into public.organizations(id,code,name,kind) values(v_org,${literal(c.process)},'Committed Preview concurrency fixture','internal');
  foreach v_user in array v_users loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_user,v_user::text||'@example.invalid',jsonb_build_object('user_type',case when v_user=v_users[3] then 'internal' else 'administrator' end,'workspace_mode','production'),jsonb_build_object('full_name','Preview concurrency fixture','stb_run',${literal(c.run)}));
    update public.profiles p set organization_id=v_org,workspace_mode='production' where p.id=v_user;
  end loop;
  insert into public.processes(id,name,level,organization_id) values(${literal(c.process)},'Preview concurrency fixture','process',v_org);
  insert into public.user_process_permissions(user_id,process_id,document_role,source) values(v_users[3],${literal(c.process)},'viewer','direct');
  insert into public.user_module_permissions(user_id,module_id,can_view,source) values(v_users[3],'indicators',true,'direct');
  insert into public.user_module_action_permissions(user_id,module_id,action,source) values(v_users[3],'indicators','view','direct'),(v_users[3],'indicators','update','direct');
  for v_n in 1..52 loop
    insert into public.indicator_definitions(code,organization_id,workspace_mode,process_id,area,name,metric_label,created_by) values(${literal(c.process)}||'-'||v_n,v_org,'production',${literal(c.process)},'Fixture','Concurrency indicator '||v_n,'>=0',v_users[1]) returning indicator_definitions.id into v_def;
    insert into public.indicator_evaluation_rules(indicator_id,rule_type,target_min,compliant_rule,marginal_rule,noncompliant_rule,updated_by) values(v_def,'minimum',0,'>=0','>=0','<0',v_users[1]);
    insert into public.indicator_definition_processes(indicator_id,process_id) values(v_def,${literal(c.process)});
    insert into public.indicator_periods(indicator_id,year,quarter,scheduled_date,created_by) values(v_def,2030,'Q1','2030-03-31',v_users[1]);
  end loop;
  if (select count(*) from public.indicator_definitions d where d.organization_id=v_org)<>52 then raise exception 'CONCURRENCY_FIXTURE_COUNT';end if;
end;$setup$;
create function ${s}.run_action(p_label text,p_actor uuid,p_kind text,p_args jsonb,p_hold boolean) returns jsonb language plpgsql as $action$
declare v_result jsonb;v_state text:='00000';v_message text;v_code text;v_auth boolean;v_started timestamptz:=clock_timestamp();v_deadline timestamptz;v_pid integer:=pg_backend_pid();
begin
  if not exists(select 1 from ${s}.control c where p_actor=any(c.users)) then raise exception 'CONCURRENCY_ACTOR_INVALID';end if;
  perform set_config('application_name',${literal(s+':')}||p_label,true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  execute 'set local role authenticated';
  v_auth:=current_user='authenticated' and auth.uid()=p_actor;
  begin
    case p_kind
      when 'preview' then v_result:=public.preview_indicator_capture_windows(p_args->'scope',(p_args->>'include')::boolean);
      when 'global' then v_result:=public.apply_indicator_capture_windows(p_args->'scope',(p_args->>'include')::boolean,p_args->>'token',(p_args->>'operation')::uuid,'Preview multi-session acceptance',true);
      when 'exception' then v_result:=public.set_indicator_capture_exception((p_args->>'period')::uuid,(p_args->>'stamp')::timestamptz,(p_args->>'opens')::timestamptz,(p_args->>'closes')::timestamptz,false,'Preview explicit concurrency exception',true,(p_args->>'operation')::uuid);
      when 'capture' then v_result:=public.save_indicator_result_runtime((p_args->>'period')::uuid,(p_args->>'value')::numeric,'Preview concurrent capture',null,case when public.is_administrator() then 'Preview administrative capture' else null end);
      else raise exception 'CONCURRENCY_ACTION_INVALID';
    end case;
  exception when others or query_canceled or assert_failure then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
    v_code:=case when v_message in ('CAPTURE_PREVIEW_STALE','CAPTURE_OPERATION_CONFLICT','INDICATOR_CAPTURE_WINDOW_CLOSED','INDICATOR_PROCESS_FORBIDDEN','INDICATOR_CAPTURE_PERMISSION_REQUIRED','CAPTURE_ADMIN_REQUIRED') then v_message else 'UNEXPECTED_SQL_ERROR' end;
  end;
  execute 'reset role';
  if p_hold then
    if v_state<>'00000' then return jsonb_build_object('pid',v_pid,'started',v_started,'ended',clock_timestamp(),'authenticated',v_auth,'sqlstate',v_state,'code',v_code);end if;
    v_deadline:=clock_timestamp()+interval '30 seconds';
    loop
      exit when (select c.released from ${s}.control c);
      if clock_timestamp()>v_deadline then raise exception using errcode='57014',message='CONCURRENCY_BARRIER_TIMEOUT';end if;
      perform pg_sleep(0.1);
    end loop;
  end if;
  return jsonb_build_object('pid',v_pid,'started',v_started,'ended',clock_timestamp(),'authenticated',v_auth,'sqlstate',v_state,'code',v_code,'result',v_result);
end;$action$;
select true as committed_fixture_setup;`;
}
export function cleanupSql(input){
  const c=validateScope(input),s=c.schema;
  return `
do $cleanup$
declare v_org uuid;v_users uuid[];v_run uuid;v_process text;
begin
  select c.organization_id,c.users,c.run,c.process_id into strict v_org,v_users,v_run,v_process from ${s}.control c;
  if v_run<>${literal(c.run)}::uuid or v_org<>${literal(c.org)}::uuid or v_users<>${literal(`{${c.users.join(',')}}`)}::uuid[] or v_process<>${literal(c.process)} then raise exception 'CONCURRENCY_CLEANUP_SCOPE_INVALID';end if;
  if exists(select 1 from auth.users u where u.id=any(v_users) and u.raw_user_meta_data->>'stb_run' is distinct from v_run::text) or exists(select 1 from public.organizations o where o.id=v_org and o.code<>v_process) then raise exception 'CONCURRENCY_CLEANUP_IDENTITY_INVALID';end if;
  -- Preview-only cleanup of committed fixtures. The exclusive lock prevents any
  -- other session from writing while this trigger is disabled; transactional DDL
  -- restores its state on error. No business function or migration is replaced.
  lock table public.indicator_capture_operations in access exclusive mode;
  alter table public.indicator_capture_operations disable trigger indicator_capture_operations_immutable;
  delete from public.indicator_capture_operations o where o.organization_id=v_org;
  alter table public.indicator_capture_operations enable trigger indicator_capture_operations_immutable;
  delete from public.audit_log a where a.organization_id=v_org;
  delete from public.indicator_capture_rules r where r.organization_id=v_org;
  delete from public.indicator_definitions d where d.organization_id=v_org;
  delete from public.processes p where p.id=v_process and p.organization_id=v_org;
  delete from auth.users u where u.id=any(v_users) and u.raw_user_meta_data->>'stb_run'=v_run::text;
  delete from public.organizations o where o.id=v_org and o.code=v_process;
  perform set_config('integraq.stb_concurrency_cleanup',jsonb_build_object('preserved',${s}.snapshot()=(select c.baseline from ${s}.control c),'auditGuardEnabled',exists(select 1 from pg_catalog.pg_trigger t where t.tgname='indicator_capture_operations_immutable' and t.tgenabled='O'))::text,true);
end;$cleanup$;
drop schema ${s} cascade;
select current_setting('integraq.stb_concurrency_cleanup')::jsonb as cleanup_report;`;
}
export function residueSql(input){
  const c=validateScope(input);
  return `select ((select count(*) from public.organizations o where o.id=$1::uuid)+(select count(*) from auth.users u where u.id=any($2::uuid[]))+(select count(*) from public.profiles p where p.id=any($2::uuid[]))+(select count(*) from public.processes p where p.id=$3)+(select count(*) from public.indicator_definitions d where d.organization_id=$1::uuid)+(select count(*) from public.indicator_capture_operations o where o.organization_id=$1::uuid)+(select count(*) from public.indicator_capture_rules r where r.organization_id=$1::uuid)+(select count(*) from public.audit_log a where a.organization_id=$1::uuid)+(case when pg_catalog.to_regnamespace('${c.schema}') is null then 0 else 1 end))::integer as residual_fixture_records`;
}
