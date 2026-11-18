-- PROPOSAL ONLY. Do not execute without explicit approval for the target.
-- Permanent deletion of one Root2Cause action. Storage is removed by the
-- authenticated server route between begin and complete RPC calls.
-- Requires: workspace_data, profiles, processes, user_module_action_permissions,
-- corrective_actions and its existing owned children, file_objects, audit_log,
-- has_process_access, current_workspace_mode, is_administrator/is_internal_user.
begin;

create table if not exists public.root2cause_hard_delete_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workspace_mode text not null check (workspace_mode in ('demo','production')),
  action_id uuid not null,
  action_folio text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  file_ids uuid[] not null default '{}',
  storage_paths text[] not null default '{}',
  status text not null default 'storage_pending' check (status in ('storage_pending','completed')),
  last_storage_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, workspace_mode, action_id),
  check ((status = 'storage_pending' and completed_at is null) or (status = 'completed' and completed_at is not null and cardinality(file_ids) = 0 and cardinality(storage_paths) = 0))
);
alter table public.root2cause_hard_delete_operations enable row level security;
revoke all on public.root2cause_hard_delete_operations from public, anon, authenticated;

-- Keep AC codes reserved after a record is physically removed. Allocation is
-- serialized and checks active codes plus completed-deletion tombstones.
create table if not exists public.root2cause_action_folio_counter (
  singleton boolean primary key default true check (singleton),
  last_number bigint not null check (last_number >= 0),
  updated_at timestamptz not null default now()
);
alter table public.root2cause_action_folio_counter enable row level security;
revoke all on public.root2cause_action_folio_counter from public,anon,authenticated;

create table if not exists public.root2cause_action_folio_reservations (
  action_id uuid primary key,
  folio text not null unique,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  process_id text not null references public.processes(id) on delete restrict,
  reserved_by uuid not null references public.profiles(id) on delete restrict,
  reserved_at timestamptz not null default now()
);
alter table public.root2cause_action_folio_reservations enable row level security;
revoke all on public.root2cause_action_folio_reservations from public,anon,authenticated;

-- Prevent an in-flight evidence upload from registering after deletion has
-- reserved the Storage manifest.
create or replace function public.iq_root2cause_evidence_delete_pending(p_resource_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_resource_key !~ '^[a-f0-9-]{36}_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$' then false
    else exists (
      select 1
      from public.profiles actor
      join public.workspace_data workspace
        on workspace.workspace_id=actor.organization_id
       and workspace.workspace_mode=public.current_workspace_mode()
       and workspace.area='correctiveActions'
       and workspace.deleted_at is null
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(workspace.payload)='array' then workspace.payload else '[]'::jsonb end
      ) action
      join public.root2cause_hard_delete_operations operation
        on operation.organization_id=workspace.workspace_id
       and operation.workspace_mode=workspace.workspace_mode
       and operation.action_id::text=action->>'id'
       and operation.status='storage_pending'
      where actor.id=auth.uid()
        and actor.status='active'
        and actor.user_type in ('administrator','internal')
        and action#>>'{a3,evidenceId}'=split_part(p_resource_key,'_',1)
    )
  end;
$$;
revoke all on function public.iq_root2cause_evidence_delete_pending(text) from public,anon;
grant execute on function public.iq_root2cause_evidence_delete_pending(text) to authenticated;

create policy root2cause_hard_delete_evidence_insert_guard on public.file_objects
  as restrictive for insert to authenticated
  with check (resource_type<>'root2cause_evidence' or not public.iq_root2cause_evidence_delete_pending(resource_key));
create policy root2cause_hard_delete_storage_insert_guard on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id<>'integraq-private'
    or name not like '%/attachments/corrective-actions/root2cause_evidence/%'
    or not public.iq_root2cause_evidence_delete_pending(split_part(name,'/',5))
  );

create or replace function public.iq_root2cause_block_evidence_insert_during_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.resource_type='root2cause_evidence'
    and public.iq_root2cause_evidence_delete_pending(new.resource_key) then
    raise exception using errcode='P0001',message='ROOT2CAUSE_DELETE_IN_PROGRESS';
  end if;
  return new;
end $$;
revoke all on function public.iq_root2cause_block_evidence_insert_during_delete() from public,anon,authenticated;
drop trigger if exists file_objects_root2cause_insert_delete_guard on public.file_objects;
create trigger file_objects_root2cause_insert_delete_guard before insert on public.file_objects
for each row execute function public.iq_root2cause_block_evidence_insert_during_delete();

