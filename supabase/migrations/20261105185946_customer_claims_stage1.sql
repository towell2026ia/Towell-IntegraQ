-- IQ-CLIENTES-02. Scope: claims and their private evidence only. No historical row updates.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.quality_cases
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict,
  add column if not exists cancellation_reason text;
alter table public.quality_cases add constraint quality_cases_cancellation_complete check (
  (cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
  (cancelled_at is not null and cancelled_by is not null and nullif(btrim(cancellation_reason),'') is not null)
);
-- Preserve every existing link and its FK; several A3 may follow one claim.
alter table public.corrective_actions drop constraint corrective_actions_quality_case_id_key;
create index corrective_actions_quality_case_claim_idx on public.corrective_actions(quality_case_id) where quality_case_id is not null;

create function public.iq_can_read_customer_claim(customer_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.organizations o on o.owning_organization_id=p.organization_id
    where p.id=auth.uid() and p.status='active' and p.workspace_mode='production'
      and p.user_type in ('administrator','internal') and o.id=customer_id and o.kind='customer'
      and (public.is_administrator() or (public.has_module_permission('customers','view') and
        public.has_permission('clientes.ver',p.organization_id)))
  );
$$;
revoke all on function public.iq_can_read_customer_claim(uuid) from public,anon;
grant execute on function public.iq_can_read_customer_claim(uuid) to authenticated,service_role;

create policy iq_claim_private_select on public.quality_cases as restrictive for select to authenticated
  using (kind<>'claim' or public.iq_can_read_customer_claim(external_organization_id));
create policy iq_claim_server_insert on public.quality_cases as restrictive for insert to authenticated with check (kind<>'claim');
create policy iq_claim_server_update on public.quality_cases as restrictive for update to authenticated using (kind<>'claim') with check (kind<>'claim');
create policy iq_claim_no_physical_delete on public.quality_cases as restrictive for delete to authenticated using (kind<>'claim');

create policy iq_claim_evidence_private_select on public.file_objects as restrictive for select to authenticated using (
  resource_type<>'customer_claim_evidence' or (audience='internal' and exists (
    select 1 from public.quality_cases q where q.id=file_objects.resource_id and q.kind='claim'
      and public.iq_can_read_customer_claim(q.external_organization_id)
  ))
);
create policy iq_claim_evidence_server_insert on public.file_objects as restrictive for insert to authenticated with check (resource_type<>'customer_claim_evidence');
create policy iq_claim_evidence_server_update on public.file_objects as restrictive for update to authenticated using (resource_type<>'customer_claim_evidence') with check (resource_type<>'customer_claim_evidence');
create policy iq_claim_evidence_no_delete on public.file_objects as restrictive for delete to authenticated using (resource_type<>'customer_claim_evidence');
create policy iq_claim_storage_server_only on storage.objects as restrictive for all to authenticated
  using (bucket_id<>'integraq-private' or name not like 'claim-evidence/%')
  with check (bucket_id<>'integraq-private' or name not like 'claim-evidence/%');

-- Protect old row classification against owner UPDATE policies combined with OR.
create function public.iq_guard_claim_reclassification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user<>'service_role' then
    if tg_table_name='quality_cases' and to_jsonb(old)->>'kind'='claim' then
      raise exception using errcode='42501',message='CLAIM_SERVER_COMMAND_REQUIRED';
    elsif tg_table_name='file_objects' and to_jsonb(old)->>'resource_type'='customer_claim_evidence' then
      raise exception using errcode='42501',message='CLAIM_EVIDENCE_SERVER_COMMAND_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.iq_guard_claim_reclassification() from public,anon,authenticated;
create trigger iq_claim_reclassification_guard before update on public.quality_cases for each row execute function public.iq_guard_claim_reclassification();
create trigger iq_claim_file_reclassification_guard before update on public.file_objects for each row execute function public.iq_guard_claim_reclassification();

-- Service-only transaction boundary. The API separately checks live module and granular permissions.
-- This invoker function never elevates an authenticated caller; only service_role can execute it.
create function public.iq_customer_claim_command(actor_id uuid, workspace_id uuid, command text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor public.profiles;
  previous public.quality_cases;
  saved public.quality_cases;
  company public.organizations;
  linked public.corrective_actions;
  replaced public.file_objects;
  claim_id uuid := (payload->>'id')::uuid;
  evidence_id uuid;
  reason text := nullif(btrim(payload->>'reason'),'');
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_COMMAND_ONLY'; end if;
  select * into actor from public.profiles p where p.id=actor_id and p.status='active'
    and p.user_type in ('administrator','internal') and p.workspace_mode='production' and p.organization_id=workspace_id;
  if not found then raise exception using errcode='42501',message='ACTIVE_INTERNAL_ACTOR_REQUIRED'; end if;
  if not exists(select 1 from public.organizations where id=workspace_id and kind='internal' and active) then
    raise exception using errcode='42501',message='ACTIVE_WORKSPACE_REQUIRED';
  end if;
  select * into previous from public.quality_cases where id=claim_id for update;
  if previous.id is not null and previous.kind<>'claim' then raise exception 'NOT_A_CLAIM'; end if;
  if previous.cancelled_at is not null then raise exception 'CLAIM_ALREADY_CANCELLED'; end if;
  if command='save' then
    if nullif(btrim(payload->>'title'),'') is null or nullif(btrim(payload->>'description'),'') is null
      or length(payload->>'title')>500 or length(payload->>'description')>20000
      or payload->>'status' not in ('open','under_review','action_required','closed') then raise exception 'INVALID_CLAIM'; end if;
    select * into company from public.organizations where id=(payload->>'customerId')::uuid and kind='customer'
      and (active or previous.id is not null) and owning_organization_id=workspace_id;
    if not found then raise exception using errcode='42501',message='CUSTOMER_SCOPE_DENIED'; end if;
    if previous.id is not null and previous.external_organization_id<>company.id then raise exception 'CLAIM_CUSTOMER_IMMUTABLE'; end if;
    if previous.id is not null and previous.updated_at is distinct from (payload->>'updatedAt')::timestamptz then raise exception 'CLAIM_CONCURRENT_EDIT'; end if;
    if nullif(payload->>'processId','') is not null and not exists (
      select 1 from public.processes where id=payload->>'processId' and organization_id=workspace_id and active
    ) then raise exception using errcode='42501',message='PROCESS_SCOPE_DENIED'; end if;
    if previous.id is null then
      insert into public.quality_cases(id,folio,kind,external_organization_id,received_at,title,description,status,external_reference,process_id,portal_visible,created_by)
      values(claim_id,'RC-'||extract(year from (payload->>'receivedAt')::date)::text||'-'||upper(replace(claim_id::text,'-','')),'claim',company.id,
        (payload->>'receivedAt')::date,btrim(payload->>'title'),btrim(payload->>'description'),(payload->>'status')::public.quality_case_status,
        nullif(btrim(payload->>'externalReference'),''),nullif(payload->>'processId',''),false,actor_id) returning * into saved;
    else
      update public.quality_cases set received_at=(payload->>'receivedAt')::date,title=btrim(payload->>'title'),
        description=btrim(payload->>'description'),status=(payload->>'status')::public.quality_case_status,
        external_reference=nullif(btrim(payload->>'externalReference'),''),process_id=nullif(payload->>'processId',''),portal_visible=false
      where id=claim_id returning * into saved;
    end if;
  else
    if previous.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
    select * into company from public.organizations where id=previous.external_organization_id and kind='customer' and owning_organization_id=workspace_id;
    if not found then raise exception using errcode='42501',message='CUSTOMER_SCOPE_DENIED'; end if;
    saved:=previous;
  end if;
  if command='cancel' then
    if actor.user_type<>'administrator' or reason is null then raise exception using errcode='42501',message='ADMIN_REASON_REQUIRED'; end if;
    update public.quality_cases set cancelled_at=now(),cancelled_by=actor_id,cancellation_reason=reason,portal_visible=false where id=claim_id returning * into saved;
  elsif command='evidence' then
    evidence_id:=(payload->>'fileId')::uuid;
    if payload->>'objectPath' not like 'claim-evidence/'||workspace_id::text||'/'||claim_id::text||'/'||evidence_id::text||'/%'
      or (payload->>'size')::bigint not between 1 and 4194304 then raise exception 'INVALID_EVIDENCE'; end if;
    if nullif(payload->>'replaceId','') is not null then
      select * into replaced from public.file_objects f where f.id=(payload->>'replaceId')::uuid and f.resource_type='customer_claim_evidence'
        and f.resource_id=claim_id and f.workspace_id=iq_customer_claim_command.workspace_id and f.is_current and f.deleted_at is null for update;
      if not found then raise exception 'EVIDENCE_VERSION_CONFLICT'; end if;
      update public.file_objects set is_current=false where id=replaced.id;
    end if;
    insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,workspace_id,external_organization_id,
      audience,resource_type,resource_id,resource_key,uploaded_by,version,is_current,replaces_file_id,preview_status)
    values(evidence_id,'integraq-private',payload->>'objectPath',payload->>'filename',payload->>'mime',(payload->>'size')::bigint,payload->>'sha256','customers',workspace_id,
      company.id,'internal','customer_claim_evidence',claim_id,claim_id::text,actor_id,coalesce(replaced.version,0)+1,true,replaced.id,'not_required');
  elsif command not in ('save','link','cancel') then raise exception 'INVALID_COMMAND';
  end if;
  if command='link' or nullif(payload->>'actionId','') is not null then
    if actor.user_type<>'administrator' then raise exception using errcode='42501',message='ADMIN_A3_REQUIRED'; end if;
    select * into linked from public.corrective_actions where id=(payload->>'actionId')::uuid and source='customer'
      and organization_id=workspace_id and external_organization_id=company.id and deleted_at is null for update;
    if not found then raise exception using errcode='42501',message='A3_CUSTOMER_SCOPE_DENIED'; end if;
    if linked.quality_case_id is not null and linked.quality_case_id<>claim_id then raise exception 'A3_ALREADY_LINKED'; end if;
    update public.corrective_actions set quality_case_id=claim_id where id=linked.id;
  end if;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
    values(actor_id,workspace_id,'customers','customer_claim.'||command,'quality_case',claim_id,to_jsonb(previous),to_jsonb(saved),reason,
      jsonb_build_object('action_id',payload->>'actionId','file_id',evidence_id));
  return jsonb_build_object('claim',to_jsonb(saved),'fileId',evidence_id);
end;
$$;
revoke all on function public.iq_customer_claim_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.iq_customer_claim_command(uuid,uuid,text,jsonb) to service_role;
