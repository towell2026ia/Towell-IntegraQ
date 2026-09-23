-- ID-PRD-UPDATE-01
-- Capa incremental de versionado, ciclo de vida, auditoria y Lista Maestra.
-- Reutiliza controlled_documents, controlled_document_versions y el flujo vigente.

begin;

-- Nunca permitir que una eliminacion fisica del documento borre evidencia historica.
alter table public.controlled_document_versions
  drop constraint if exists controlled_document_versions_document_id_fkey,
  add constraint controlled_document_versions_document_id_fkey
    foreign key (document_id) references public.controlled_documents(id) on delete restrict;

alter table public.document_workflow_events
  drop constraint if exists document_workflow_events_document_id_fkey,
  add constraint document_workflow_events_document_id_fkey
    foreign key (document_id) references public.controlled_documents(id) on delete restrict,
  drop constraint if exists document_workflow_events_version_id_fkey,
  add constraint document_workflow_events_version_id_fkey
    foreign key (version_id) references public.controlled_document_versions(id) on delete restrict;

alter table public.controlled_document_versions
  add column if not exists change_summary text,
  add column if not exists comments text;

create unique index if not exists controlled_document_current_version_idx
  on public.controlled_document_versions(document_id)
  where status = 'current';

create table if not exists public.document_lifecycle (
  document_id uuid primary key references public.controlled_documents(id) on delete restrict,
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'obsolete', 'deleted')),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete restrict,
  delete_reason text,
  obsoleted_at timestamptz,
  obsoleted_by uuid references public.profiles(id) on delete restrict,
  obsolete_reason text,
  replacement_document_id uuid references public.controlled_documents(id) on delete restrict,
  restored_at timestamptz,
  restored_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (not is_deleted or (deleted_at is not null and deleted_by is not null and length(trim(coalesce(delete_reason, ''))) > 0))
);

create index if not exists document_lifecycle_deleted_idx
  on public.document_lifecycle(is_deleted);
create index if not exists document_lifecycle_status_idx
  on public.document_lifecycle(lifecycle_status);
create trigger document_lifecycle_set_updated_at
before update on public.document_lifecycle
for each row execute function public.set_updated_at();

create table if not exists public.document_audit_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.controlled_documents(id) on delete restrict,
  document_version_id uuid references public.controlled_document_versions(id) on delete restrict,
  event_type text not null check (event_type in (
    'DOCUMENT_CREATED', 'DOCUMENT_EDITED', 'VERSION_CREATED', 'VERSION_SUBMITTED',
    'VERSION_APPROVED', 'VERSION_REJECTED', 'DOCUMENT_OBSOLETED',
    'DOCUMENT_DELETED', 'DOCUMENT_RESTORED', 'DOCUMENT_VIEWED', 'FILE_REPLACED'
  )),
  previous_state jsonb,
  new_state jsonb,
  reason text,
  performed_by uuid references public.profiles(id) on delete restrict,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists document_audit_document_idx
  on public.document_audit_log(document_id, performed_at desc);
create index if not exists document_audit_event_idx
  on public.document_audit_log(event_type);

insert into public.document_lifecycle(
  document_id, lifecycle_status, is_deleted, deleted_at, deleted_by, delete_reason
)
select document.id,
       case when document.deleted_at is not null then 'deleted' else 'active' end,
       document.deleted_at is not null,
       document.deleted_at,
       case when document.deleted_at is not null then coalesce(document.deleted_by, document.created_by) end,
       case when document.deleted_at is not null then coalesce(nullif(trim(document.deletion_reason), ''), 'Eliminacion historica migrada') end
from public.controlled_documents document
on conflict (document_id) do nothing;

-- El historial vigente ya fue inspeccionado: se conserva y se proyecta una sola vez
-- en la bitacora ampliada, sin modificar document_workflow_events.
with normalized_events as (
  select
    event.document_id,
    event.version_id,
    case event.action
      when 'created' then 'VERSION_CREATED'
      when 'uploaded' then 'VERSION_CREATED'
      when 'submitted' then 'VERSION_SUBMITTED'
      when 'approved' then 'VERSION_APPROVED'
      when 'rejected' then 'VERSION_REJECTED'
      when 'obsoleted' then 'DOCUMENT_OBSOLETED'
    end as event_type,
    event.actor_id,
    event.comment,
    event.created_at
  from public.document_workflow_events event
), legacy_events as (
  select distinct on (event.document_id, event.version_id, event.event_type) event.*
  from normalized_events event
  order by event.document_id, event.version_id, event.event_type, event.created_at
)
insert into public.document_audit_log(
  document_id, document_version_id, event_type, reason, performed_by, performed_at, metadata
)
select legacy.document_id, legacy.version_id, legacy.event_type, legacy.comment,
       legacy.actor_id, legacy.created_at, jsonb_build_object('backfilled', true)
