-- U08, proposal for separate authorization. Existing rows and AC numbering are retained.
begin;
alter table public.corrective_action_plans add column cause_category text
  check (cause_category in ('workforce','machinery','method','material','environment','measurement'));

create or replace function public.iq_root2cause_create_action(p_action jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  action_id uuid;
  action_source public.corrective_action_source;
  severity_value public.corrective_action_severity;
  customer_id uuid;
  claim_id uuid;
  process_value text;
  new_folio text;
  fingerprint text;
  existing public.corrective_actions%rowtype;
  plan jsonb;
  responsible public.profiles%rowtype;
  simplified boolean;
  plan_status public.action_item_status;
  a3 jsonb;
begin
  if auth.uid() is null or jsonb_typeof(p_action) <> 'object' then
    raise exception using errcode = '42501', message = 'Sesión o análisis inválido';
  end if;
  select * into actor from public.profiles where id = auth.uid() and status = 'active'
    and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is null
    or not public.has_module_permission('corrective-actions','create') then
    raise exception using errcode = '42501', message = 'No tienes permiso para crear análisis';
  end if;
  action_id := nullif(p_action->>'id','')::uuid;
  process_value := nullif(p_action->>'processId','');
  if action_id is null or (process_value is not null and not public.has_process_access(process_value)) then
    raise exception using errcode = '42501', message = 'El proceso no está autorizado';
  end if;
  action_source := (p_action->>'source')::public.corrective_action_source;
  severity_value := (p_action->>'severity')::public.corrective_action_severity;
  if action_source not in ('internal','customer','sgc')
    or length(trim(coalesce(p_action->>'problem',''))) < 15
    or length(trim(coalesce(p_action->>'owner',''))) = 0
    or coalesce(p_action->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (length(trim(coalesce(p_action->>'area',''))) = 0 and process_value is null)
    or (action_source = 'sgc' and process_value is null) then
    raise exception using errcode = '22023', message = 'Faltan datos obligatorios del análisis';
  end if;

  customer_id := nullif(p_action->>'relatedPartyId','')::uuid;
  claim_id := nullif(p_action->>'qualityCaseId','')::uuid;
  if action_source = 'customer' then
    if customer_id is null or not exists (
      select 1 from public.organizations o where o.id = customer_id and o.kind = 'customer'
        and o.active and o.owning_organization_id = actor.organization_id
    ) then
      raise exception using errcode = '42501', message = 'Selecciona un cliente autorizado del catálogo';
    end if;
    if claim_id is not null and not exists (
      select 1 from public.quality_cases q where q.id = claim_id and q.kind = 'claim'
        and q.external_organization_id = customer_id
    ) then
      raise exception using errcode = '42501', message = 'La reclamación no pertenece al cliente seleccionado';
    end if;
  elsif customer_id is not null or claim_id is not null then
    raise exception using errcode = '22023', message = 'Una acción interna o SGC no puede llevar cliente externo';
  end if;

  fingerprint := md5(p_action::text);
  select * into existing from public.corrective_actions where id = action_id;
  if found then
    if existing.organization_id <> actor.organization_id or existing.created_by <> actor.id
      or existing.create_request_fingerprint is distinct from fingerprint then
      raise exception using errcode = '23505', message = 'El reintento no coincide con la creación original';
    end if;
    return jsonb_build_object('id', existing.id, 'folio', existing.folio, 'title', existing.title, 'replayed', true);
  end if;

  new_folio := 'AC-' || lpad(nextval('public.root2cause_ac_seq')::text, 6, '0');
  insert into public.corrective_actions (
    id, folio, title, problem, source, severity, process_id, area, owner_name,
    external_reference, quality_case_id, external_organization_id, due_date, status,
    progress, root_cause, portal_visible, organization_id, created_by, create_request_fingerprint
  ) values (
    action_id, new_folio, new_folio, trim(p_action->>'problem'), action_source, severity_value,
    process_value, nullif(trim(p_action->>'area'),''), trim(p_action->>'owner'),
    nullif(trim(p_action->>'externalClaimReference'),''), claim_id, customer_id,
    (p_action->>'dueDate')::date, 'action_plan', 55,
    nullif(trim(coalesce(p_action#>>'{a3,rootCause}', '')),''), false,
    actor.organization_id, actor.id, fingerprint
  );

  a3 := coalesce(p_action->'a3','{}'::jsonb);
  insert into public.corrective_action_a3 (
    corrective_action_id, event_type, severity_justification, five_w_two_h,
    brainstorm, ishikawa, non_detection_cause, non_detection_whys,
    root_cause, root_cause_whys, ai_draft, workflow_metadata, updated_by
  ) values (
    action_id, nullif(a3->>'eventType',''), nullif(a3->>'severityJustification',''),
    coalesce(a3->'fiveW2H','{}'::jsonb), coalesce(a3->'brainstorm','[]'::jsonb),
    coalesce(a3->'ishikawa','{}'::jsonb), nullif(a3->>'nonDetectionCause',''),
    coalesce(a3->'nonDetectionWhys','[]'::jsonb), nullif(a3->>'rootCause',''),
    coalesce(a3->'rootCauseWhys','[]'::jsonb), p_action->'aiDraft',
    jsonb_build_object(
      'evidenceId', a3->'evidenceId',
      'descriptiveTitle', a3->'descriptiveTitle', 'brainstormIds', coalesce(a3->'brainstormIds','[]'::jsonb),
      'causeItems', coalesce(a3->'causeItems','[]'::jsonb), 'rootCauseCauseId', a3->'rootCauseCauseId'
    ), actor.id
  );

  if jsonb_typeof(a3->'plans') is distinct from 'array' or jsonb_array_length(a3->'plans') = 0 then
    raise exception using errcode = '22023', message = 'Se requiere al menos una acción correctiva';
  end if;
  for plan in select value from jsonb_array_elements(a3->'plans') loop
    plan_status := coalesce(nullif(plan->>'status','')::public.action_item_status, 'pending'::public.action_item_status);
    simplified := plan ? 'causeCategory' or plan ? 'ownerUserId';
    if nullif(trim(plan->>'description'),'') is null or nullif(plan->>'id','') is null
      or coalesce(plan->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode='22023', message='La acción requiere identificador, descripción y fecha';
    end if;
    if simplified then
      if coalesce(plan->>'causeCategory','') not in ('workforce','machinery','method','material','environment','measurement')
        or (nullif(plan->>'causeId','') is not null and not exists (
          select 1 from jsonb_array_elements(a3->'causeItems') c where c->>'id'=plan->>'causeId'
            and c->>'category'=plan->>'causeCategory'
            and (nullif(trim(plan->>'cause'),'') is null or trim(c->>'text')=trim(plan->>'cause'))
        )) then raise exception using errcode='22023', message='Revisa la M y la causa vinculada'; end if;
      select p.* into responsible from public.profiles p
        where p.id=nullif(plan->>'ownerUserId','')::uuid and p.organization_id=actor.organization_id
          and p.status='active' and p.workspace_mode='production' and p.user_type in ('administrator','internal')
          and (process_value is null or p.user_type='administrator' or exists (
            select 1 from public.processes pr where pr.id=process_value and pr.organization_id=actor.organization_id
            and (pr.process_owner_user_id=p.id or exists (
              select 1 from public.user_process_permissions up where up.process_id=pr.id and up.user_id=p.id))
          )) for share of p;
      if responsible.id is null then raise exception using errcode='42501', message='Responsable no disponible para este proceso'; end if;
    elsif nullif(trim(plan->>'owner'),'') is null or nullif(trim(plan->>'cause'),'') is null
      or nullif(trim(plan->>'expectedResult'),'') is null or nullif(trim(plan->>'completionEvidence'),'') is null
      or nullif(trim(plan->>'effectivenessMethod'),'') is null then
      raise exception using errcode='22023', message='Faltan datos del plan histórico';
    end if;
    insert into public.corrective_action_plans (
      id, corrective_action_id, description, owner_name, owner_id, cause_category, due_date, status, cause_text,
      cause_reference_id, expected_result, completion_evidence, effectiveness_method
    ) values (
      (plan->>'id')::uuid, action_id, trim(plan->>'description'),
      case when simplified then responsible.full_name else trim(plan->>'owner') end,
      case when simplified then responsible.id end, plan->>'causeCategory',
      (plan->>'dueDate')::date, plan_status, trim(plan->>'cause'),
      nullif(plan->>'causeId','')::uuid, trim(plan->>'expectedResult'),
      trim(plan->>'completionEvidence'), trim(plan->>'effectivenessMethod')
    );
  end loop;

  insert into public.audit_log (
    actor_id, organization_id, module, action, resource_type, resource_id, previous_value, new_value, reason, metadata
  ) values (
    actor.id, actor.organization_id, 'corrective-actions', 'root2cause.created',
    'corrective_action', action_id::text, null,
    jsonb_build_object('id',action_id,'folio',new_folio,'title',new_folio,'source',action_source,
      'process_id',process_value,'area',p_action->>'area','owner',p_action->>'owner','due_date',p_action->>'dueDate',
      'customer_id',customer_id,'external_reference',p_action->>'externalClaimReference',
      'analysis',a3,'actions',a3->'plans'),
    'Creación transaccional de análisis Root2Cause', jsonb_build_object('request_fingerprint',fingerprint)
  );
  return jsonb_build_object('id', action_id, 'folio', new_folio, 'title', new_folio, 'replayed', false);
end $$;

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

-- Delegate creation and AC numbering to the installed finalizer under the same row lock.
create function public.iq_root2cause_finalize_plan(p_draft_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  d public.root2cause_drafts%rowtype;
begin
  select * into d from public.root2cause_drafts where id=p_draft_id;
  if not found then raise exception using errcode='42501',message='ROOT2CAUSE_DRAFT_NOT_AVAILABLE'; end if;
  if d.status='draft' and exists (select 1 from jsonb_array_elements(d.payload#>'{draft,plans}') p
    where nullif(p->>'ownerUserId','') is null or nullif(p->>'causeCategory','') is null) then
    raise exception using errcode='22023',message='Responsable o M pendiente en el plan';
  end if;
  return public.iq_root2cause_finalize_draft(p_draft_id,p_expected_revision);
end $$;
revoke all on function public.iq_root2cause_finalize_plan(uuid,integer) from public,anon;
grant execute on function public.iq_root2cause_finalize_plan(uuid,integer) to authenticated;
commit;
