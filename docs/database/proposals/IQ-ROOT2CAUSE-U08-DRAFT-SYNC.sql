-- Preserve the SGC process requirement for finalized records and allow incomplete drafts.
begin;
alter table public.root2cause_drafts drop constraint root2cause_draft_sgc_process,
  add constraint root2cause_draft_sgc_process check (status='draft' or source<>'sgc' or process_id is not null);

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
  if p_customer_id is not null and not exists(select 1 from public.organizations o where o.id=p_customer_id and o.kind='customer' and o.active and o.owning_organization_id=actor.organization_id) then raise exception using errcode='42501',message='ROOT2CAUSE_CUSTOMER_SCOPE_DENIED'; end if;
  if p_quality_case_id is not null then
    perform 1 from public.quality_cases q where q.id=p_quality_case_id and q.kind='claim'
      and q.external_organization_id=p_customer_id for update;
    if not found then raise exception using errcode='42501',message='ROOT2CAUSE_CLAIM_SCOPE_DENIED'; end if;
    -- Existing links remain editable. Serialize competing new links on the claim itself.
    if not exists (select 1 from public.root2cause_drafts where id=p_draft_id and quality_case_id=p_quality_case_id)
      and (exists (select 1 from public.root2cause_drafts where organization_id=actor.organization_id and quality_case_id=p_quality_case_id)
        or exists (select 1 from public.corrective_actions where organization_id=actor.organization_id and quality_case_id=p_quality_case_id and deleted_at is null)) then
      raise exception using errcode='23505',message='ROOT2CAUSE_CLAIM_ALREADY_LINKED';
    end if;
  end if;
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
  if not (actor.user_type='administrator' or current_draft.created_by=actor.id or
    (current_draft.process_id is not null and public.has_process_access(current_draft.process_id))) then
    raise exception using errcode='42501',message='ROOT2CAUSE_DRAFT_NOT_AVAILABLE';
  end if;
  if current_draft.revision=p_expected_revision+1 and current_draft.updated_by=actor.id
    and current_draft.current_step=p_current_step and current_draft.payload=p_payload
    and current_draft.process_id is not distinct from p_process_id and current_draft.source=p_source
    and current_draft.external_organization_id is not distinct from p_customer_id
    and current_draft.quality_case_id is not distinct from p_quality_case_id then
    return jsonb_build_object('id',p_draft_id,'revision',current_draft.revision,'updatedAt',current_draft.updated_at,'replayed',true);
  end if;
  if current_draft.revision<>p_expected_revision then raise exception using errcode='40001',message='ROOT2CAUSE_DRAFT_REVISION_CONFLICT'; end if;
  update public.root2cause_drafts set process_id=p_process_id,source=p_source,external_organization_id=p_customer_id,quality_case_id=p_quality_case_id,
    current_step=p_current_step,payload=p_payload,revision=revision+1,updated_by=actor.id,updated_at=now() where id=p_draft_id;
  return jsonb_build_object('id',p_draft_id,'revision',p_expected_revision+1,'updatedAt',now());
end $$;
commit;