from legacy_events legacy
where legacy.event_type is not null
  and not exists (
    select 1 from public.document_audit_log audit
    where audit.document_id = legacy.document_id
      and audit.document_version_id = legacy.version_id
      and audit.event_type = legacy.event_type
      and audit.performed_at = legacy.created_at
  );

insert into public.permissions(code, module, action, description, risk_level) values
  ('documents.edit', 'documents', 'edit', 'Editar metadata documental', 'MEDIUM'),
  ('documents.version', 'documents', 'version', 'Crear una nueva version documental', 'HIGH'),
  ('documents.obsolete', 'documents', 'obsolete', 'Declarar documentos obsoletos', 'HIGH'),
  ('documents.delete', 'documents', 'delete', 'Eliminar documentos logicamente', 'CRITICAL'),
  ('documents.restore', 'documents', 'restore', 'Restaurar documentos eliminados', 'CRITICAL'),
  ('documents.history', 'documents', 'history', 'Consultar historial documental', 'HIGH'),
  ('documents.master_list', 'documents', 'master_list', 'Consultar Lista Maestra', 'LOW')
on conflict (code) do update set
  description = excluded.description,
  risk_level = excluded.risk_level,
  status = 'active';

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code in (
  'documents.edit', 'documents.version', 'documents.history', 'documents.master_list'
)
where role.code = 'DOCUMENT_OWNER'
on conflict do nothing;

