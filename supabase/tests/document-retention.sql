-- GitHub hosted, exact isolated PR Preview only. No committed fixtures.
do $test$
declare
 v_org uuid:=gen_random_uuid();v_other uuid:=gen_random_uuid();v_admin uuid:=gen_random_uuid();v_reader uuid:=gen_random_uuid();v_demo uuid:=gen_random_uuid();v_external uuid:=gen_random_uuid();v_foreign uuid:=gen_random_uuid();v_user uuid;
 v_process text:='STB2-'||gen_random_uuid()::text;v_code text:='STB2-'||gen_random_uuid()::text;v_type text;
 v_old jsonb;v_new jsonb;v_extra jsonb;v_doc jsonb;v_file jsonb;v_old_id uuid;v_new_id uuid;v_version uuid;v_folder uuid:=gen_random_uuid();v_f1 uuid:=gen_random_uuid();v_f2 uuid:=gen_random_uuid();v_f3 uuid:=gen_random_uuid();v_key text:=gen_random_uuid()::text;
 v_before jsonb:='{}';v_after jsonb:='{}';v_table record;v_digest text;v_versions text;v_files text;
 v_stage text:='STB2_SETUP';v_failed text;v_state text;v_message text;v_error text;v_pass boolean:=false;v_residual integer;
