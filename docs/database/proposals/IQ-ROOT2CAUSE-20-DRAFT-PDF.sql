-- PROPOSAL ONLY. Install only after review and explicit authorization for a named environment.
-- Reuses corrective_actions, corrective_action_a3, corrective_action_plans, file_objects,
-- audit_log and the private integraq-private bucket. Does not alter historical rows.
begin;

create table if not exists public.root2cause_drafts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  process_id text references public.processes(id) on delete restrict,
  source text not null check (source in ('internal','customer','sgc')),
  external_organization_id uuid references public.organizations(id) on delete restrict,
  quality_case_id uuid references public.quality_cases(id) on delete restrict,
  current_step smallint not null check (current_step between 0 and 7),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (octet_length(payload::text) <= 200000),
  status text not null default 'draft' check (status in ('draft','finalized')),
  finalized_action_id uuid unique references public.corrective_actions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint root2cause_draft_final_state check ((status='draft' and finalized_action_id is null) or (status='finalized' and finalized_action_id=id)),
  constraint root2cause_draft_customer_scope check ((source='customer' and (quality_case_id is null or external_organization_id is not null)) or (source<>'customer' and external_organization_id is null and quality_case_id is null)),
  constraint root2cause_draft_sgc_process check (source<>'sgc' or process_id is not null)
);
create index if not exists root2cause_drafts_process_updated_idx on public.root2cause_drafts(organization_id,process_id,updated_at desc) where status='draft';
alter table public.root2cause_drafts enable row level security;
revoke all on public.root2cause_drafts from public,anon,authenticated;
grant select on public.root2cause_drafts to authenticated;
create policy root2cause_drafts_select_scope on public.root2cause_drafts for select to authenticated using (
  organization_id=(select p.organization_id from public.profiles p where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal'))
  and public.has_module_permission('corrective-actions','view')
  and (public.is_administrator() or created_by=auth.uid() or (process_id is not null and public.has_process_access(process_id)))
);

create or replace function public.iq_root2cause_save_draft(
  p_draft_id uuid,p_expected_revision integer,p_current_step integer,p_payload jsonb,
  p_process_id text,p_source text,p_customer_id uuid default null,p_quality_case_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; current_draft public.root2cause_drafts%rowtype; expected_source text; inserted_id uuid;
begin
  if auth.uid() is null or p_draft_id is null or p_expected_revision<0 or p_current_step not between 0 and 7
    or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>200000 or (p_payload->>'step')::integer is distinct from p_current_step then raise exception using errcode='22023',message='INVALID_ROOT2CAUSE_DRAFT'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is null or not public.has_module_permission('corrective-actions',case when p_expected_revision=0 then 'create'::public.module_permission_action else 'update'::public.module_permission_action end) then
    raise exception using errcode='42501',message='ROOT2CAUSE_DRAFT_PERMISSION_DENIED'; end if;
  expected_source:=p_payload#>>'{draft,origin}';
  if expected_source not in ('internal','customer','system') or (p_source not in ('internal','customer','sgc')) or (expected_source='system' and p_source<>'sgc')
    or (expected_source='internal' and p_source<>'internal') or (expected_source='customer' and p_source<>'customer')
    or p_payload#>>'{draft,evidenceId}'<>p_draft_id::text
    or nullif(p_payload#>>'{draft,processId}','') is distinct from p_process_id
    or nullif(p_payload#>>'{draft,relatedPartyId}','') is distinct from p_customer_id::text
    or nullif(p_payload#>>'{draft,qualityCaseId}','') is distinct from p_quality_case_id::text then raise exception using errcode='22023',message='ROOT2CAUSE_DRAFT_SCOPE_MISMATCH'; end if;
  if p_process_id is not null and not public.has_process_access(p_process_id) then raise exception using errcode='42501',message='ROOT2CAUSE_PROCESS_ACCESS_DENIED'; end if;
  if p_source='sgc' and p_process_id is null then raise exception using errcode='22023',message='ROOT2CAUSE_SGC_PROCESS_REQUIRED'; end if;
  if p_customer_id is not null and not exists(select 1 from public.organizations o where o.id=p_customer_id and o.kind='customer' and o.active and o.owning_organization_id=actor.organization_id) then raise exception using errcode='42501',message='ROOT2CAUSE_CUSTOMER_SCOPE_DENIED'; end if;
  if p_quality_case_id is not null and not exists(select 1 from public.quality_cases q where q.id=p_quality_case_id and q.kind='claim' and q.external_organization_id=p_customer_id) then raise exception using errcode='42501',message='ROOT2CAUSE_CLAIM_SCOPE_DENIED'; end if;
  if p_expected_revision=0 then
    insert into public.root2cause_drafts(id,organization_id,process_id,source,external_organization_id,quality_case_id,current_step,payload,created_by,updated_by)
      values(p_draft_id,actor.organization_id,p_process_id,p_source,p_customer_id,p_quality_case_id,p_current_step,p_payload,actor.id,actor.id)
      on conflict (id) do nothing returning id into inserted_id;
    if inserted_id is not null then return jsonb_build_object('id',p_draft_id,'revision',1,'updatedAt',now(),'replayed',false); end if;
    select * into current_draft from public.root2cause_drafts where id=p_draft_id for update;
    if current_draft.organization_id=actor.organization_id and current_draft.created_by=actor.id and current_draft.status='draft'
      and current_draft.revision=1 and current_draft.process_id is not distinct from p_process_id and current_draft.source=p_source
      and current_draft.external_organization_id is not distinct from p_customer_id and current_draft.quality_case_id is not distinct from p_quality_case_id
      and current_draft.current_step=p_current_step and current_draft.payload=p_payload then
      return jsonb_build_object('id',p_draft_id,'revision',1,'updatedAt',current_draft.updated_at,'replayed',true);
    end if;
    raise exception using errcode='40001',message='ROOT2CAUSE_DRAFT_REVISION_CONFLICT';
  end if;
  select * into current_draft from public.root2cause_drafts where id=p_draft_id for update;
  if current_draft.id is null or current_draft.organization_id<>actor.organization_id or current_draft.status<>'draft' then raise exception using errcode='42501',message='ROOT2CAUSE_DRAFT_NOT_AVAILABLE'; end if;
  if current_draft.revision<>p_expected_revision then raise exception using errcode='40001',message='ROOT2CAUSE_DRAFT_REVISION_CONFLICT'; end if;
  update public.root2cause_drafts set process_id=p_process_id,source=p_source,external_organization_id=p_customer_id,quality_case_id=p_quality_case_id,
    current_step=p_current_step,payload=p_payload,revision=revision+1,updated_by=actor.id,updated_at=now() where id=p_draft_id;
  return jsonb_build_object('id',p_draft_id,'revision',p_expected_revision+1,'updatedAt',now());
end $$;
revoke all on function public.iq_root2cause_save_draft(uuid,integer,integer,jsonb,text,text,uuid,uuid) from public,anon;
grant execute on function public.iq_root2cause_save_draft(uuid,integer,integer,jsonb,text,text,uuid,uuid) to authenticated;

create or replace function public.iq_root2cause_finalize_draft(p_draft_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; d public.root2cause_drafts%rowtype; v jsonb; a jsonb; result jsonb; source_value text; plans jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is null or not public.has_module_permission('corrective-actions','create') then raise exception using errcode='42501',message='ROOT2CAUSE_CREATE_PERMISSION_DENIED'; end if;
  select * into d from public.root2cause_drafts where id=p_draft_id and organization_id=actor.organization_id for update;
  if d.id is null then raise exception using errcode='42501',message='ROOT2CAUSE_DRAFT_NOT_AVAILABLE'; end if;
  if d.process_id is not null and not public.has_process_access(d.process_id) then raise exception using errcode='42501',message='ROOT2CAUSE_PROCESS_ACCESS_DENIED'; end if;
  if d.status='finalized' and d.finalized_action_id=d.id then
    select jsonb_build_object('id',c.id,'folio',c.folio,'title',c.title,'replayed',true) into result from public.corrective_actions c where c.id=d.id and c.organization_id=actor.organization_id;
    if result is not null then return result; end if;
  end if;
  if d.revision<>p_expected_revision then raise exception using errcode='40001',message='ROOT2CAUSE_DRAFT_REVISION_CONFLICT'; end if;
  v:=d.payload->'draft'; source_value:=case d.source when 'customer' then 'customer' when 'sgc' then 'sgc' else 'internal' end; plans:=v->'plans';
  if nullif(trim(v->>'problem'),'') is null or length(trim(v->>'problem'))<15 or nullif(trim(v->>'owner'),'') is null
    or coalesce(v->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' or (nullif(trim(v->>'area'),'') is null and d.process_id is null)
    or (d.source='customer' and d.external_organization_id is null) or (d.source='sgc' and d.process_id is null)
    or nullif(trim(v#>>'{severityJustification}'),'') is null or jsonb_typeof(v->'fiveW2H')<>'object'
    or jsonb_typeof(v->'brainstorm')<>'array' or jsonb_typeof(v->'causeItems')<>'array'
    or jsonb_typeof(plans)<>'array' or jsonb_array_length(plans)=0 then
    raise exception using errcode='22023',message='ROOT2CAUSE_FINAL_REQUIREMENTS_MISSING'; end if;
  if (select count(*) from jsonb_each_text(v->'fiveW2H') x where nullif(trim(x.value),'') is not null)<>7 then raise exception using errcode='22023',message='ROOT2CAUSE_5W2H_INCOMPLETE'; end if;
  if jsonb_array_length(v->'brainstorm')<3 or (select count(*) from jsonb_array_elements(v->'causeItems') x where nullif(trim(x->>'text'),'') is not null and nullif(x->>'category','') is not null)<3
    or nullif(trim(v->>'nonDetectionCause'),'') is null or nullif(trim(v->>'rootCause'),'') is null
    or jsonb_typeof(v->'nonDetectionWhys')<>'array' or jsonb_typeof(v->'rootCauseWhys')<>'array'
    or (select count(*) from jsonb_array_elements(v->'nonDetectionWhys') x where nullif(trim(x#>>'{}'),'') is not null)<3
    or (select count(*) from jsonb_array_elements(v->'rootCauseWhys') x where nullif(trim(x#>>'{}'),'') is not null)<3 then
    raise exception using errcode='22023',message='ROOT2CAUSE_CAUSE_ANALYSIS_INCOMPLETE'; end if;
  a:=jsonb_build_object('evidenceId',p_draft_id,'descriptiveTitle',nullif(trim(v->>'title'),''),'brainstormIds',coalesce(v->'brainstormIds','[]'::jsonb),
    'causeItems',coalesce(v->'causeItems','[]'::jsonb),'rootCauseCauseId',v->'rootCauseCauseId','eventType',v->'eventType',
    'severityJustification',v->'severityJustification','fiveW2H',v->'fiveW2H','brainstorm',v->'brainstorm','ishikawa',v->'ishikawa',
    'nonDetectionCause',v->'nonDetectionCause','rootCause',v->'rootCause','nonDetectionWhys',v->'nonDetectionWhys','rootCauseWhys',v->'rootCauseWhys','plans',plans);
  a:=jsonb_build_object('id',d.id,'title',d.id::text,'problem',v->>'problem','source',source_value,'severity',v->>'severity','area',v->>'area',
    'owner',v->>'owner','dueDate',v->>'dueDate','processId',d.process_id,'relatedPartyId',d.external_organization_id,'qualityCaseId',d.quality_case_id,
    'externalClaimReference',v->>'externalClaimReference','a3',a,'aiDraft',d.payload->'aiDraft');
  result:=public.iq_root2cause_create_action(a);
  update public.root2cause_drafts set status='finalized',finalized_action_id=d.id,revision=revision+1,updated_by=actor.id,updated_at=now() where id=d.id;
  return result;
end $$;
revoke all on function public.iq_root2cause_finalize_draft(uuid,integer) from public,anon;
grant execute on function public.iq_root2cause_finalize_draft(uuid,integer) to authenticated;

create or replace function public.iq_root2cause_draft_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
  values(auth.uid(),new.organization_id,'corrective-actions',case when tg_op='INSERT' then 'root2cause.draft.created' else 'root2cause.draft.updated' end,
    'root2cause_draft',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),
    case when new.status='finalized' then 'Finalización del borrador' else 'Guardado de borrador Root2Cause' end,jsonb_build_object('revision',new.revision,'process_id',new.process_id));
  return new;
end $$;
revoke all on function public.iq_root2cause_draft_audit() from public,anon,authenticated;
create trigger root2cause_drafts_audit after insert or update on public.root2cause_drafts for each row execute function public.iq_root2cause_draft_audit();

-- Official PDF versions reuse private Storage and file_objects; older versions remain intact.
create or replace function public.iq_root2cause_register_official_pdf(p_actor_id uuid,p_action_id uuid,p_file jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; item public.corrective_actions%rowtype; existing public.file_objects%rowtype; stored_object storage.objects%rowtype; next_version integer; file_id uuid;
begin
  -- This RPC is callable only by the trusted server. The server authenticates the
  -- user and checks module/process access before passing that actor's profile ID.
  if coalesce(auth.role(),'')<>'service_role' or p_actor_id is null then raise exception using errcode='42501',message='ROOT2CAUSE_PDF_SERVER_ONLY'; end if;
  select * into actor from public.profiles where id=p_actor_id and status='active' and user_type in ('administrator','internal') and workspace_mode='production';
  if actor.id is null or actor.organization_id is null then raise exception using errcode='42501',message='ROOT2CAUSE_PDF_PERMISSION_DENIED'; end if;
  select * into item from public.corrective_actions where id=p_action_id and organization_id=actor.organization_id and deleted_at is null for update;
  if item.id is null or (item.process_id is not null and not public.has_process_access(item.process_id)) then raise exception using errcode='42501',message='ROOT2CAUSE_ACTION_NOT_AVAILABLE'; end if;
  if nullif(p_file->>'sourceUpdatedAt','')::timestamptz is distinct from item.updated_at then raise exception using errcode='40001',message='ROOT2CAUSE_PDF_SOURCE_CHANGED'; end if;
  if p_file->>'bucket' is distinct from 'integraq-private' or p_file->>'mime' is distinct from 'application/pdf'
    or p_file->>'path' is distinct from 'root2cause-official-pdf/'||actor.organization_id::text||'/'||p_action_id::text||'/'||lower(p_file->>'sha256')||'.pdf'
    or coalesce((p_file->>'sizeBytes')::bigint,0) not between 1 and 20971520
    or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ROOT2CAUSE_PDF_FILE_INVALID'; end if;
  select * into stored_object from storage.objects where bucket_id='integraq-private' and name=p_file->>'path';
  if stored_object.id is null
    or coalesce(stored_object.metadata->>'mimetype','')<>'application/pdf'
    or coalesce((stored_object.metadata->>'size')::bigint,-1)<>(p_file->>'sizeBytes')::bigint then
    raise exception using errcode='22023',message='ROOT2CAUSE_PDF_OBJECT_NOT_FOUND_OR_METADATA_MISMATCH';
  end if;
  select * into existing from public.file_objects where bucket_id='integraq-private' and object_path=p_file->>'path' for update;
  if existing.id is not null then
    if existing.resource_type<>'root2cause_official_pdf' or existing.resource_id<>p_action_id or existing.sha256<>p_file->>'sha256' then raise exception using errcode='23505',message='ROOT2CAUSE_PDF_PATH_CONFLICT'; end if;
    return jsonb_build_object('fileId',existing.id,'version',existing.version,'sha256',existing.sha256,'replayed',true);
  end if;
  file_id:=(p_file->>'id')::uuid;
  perform 1 from public.file_objects where resource_type='root2cause_official_pdf' and resource_id=p_action_id and workspace_id=actor.organization_id and is_current and deleted_at is null for update;
  update public.file_objects set is_current=false,updated_by=actor.id where resource_type='root2cause_official_pdf' and resource_id=p_action_id and workspace_id=actor.organization_id and is_current and deleted_at is null;
  select coalesce(max(version),0)+1 into next_version from public.file_objects where resource_type='root2cause_official_pdf' and resource_id=p_action_id and workspace_id=actor.organization_id;
  insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,process_id,module_id,audience,resource_type,resource_id,resource_key,workspace_id,version,is_current,uploaded_by)
    values(file_id,'integraq-private',p_file->>'path',item.folio||'.pdf','application/pdf', (p_file->>'sizeBytes')::bigint,p_file->>'sha256',item.process_id,'corrective-actions','internal','root2cause_official_pdf',p_action_id,p_action_id::text,actor.organization_id,next_version,true,actor.id);
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
    values(actor.id,actor.organization_id,'corrective-actions','root2cause.official_pdf.created','file_objects',file_id::text,null,
      jsonb_build_object('action_id',p_action_id,'version',next_version,'sha256',p_file->>'sha256','size_bytes',(p_file->>'sizeBytes')::bigint),
      'Versión oficial A3 generada desde el expediente persistido',jsonb_build_object('folio',item.folio));
  return jsonb_build_object('fileId',file_id,'version',next_version,'sha256',p_file->>'sha256','replayed',false);
end $$;
revoke all on function public.iq_root2cause_register_official_pdf(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.iq_root2cause_register_official_pdf(uuid,uuid,jsonb) to service_role;

create policy root2cause_official_pdf_select_guard on public.file_objects as restrictive for select to authenticated
using (resource_type<>'root2cause_official_pdf' or (module_id='corrective-actions' and audience='internal' and bucket_id='integraq-private' and public.can_access_corrective_action(resource_id)));
create policy root2cause_official_pdf_insert_guard on public.file_objects as restrictive for insert to authenticated
with check (resource_type<>'root2cause_official_pdf');
create policy root2cause_official_pdf_update_guard on public.file_objects as restrictive for update to authenticated
using (resource_type<>'root2cause_official_pdf') with check (resource_type<>'root2cause_official_pdf');
create policy root2cause_official_pdf_delete_guard on public.file_objects as restrictive for delete to authenticated
using (resource_type<>'root2cause_official_pdf');

create policy root2cause_official_pdf_storage_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id<>'integraq-private' or name not like 'root2cause-official-pdf/%' or exists (
  select 1 from public.file_objects f where f.bucket_id=storage.objects.bucket_id and f.object_path=storage.objects.name
    and f.resource_type='root2cause_official_pdf' and f.deleted_at is null and public.can_access_corrective_action(f.resource_id)));
create policy root2cause_official_pdf_storage_insert_guard on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'integraq-private' or name not like 'root2cause-official-pdf/%');
create policy root2cause_official_pdf_storage_update_guard on storage.objects as restrictive for update to authenticated
using (bucket_id<>'integraq-private' or name not like 'root2cause-official-pdf/%') with check (bucket_id<>'integraq-private' or name not like 'root2cause-official-pdf/%');
create policy root2cause_official_pdf_storage_delete_guard on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'integraq-private' or name not like 'root2cause-official-pdf/%');

-- Extend existing evidence authorization only for persisted, process-authorized drafts.
create or replace function public.iq_root2cause_evidence_access(p_key text,p_process text default null,p_write boolean default false,p_uploader uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; item jsonb; scope_id text; section_kind text; section_id text; case_process text;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
 if actor.id is null or actor.organization_id is null or not public.has_module_permission('corrective-actions','view') then return false; end if;
 if p_write and (actor.user_type<>'administrator' or not public.has_module_permission('corrective-actions','create')) then return false; end if;
 if p_uploader is not null and not exists(select 1 from public.profiles p where p.id=p_uploader and p.organization_id=actor.organization_id) then return false; end if;
 if p_key !~ '^[a-f0-9-]{36}_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$' then return false; end if;
 scope_id:=split_part(p_key,'_',1); section_kind:=split_part(p_key,'_',2); section_id:=split_part(p_key,'_',3);
 if exists(select 1 from public.root2cause_drafts d where d.id=scope_id::uuid and d.organization_id=actor.organization_id and d.status in ('draft','finalized')
   and d.source<>'supplier' and d.process_id is not null and d.process_id=p_process and public.has_process_access(d.process_id)
   and (actor.user_type='administrator' or d.created_by=actor.id or public.has_process_access(d.process_id))
   and (not p_write or (actor.user_type='administrator' and public.has_module_permission('corrective-actions','create')
     and (d.status='draft' or exists(select 1 from public.corrective_actions ca where ca.id=d.id and ca.organization_id=actor.organization_id and ca.deleted_at is null and ca.status<>'closed'))))
   and (section_kind='step' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload#>'{draft,plans}')='array' then d.payload#>'{draft,plans}' else '[]'::jsonb end) x where x->>'id'=section_id))) then return true; end if;
 for item in select v from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) v
   where w.workspace_id=actor.organization_id and w.workspace_mode=public.current_workspace_mode() and w.area='correctiveActions' and w.deleted_at is null loop
  if item#>>'{a3,evidenceId}'=scope_id and item->>'source'<>'supplier' then
   case_process:=item->>'processId'; if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
   if p_write and item->>'status'='closed' then return false; end if;
   if actor.user_type<>'administrator' and coalesce(item->>'ownerId','')<>actor.id::text and not (coalesce(item->'participantUserIds','[]'::jsonb) ? actor.id::text) then return false; end if;
   if section_kind='step' then return true; end if;
   return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item#>'{a3,plans}')='array' then item#>'{a3,plans}' else '[]'::jsonb end) v where v->>'id'=section_id);
  end if;
 end loop;
 select payload->'draft' into item from public.workspace_data where workspace_id=actor.organization_id and workspace_mode=public.current_workspace_mode() and area='a3Draft' and deleted_at is null;
 if actor.user_type='administrator' and item->>'evidenceId'=scope_id then
  case_process:=item->>'processId'; if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
  if section_kind='step' then return true; end if;
  return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item->'plans')='array' then item->'plans' else '[]'::jsonb end) v where v->>'id'=section_id);
 end if;
 return false;
end $$;
revoke all on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) from public,anon;
grant execute on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) to authenticated;

commit;
