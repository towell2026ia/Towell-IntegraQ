-- PROPOSAL ONLY. Do not execute without authorization for an exact target.
-- Existing infrastructure: workspace_data, profiles, file_objects, audit_log,
-- has_module_permission, current_workspace_mode, private Storage and existing audit triggers.
-- No updates to existing rows; no automatic tasks, messages or data migrations.
begin;
create function public.iq_root2cause_evidence_access(p_key text,p_process text default null,p_write boolean default false,p_uploader uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; item jsonb; draft jsonb; scope_id text; section_kind text; section_id text; case_process text;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
 if actor.id is null or actor.organization_id is null or not public.has_module_permission('corrective-actions','view') then return false; end if;
 if p_write and (actor.user_type<>'administrator' or not public.has_module_permission('corrective-actions','create')) then return false; end if;
 if p_uploader is not null and not exists(select 1 from public.profiles p where p.id=p_uploader and p.organization_id=actor.organization_id) then return false; end if;
 if p_key !~ '^[a-f0-9-]{36}_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$' then return false; end if;
 scope_id:=split_part(p_key,'_',1);section_kind:=split_part(p_key,'_',2);section_id:=split_part(p_key,'_',3);
 for item in select v from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) v where w.workspace_id=actor.organization_id and w.workspace_mode=public.current_workspace_mode() and w.area='correctiveActions' and w.deleted_at is null loop
  if item#>>'{a3,evidenceId}'=scope_id and item->>'source'<>'supplier' then
   case_process:=item->>'processId';
   if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
   if p_write and item->>'status'='closed' then return false; end if;
   if actor.user_type<>'administrator' and coalesce(item->>'ownerId','')<>actor.id::text and not (coalesce(item->'participantUserIds','[]'::jsonb) ? actor.id::text) then return false; end if;
   if section_kind='step' then return true; end if;
   return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item#>'{a3,plans}')='array' then item#>'{a3,plans}' else '[]'::jsonb end) v where v->>'id'=section_id);
  end if;
 end loop;
 select payload->'draft' into draft from public.workspace_data where workspace_id=actor.organization_id and workspace_mode=public.current_workspace_mode() and area='a3Draft' and deleted_at is null;
 if actor.user_type='administrator' and draft->>'evidenceId'=scope_id then
  case_process:=draft->>'processId';
  if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
  if section_kind='step' then return true; end if;
  return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(draft->'plans')='array' then draft->'plans' else '[]'::jsonb end) v where v->>'id'=section_id);
 end if;
 return false;
end $$;
revoke all on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) from public,anon;
grant execute on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) to authenticated;

-- Restrictive policies intersect with existing policies; they do not grant access.
create policy root2cause_evidence_read_guard on public.file_objects as restrictive for select to authenticated
using (resource_type<>'root2cause_evidence' or (module_id='corrective-actions' and audience='internal' and public.iq_root2cause_evidence_access(resource_key,process_id,false,uploaded_by)));
create policy root2cause_evidence_insert_guard on public.file_objects as restrictive for insert to authenticated
with check (resource_type<>'root2cause_evidence' or (module_id='corrective-actions' and audience='internal' and uploaded_by=auth.uid() and bucket_id='integraq-private' and process_id is not null and public.iq_root2cause_evidence_access(resource_key,process_id,true,uploaded_by) and object_path like auth.uid()::text||'/attachments/corrective-actions/root2cause_evidence/'||resource_key||'/%'));
create policy root2cause_evidence_update_guard on public.file_objects as restrictive for update to authenticated
using (resource_type<>'root2cause_evidence' or public.iq_root2cause_evidence_access(resource_key,process_id,true,uploaded_by))
with check (resource_type<>'root2cause_evidence' or (module_id='corrective-actions' and audience='internal' and public.iq_root2cause_evidence_access(resource_key,process_id,true,uploaded_by)));
create policy root2cause_evidence_delete_guard on public.file_objects as restrictive for delete to authenticated
using (resource_type<>'root2cause_evidence');

create function public.iq_root2cause_evidence_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.resource_type='root2cause_evidence' or new.resource_type='root2cause_evidence' then
  if row(old.resource_type,old.resource_key,old.module_id,old.uploaded_by,old.bucket_id,old.object_path,old.sha256,old.audience) is distinct from row(new.resource_type,new.resource_key,new.module_id,new.uploaded_by,new.bucket_id,new.object_path,new.sha256,new.audience) then
   raise exception 'Root2Cause evidence identity is immutable';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.iq_root2cause_evidence_identity_guard() from public,anon,authenticated;
create trigger root2cause_evidence_identity_guard before update on public.file_objects for each row execute function public.iq_root2cause_evidence_identity_guard();

create policy root2cause_storage_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id<>'integraq-private' or name not like '%/attachments/corrective-actions/root2cause_evidence/%' or exists(select 1 from public.file_objects f where f.bucket_id=storage.objects.bucket_id and f.object_path=storage.objects.name and f.resource_type='root2cause_evidence' and f.deleted_at is null));
create policy root2cause_storage_insert_guard on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'integraq-private' or name not like '%/attachments/corrective-actions/root2cause_evidence/%' or (split_part(name,'/',1)=auth.uid()::text and public.iq_root2cause_evidence_access(split_part(name,'/',5),null,true,auth.uid())));
create policy root2cause_storage_update_guard on storage.objects as restrictive for update to authenticated
using (bucket_id<>'integraq-private' or name not like '%/attachments/corrective-actions/root2cause_evidence/%')
with check (bucket_id<>'integraq-private' or name not like '%/attachments/corrective-actions/root2cause_evidence/%');
create policy root2cause_storage_delete_guard on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'integraq-private' or name not like '%/attachments/corrective-actions/root2cause_evidence/%');

-- Authentic file events reuse the existing audit_log; clients cannot forge this namespace.
create function public.iq_root2cause_evidence_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.resource_type='root2cause_evidence' then
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
  values(auth.uid(),(select organization_id from public.profiles where id=new.uploaded_by),'corrective-actions','root2cause.evidence.'||lower(tg_op),'file_objects',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),'Evidencia vinculada por etapa o acción',jsonb_build_object('resource_key',new.resource_key));
 end if;
 return new;
end $$;
revoke all on function public.iq_root2cause_evidence_audit() from public,anon,authenticated;
create trigger root2cause_evidence_audit after insert or update on public.file_objects for each row execute function public.iq_root2cause_evidence_audit();
create policy root2cause_evidence_audit_insert_guard on public.audit_log as restrictive for insert to authenticated
with check (action not like 'root2cause.evidence.%');
create policy root2cause_evidence_audit_update_guard on public.audit_log as restrictive for update to authenticated
using (action not like 'root2cause.evidence.%') with check (action not like 'root2cause.evidence.%');
create policy root2cause_evidence_audit_delete_guard on public.audit_log as restrictive for delete to authenticated
using (action not like 'root2cause.evidence.%');

-- Contract only becomes visible after all preceding guards commit atomically.
create function public.iq_root2cause_evidence_contract() returns integer language sql stable security invoker set search_path='' as $$
 select case when public.has_module_permission('corrective-actions','view') and public.is_internal_user() then 1 else 0 end;
$$;
revoke all on function public.iq_root2cause_evidence_contract() from public,anon;
grant execute on function public.iq_root2cause_evidence_contract() to authenticated;
commit;