begin
  for v_table in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and (n.nspname in ('public','auth') or (n.nspname='storage' and c.relname='objects')) order by n.nspname,c.relname loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',v_table.nspname,v_table.relname) into v_digest;
    v_before:=v_before||jsonb_build_object(v_table.nspname||'.'||v_table.relname,v_digest);
  end loop;
 begin
  insert into public.organizations(id,code,name,kind) values(v_org,'STB2-'||v_org,'STB-02 Preview fixtures','internal'),(v_other,'STB2-'||v_other,'Other fixture scope','customer');
  foreach v_user in array array[v_admin,v_reader,v_demo,v_external,v_foreign] loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_user,v_user::text||'@example.invalid',jsonb_build_object('user_type',case when v_user in (v_admin,v_demo,v_foreign) then 'administrator' else 'internal' end,'workspace_mode',case when v_user=v_demo then 'demo' else 'production' end),'{"full_name":"STB-02 fixture"}');
    update public.profiles p set organization_id=case when v_user=v_foreign then v_other else v_org end,status='active' where p.id=v_user;
  end loop;
  update public.profiles set user_type='customer',external_party_kind='customer',external_party_id=v_other,external_party_name='STB-02 external fixture' where id=v_external;
  insert into public.processes(id,name,level,organization_id) values(v_process,'STB-02 fixture','process',v_org);
  insert into public.user_process_permissions(user_id,process_id,document_role,source) values(v_reader,v_process,'viewer','direct');
  insert into public.user_module_permissions(user_id,module_id,can_view,source) values(v_reader,'documents',true,'direct');
  insert into public.user_module_action_permissions(user_id,module_id,action,source) values(v_reader,'documents','view','direct');
  select t.id into v_type from public.document_types t where t.active order by t.sort_order limit 1;
  if v_type is null then raise exception 'STB2_DOCUMENT_TYPE_MISSING';end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);execute 'set local role authenticated';
  v_doc:=jsonb_build_object('process_id',v_process,'document_type_id',v_type,'code',v_code,'title','Retained official fixture','revision',1,'validator_id',v_admin);
  v_file:=jsonb_build_object('object_path',v_admin::text||'/documents/'||gen_random_uuid()::text||'/original.pdf','original_name','original.pdf','mime_type','application/pdf','size_bytes',10,'sha256',repeat('a',64));
  v_old:=public.register_controlled_file(v_doc,v_file);
  v_old_id:=(v_old->>'document_id')::uuid;v_version:=(v_old->>'version_id')::uuid;
  perform public.review_document_version(v_version,'approve',null);
  execute 'reset role';
  select md5(jsonb_agg(to_jsonb(v) order by v.id)::text) into v_versions from public.controlled_document_versions v where v.document_id=v_old_id;
  select md5(to_jsonb(f)::text) into v_files from public.file_objects f where f.id=(v_old->>'file_id')::uuid;

  v_stage:='STB2_DELETE';
  execute 'set local role authenticated';
  begin perform public.soft_delete_document(v_old_id,' ');raise exception 'STB2_EMPTY_REASON_ACCEPTED';exception when invalid_parameter_value then null;end;
  perform public.soft_delete_document(v_old_id,'Fixture replacement reason');
  perform public.soft_delete_document(v_old_id,'Repeated deletion');
  if not exists(select 1 from public.document_lifecycle l where l.document_id=v_old_id and l.is_deleted and l.delete_reason='Fixture replacement reason') then raise exception 'STB2_DELETE_NOT_RECORDED';end if;
  perform set_config('request.jwt.claim.sub',v_reader::text,true);
  if exists(select 1 from public.controlled_documents d where d.id=v_old_id) or exists(select 1 from public.v_document_master_list m where m.id=v_old_id) then raise exception 'STB2_DELETED_STILL_OPERATIONAL';end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  v_stage:='STB2_REUSE';
  if not public.document_code_available(v_code,v_process) then raise exception 'STB2_DELETED_CODE_BLOCKS_REUSE';end if;
  v_new:=public.register_controlled_file(v_doc,v_file||jsonb_build_object('object_path',v_admin::text||'/documents/'||gen_random_uuid()::text||'/replacement.pdf'));
  v_new_id:=(v_new->>'document_id')::uuid;
  if v_new_id=v_old_id then raise exception 'STB2_OLD_ID_OVERWRITTEN';end if;
  begin perform public.register_controlled_file(v_doc,v_file||jsonb_build_object('object_path',v_admin::text||'/documents/'||gen_random_uuid()::text||'/duplicate.pdf'));raise exception 'STB2_DUPLICATE_ACTIVE_ACCEPTED';exception when unique_violation then null;end;
  begin perform public.restore_document(v_old_id);raise exception 'STB2_RESTORE_OVERWROTE_ACTIVE';exception when unique_violation then null;end;
  if not exists(select 1 from public.controlled_documents d where d.id=v_old_id and d.deleted_at is not null) then raise exception 'STB2_CONFLICT_PARTIALLY_RESTORED';end if;
  v_stage:='STB2_RESTORE';
  perform public.soft_delete_document(v_new_id,'Release fixture code');
  perform public.restore_document(v_old_id);
  if not exists(select 1 from public.controlled_documents d where d.id=v_old_id and d.deleted_at is null) then raise exception 'STB2_RESTORE_FAILED';end if;
  if (select count(*) from public.document_audit_log a where a.document_id=v_old_id and a.event_type='DOCUMENT_DELETED' and a.reason='Fixture replacement reason')<>1 or not exists(select 1 from public.document_audit_log a where a.document_id=v_old_id and a.event_type='DOCUMENT_RESTORED') then raise exception 'STB2_AUDIT_MISSING';end if;
  begin update public.document_audit_log set reason='tampered' where document_id=v_old_id;raise exception 'STB2_AUDIT_MUTABLE';exception when insufficient_privilege then null;end;
  execute 'reset role';
  if v_versions is distinct from (select md5(jsonb_agg(to_jsonb(v) order by v.id)::text) from public.controlled_document_versions v where v.document_id=v_old_id) or v_files is distinct from (select md5(to_jsonb(f)::text) from public.file_objects f where f.id=(v_old->>'file_id')::uuid) then raise exception 'STB2_OFFICIAL_VERSION_OR_FILE_CHANGED';end if;

  v_stage:='STB2_VERSIONS';
  execute 'set local role authenticated';
  begin
    perform public.register_controlled_file(jsonb_build_object('revision',1,'change_reason','Fixture revision','change_summary','Fixture summary'),v_file||jsonb_build_object('object_path',v_admin::text||'/documents/'||gen_random_uuid()::text||'/duplicate-revision.pdf'),v_old_id);
    raise exception 'STB2_DUPLICATE_REVISION_ACCEPTED';
  exception when unique_violation then null;end;
  v_extra:=public.register_controlled_file(jsonb_build_object('revision',2,'change_reason','Fixture revision','change_summary','Fixture summary'),v_file||jsonb_build_object('object_path',v_admin::text||'/documents/'||gen_random_uuid()::text||'/new-revision.pdf'),v_old_id);
  if not exists(select 1 from public.controlled_document_versions v where v.id=v_version and v.status='current' and v.file_id=(v_old->>'file_id')::uuid) or not exists(select 1 from public.controlled_document_versions v where v.id=(v_extra->>'version_id')::uuid and v.status='draft') then raise exception 'STB2_VERSION_FLOW_NOT_RETAINED';end if;
  execute 'reset role';

  v_stage:='STB2_GENERAL';
  execute 'set local role authenticated';
  insert into public.document_folders(id,workspace_id,name,created_by,updated_by) values(v_folder,v_org,'STB-02 General fixture',v_admin,v_admin);
  v_file:=jsonb_build_object('id',v_f1,'object_path',v_org::text||'/information-general/'||v_folder::text||'/'||v_f1::text||'/original.pdf','original_name','same-name.pdf','display_name','Same document','mime_type','application/pdf','size_bytes',10,'sha256',repeat('b',64),'folder_id',v_folder,'resource_key',v_key,'preview_status','not_required','reference_type','internal','validity_status','current');
  perform public.publish_general_document(v_file);
  begin perform public.general_document_lifecycle(v_f1,'delete','');raise exception 'STB2_GENERAL_REASON_MISSING';exception when invalid_parameter_value then null;end;
  perform public.general_document_lifecycle(v_f1,'delete','General replacement reason');
  perform public.publish_general_document(v_file||jsonb_build_object('id',v_f2,'object_path',v_org::text||'/information-general/'||v_folder::text||'/'||v_f2::text||'/replacement.pdf'));
  begin perform public.general_document_lifecycle(v_f1,'restore');raise exception 'STB2_GENERAL_RESTORE_OVERWROTE_ACTIVE';exception when unique_violation then null;end;
  perform public.general_document_lifecycle(v_f2,'delete','Release general fixture key');
  perform public.general_document_lifecycle(v_f1,'restore');
  begin
    perform public.publish_general_document(v_file||jsonb_build_object('id',v_f3,'object_path',v_org::text||'/information-general/'||v_folder::text||'/'||v_f3::text||'/failed.pdf','reference_type','invalid'),v_f1);
    raise exception 'STB2_FAILED_REPLACEMENT_PUBLISHED';
  exception when check_violation then null;end;
  if not exists(select 1 from public.file_objects f where f.id=v_f1 and f.is_current and f.deleted_at is null) or exists(select 1 from public.file_objects f where f.id=v_f3) then raise exception 'STB2_GENERAL_PARTIAL_PUBLICATION';end if;
  if not exists(select 1 from public.document_retention_events e where e.file_id=v_f1 and e.action='delete' and e.reason='General replacement reason') then raise exception 'STB2_GENERAL_AUDIT_MISSING';end if;
  begin update public.file_objects set object_path='overwritten.pdf' where id=v_f1;raise exception 'STB2_BINARY_MUTABLE';exception when insufficient_privilege then null;end;
  begin delete from public.file_objects where id=v_f1;exception when insufficient_privilege then null;end;
  if not exists(select 1 from public.file_objects where id=v_f1) then raise exception 'STB2_PHYSICAL_FILE_DELETE_ALLOWED';end if;
  execute 'reset role';

  v_stage:='STB2_RLS';
  foreach v_user in array array[v_reader,v_demo,v_external,v_foreign] loop
    perform set_config('request.jwt.claim.sub',v_user::text,true);execute 'set local role authenticated';
    begin perform public.soft_delete_document(v_old_id,'Unauthorized');raise exception 'STB2_UNAUTHORIZED_DELETE';exception when insufficient_privilege then null;end;
    begin perform public.restore_document(v_new_id);raise exception 'STB2_UNAUTHORIZED_RESTORE';exception when insufficient_privilege then null;end;
    begin perform public.general_document_lifecycle(v_f1,'delete','Unauthorized');raise exception 'STB2_UNAUTHORIZED_GENERAL';exception when insufficient_privilege then null;end;
    if v_user<>v_reader and (exists(select 1 from public.controlled_documents where id=v_old_id) or exists(select 1 from public.file_objects where id=v_f1)) then raise exception 'STB2_SCOPE_LEAK';end if;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claim.sub',v_demo::text,true);execute 'set local role authenticated';
  perform public.register_controlled_file(v_doc||jsonb_build_object('validator_id',v_demo),v_file||jsonb_build_object('object_path',v_demo::text||'/documents/'||gen_random_uuid()::text||'/demo.pdf'));
  if (select count(*) from public.controlled_documents where upper(code)=upper(v_code))<>1 then raise exception 'STB2_DEMO_SCOPE_FAILED';end if;
  execute 'reset role';
  raise exception using errcode='ZST02',message='STB2_EXPECTED_ROLLBACK';
 exception when others or query_canceled or assert_failure then
  get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  if v_state='ZST02' and v_message='STB2_EXPECTED_ROLLBACK' then v_pass:=true;v_state:=null;
  else v_failed:=v_stage;v_error:=case when v_message ~ '^STB2_[A-Z0-9_]+$' then v_message else 'STB2_SQL_ERROR' end;end if;
 end;
  for v_table in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and (n.nspname in ('public','auth') or (n.nspname='storage' and c.relname='objects')) order by n.nspname,c.relname loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',v_table.nspname,v_table.relname) into v_digest;
    v_after:=v_after||jsonb_build_object(v_table.nspname||'.'||v_table.relname,v_digest);
  end loop;
 select (select count(*) from public.organizations where id in(v_org,v_other))+(select count(*) from auth.users where id=any(array[v_admin,v_reader,v_demo,v_external,v_foreign])) into v_residual;
 if v_before is distinct from v_after or v_residual<>0 then v_pass:=false;v_failed:='STB2_ROLLBACK';v_state:='P0001';v_error:='STB2_PRESERVATION_FAILED';end if;
 perform set_config('integraq.stb2_report',jsonb_build_object('status',case when v_pass then 'PASS' else 'FAIL' end,'stage',v_failed,'sqlstate',v_state,'code',v_error,'residualFixtures',v_residual,'preserved',v_before=v_after)::text,true);
end;$test$;
select current_setting('integraq.stb2_report')::jsonb as report;