create or replace function public.assert_document_permission(
  requested_permission text,
  requested_document_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare selected_process_id text;
begin
  select process_id into selected_process_id
  from public.controlled_documents
  where id = requested_document_id;
  if selected_process_id is null then
    raise exception using errcode = 'P0002', message = 'DOCUMENT_NOT_FOUND';
  end if;
  if not (
    public.is_administrator()
    or public.has_permission(requested_permission, null, null, selected_process_id, null, false, null)
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return selected_process_id;
end;
$$;

create or replace function public.create_document_version(
  p_document_id uuid,
  p_revision integer,
  p_file_id uuid,
  p_file_name text,
  p_change_reason text,
  p_change_summary text,
  p_comments text default null,
  p_version_id uuid default gen_random_uuid()
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare selected_process_id text;
begin
  selected_process_id := public.assert_document_permission('documents.version', p_document_id);
  if p_revision is null or p_revision < 0 then
    raise exception using errcode = '22023', message = 'REVISION_REQUIRED';
  end if;
  if nullif(trim(p_file_name), '') is null then
    raise exception using errcode = '22023', message = 'FILE_REQUIRED';
  end if;
  if nullif(trim(p_change_reason), '') is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  if nullif(trim(p_change_summary), '') is null then
    raise exception using errcode = '22023', message = 'SUMMARY_REQUIRED';
  end if;
  if not exists (
    select 1 from public.file_objects file
    where file.id = p_file_id
      and file.uploaded_by = auth.uid()
      and file.module_id = 'documents'
      and (file.resource_id is null or file.resource_id = p_document_id)
  ) then
    raise exception using errcode = '42501', message = 'INVALID_FILE_REFERENCE';
  end if;
  if exists (
    select 1 from public.document_lifecycle
    where document_id = p_document_id and is_deleted
  ) then
    raise exception using errcode = 'P0001', message = 'DOCUMENT_DELETED';
  end if;

  insert into public.controlled_document_versions(
    id, document_id, revision, status, file_id, file_name, change_reason,
    change_summary, comments, uploaded_by
  ) values (
    p_version_id, p_document_id, p_revision, 'draft', p_file_id, trim(p_file_name),
    trim(p_change_reason), trim(p_change_summary), nullif(trim(p_comments), ''), auth.uid()
  );

  insert into public.document_workflow_events(document_id, version_id, action, actor_id, comment)
  values (p_document_id, p_version_id, 'created', auth.uid(), trim(p_change_reason));
  insert into public.document_audit_log(
    document_id, document_version_id, event_type, new_state, reason, performed_by, metadata
  ) values (
    p_document_id, p_version_id, 'VERSION_CREATED',
    jsonb_build_object('revision', p_revision, 'status', 'draft'), trim(p_change_reason), auth.uid(),
    jsonb_build_object('change_summary', trim(p_change_summary), 'process_id', selected_process_id)
  );
  return p_version_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'VERSION_ALREADY_EXISTS';
end;
$$;

create or replace function public.edit_document_metadata(
  p_document_id uuid,
  p_title text,
  p_description text,
  p_process_id text,
  p_document_type_id text,
  p_owner_id uuid default null,
  p_code text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous_row public.controlled_documents%rowtype;
declare next_code text;
begin
  perform public.assert_document_permission('documents.edit', p_document_id);
  select * into previous_row from public.controlled_documents where id = p_document_id for update;
  if nullif(trim(p_title), '') is null then
    raise exception using errcode = '22023', message = 'TITLE_REQUIRED';
  end if;
  if p_process_id <> previous_row.process_id and not (
    public.is_administrator()
    or public.has_permission('documents.edit', null, null, p_process_id, null, false, null)
  ) then
    raise exception using errcode = '42501', message = 'OUTSIDE_SCOPE';
  end if;
  next_code := coalesce(nullif(upper(trim(p_code)), ''), previous_row.code);
  update public.controlled_documents set
    title = trim(p_title), description = nullif(trim(p_description), ''),
    process_id = p_process_id, document_type_id = p_document_type_id,
    owner_id = coalesce(p_owner_id, owner_id), code = next_code
  where id = p_document_id;
  insert into public.document_audit_log(
    document_id, event_type, previous_state, new_state, performed_by,
    metadata
  ) values (
    p_document_id, 'DOCUMENT_EDITED',
    jsonb_build_object('code', previous_row.code, 'title', previous_row.title, 'description', previous_row.description, 'process_id', previous_row.process_id, 'document_type_id', previous_row.document_type_id, 'owner_id', previous_row.owner_id),
    jsonb_build_object('code', next_code, 'title', trim(p_title), 'description', nullif(trim(p_description), ''), 'process_id', p_process_id, 'document_type_id', p_document_type_id, 'owner_id', coalesce(p_owner_id, previous_row.owner_id)),
    auth.uid(), jsonb_build_object('process_id', p_process_id)
  );
end;
$$;

create or replace function public.obsolete_document(
  p_document_id uuid,
  p_reason text,
  p_replacement_document_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare selected_process_id text;
declare selected_version_id uuid;
begin
  selected_process_id := public.assert_document_permission('documents.obsolete', p_document_id);
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  if p_replacement_document_id = p_document_id then
    raise exception using errcode = '22023', message = 'INVALID_REPLACEMENT';
  end if;
  select id into selected_version_id from public.controlled_document_versions
  where document_id = p_document_id and status = 'current' for update;
  insert into public.document_lifecycle(
    document_id, lifecycle_status, is_deleted, obsoleted_at, obsoleted_by,
    obsolete_reason, replacement_document_id
  ) values (
    p_document_id, 'obsolete', false, now(), auth.uid(), trim(p_reason), p_replacement_document_id
  ) on conflict (document_id) do update set
    lifecycle_status = 'obsolete', is_deleted = false, obsoleted_at = now(),
    obsoleted_by = auth.uid(), obsolete_reason = excluded.obsolete_reason,
    replacement_document_id = excluded.replacement_document_id,
    deleted_at = null, deleted_by = null, delete_reason = null;
  update public.controlled_document_versions set status = 'obsolete'
  where id = selected_version_id;
  if selected_version_id is not null then
    insert into public.document_workflow_events(document_id, version_id, action, actor_id, comment)
    values (p_document_id, selected_version_id, 'obsoleted', auth.uid(), trim(p_reason));
  end if;
  insert into public.document_audit_log(
    document_id, document_version_id, event_type, previous_state, new_state,
    reason, performed_by, metadata
  ) values (
    p_document_id, selected_version_id, 'DOCUMENT_OBSOLETED',
    jsonb_build_object('lifecycle_status', 'active'),
    jsonb_build_object('lifecycle_status', 'obsolete', 'replacement_document_id', p_replacement_document_id),
    trim(p_reason), auth.uid(), jsonb_build_object('process_id', selected_process_id)
  );
end;
$$;

create or replace function public.soft_delete_document(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare selected_process_id text;
begin
  selected_process_id := public.assert_document_permission('documents.delete', p_document_id);
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  insert into public.document_lifecycle(
    document_id, lifecycle_status, is_deleted, deleted_at, deleted_by, delete_reason
  ) values (
    p_document_id, 'deleted', true, now(), auth.uid(), trim(p_reason)
  ) on conflict (document_id) do update set
    lifecycle_status = 'deleted', is_deleted = true, deleted_at = now(),
    deleted_by = auth.uid(), delete_reason = excluded.delete_reason;
  update public.controlled_documents set
    deleted_at = now(), deleted_by = auth.uid(), deletion_reason = trim(p_reason)
  where id = p_document_id;
  insert into public.document_audit_log(
    document_id, event_type, previous_state, new_state, reason, performed_by, metadata
  ) values (
    p_document_id, 'DOCUMENT_DELETED', jsonb_build_object('is_deleted', false),
    jsonb_build_object('is_deleted', true), trim(p_reason), auth.uid(),
    jsonb_build_object('process_id', selected_process_id)
  );
end;
$$;

create or replace function public.restore_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare selected_process_id text;
declare selected public.document_lifecycle%rowtype;
begin
  selected_process_id := public.assert_document_permission('documents.restore', p_document_id);
  select * into selected from public.document_lifecycle where document_id = p_document_id for update;
  if selected.document_id is null or not selected.is_deleted then
    raise exception using errcode = 'P0001', message = 'DOCUMENT_NOT_DELETED';
  end if;
  update public.document_lifecycle set
    lifecycle_status = case when obsoleted_at is null then 'active' else 'obsolete' end,
    is_deleted = false, restored_at = now(), restored_by = auth.uid(),
    deleted_at = null, deleted_by = null, delete_reason = null
  where document_id = p_document_id;
  update public.controlled_documents set
    deleted_at = null, deleted_by = null, deletion_reason = null
  where id = p_document_id;
  insert into public.document_audit_log(
    document_id, event_type, previous_state, new_state, performed_by, metadata
  ) values (
    p_document_id, 'DOCUMENT_RESTORED', jsonb_build_object('is_deleted', true),
    jsonb_build_object('is_deleted', false), auth.uid(),
    jsonb_build_object('process_id', selected_process_id)
  );
end;
$$;

-- Se conserva el flujo vigente; solo se agrega auditoria ampliada.
create or replace function public.submit_document_version(requested_version_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare selected_process_id text;
declare selected_document_id uuid;
begin
  select d.process_id, d.id into selected_process_id, selected_document_id
  from public.controlled_document_versions version
  join public.controlled_documents d on d.id = version.document_id
  where version.id = requested_version_id and version.status in ('draft', 'rejected')
  for update of version;
  if selected_document_id is null then raise exception 'La version no esta disponible para envio.'; end if;
  if not (public.has_process_document_role(selected_process_id, 'modifier') or public.is_administrator()) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.controlled_document_versions set
    status = 'pending', submitted_by = auth.uid(), submitted_at = now(),
    rejection_reason = null, rejected_by = null, rejected_at = null
  where id = requested_version_id;
  insert into public.document_workflow_events(document_id, version_id, action, actor_id)
  values (selected_document_id, requested_version_id, 'submitted', auth.uid());
  insert into public.document_audit_log(document_id, document_version_id, event_type, new_state, performed_by, metadata)
  values (selected_document_id, requested_version_id, 'VERSION_SUBMITTED', jsonb_build_object('status', 'pending'), auth.uid(), jsonb_build_object('process_id', selected_process_id));
  return requested_version_id;
end;
$$;

create or replace function public.review_document_version(
  requested_version_id uuid, decision text, review_comment text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare selected_process_id text;
declare selected_document_id uuid;
begin
  if decision not in ('approve', 'reject') then raise exception 'Decision invalida.'; end if;
  select d.process_id, d.id into selected_process_id, selected_document_id
  from public.controlled_document_versions version
  join public.controlled_documents d on d.id = version.document_id
  where version.id = requested_version_id and version.status = 'pending'
  for update of version;
  if selected_document_id is null then raise exception 'La version no esta pendiente de autorizacion.'; end if;
  if not public.has_process_document_role(selected_process_id, 'authorizer') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if decision = 'approve' then
    update public.controlled_document_versions set status = 'obsolete'
    where document_id = selected_document_id and status = 'current';
    update public.controlled_document_versions set
      status = 'current', validator_id = auth.uid(), authorized_by = auth.uid(),
      authorized_at = now(), rejection_reason = null
    where id = requested_version_id;
  else
    if nullif(trim(review_comment), '') is null then
      raise exception using errcode = '22023', message = 'REASON_REQUIRED';
    end if;
    update public.controlled_document_versions set
      status = 'rejected', validator_id = auth.uid(), rejected_by = auth.uid(),
      rejected_at = now(), rejection_reason = trim(review_comment)
    where id = requested_version_id;
  end if;
  insert into public.document_workflow_events(document_id, version_id, action, actor_id, comment)
  values (selected_document_id, requested_version_id,
    case when decision = 'approve' then 'approved'::public.document_workflow_action else 'rejected'::public.document_workflow_action end,
    auth.uid(), nullif(trim(review_comment), ''));
  insert into public.document_audit_log(
    document_id, document_version_id, event_type, new_state, reason, performed_by, metadata
  ) values (
    selected_document_id, requested_version_id,
    case when decision = 'approve' then 'VERSION_APPROVED' else 'VERSION_REJECTED' end,
    jsonb_build_object('status', case when decision = 'approve' then 'current' else 'rejected' end),
    nullif(trim(review_comment), ''), auth.uid(), jsonb_build_object('process_id', selected_process_id)
  );
  return requested_version_id;
end;
$$;

create or replace view public.v_document_master_list
with (security_invoker = true)
as
select
  document.id,
  document.process_id,
  document.document_type_id,
  document.code,
  document.title,
  document.description,
  document.owner_id,
  owner.full_name as owner_name,
  version.id as version_id,
  version.revision,
  version.status,
  version.updated_at as version_date,
  coalesce(lifecycle.lifecycle_status, 'active') as lifecycle_status,
  coalesce(lifecycle.is_deleted, false) as is_deleted,
  lifecycle.obsolete_reason,
  lifecycle.replacement_document_id
from public.controlled_documents document
left join public.profiles owner on owner.id = document.owner_id
left join lateral (
  select selected.* from public.controlled_document_versions selected
  where selected.document_id = document.id
  order by case selected.status when 'current' then 0 when 'pending' then 1 else 2 end,
           selected.revision desc
  limit 1
) version on true
left join public.document_lifecycle lifecycle on lifecycle.document_id = document.id;

alter table public.document_lifecycle enable row level security;
alter table public.document_audit_log enable row level security;

drop policy if exists controlled_documents_select_process on public.controlled_documents;
create policy controlled_documents_select_process on public.controlled_documents
for select to authenticated using (
  public.is_administrator()
  or (
    public.has_module_permission('documents', 'view')
    and public.has_process_access(process_id)
    and deleted_at is null
  )
);
drop policy if exists controlled_documents_update_modifier on public.controlled_documents;

create policy document_lifecycle_read on public.document_lifecycle
for select to authenticated using (
  public.is_administrator() or exists (
    select 1 from public.controlled_documents document
    where document.id = document_id and public.has_process_access(document.process_id)
  )
);
create policy document_audit_read on public.document_audit_log
for select to authenticated using (
  public.is_administrator() or exists (
    select 1 from public.controlled_documents document
    where document.id = document_id
      and public.has_permission('documents.history', null, null, document.process_id, null, false, null)
  )
);

revoke insert, update, delete on public.document_lifecycle from authenticated;
revoke insert, update, delete on public.document_audit_log from authenticated;
revoke update, delete on public.controlled_documents from authenticated;
grant select on public.document_lifecycle, public.document_audit_log to authenticated;
grant select on public.v_document_master_list to authenticated;
grant execute on function public.assert_document_permission(text, uuid) to authenticated;
grant execute on function public.create_document_version(uuid, integer, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.edit_document_metadata(uuid, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.obsolete_document(uuid, text, uuid) to authenticated;
grant execute on function public.soft_delete_document(uuid, text) to authenticated;
grant execute on function public.restore_document(uuid) to authenticated;

commit;
