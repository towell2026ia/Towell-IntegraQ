-- Release 2B. Additive contract for progress on existing Root2Cause plans.
alter table public.corrective_action_plans
  add column followup_revision integer not null default 0,
  add column followup_note text,
  add column effectiveness_result text check (effectiveness_result in ('effective','ineffective')),
  add column effectiveness_note text;

create function public.iq_u08_plan_queue() returns table (
  plan_id uuid, folio text, description text, owner_name text, due_date date,
  status text, revision integer, note text, effectiveness text, review_note text, evidence jsonb
) language sql stable security definer set search_path = '' as $$
  select p.id, a.folio::text, p.description, p.owner_name, p.due_date, p.status::text,
    p.followup_revision, p.followup_note, p.effectiveness_result, p.effectiveness_note,
    coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.original_name) order by f.created_at, f.id)
      from public.file_objects f where f.workspace_id = a.organization_id and f.module_id = 'corrective-actions'
      and f.audience = 'internal' and f.bucket_id = 'integraq-private' and f.resource_type = 'root2cause_evidence'
      and f.resource_key = coalesce(d.workflow_metadata->>'evidenceId', a.id::text) || '_plan_' || p.id::text
      and f.process_id = a.process_id and f.is_current and f.deleted_at is null), '[]'::jsonb)
  from public.profiles u join public.corrective_actions a on a.organization_id = u.organization_id
  join public.corrective_action_a3 d on d.corrective_action_id = a.id
  join public.corrective_action_plans p on p.corrective_action_id = a.id
  where u.id = auth.uid() and u.status = 'active' and u.workspace_mode = 'production'
    and u.user_type in ('internal','administrator') and public.has_module_permission('corrective-actions','view')
    and (u.user_type = 'administrator' or p.owner_id = u.id)
    and a.deleted_at is null and a.source <> 'supplier' and a.status <> 'closed' and p.status <> 'cancelled'
  order by p.due_date, p.id
$$;

create function public.iq_u08_update_plan(p_plan uuid, p_revision integer, p_command text, p_note text, p_file uuid default null, p_owner uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; plan public.corrective_action_plans; action_row public.corrective_actions; current_files jsonb; assignee public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active'
    and workspace_mode = 'production' and user_type in ('administrator','internal');
  if actor.id is null or not coalesce(public.has_module_permission('corrective-actions','update'),false) then
    raise exception 'Seguimiento no autorizado' using errcode='42501';
  end if;
  select a.* into action_row from public.corrective_actions a join public.corrective_action_plans p on p.corrective_action_id=a.id
    where p.id=p_plan and (actor.user_type='administrator' or p.owner_id=actor.id)
    and a.organization_id=actor.organization_id and a.deleted_at is null and a.source <> 'supplier' and a.status <> 'closed' for update of a;
  select * into plan from public.corrective_action_plans where id=p_plan and corrective_action_id=action_row.id for update;
  select evidence into current_files from public.iq_u08_plan_queue() where plan_id=p_plan;
  if plan.id is null or current_files is null then raise exception 'Plan no disponible' using errcode='42501'; end if;
  if p_revision is distinct from plan.followup_revision then raise exception 'La revisión cambió' using errcode='40001'; end if;
  if nullif(trim(p_note),'') is null or length(p_note)>2000 or p_command is null or p_command not in ('progress','complete','effective','ineffective','assign') then
    raise exception 'Operación o nota inválida' using errcode='22023';
  end if;
  if p_command='assign' then
    if actor.user_type <> 'administrator' or plan.status='completed' then raise exception 'Asignación no autorizada' using errcode='42501'; end if;
    select * into assignee from public.profiles where id=p_owner and status='active' and workspace_mode='production'
      and organization_id=actor.organization_id and user_type in ('internal','administrator');
    if assignee.id is null then raise exception 'Responsable no disponible' using errcode='22023'; end if;
    update public.corrective_action_plans set owner_id=assignee.id,owner_name=assignee.full_name,followup_revision=followup_revision+1 where id=p_plan;
  elsif p_command in ('effective','ineffective') then
    if actor.user_type <> 'administrator' or plan.status <> 'completed' then raise exception 'Revisión de Calidad pendiente' using errcode='42501'; end if;
    if not exists(select 1 from jsonb_array_elements(current_files) f where f->>'id'=plan.evidence_file_id::text) then
      raise exception 'La evidencia final ya no está disponible' using errcode='22023'; end if;
    update public.corrective_action_plans set effectiveness_result=p_command,effectiveness_note=trim(p_note),
      followup_revision=followup_revision+1 where id=p_plan;
  else
    if p_command='complete' and not exists(select 1 from jsonb_array_elements(current_files) f where f->>'id'=p_file::text) then
      raise exception 'Selecciona una evidencia vigente de esta acción' using errcode='22023'; end if;
    update public.corrective_action_plans set status=(case when p_command='complete' then 'completed' else 'in_progress' end)::public.action_item_status,
      completed_at=case when p_command='complete' then now() end, followup_note=trim(p_note),
      evidence_file_id=case when p_command='complete' then p_file else evidence_file_id end,
      effectiveness_result=null,effectiveness_note=null,followup_revision=followup_revision+1 where id=p_plan;
  end if;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,reason,metadata)
    values(actor.id,actor.organization_id,'corrective-actions','root2cause.plan_followup','corrective_action_plan',p_plan::text,
      trim(p_note),jsonb_build_object('command',p_command,'revision',p_revision+1,'action_id',action_row.id,'file_id',p_file,
      'previous_owner',plan.owner_id,'assigned_owner',assignee.id,'previous_status',plan.status,'previous_effectiveness',plan.effectiveness_result,'previous_evidence',plan.evidence_file_id));
  return p_revision+1;
