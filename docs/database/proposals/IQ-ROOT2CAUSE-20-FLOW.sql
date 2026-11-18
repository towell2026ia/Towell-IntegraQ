-- PROPOSAL ONLY. Do not run without explicit authorization for a named environment.
-- Adds the global AC sequence and persists Root2Cause workflow metadata atomically.
begin;

create sequence if not exists public.root2cause_ac_seq as bigint minvalue 1;

do $$
declare existing_max bigint;
declare seq_called boolean;
begin
  select coalesce(max((regexp_match(folio, '^AC-(?:[0-9]{4}-)?([0-9]+)$'))[1]::bigint), 0)
    into existing_max
  from public.corrective_actions;
  select is_called into seq_called from public.root2cause_ac_seq;
  if not seq_called then
    if existing_max > 0 then
      perform setval('public.root2cause_ac_seq', existing_max, true);
    else
      perform setval('public.root2cause_ac_seq', 1, false);
    end if;
  end if;
end $$;

alter table public.corrective_actions
  add column if not exists external_reference text,
  add column if not exists create_request_fingerprint text;
alter table public.corrective_action_a3
  add column if not exists workflow_metadata jsonb not null default '{}'::jsonb;
alter table public.corrective_action_plans
  add column if not exists cause_text text,
  add column if not exists cause_reference_id uuid,
  add column if not exists expected_result text,
  add column if not exists completion_evidence text,
  add column if not exists effectiveness_method text;

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

  if jsonb_typeof(a3->'plans') <> 'array' or jsonb_array_length(a3->'plans') = 0 then
    raise exception using errcode = '22023', message = 'Se requiere al menos una acción correctiva';
  end if;
  for plan in select value from jsonb_array_elements(a3->'plans') loop
    plan_status := coalesce(nullif(plan->>'status','')::public.action_item_status, 'pending'::public.action_item_status);
    if nullif(trim(plan->>'description'),'') is null or nullif(trim(plan->>'owner'),'') is null
      or coalesce(plan->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or nullif(trim(plan->>'cause'),'') is null
      or nullif(trim(plan->>'expectedResult'),'') is null
      or nullif(trim(plan->>'completionEvidence'),'') is null
      or nullif(trim(plan->>'effectivenessMethod'),'') is null then
      raise exception using errcode = '22023', message = 'Una acción carece de causa, responsable, fecha o verificación';
    end if;
    insert into public.corrective_action_plans (
      id, corrective_action_id, description, owner_name, due_date, status, cause_text,
      cause_reference_id, expected_result, completion_evidence, effectiveness_method
    ) values (
      (plan->>'id')::uuid, action_id, trim(plan->>'description'), trim(plan->>'owner'),
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

revoke all on function public.iq_root2cause_create_action(jsonb) from public, anon;
grant execute on function public.iq_root2cause_create_action(jsonb) to authenticated;

commit;