create or replace function public.iq_root2cause_allocate_action_folio(p_process_id text,p_action_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; maximum_number bigint; next_number bigint; draft jsonb; folio text; prior public.root2cause_action_folio_reservations%rowtype;
begin
  select * into actor from public.profiles p where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal') and p.organization_id is not null;
  if actor.id is null or not public.has_module_permission('corrective-actions','create') then raise exception using errcode='42501',message='ACTION_CREATE_FORBIDDEN'; end if;
  if p_process_id is null or not exists(select 1 from public.processes p where p.id=p_process_id and p.organization_id=actor.organization_id) or not public.has_process_access(p_process_id) then
    raise exception using errcode='42501',message='OUTSIDE_PROCESS_SCOPE';
  end if;
  if p_action_id is null then raise exception using errcode='22023',message='ACTION_ID_REQUIRED'; end if;
  select * into prior from public.root2cause_action_folio_reservations r where r.action_id=p_action_id;
  if prior.action_id is not null then
    if prior.organization_id is distinct from actor.organization_id or prior.process_id is distinct from p_process_id then raise exception using errcode='42501',message='FOLIO_RESERVATION_SCOPE_MISMATCH'; end if;
    return prior.folio;
  end if;
  select w.payload->'draft' into draft from public.workspace_data w where w.workspace_id=actor.organization_id and w.workspace_mode=public.current_workspace_mode()
    and w.area='a3Draft' and w.deleted_at is null;
  if draft is null or draft->>'evidenceId'<>p_action_id::text or draft->>'processId'<>p_process_id then raise exception using errcode='P0001',message='SAVED_A3_DRAFT_MISMATCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(77342,91007);
  select * into prior from public.root2cause_action_folio_reservations r where r.action_id=p_action_id for update;
  if prior.action_id is not null then
    if prior.organization_id is distinct from actor.organization_id or prior.process_id is distinct from p_process_id then raise exception using errcode='42501',message='FOLIO_RESERVATION_SCOPE_MISMATCH'; end if;
    return prior.folio;
  end if;
  select coalesce(max((regexp_match(code,'^AC-(?:[0-9]{4}-)?([0-9]+)$'))[1]::bigint),0) into maximum_number from (
    select item->>'folio' as code from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) item
      where w.area='correctiveActions'
    union all
    select action.folio from public.corrective_actions action
    union all
    select op.action_folio from public.root2cause_hard_delete_operations op
    union all
    select reservation.folio from public.root2cause_action_folio_reservations reservation
    union all
    select log.entity_code_snapshot from public.audit_log log where log.action='root2cause.action_deleted'
  ) codes where code ~ '^AC-([0-9]{4}-)?[0-9]+$';
  insert into public.root2cause_action_folio_counter(singleton,last_number) values(true,maximum_number)
    on conflict(singleton) do nothing;
  update public.root2cause_action_folio_counter counter set last_number=greatest(counter.last_number,maximum_number)+1,updated_at=now()
    where counter.singleton returning last_number into next_number;
  insert into public.root2cause_action_folio_reservations as reservation(action_id,folio,organization_id,process_id,reserved_by)
    values(p_action_id,'AC-'||to_char(now(),'YYYY')||'-'||lpad(next_number::text,3,'0'),actor.organization_id,p_process_id,actor.id)
    returning reservation.folio into folio;
  return folio;
end $$;
revoke all on function public.iq_root2cause_allocate_action_folio(text,uuid) from public,anon;
grant execute on function public.iq_root2cause_allocate_action_folio(text,uuid) to authenticated;