end $$;

revoke all on function public.iq_u08_plan_queue(),public.iq_u08_update_plan(uuid,integer,text,text,uuid,uuid) from public,anon;
grant execute on function public.iq_u08_plan_queue(),public.iq_u08_update_plan(uuid,integer,text,text,uuid,uuid) to authenticated;

create function public.iq_u08_check_a3_closure() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source='supplier' or not exists(select 1 from public.corrective_action_a3 where corrective_action_id=new.id) then return new; end if;
  if not exists(select 1 from public.corrective_action_plans where corrective_action_id=new.id and status<>'cancelled')
    or exists(select 1 from public.corrective_action_plans p join public.corrective_action_a3 d on d.corrective_action_id=p.corrective_action_id
      where p.corrective_action_id=new.id and p.status<>'cancelled' and
        (p.status<>'completed' or p.effectiveness_result is distinct from 'effective' or not exists (
          select 1 from public.file_objects f where f.id=p.evidence_file_id and f.workspace_id=new.organization_id
          and f.module_id='corrective-actions' and f.bucket_id='integraq-private' and f.audience='internal'
          and f.process_id=new.process_id and f.resource_type='root2cause_evidence'
          and f.resource_key=coalesce(d.workflow_metadata->>'evidenceId',new.id::text)||'_plan_'||p.id::text
          and f.deleted_at is null and f.is_current))) then
    raise exception 'Faltan cumplimiento, evidencia vigente o eficacia del plan' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.iq_u08_check_a3_closure() from public,anon,authenticated;
create trigger iq_u08_check_a3_closure before update of status on public.corrective_actions
  for each row when (new.status='closed' and old.status is distinct from new.status) execute function public.iq_u08_check_a3_closure();

-- Service-only reservation for a confirmed future Redbooth transport.
create table public.root2cause_redbooth_reservations (
  correlation text primary key,
  fingerprint text not null,
  state text not null default 'reserved' check (state in ('reserved','created','done','uncertain')),
  task jsonb,
  attachment text,
  updated_at timestamptz not null default now(),
  check (state not in ('created','done') or task is not null)
);
alter table public.root2cause_redbooth_reservations enable row level security;
revoke all on public.root2cause_redbooth_reservations from public, anon, authenticated;
grant select,insert,update on public.root2cause_redbooth_reservations to service_role;

-- Expose only confirmed identifiers and synchronization state to authorized readers.
create function public.iq_u08_redbooth_status(p_action uuid)
returns table(item text, sync_state text, remote_id text) language sql stable security definer set search_path='' as $$
  select split_part(r.correlation,':',3), case r.state when 'done' then 'synced' when 'uncertain' then 'error' else 'pending' end,
    case when r.state='done' then r.task->>'id' end
  from public.profiles u join public.corrective_actions a on a.organization_id=u.organization_id
  join public.root2cause_redbooth_reservations r on split_part(r.correlation,':',1)=a.organization_id::text
    and split_part(r.correlation,':',2)=a.id::text and split_part(r.correlation,':',4)='2233821' and split_part(r.correlation,':',5)='6673813'
  where a.id=p_action and a.deleted_at is null and a.source<>'supplier' and u.id=auth.uid()
    and u.status='active' and u.workspace_mode='production' and u.user_type in ('administrator','internal')
    and public.has_module_permission('corrective-actions','view')
    and (u.user_type='administrator' or a.process_id is null or public.has_process_access(a.process_id))
$$;
revoke all on function public.iq_u08_redbooth_status(uuid) from public,anon;
grant execute on function public.iq_u08_redbooth_status(uuid) to authenticated;
