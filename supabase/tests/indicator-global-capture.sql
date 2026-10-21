-- GitHub-hosted execution only, against the Git integration's verified isolated Preview.
-- All fixture identities/data and test DDL roll back. Never run against production.
begin;
do $test$
declare
  org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); external_user uuid:=gen_random_uuid(); demo_user uuid:=gen_random_uuid();
  process text:='STB-CI-'||gen_random_uuid()::text; id uuid; first_period uuid; extra uuid;
  scope jsonb; closed_scope jsonb; preview jsonb; applied jsonb; recovered jsonb; before_results text; before_files text; before_windows text;
  op uuid:=gen_random_uuid(); closed_op uuid:=gen_random_uuid(); stamp timestamptz; u uuid;
begin
  if to_regprocedure('public.apply_indicator_capture_windows(jsonb,boolean,text,uuid,text,boolean)') is null then raise exception 'STB_MIGRATION_MISSING'; end if;
  insert into public.organizations(id,code,name,kind) values(org,'STB-CI-'||org::text,'STB acceptance fixtures','internal');
  foreach u in array array[actor,reader,outsider,external_user,demo_user] loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(u,u::text||'@example.invalid',jsonb_build_object('user_type',case when u=actor then 'administrator' else 'internal' end,'workspace_mode',case when u=demo_user then 'demo' else 'production' end),'{"full_name":"STB Preview fixture"}');
    update public.profiles set organization_id=org,workspace_mode=case when u=demo_user then 'demo' else 'production' end where profiles.id=u;
  end loop;
  -- A genuine external profile, scoped to a fixture external organization, never a real account.
  insert into public.organizations(id,code,name,kind) values(gen_random_uuid(),'STB-EXT-'||org::text,'STB external fixture','customer') returning organizations.id into id;
  update public.profiles set user_type='customer',status='active',external_party_kind='customer',external_party_id=id,external_party_name='STB external fixture' where profiles.id=external_user;
  insert into public.processes(id,name,level,organization_id) values(process,'STB fixture process','process',org);
  insert into public.user_process_permissions(user_id,process_id,document_role,source) values(reader,process,'viewer','direct');
  insert into public.user_module_permissions(user_id,module_id,can_view,source) values(reader,'indicators',true,'direct');
  insert into public.user_module_action_permissions(user_id,module_id,action,source) values(reader,'indicators','view','direct'),(reader,'indicators','update','direct');
  for n in 1..52 loop
    insert into public.indicator_definitions(code,organization_id,workspace_mode,process_id,area,name,metric_label,created_by)
    values('STB-CI-'||n,org,'production',process,'Fixture','STB indicator '||n,'>=0',actor) returning indicator_definitions.id into id;
    insert into public.indicator_evaluation_rules(indicator_id,rule_type,target_min,compliant_rule,marginal_rule,noncompliant_rule,updated_by) values(id,'minimum',0,'>=0','>=0','<0',actor);
    insert into public.indicator_definition_processes(indicator_id,process_id) values(id,process);
    insert into public.indicator_periods(indicator_id,year,quarter,scheduled_date,opens_at,closes_at,created_by)
    values(id,2030,'Q1','2030-03-31',null,null,actor);
  end loop;
  select p.id,p.updated_at into first_period,stamp from public.indicator_periods p join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=org order by d.code limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  perform public.save_indicator_result_runtime(first_period,1,'Protected baseline fixture',null,'Preview baseline');
  perform public.set_indicator_capture_exception(first_period,stamp,now()-interval '2 days',now()+interval '2 days',false,'Explicit fixture exception',true,gen_random_uuid());
  execute 'reset role';
  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text,'[]')) into before_results from public.indicator_results r;
  select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.id)::text,'[]')) into before_files from public.file_objects f;
  scope:=jsonb_build_array(jsonb_build_object('year',2030,'quarter','Q1','opensAt',now()-interval '1 day','closesAt',now()+interval '1 day'));
  closed_scope:=jsonb_build_array(jsonb_build_object('year',2030,'quarter','Q1','opensAt',now()+interval '5 days','closesAt',now()+interval '6 days'));
  execute 'set local role authenticated';
  preview:=public.preview_indicator_capture_windows(scope,false);
  if (preview->>'indicators')::integer<>52 or (preview->>'windows')::integer<>51 or (preview->>'exceptions')::integer<>1 then raise exception 'STB_52_PREVIEW_OR_EXCEPTION_FAILED'; end if;
  applied:=public.apply_indicator_capture_windows(scope,false,preview->>'token',op,'Preview bulk acceptance',true);
  if (applied->'preview'->>'indicators')::integer<>52 then raise exception 'STB_BULK_SCOPE_FAILED'; end if;
  if (public.apply_indicator_capture_windows(scope,false,preview->>'token',op,'Preview bulk acceptance',true)->>'replayed')::boolean is distinct from true then raise exception 'STB_IDEMPOTENCY_FAILED'; end if;
  begin
    perform public.apply_indicator_capture_windows(closed_scope,false,preview->>'token',gen_random_uuid(),'Stale fixture preview',true);
    raise exception 'STB_STALE_PREVIEW_WAS_ACCEPTED';
  exception when others then if sqlerrm not like '%CAPTURE_PREVIEW_STALE%' then raise; end if; end;
  begin
    perform public.apply_indicator_capture_windows(scope,false,applied->'preview'->>'token',gen_random_uuid(),'No confirmation',false);
    raise exception 'STB_CONFIRMATION_BYPASSED';
  exception when others then if sqlerrm not like '%CAPTURE_CONFIRMATION_REQUIRED%' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.indicator_periods p join public.indicator_definitions d on d.id=p.indicator_id where d.organization_id=org and p.capture_rule_source='global' and p.opens_at=(scope->0->>'opensAt')::timestamptz)<>51 then raise exception 'STB_BULK_UPDATE_FAILED'; end if;
  -- Future indicator inherits every configured period without being part of the apply request.
  insert into public.indicator_definitions(code,organization_id,workspace_mode,process_id,area,name,metric_label,created_by) values('STB-FUTURE',org,'production',process,'Fixture','Future fixture','>=0',actor) returning indicator_definitions.id into extra;
  if not exists(select 1 from public.indicator_periods where indicator_id=extra and opens_at=(scope->0->>'opensAt')::timestamptz and capture_rule_source='global') then raise exception 'STB_INHERITANCE_FAILED'; end if;
  execute 'set local role authenticated';
  begin
    perform public.restore_indicator_capture_windows(op,applied->'preview'->>'token','Conflict fixture',true);raise exception 'STB_RECOVERY_OVERWROTE_CHANGED_SCOPE';
  exception when others then if sqlerrm not like '%CAPTURE_RECOVERY_CONFLICT%' then raise; end if; end;
  execute 'reset role';
  delete from public.indicator_definitions where indicator_definitions.id=extra; -- This UUID was created above; whole test rolls back.
  execute 'set local role authenticated';
  recovered:=public.restore_indicator_capture_windows(op,applied->'preview'->>'token','Recover preview fixture',true);
  execute 'reset role';
  if before_results is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text,'[]')) from public.indicator_results r) then raise exception 'STB_RESULTS_CHANGED'; end if;
  if before_files is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.id)::text,'[]')) from public.file_objects f) then raise exception 'STB_EVIDENCE_CHANGED'; end if;
  -- Non-admin and external actors cannot preview or execute a global operation.
  foreach u in array array[reader,outsider,external_user,demo_user] loop
    perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
    begin perform public.preview_indicator_capture_windows(scope,false);raise exception 'STB_ADMIN_GATE_BYPASSED';
    exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;

  -- Force a failure after the rule upsert and prove the transaction leaves no partial publication.
  execute $create$create function pg_temp.fail_stb_capture() returns trigger language plpgsql as $body$begin if new.id::text=tg_argv[0] then raise exception 'STB_FORCED_PERIOD_FAILURE'; end if;return new;end;$body$create$;
  execute format('create trigger stb_forced_capture_failure before update on public.indicator_periods for each row execute function pg_temp.fail_stb_capture(%L)',first_period::text);
  perform set_config('request.jwt.claim.sub',actor::text,true);execute 'set local role authenticated';
  preview:=public.preview_indicator_capture_windows(closed_scope,true);
  begin perform public.apply_indicator_capture_windows(closed_scope,true,preview->>'token',gen_random_uuid(),'Rollback fixture',true);raise exception 'STB_FAILURE_NOT_RAISED';
  exception when others then if sqlerrm not like '%STB_FORCED_PERIOD_FAILURE%' then raise; end if;end;
  if public.preview_indicator_capture_windows(closed_scope,true)->>'token' is distinct from preview->>'token' then raise exception 'STB_PARTIAL_TRANSACTION_PUBLISHED'; end if;
  execute 'reset role';execute 'drop trigger stb_forced_capture_failure on public.indicator_periods';
  perform set_config('request.jwt.claim.sub',outsider::text,true);execute 'set local role authenticated';
  if exists(select 1 from public.indicator_definitions where organization_id=org) or exists(select 1 from public.indicator_capture_operations where organization_id=org) then raise exception 'STB_RLS_INFORMATION_LEAK'; end if;
  execute 'reset role';
  -- Make all 52 windows open, test capture, then close them and enforce user/admin rules.
  perform set_config('request.jwt.claim.sub',actor::text,true);execute 'set local role authenticated';
  preview:=public.preview_indicator_capture_windows(scope,true);
  perform public.apply_indicator_capture_windows(scope,true,preview->>'token',gen_random_uuid(),'Open capture fixture',true);
  perform set_config('request.jwt.claim.sub',reader::text,true);
  perform public.save_indicator_result_runtime(first_period,2,'Authorized fixture capture',null,null);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  preview:=public.preview_indicator_capture_windows(closed_scope,true);
  perform public.apply_indicator_capture_windows(closed_scope,true,preview->>'token',closed_op,'Close capture fixture',true);
  perform set_config('request.jwt.claim.sub',reader::text,true);
  begin perform public.save_indicator_result_runtime(first_period,3,'Must be blocked',null,null);raise exception 'STB_CLOSED_CAPTURE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin perform public.save_indicator_result_runtime(first_period,3,'Must require reason',null,null);raise exception 'STB_OVERRIDE_WITHOUT_REASON_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm not like '%INDICATOR_ADMIN_OVERRIDE_REASON_REQUIRED%' then raise; end if; end;
  perform public.save_indicator_result_runtime(first_period,3,'Authorized administrative fixture',null,'Explicit Preview override');
  begin update public.indicator_capture_operations set reason='tampered' where id=op;raise exception 'STB_AUDIT_MUTABLE';exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select count(*) from public.audit_log where organization_id=org and action='indicator_capture.global_applied')<1 then raise exception 'STB_AUDIT_MISSING'; end if;
end $test$;
rollback;
select 'STB_01_PREVIEW_PASS' as status,52 as fixture_indicators;
