-- Schema only. Production cleanup is an explicit, separately gated operation.
begin;
alter table public.notifications
  add column organization_id uuid references public.organizations(id),
  add column workspace_mode text not null default 'production' check (workspace_mode in ('production','demo')),
  add column event_type text,
  add column workspace_id uuid references public.form_records(id) on delete restrict,
  add column dedupe_key text;
create unique index notifications_dedupe_key on public.notifications(dedupe_key);
alter table public.notifications alter column resource_id type text using resource_id::text;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
-- UPDATE grants are restricted to read state; users cannot rewrite or redirect a notification.
revoke update on public.notifications from authenticated;
grant update (read_at, status) on public.notifications to authenticated;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  channel text not null default 'email' check (channel = 'email'),
  recipient_address text,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','blocked_missing_address')),
  attempts integer not null default 0,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  first_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id,channel)
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant all on public.notification_deliveries to service_role;
create index notification_deliveries_queued on public.notification_deliveries(status,available_at);

-- Resolve materialized effective grants, including explicit denial overrides.
create function public.risk_has_access(p_user uuid, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=p_user and p.status='active'
    and p.user_type in ('administrator','internal') and (
      p.user_type='administrator' or (
        not exists(select 1 from public.user_permission_overrides o join public.permissions c on c.id=o.permission_id
          where o.user_id=p_user and not o.allowed and c.code in (case when p_action='update' then 'risks.edit' else 'risks.read' end, 'risks:'||p_action))
        and (exists(select 1 from public.user_module_action_permissions a where a.user_id=p_user and a.module_id='risks' and (a.action::text=p_action or (p_action='view' and a.action::text='update')))
          or (p_action='view' and exists(select 1 from public.user_module_permissions m where m.user_id=p_user and m.module_id='risks' and m.can_view))
          or exists(select 1 from public.user_permission_overrides o join public.permissions c on c.id=o.permission_id
            where o.user_id=p_user and o.allowed and c.code in (case when p_action='update' then 'risks.edit' else 'risks.read' end,'risks:'||p_action)))
      )
    ));
$$;
revoke all on function public.risk_has_access(uuid,text) from public, anon, authenticated;
grant execute on function public.risk_has_access(uuid,text) to service_role;

create function public.risk_notification_recipients(p_org uuid,p_mode text,p_event text,p_process text,p_owner uuid default null)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct p.id from public.profiles p join auth.users u on u.id=p.id
  where p.organization_id=p_org and p.status='active' and p.user_type in ('administrator','internal')
    and coalesce(u.raw_app_meta_data->>'workspace_mode','production')=p_mode
    and p_mode='production'
    and (
      (p_event <> 'risk.action_due' and p.user_type='administrator')
      or (p_event not in ('risk.action_due') and exists(select 1 from public.user_process_permissions d where d.user_id=p.id and d.process_id='P-03') and public.risk_has_access(p.id,'view'))
      or (p_event='risk.analysis_started' and public.risk_has_access(p.id,'update'))
      or (p_event not in ('risk.deleted','risk.restored','risk.analysis_started','risk.action_overdue') and public.risk_has_access(p.id,'update') and exists(select 1 from public.user_process_permissions s where s.user_id=p.id and s.process_id=p_process))
      or (p_event in ('risk.action_assigned','risk.action_due','risk.action_overdue') and p.id=p_owner and public.risk_has_access(p.id,'view'))
    );