-- Fail closed for any FK consumer outside Root2Cause-owned children. This
-- prevents ON DELETE SET NULL or CASCADE from changing another module.
create or replace function public.iq_root2cause_assert_no_external_action_refs(p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare fk record; ref_exists boolean; ref_column text;
begin
  for fk in
    select c.conrelid, c.conname, c.conkey
    from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.corrective_actions'::regclass
  loop
    if fk.conrelid in (
      'public.corrective_action_a3'::regclass,
      'public.corrective_action_plans'::regclass,
      'public.corrective_action_effectiveness_reviews'::regclass,
      'public.corrective_action_participants'::regclass,
      to_regclass('public.root2cause_drafts')
    ) then continue; end if;
    if cardinality(fk.conkey) <> 1 then
      raise exception using errcode = 'P0001', message = 'UNSUPPORTED_ACTION_REFERENCE';
    end if;
    select a.attname into ref_column from pg_catalog.pg_attribute a
      where a.attrelid = fk.conrelid and a.attnum = fk.conkey[1];
    execute format('select exists(select 1 from %s r where r.%I = $1)', fk.conrelid::regclass, ref_column)
      into ref_exists using p_action_id;
    if ref_exists then
      raise exception using errcode = 'P0001', message = 'ACTION_REFERENCED_BY_OTHER_MODULE', detail = fk.conrelid::regclass::text;
    end if;
  end loop;
end $$;
revoke all on function public.iq_root2cause_assert_no_external_action_refs(uuid) from public, anon, authenticated;

create or replace function public.iq_root2cause_assert_file_exclusive(p_file_id uuid,p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare fk record; ref_exists boolean; ref_column text;
begin
  for fk in select c.conrelid,c.conkey from pg_catalog.pg_constraint c
    where c.contype='f' and c.confrelid='public.file_objects'::regclass loop
    if cardinality(fk.conkey)<>1 then raise exception using errcode='P0001',message='UNSUPPORTED_FILE_REFERENCE'; end if;
    select a.attname into ref_column from pg_catalog.pg_attribute a where a.attrelid=fk.conrelid and a.attnum=fk.conkey[1];
    if fk.conrelid='public.corrective_action_plans'::regclass or fk.conrelid='public.corrective_action_effectiveness_reviews'::regclass then
      execute format('select exists(select 1 from %s r where r.%I=$1 and r.corrective_action_id<>$2)',fk.conrelid::regclass,ref_column) into ref_exists using p_file_id,p_action_id;
    else
      execute format('select exists(select 1 from %s r where r.%I=$1)',fk.conrelid::regclass,ref_column) into ref_exists using p_file_id;
    end if;
    if ref_exists then raise exception using errcode='P0001',message='FILE_REFERENCED_OUTSIDE_ACTION',detail=fk.conrelid::regclass::text; end if;
  end loop;
end $$;
revoke all on function public.iq_root2cause_assert_file_exclusive(uuid,uuid) from public,anon,authenticated;

create or replace function public.iq_root2cause_assert_owned_children_unreferenced(p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare child_table text; child_key text; fk record; ref_column text; ref_exists boolean;
begin
  foreach child_table in array array['corrective_action_a3','corrective_action_plans','corrective_action_effectiveness_reviews','corrective_action_participants'] loop
    if to_regclass('public.'||child_table) is null then continue; end if;
    execute format('select 1 from %s owned where owned.corrective_action_id=$1 for update',to_regclass('public.'||child_table)::regclass) using p_action_id;
    child_key := case when exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=to_regclass('public.'||child_table) and a.attname='id' and not a.attisdropped) then 'id' else 'corrective_action_id' end;
    for fk in select c.conrelid,c.conkey from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=to_regclass('public.'||child_table) loop
      if cardinality(fk.conkey)<>1 then raise exception using errcode='P0001',message='UNSUPPORTED_ROOT2CAUSE_CHILD_REFERENCE',detail=child_table; end if;
      select a.attname into ref_column from pg_catalog.pg_attribute a where a.attrelid=fk.conrelid and a.attnum=fk.conkey[1];
      execute format('select exists(select 1 from %s consumer where consumer.%I in (select owned.%I from %s owned where owned.corrective_action_id=$1))',fk.conrelid::regclass,ref_column,child_key,to_regclass('public.'||child_table)::regclass) into ref_exists using p_action_id;
      if ref_exists then raise exception using errcode='P0001',message='ROOT2CAUSE_CHILD_REFERENCED_EXTERNALLY',detail=fk.conrelid::regclass::text||' -> '||child_table; end if;
    end loop;
  end loop;
end $$;
revoke all on function public.iq_root2cause_assert_owned_children_unreferenced(uuid) from public,anon,authenticated;

create or replace function public.iq_root2cause_assert_no_workspace_references(p_action_id uuid,p_folio text,p_workspace_id uuid,p_workspace_mode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.workspace_data w where w.area not in ('correctiveActions','a3Draft')
    and (w.payload::text like '%'||p_action_id::text||'%' or w.payload::text like '%'||p_folio||'%')) then
    raise exception using errcode='P0001',message='ACTION_REFERENCED_IN_OTHER_WORKSPACE_DATA';
  end if;
  if exists(select 1 from public.workspace_data w where w.area='correctiveActions'
    and (w.workspace_id<>p_workspace_id or w.workspace_mode<>p_workspace_mode)
    and w.payload::text like '%'||p_action_id::text||'%') then
    raise exception using errcode='P0001',message='ACTION_ID_REFERENCED_IN_OTHER_WORKSPACE';
  end if;
end $$;
revoke all on function public.iq_root2cause_assert_no_workspace_references(uuid,text,uuid,text) from public,anon,authenticated;

create or replace function public.iq_root2cause_assert_draft_unreferenced(p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare fk record; draft_key text; ref_column text; referenced boolean;
begin
  if to_regclass('public.root2cause_drafts') is null or not exists(select 1 from pg_catalog.pg_attribute a
    where a.attrelid='public.root2cause_drafts'::regclass and a.attname='finalized_action_id' and not a.attisdropped) then return; end if;
  execute 'select 1 from public.root2cause_drafts where finalized_action_id=$1 for update' using p_action_id;
  for fk in select c.conrelid,c.conkey,c.confkey from pg_catalog.pg_constraint c
    where c.contype='f' and c.confrelid='public.root2cause_drafts'::regclass loop
    if cardinality(fk.conkey)<>1 or cardinality(fk.confkey)<>1 then raise exception using errcode='P0001',message='UNSUPPORTED_ROOT2CAUSE_DRAFT_REFERENCE'; end if;
    select a.attname into ref_column from pg_catalog.pg_attribute a where a.attrelid=fk.conrelid and a.attnum=fk.conkey[1];
    select a.attname into draft_key from pg_catalog.pg_attribute a where a.attrelid='public.root2cause_drafts'::regclass and a.attnum=fk.confkey[1];
    execute format('select exists(select 1 from %s consumer where consumer.%I in (select d.%I from public.root2cause_drafts d where d.finalized_action_id=$1))',fk.conrelid::regclass,ref_column,draft_key) into referenced using p_action_id;
    if referenced then raise exception using errcode='P0001',message='ROOT2CAUSE_DRAFT_REFERENCED_EXTERNALLY',detail=fk.conrelid::regclass::text; end if;
  end loop;
end $$;
revoke all on function public.iq_root2cause_assert_draft_unreferenced(uuid) from public,anon,authenticated;

create or replace function public.iq_root2cause_hard_delete_contract()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.user_type='administrator'
      and p.organization_id is not null)
    and exists(select 1 from public.user_module_action_permissions permission where permission.user_id=auth.uid()
      and permission.module_id='corrective-actions' and permission.action='manage' and permission.source='direct')
    and to_regclass('public.root2cause_hard_delete_operations') is not null;
$$;
revoke all on function public.iq_root2cause_hard_delete_contract() from public,anon;
grant execute on function public.iq_root2cause_hard_delete_contract() to authenticated;

create or replace function public.iq_root2cause_workspace_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare op record; operation_id uuid; operation_actor_id uuid; old_action jsonb; new_action jsonb;
begin
  if tg_op='UPDATE' and new.area='correctiveActions' then
    begin operation_id:=nullif(current_setting('app.root2cause_hard_delete_operation',true),'')::uuid;
    exception when others then operation_id:=null; end;
    begin operation_actor_id:=nullif(current_setting('app.root2cause_hard_delete_actor',true),'')::uuid;
    exception when others then operation_actor_id:=null; end;
    for op in select pending.id,pending.action_id,pending.actor_id from public.root2cause_hard_delete_operations pending
      where pending.organization_id=new.workspace_id and pending.workspace_mode=new.workspace_mode and pending.status='storage_pending'
    loop
      if operation_id=op.id and operation_actor_id=op.actor_id then continue; end if;
      select item into old_action from jsonb_array_elements(case when jsonb_typeof(old.payload)='array' then old.payload else '[]'::jsonb end) item
        where item->>'id'=op.action_id::text;
      select item into new_action from jsonb_array_elements(case when jsonb_typeof(new.payload)='array' then new.payload else '[]'::jsonb end) item
        where item->>'id'=op.action_id::text;
      if old_action is distinct from new_action then
        raise exception using errcode='P0001',message='ROOT2CAUSE_HARD_DELETE_TARGET_IN_PROGRESS';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.iq_root2cause_workspace_delete_guard() from public,anon,authenticated;
drop trigger if exists workspace_data_root2cause_delete_guard on public.workspace_data;
create trigger workspace_data_root2cause_delete_guard before update on public.workspace_data
for each row execute function public.iq_root2cause_workspace_delete_guard();

-- Freeze only manifest file metadata while Storage cleanup is pending. The
-- authenticated completion RPC is the sole exception and only for DELETE of
-- the exact file rows in its own operation.
create or replace function public.iq_root2cause_file_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare operation_id uuid; operation_actor_id uuid; pending record;
begin
  begin operation_id:=nullif(current_setting('app.root2cause_hard_delete_operation',true),'')::uuid;
  exception when others then operation_id:=null; end;
  begin operation_actor_id:=nullif(current_setting('app.root2cause_hard_delete_actor',true),'')::uuid;
  exception when others then operation_actor_id:=null; end;
  for pending in select op.id,op.actor_id from public.root2cause_hard_delete_operations op
    where op.status='storage_pending' and old.id=any(op.file_ids)
  loop
    if tg_op='DELETE' and operation_id=pending.id and pending.actor_id=operation_actor_id then continue; end if;
    raise exception using errcode='P0001',message='ROOT2CAUSE_FILE_DELETE_IN_PROGRESS';
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.iq_root2cause_file_delete_guard() from public,anon,authenticated;
drop trigger if exists file_objects_root2cause_delete_guard on public.file_objects;
create trigger file_objects_root2cause_delete_guard before update or delete on public.file_objects
for each row execute function public.iq_root2cause_file_delete_guard();

create or replace function public.iq_root2cause_action_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare operation_id uuid; operation_actor_id uuid; pending record;
begin
  begin operation_id:=nullif(current_setting('app.root2cause_hard_delete_operation',true),'')::uuid;
  exception when others then operation_id:=null; end;
  begin operation_actor_id:=nullif(current_setting('app.root2cause_hard_delete_actor',true),'')::uuid;
  exception when others then operation_actor_id:=null; end;
  for pending in select op.id,op.actor_id from public.root2cause_hard_delete_operations op
    where op.action_id=old.id and op.status='storage_pending'
  loop
    if tg_op='DELETE' and operation_id=pending.id and pending.actor_id=operation_actor_id then continue; end if;
    raise exception using errcode='P0001',message='ROOT2CAUSE_ACTION_DELETE_IN_PROGRESS';
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.iq_root2cause_action_delete_guard() from public,anon,authenticated;
drop trigger if exists corrective_actions_root2cause_delete_guard on public.corrective_actions;
create trigger corrective_actions_root2cause_delete_guard before update or delete on public.corrective_actions
for each row execute function public.iq_root2cause_action_delete_guard();

-- Suppress the generic full-payload workspace audit only while one validated
-- hard-delete operation is removing its exact action/draft. The final RPC
-- writes a minimal immutable audit event instead.
create or replace function public.audit_workspace_data_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare op_id uuid; operation_actor_id uuid; audit_action text;
begin
  begin op_id := nullif(current_setting('app.root2cause_hard_delete_operation', true), '')::uuid;
  exception when others then op_id := null; end;
  begin operation_actor_id := nullif(current_setting('app.root2cause_hard_delete_actor', true), '')::uuid;
  exception when others then operation_actor_id := null; end;
  if op_id is not null and exists (
    select 1 from public.root2cause_hard_delete_operations op
    where op.id = op_id and op.organization_id = new.workspace_id
      and op.actor_id = operation_actor_id and op.status = 'storage_pending'
      and new.area in ('correctiveActions','a3Draft')
  ) then return new; end if;

  audit_action := case
    when tg_op = 'INSERT' then 'CREATE'
    when old.deleted_at is null and new.deleted_at is not null then 'DELETE'
    when old.deleted_at is not null and new.deleted_at is null then 'RESTORE'
    else 'UPDATE'
  end;
  insert into public.audit_log(actor_id, organization_id, module, action, resource_type, resource_id, previous_value, new_value, reason, metadata)
  values (auth.uid(), new.workspace_id, new.area, audit_action, 'workspace_data', new.id::text,
    case when tg_op = 'UPDATE' then old.payload else null end, new.payload, new.deletion_reason,
    jsonb_build_object('workspace_mode',new.workspace_mode,'revision',new.revision,'deleted_at',new.deleted_at));
  return new;
end $$;

create or replace function public.iq_root2cause_hard_delete_begin(p_action_id uuid, p_folio text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; current_payload jsonb; selected_action jsonb; evidence_id text; process_id text;
        operation public.root2cause_hard_delete_operations%rowtype; relational_action public.corrective_actions%rowtype;
        file_row record; file_ids uuid[] := '{}'; storage_paths text[] := '{}';
begin
  select * into actor from public.profiles p where p.id = auth.uid() and p.status = 'active'
    and p.user_type = 'administrator' and p.organization_id is not null;
  if actor.id is null then raise exception using errcode = '42501', message = 'ADMIN_REQUIRED'; end if;
  if not exists (select 1 from public.user_module_action_permissions permission
      where permission.user_id = actor.id and permission.module_id = 'corrective-actions' and permission.action = 'manage' and permission.source = 'direct') then
    raise exception using errcode = '42501', message = 'EXPLICIT_DELETE_PERMISSION_REQUIRED';
  end if;
  if p_action_id is null or p_folio is null or length(trim(p_folio)) = 0 or p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'FOLIO_AND_REASON_REQUIRED';
  end if;

  -- Retrying a request after a committed delete remains idempotent even though
  -- the operational record is already gone.
  select * into operation from public.root2cause_hard_delete_operations op
    where op.organization_id=actor.organization_id and op.workspace_mode=public.current_workspace_mode() and op.action_id=p_action_id for update;
  if operation.id is not null then
    if operation.action_folio<>p_folio then raise exception using errcode='P0001',message='ACTION_FOLIO_CONFLICT'; end if;
    if operation.status='completed' then return jsonb_build_object('operationId',operation.id,'status','completed','paths','[]'::jsonb); end if;
    if operation.actor_id<>actor.id or operation.reason<>trim(p_reason) then raise exception using errcode='42501',message='PENDING_DELETE_REQUIRES_ORIGINAL_ADMIN_AND_REASON'; end if;
    return jsonb_build_object('operationId',operation.id,'status',operation.status,'paths',to_jsonb(operation.storage_paths));
  end if;

  select w.payload into current_payload from public.workspace_data w
    where w.workspace_id = actor.organization_id and w.workspace_mode = public.current_workspace_mode()
      and w.area = 'correctiveActions' and w.deleted_at is null;
  if jsonb_typeof(current_payload) <> 'array' then raise exception using errcode = 'P0002', message = 'ACTION_NOT_FOUND'; end if;
  select item into selected_action from jsonb_array_elements(current_payload) item
    where item->>'id' = p_action_id::text and item->>'folio' = p_folio;
  if selected_action is null then raise exception using errcode = 'P0002', message = 'ACTION_NOT_FOUND_OR_FOLIO_MISMATCH'; end if;
  if (select count(*) from jsonb_array_elements(current_payload) item where item->>'id'=p_action_id::text)<>1
    or (select count(*) from jsonb_array_elements(current_payload) item where item->>'folio'=p_folio)<>1
    or exists(select 1 from public.corrective_actions other_action where other_action.folio=p_folio and other_action.id<>p_action_id) then
    raise exception using errcode='P0001',message='DUPLICATE_ACTION_ID_OR_FOLIO';
  end if;
  if selected_action->>'source' = 'supplier' then raise exception using errcode = '42501', message = 'NOT_A_ROOT2CAUSE_ACTION'; end if;
  select * into relational_action from public.corrective_actions a where a.id=p_action_id for update;
  if relational_action.id is not null and (relational_action.folio<>p_folio or relational_action.source='supplier' or relational_action.organization_id is distinct from actor.organization_id
    or not (relational_action.source::text=selected_action->>'source' or (selected_action->>'source'='audit' and relational_action.source::text='sgc'))) then
    raise exception using errcode='P0001',message='RELATIONAL_ACTION_IDENTITY_MISMATCH';
  end if;
  process_id := nullif(selected_action->>'processId','');
  if relational_action.id is not null and relational_action.process_id is distinct from process_id then raise exception using errcode='P0001',message='RELATIONAL_ACTION_SCOPE_MISMATCH'; end if;
  if process_id is not null and (not exists(select 1 from public.processes p where p.id = process_id and p.organization_id = actor.organization_id)
      or not public.has_process_access(process_id)) then
    raise exception using errcode = '42501', message = 'OUTSIDE_PROCESS_SCOPE';
  end if;
  perform public.iq_root2cause_assert_no_external_action_refs(p_action_id);
  perform public.iq_root2cause_assert_owned_children_unreferenced(p_action_id);
  perform public.iq_root2cause_assert_no_workspace_references(p_action_id,p_folio,actor.organization_id,public.current_workspace_mode());
  perform public.iq_root2cause_assert_draft_unreferenced(p_action_id);

  -- Serialize the reservation against workspace edits and concurrent deletes.
  select w.payload into current_payload from public.workspace_data w
    where w.workspace_id=actor.organization_id and w.workspace_mode=public.current_workspace_mode()
      and w.area='correctiveActions' and w.deleted_at is null for update;
  select item into selected_action from jsonb_array_elements(case when jsonb_typeof(current_payload)='array' then current_payload else '[]'::jsonb end) item
    where item->>'id'=p_action_id::text and item->>'folio'=p_folio;
  if selected_action is null then raise exception using errcode='P0002',message='ACTION_CHANGED_OR_NOT_FOUND'; end if;
  if (select count(*) from jsonb_array_elements(case when jsonb_typeof(current_payload)='array' then current_payload else '[]'::jsonb end) item where item->>'id'=p_action_id::text)<>1
    or (select count(*) from jsonb_array_elements(case when jsonb_typeof(current_payload)='array' then current_payload else '[]'::jsonb end) item where item->>'folio'=p_folio)<>1 then
    raise exception using errcode='P0001',message='DUPLICATE_ACTION_ID_OR_FOLIO';
  end if;

  select * into operation from public.root2cause_hard_delete_operations op
    where op.organization_id = actor.organization_id and op.workspace_mode = public.current_workspace_mode() and op.action_id = p_action_id for update;
  if operation.id is not null then
    if operation.action_folio <> p_folio then raise exception using errcode = 'P0001', message = 'ACTION_FOLIO_CONFLICT'; end if;
    if operation.status = 'completed' then return jsonb_build_object('operationId',operation.id,'status','completed','paths','[]'::jsonb); end if;
    if operation.actor_id <> actor.id or operation.reason <> trim(p_reason) then raise exception using errcode = '42501', message = 'PENDING_DELETE_REQUIRES_ORIGINAL_ADMIN_AND_REASON'; end if;
    return jsonb_build_object('operationId',operation.id,'status',operation.status,'paths',to_jsonb(operation.storage_paths));
  end if;

  evidence_id := nullif(selected_action#>>'{a3,evidenceId}','');
  if evidence_id is not null and evidence_id !~ '^[a-f0-9-]{36}$' then raise exception using errcode = 'P0001', message = 'UNSAFE_EVIDENCE_ID'; end if;
  if evidence_id is not null and (
    exists(select 1 from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) other_action
      where w.area='correctiveActions' and other_action->>'id'<>p_action_id::text and other_action#>>'{a3,evidenceId}'=evidence_id)
    or exists(select 1 from public.workspace_data d where d.area='a3Draft' and d.workspace_id<>actor.organization_id and d.payload#>>'{draft,evidenceId}'=evidence_id)
  ) then raise exception using errcode='P0001',message='ROOT2CAUSE_EVIDENCE_SHARED'; end if;
  if exists(select 1 from public.corrective_action_plans x left join public.file_objects f on f.id=x.evidence_file_id
       where x.corrective_action_id=p_action_id and x.evidence_file_id is not null
         and (f.id is null or f.module_id is distinct from 'corrective-actions' or f.bucket_id is distinct from 'integraq-private' or f.process_id is distinct from process_id))
    or exists(select 1 from public.corrective_action_effectiveness_reviews x left join public.file_objects f on f.id=x.evidence_file_id
       where x.corrective_action_id=p_action_id and x.evidence_file_id is not null
         and (f.id is null or f.module_id is distinct from 'corrective-actions' or f.bucket_id is distinct from 'integraq-private' or f.process_id is distinct from process_id)) then
    raise exception using errcode='P0001',message='ACTION_EVIDENCE_OWNERSHIP_UNVERIFIED';
  end if;
  -- Only private objects with exact Root2Cause ownership and verified uploader
  -- organization/process are eligible. Unknown metadata is a hard blocker.
  for file_row in select f.id,f.bucket_id,f.object_path,f.preview_path,f.module_id,f.process_id,f.resource_type,f.resource_key,f.resource_id,f.uploaded_by,p.organization_id as uploader_org,
      (exists(select 1 from public.corrective_action_plans x where x.corrective_action_id=p_action_id and x.evidence_file_id=f.id)
       or exists(select 1 from public.corrective_action_effectiveness_reviews x where x.corrective_action_id=p_action_id and x.evidence_file_id=f.id)) as plan_file
      from public.file_objects f left join public.profiles p on p.id=f.uploaded_by
      where f.module_id='corrective-actions' and (
        (evidence_id is not null and f.resource_type='root2cause_evidence' and f.resource_key like evidence_id || '\_%' escape '\')
        or (f.resource_type='root2cause_official_pdf' and f.resource_id=p_action_id)
        or exists(select 1 from public.corrective_action_plans x where x.corrective_action_id=p_action_id and x.evidence_file_id=f.id)
        or exists(select 1 from public.corrective_action_effectiveness_reviews x where x.corrective_action_id=p_action_id and x.evidence_file_id=f.id)
      )
  loop
      if file_row.bucket_id <> 'integraq-private' or file_row.process_id is distinct from process_id
        or file_row.uploader_org is distinct from actor.organization_id then
        raise exception using errcode = 'P0001', message = 'ROOT2CAUSE_FILE_SCOPE_MISMATCH';
      end if;
      if file_row.resource_type='root2cause_evidence' and evidence_id is not null and
        (file_row.resource_key !~ ('^' || evidence_id || '_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$')
         or file_row.object_path not like file_row.uploaded_by::text || '/attachments/corrective-actions/root2cause_evidence/' || file_row.resource_key || '/%') then
        raise exception using errcode = 'P0001', message = 'ROOT2CAUSE_EVIDENCE_PATH_UNVERIFIED';
      end if;
      if file_row.resource_type='root2cause_official_pdf' and file_row.object_path not like file_row.uploaded_by::text || '/attachments/corrective-actions/root2cause_official_pdf/%' then
        raise exception using errcode = 'P0001', message = 'ROOT2CAUSE_PDF_PATH_UNVERIFIED';
      end if;
      if file_row.preview_path is not null and file_row.preview_path not like file_row.uploaded_by::text || '/attachments/corrective-actions/%' then
        raise exception using errcode='P0001',message='ROOT2CAUSE_PREVIEW_PATH_UNVERIFIED';
      end if;
      if file_row.resource_type not in ('root2cause_evidence','root2cause_official_pdf') and
        (not file_row.plan_file or file_row.object_path not like file_row.uploaded_by::text || '/attachments/corrective-actions/%') then
        raise exception using errcode='P0001',message='ROOT2CAUSE_ATTACHED_FILE_PATH_UNVERIFIED';
      end if;
      perform public.iq_root2cause_assert_file_exclusive(file_row.id,p_action_id);
      -- Fail closed if an attached file is also referenced outside exclusive
      -- Root2Cause plan/effectiveness rows.
      if exists(select 1 from public.corrective_action_plans x where x.evidence_file_id=file_row.id and x.corrective_action_id<>p_action_id)
        or exists(select 1 from public.corrective_action_effectiveness_reviews x where x.evidence_file_id=file_row.id and x.corrective_action_id<>p_action_id) then
        raise exception using errcode = 'P0001', message = 'FILE_SHARED_WITH_OTHER_ACTION';
      end if;
      file_ids := array_append(file_ids,file_row.id);
      storage_paths := array_append(storage_paths,file_row.object_path);
      if file_row.preview_path is not null then storage_paths := array_append(storage_paths,file_row.preview_path); end if;
  end loop;

  insert into public.root2cause_hard_delete_operations(organization_id,workspace_mode,action_id,action_folio,actor_id,reason,file_ids,storage_paths)
  values(actor.organization_id,public.current_workspace_mode(),p_action_id,p_folio,actor.id,trim(p_reason),file_ids,storage_paths)
  returning * into operation;
  insert into public.audit_log(actor_id,organization_id,user_name_snapshot,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,reason,metadata,origin)
  values(actor.id,actor.organization_id,actor.full_name,'corrective-actions','root2cause.action_delete_started','corrective_action',p_action_id::text,p_folio,
    jsonb_build_object('status','storage_pending'),trim(p_reason),jsonb_build_object('operation_id',operation.id), 'admin_override');
  return jsonb_build_object('operationId',operation.id,'status',operation.status,'paths',to_jsonb(operation.storage_paths));
end $$;

create or replace function public.iq_root2cause_hard_delete_storage_failed(p_operation_id uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; operation public.root2cause_hard_delete_operations%rowtype;
begin
  select * into actor from public.profiles p where p.id=auth.uid() and p.status='active' and p.user_type='administrator';
  if actor.id is null or not exists(select 1 from public.user_module_action_permissions permission where permission.user_id=actor.id and permission.module_id='corrective-actions' and permission.action='manage' and permission.source='direct') then
    raise exception using errcode='42501', message='EXPLICIT_DELETE_PERMISSION_REQUIRED';
  end if;
  select * into operation from public.root2cause_hard_delete_operations op
    where op.id=p_operation_id and op.actor_id=actor.id and op.organization_id=actor.organization_id and op.status='storage_pending' for update;
  if operation.id is null then raise exception using errcode='P0002', message='DELETE_OPERATION_NOT_FOUND'; end if;
  update public.root2cause_hard_delete_operations set last_storage_error=left(coalesce(nullif(trim(p_error),''),'Storage no confirmó la limpieza.'),300) where id=operation.id;
  insert into public.audit_log(actor_id,organization_id,user_name_snapshot,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,reason,metadata,origin)
  values(actor.id,actor.organization_id,actor.full_name,'corrective-actions','root2cause.action_delete_storage_incomplete','corrective_action',operation.action_id::text,operation.action_folio,
    jsonb_build_object('status','storage_pending'),operation.reason,jsonb_build_object('operation_id',operation.id,'error',left(coalesce(nullif(trim(p_error),''),'Storage no confirmó la limpieza.'),300)), 'admin_override');
end $$;

create or replace function public.iq_root2cause_hard_delete_complete(p_operation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; operation public.root2cause_hard_delete_operations%rowtype; relational_action public.corrective_actions%rowtype;
        action_row jsonb; evidence_id text; process_id text; workspace_id uuid; workspace_payload jsonb; file_row record;
begin
  -- This RPC is callable only with the server-held service_role key. The
  -- backend supplies the already-authenticated actor ID, which is rechecked
  -- against the immutable operation and the live direct permission grant.
  select * into actor from public.profiles p where p.id=p_actor_id and p.status='active' and p.user_type='administrator' and p.organization_id is not null;
  if actor.id is null or not exists(select 1 from public.user_module_action_permissions permission where permission.user_id=actor.id and permission.module_id='corrective-actions' and permission.action='manage' and permission.source='direct') then
    raise exception using errcode='42501', message='EXPLICIT_DELETE_PERMISSION_REQUIRED';
  end if;
  select * into operation from public.root2cause_hard_delete_operations op where op.id=p_operation_id and op.organization_id=actor.organization_id and op.actor_id=actor.id for update;
  if operation.id is null then raise exception using errcode='42501', message='DELETE_OPERATION_NOT_FOUND'; end if;
  if operation.actor_id is distinct from actor.id then raise exception using errcode='42501', message='DELETE_ACTOR_MISMATCH'; end if;
  if operation.status='completed' then return jsonb_build_object('deleted',true,'alreadyCompleted',true,'folio',operation.action_folio); end if;

  -- Independent database-side check: the server must have removed and
  -- verified every manifest object before PostgreSQL can delete its metadata.
  if exists(select 1 from storage.objects stored_object
    where stored_object.bucket_id='integraq-private' and stored_object.name=any(operation.storage_paths)) then
    raise exception using errcode='P0001',message='ROOT2CAUSE_STORAGE_OBJECTS_REMAIN';
  end if;

  select w.id,w.payload into workspace_id,workspace_payload from public.workspace_data w
    where w.workspace_id=operation.organization_id and w.workspace_mode=operation.workspace_mode and w.area='correctiveActions' and w.deleted_at is null for update;
  if workspace_id is null or jsonb_typeof(workspace_payload)<>'array' then raise exception using errcode='P0002',message='ACTION_NOT_FOUND_DURING_FINALIZATION'; end if;
  select item into action_row from jsonb_array_elements(workspace_payload) item where item->>'id'=operation.action_id::text and item->>'folio'=operation.action_folio;
  if action_row is null then raise exception using errcode='P0001',message='ACTION_CHANGED_DURING_DELETE'; end if;
  select * into relational_action from public.corrective_actions a where a.id=operation.action_id for update;
  if relational_action.id is not null and (relational_action.folio<>operation.action_folio or relational_action.source='supplier' or relational_action.organization_id is distinct from actor.organization_id
    or not (relational_action.source::text=action_row->>'source' or (action_row->>'source'='audit' and relational_action.source::text='sgc'))) then
    raise exception using errcode='P0001',message='RELATIONAL_ACTION_IDENTITY_MISMATCH';
  end if;
  process_id:=nullif(action_row->>'processId','');
  if relational_action.id is not null and relational_action.process_id is distinct from process_id then raise exception using errcode='P0001',message='RELATIONAL_ACTION_SCOPE_MISMATCH'; end if;
  if process_id is not null and (not exists(select 1 from public.processes p where p.id=process_id and p.organization_id=actor.organization_id) or not public.has_process_access(process_id)) then raise exception using errcode='42501',message='OUTSIDE_PROCESS_SCOPE'; end if;
  perform public.iq_root2cause_assert_no_external_action_refs(operation.action_id);
  perform public.iq_root2cause_assert_owned_children_unreferenced(operation.action_id);
  perform public.iq_root2cause_assert_no_workspace_references(operation.action_id,operation.action_folio,operation.organization_id,operation.workspace_mode);
  perform public.iq_root2cause_assert_draft_unreferenced(operation.action_id);
  evidence_id:=nullif(action_row#>>'{a3,evidenceId}','');
  if evidence_id is not null and (
    exists(select 1 from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) other_action
      where w.area='correctiveActions' and other_action->>'id'<>operation.action_id::text and other_action#>>'{a3,evidenceId}'=evidence_id)
    or exists(select 1 from public.workspace_data d where d.area='a3Draft' and d.workspace_id<>operation.organization_id and d.payload#>>'{draft,evidenceId}'=evidence_id)
  ) then raise exception using errcode='P0001',message='ROOT2CAUSE_EVIDENCE_SHARED'; end if;

  -- Revalidate and lock the exact manifest before touching relational files.
  if cardinality(operation.file_ids)>0 then
    perform f.id from public.file_objects f where f.id=any(operation.file_ids) for update;
    if (select count(*) from public.file_objects f where f.id=any(operation.file_ids))<>cardinality(operation.file_ids) then
      raise exception using errcode='P0001',message='ROOT2CAUSE_FILE_MANIFEST_CHANGED';
    end if;
    if exists(select 1 from public.file_objects f where f.id=any(operation.file_ids)
      and (f.bucket_id<>'integraq-private' or f.module_id<>'corrective-actions' or f.process_id is distinct from process_id
        or f.object_path<>all(operation.storage_paths) or (f.preview_path is not null and f.preview_path<>all(operation.storage_paths)))) then
      raise exception using errcode='P0001',message='ROOT2CAUSE_FILE_MANIFEST_CHANGED';
    end if;
    for file_row in select unnest(operation.file_ids) as id loop
      perform public.iq_root2cause_assert_file_exclusive(file_row.id,operation.action_id);
    end loop;
  end if;

  -- Every path returned by begin must have completed its Storage removal before
  -- this final transaction is entered by the server route.
  perform set_config('app.root2cause_hard_delete_operation',operation.id::text,true);
  perform set_config('app.root2cause_hard_delete_actor',actor.id::text,true);
  update public.workspace_data w set payload=(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(w.payload) item where item->>'id'<>operation.action_id::text)
    where w.id=workspace_id;
  if evidence_id is not null then
    update public.workspace_data d set payload='{}'::jsonb
      where d.workspace_id=operation.organization_id and d.workspace_mode=operation.workspace_mode and d.area='a3Draft' and d.payload#>>'{draft,evidenceId}'=evidence_id;
  end if;
  if to_regclass('public.root2cause_drafts') is not null and exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.root2cause_drafts'::regclass and a.attname='finalized_action_id' and not a.attisdropped) then
    execute 'delete from public.root2cause_drafts where finalized_action_id = $1' using operation.action_id;
  end if;
  -- These rows belong exclusively to this corrective action. Cross-module FK
  -- consumers were checked above; deleting the action cascades its A3/participants.
  delete from public.corrective_action_plans where corrective_action_id=operation.action_id;
  delete from public.corrective_action_effectiveness_reviews where corrective_action_id=operation.action_id;
  delete from public.file_objects where id=any(operation.file_ids);
  delete from public.corrective_actions where id=operation.action_id;

  insert into public.audit_log(actor_id,organization_id,user_name_snapshot,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,reason,metadata,origin)
  values(actor.id,actor.organization_id,actor.full_name,'corrective-actions','root2cause.action_deleted','corrective_action',operation.action_id::text,operation.action_folio,
    jsonb_build_object('folio',operation.action_folio,'type',coalesce(action_row->>'source','unknown'),'status',coalesce(action_row->>'status','unknown')),
    null,operation.reason,jsonb_build_object('organization_id',operation.organization_id,'process_id',process_id,'operation_id',operation.id),'admin_override');
  update public.root2cause_hard_delete_operations set status='completed',completed_at=now(),file_ids='{}',storage_paths='{}',last_storage_error=null where id=operation.id;
  return jsonb_build_object('deleted',true,'alreadyCompleted',false,'folio',operation.action_folio);
end $$;

revoke all on function public.iq_root2cause_hard_delete_begin(uuid,text,text) from public,anon;
revoke all on function public.iq_root2cause_hard_delete_storage_failed(uuid,text) from public,anon;
revoke all on function public.iq_root2cause_hard_delete_complete(uuid,uuid) from public,anon,authenticated,service_role;
do $$
begin
  if to_regprocedure('public.iq_root2cause_hard_delete_complete(uuid)') is not null then
    execute 'revoke all on function public.iq_root2cause_hard_delete_complete(uuid) from public,anon,authenticated,service_role';
  end if;
end $$;
grant execute on function public.iq_root2cause_hard_delete_begin(uuid,text,text) to authenticated;
grant execute on function public.iq_root2cause_hard_delete_storage_failed(uuid,text) to authenticated;
grant execute on function public.iq_root2cause_hard_delete_complete(uuid,uuid) to service_role;

commit;