$$;
revoke all on function public.risk_notification_recipients(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.risk_notification_recipients(uuid,text,text,text,uuid) to service_role;

-- Transactional inbox + email outbox. Email is resolved only inside the server database.
create function public.enqueue_risk_notifications(p_workspace uuid,p_org uuid,p_mode text,p_events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare e jsonb; r record; nid uuid; address text; total integer:=0;
begin
  for e in select value from jsonb_array_elements(p_events) loop
    for r in select * from public.risk_notification_recipients(p_org,p_mode,e->>'type',e->>'processId',nullif(e->>'ownerId','')::uuid) loop
      nid:=null;
      insert into public.notifications(recipient_id,organization_id,workspace_mode,module_id,event_type,resource_type,workspace_id,resource_id,title,message,action_url,dedupe_key)
      values(r.user_id,p_org,p_mode,'risks',e->>'type',case when e->>'type'='risk.analysis_started' then 'risk_cycle' when e->>'type' like 'risk.action_%' then 'risk_action' else 'risk' end,p_workspace,e->>'resourceId',e->>'title',e->>'body',e->>'targetUrl',
        p_org::text||':'||p_mode||':'||p_workspace::text||':'||(e->>'type')||':'||(e->>'resourceId')||':'||(e->>'occurrence')||':'||r.user_id::text)
      on conflict(dedupe_key) do nothing returning id into nid;
      if nid is not null then
        select email into address from auth.users where id=r.user_id;
        insert into public.notification_deliveries(notification_id,recipient_address,status,last_error)
        values(nid,nullif(address,''),case when nullif(address,'') is null then 'blocked_missing_address' else 'queued' end,
          case when nullif(address,'') is null then 'blocked_missing_address' else null end);
        total:=total+1;
      end if;
    end loop;
  end loop;
  return total;
end;
$$;
revoke all on function public.enqueue_risk_notifications(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_risk_notifications(uuid,uuid,text,jsonb) to service_role;

-- All workspace writes go through the atomic service RPC. Direct REST cannot bypass history.
create function public.guard_risk_workspace_history() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.record_number like 'RYO-WORKSPACE-%' then
    if tg_op='DELETE' then raise exception 'Risk workspace history cannot be physically deleted'; end if;
    if new.values is distinct from old.values and coalesce(current_setting('integraq.risk_write',true),'') <> 'authorized' then
      raise exception 'Use the risk workspace transaction';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_risk_workspace_history before update or delete on public.form_records
  for each row execute function public.guard_risk_workspace_history();

create function public.prevent_production_risk_demo_seed() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.record_number in ('RYO-WORKSPACE-2025','RYO-WORKSPACE-PRODUCTION') and exists(
    select 1 from jsonb_array_elements(coalesce(new.values->'risks','[]'::jsonb)) r
    where r->>'source' ~* '(demo|demostraci[oó]n|prueba|test)' or r->'metadata'->>'generated_for_demonstration'='true'
  ) then raise exception 'Production workspaces cannot be seeded with demonstration records'; end if;
  return new;
end;
$$;
create trigger prevent_production_risk_demo_seed before insert on public.form_records
  for each row execute function public.prevent_production_risk_demo_seed();

create function public.commit_risk_workspace(p_record uuid,p_actor uuid,p_expected timestamptz,p_state jsonb,p_events jsonb,p_operation text default 'update',p_risk text default null,p_reason text default null,p_category text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.form_records; actor public.profiles; mode text; org uuid; old_risk jsonb; new_risk jsonb; next_state jsonb; item jsonb; n integer; stamp timestamptz;
begin
  select * into actor from public.profiles where id=p_actor and status='active' and user_type in ('administrator','internal');
  if actor.id is null then raise exception 'Forbidden'; end if;
  org:=actor.organization_id;
  if org is null then raise exception 'Organization required'; end if;
  select coalesce(raw_app_meta_data->>'workspace_mode','production') into mode from auth.users where id=p_actor;
  select * into rec from public.form_records where id=p_record for update;
  if rec.id is null or p_expected is null or rec.updated_at is distinct from p_expected then raise exception 'STALE_WORKSPACE'; end if;
  if not exists(select 1 from public.form_definitions d join public.processes pr on pr.id=d.process_id where d.id=rec.form_id and pr.organization_id=org)
    or (mode='demo' and rec.record_number<>'RYO-WORKSPACE-DEMO')
    or (mode<>'demo' and rec.record_number not in ('RYO-WORKSPACE-2025','RYO-WORKSPACE-PRODUCTION')) then raise exception 'Workspace scope mismatch'; end if;
  next_state:=p_state;
  if p_operation in ('delete','restore') then
    if actor.user_type<>'administrator' or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Administrator and reason required'; end if;
    select value into old_risk from jsonb_array_elements(rec.values->'risks') where value->>'id'=p_risk;
    if old_risk is null then raise exception 'Unknown risk'; end if;
    if p_operation='delete' then
      if p_category not in ('test','duplicate','capture_error') or p_category is null then raise exception 'Invalid deletion category'; end if;
      if old_risk->>'deletedAt' is not null then return jsonb_build_object('state',rec.values,'updatedAt',rec.updated_at,'notifiedUsers',0); end if;
      new_risk:=old_risk||jsonb_build_object('deletedAt',now(),'deletedBy',p_actor,'deletionReason',trim(p_reason),'deletionCategory',p_category);
    else
      if old_risk->>'deletedAt' is null then return jsonb_build_object('state',rec.values,'updatedAt',rec.updated_at,'notifiedUsers',0); end if;
      new_risk:=old_risk-'deletedAt'-'deletedBy'-'deletionReason'-'deletionCategory';
    end if;
    next_state:=jsonb_set(rec.values,'{risks}',(select jsonb_agg(case when value->>'id'=p_risk then new_risk else value end) from jsonb_array_elements(rec.values->'risks')));
    p_events:=jsonb_build_array(jsonb_build_object('type',case when p_operation='delete' then 'risk.deleted' else 'risk.restored' end,'resourceId',p_risk,'processId',old_risk->>'processId','title',case when p_operation='delete' then 'Registro eliminado · ' else 'Registro restaurado · ' end||p_risk,'body',(old_risk->>'title')||E'\nProceso: '||(old_risk->>'processId')||E'\nResponsable: '||(old_risk->>'owner')||E'\nMotivo: '||p_reason||E'\nAcción requerida: revisar trazabilidad administrativa.','targetUrl','/?risk='||p_risk||'#risks','occurrence',gen_random_uuid()::text));
    insert into public.audit_log(actor_id,action,resource_type,resource_id,previous_value,new_value,metadata)
    values(p_actor,case when p_operation='delete' then 'risk.deleted' else 'risk.restored' end,'risk',p_risk,old_risk,new_risk,jsonb_build_object('kind',old_risk->>'kind','process',old_risk->>'processId','reason',p_reason,'category',coalesce(p_category,old_risk->>'deletionCategory'),'workspace',p_record));
  elsif p_operation='update' then
    if not public.risk_has_access(p_actor,'update') then raise exception 'Forbidden'; end if;
    for old_risk in select value from jsonb_array_elements(rec.values->'risks') loop
      select value into new_risk from jsonb_array_elements(p_state->'risks') where value->>'id'=old_risk->>'id';
      if new_risk is null or (new_risk->'deletedAt' is distinct from old_risk->'deletedAt') or (new_risk->'deletedBy' is distinct from old_risk->'deletedBy') or (new_risk->'deletionReason' is distinct from old_risk->'deletionReason') or (new_risk->'deletionCategory' is distinct from old_risk->'deletionCategory') or (old_risk->>'deletedAt' is not null and new_risk<>old_risk) then raise exception 'History is immutable through PUT'; end if;
    end loop;
    for item in select value from jsonb_array_elements(rec.values->'actions') loop
      if not exists(select 1 from jsonb_array_elements(p_state->'actions') a where a->>'id'=item->>'id') then raise exception 'Actions must be preserved'; end if;
    end loop;
  else raise exception 'Invalid operation'; end if;
  perform set_config('integraq.risk_write','authorized',true);
  update public.form_records set values=next_state where id=p_record returning updated_at into stamp;
  n:=public.enqueue_risk_notifications(p_record,org,mode,p_events);
  if p_operation='update' then
    insert into public.audit_log(actor_id,action,resource_type,resource_id,metadata) values(p_actor,'risk.workspace_updated','risk_workspace',p_record::text,jsonb_build_object('cycle',next_state->'cycle','events',jsonb_array_length(p_events)));
  end if;
  return jsonb_build_object('state',next_state,'updatedAt',stamp,'notifiedUsers',n);
end;
$$;
revoke all on function public.commit_risk_workspace(uuid,uuid,timestamptz,jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.commit_risk_workspace(uuid,uuid,timestamptz,jsonb,jsonb,text,text,text,text) to service_role;

create function public.reject_risk_audit_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit log is append only'; end;
$$;
create trigger reject_risk_audit_mutation before update or delete on public.audit_log
  for each row execute function public.reject_risk_audit_mutation();

create function public.claim_notification_emails(p_limit integer default 20)
returns setof public.notification_deliveries language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_deliveries set status='failed',last_error='EMAIL_RETRY_WINDOW_EXPIRED_REVIEW_REQUIRED',locked_at=null
    where status in ('sending','queued','failed') and attempts>0 and first_attempt_at<=now()-interval '23 hours';
  return query update public.notification_deliveries d set status='sending',attempts=d.attempts+1,locked_at=now(),first_attempt_at=coalesce(d.first_attempt_at,now())
  where d.id in (select q.id from public.notification_deliveries q
    where (q.status in ('queued','failed') or (q.status='sending' and q.locked_at<now()-interval '10 minutes'))
      and q.attempts<5 and q.available_at<=now() and (q.first_attempt_at is null or q.first_attempt_at>now()-interval '23 hours')
    order by q.created_at for update skip locked limit least(greatest(p_limit,1),50)) returning d.*;
end;
$$;
revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
commit;
