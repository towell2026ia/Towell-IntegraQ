-- IntegraQ: repositorio general de Información Documentada.
-- Extiende file_objects y el bucket privado; no duplica la infraestructura documental.

begin;

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 160),
  description text,
  parent_folder_id uuid references public.document_folders(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  deletion_reason text,
  constraint document_folders_not_self_parent check (parent_folder_id is null or parent_folder_id <> id),
  constraint document_folders_soft_delete_reason check (
    deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)
  )
);

create unique index document_folders_active_name_idx
  on public.document_folders(workspace_id, coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where deleted_at is null;
create index document_folders_workspace_parent_idx
  on public.document_folders(workspace_id, parent_folder_id, name);
create index document_folders_deleted_idx
  on public.document_folders(workspace_id, deleted_at)
  where deleted_at is not null;

create table public.document_upload_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  workspace_id uuid not null references public.organizations(id) on delete restrict,
  folder_id uuid references public.document_folders(id) on delete restrict,
  total_count integer not null check (total_count > 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  status text not null default 'processing' check (status in ('processing', 'completed', 'partial', 'failed')),
  failures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  completed_at timestamptz
);

create index document_upload_batches_workspace_idx
  on public.document_upload_batches(workspace_id, created_at desc);

alter table public.file_objects
  add column if not exists workspace_id uuid references public.organizations(id) on delete restrict,
  add column if not exists folder_id uuid references public.document_folders(id) on delete restrict,
  add column if not exists display_name text,
  add column if not exists reference_type text,
  add column if not exists external_origin text,
  add column if not exists validity_status text,
  add column if not exists valid_from date,
  add column if not exists valid_until date,
  add column if not exists description text,
  add column if not exists observations text,
  add column if not exists batch_id uuid references public.document_upload_batches(id) on delete set null,
  add column if not exists deletion_reason text,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.file_objects add constraint file_objects_general_reference_check
    check (resource_type <> 'general_information_document' or reference_type in ('internal', 'external'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects add constraint file_objects_general_validity_check
    check (resource_type <> 'general_information_document' or validity_status in ('current', 'not_current'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects add constraint file_objects_general_scope_check
    check (
      resource_type <> 'general_information_document'
      or (workspace_id is not null and folder_id is not null and display_name is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects add constraint file_objects_general_valid_dates_check
    check (valid_from is null or valid_until is null or valid_from <= valid_until);
exception when duplicate_object then null; end $$;

create index if not exists file_objects_general_folder_idx
  on public.file_objects(workspace_id, folder_id, created_at desc)
  where resource_type = 'general_information_document';
create index if not exists file_objects_general_filters_idx
  on public.file_objects(workspace_id, reference_type, validity_status, deleted_at)
  where resource_type = 'general_information_document';
create index if not exists file_objects_general_batch_idx
  on public.file_objects(batch_id)
  where resource_type = 'general_information_document';

create or replace function public.can_access_general_information_workspace(requested_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.organizations workspace on workspace.id = requested_workspace_id
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        profile.organization_id = requested_workspace_id
        or (
          profile.user_type in ('customer', 'supplier')
          and workspace.code = 'TOWELL'
        )
      )
  );
$$;

create or replace function public.guard_document_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_workspace uuid;
declare cycle_found boolean;
begin
  if new.parent_folder_id is not null then
    select workspace_id into parent_workspace
    from public.document_folders
    where id = new.parent_folder_id and deleted_at is null;
    if parent_workspace is null or parent_workspace <> new.workspace_id then
      raise exception using errcode = '23514', message = 'INVALID_PARENT_FOLDER';
    end if;
    with recursive ancestors as (
      select id, parent_folder_id from public.document_folders where id = new.parent_folder_id
      union all
      select folder.id, folder.parent_folder_id
      from public.document_folders folder
      join ancestors on ancestors.parent_folder_id = folder.id
    )
    select exists(select 1 from ancestors where id = new.id) into cycle_found;
    if cycle_found then
      raise exception using errcode = '23514', message = 'FOLDER_CYCLE';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  end if;
  return new;
end;
$$;

create trigger document_folders_guard
before insert or update on public.document_folders
for each row execute function public.guard_document_folder();

create or replace function public.audit_general_information_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_action text;
declare workspace uuid;
declare audit_actor uuid;
declare resource text;
declare resource_key text;
declare details jsonb;
begin
  if tg_table_name = 'document_folders' then
    resource := 'document_folder';
    if tg_op = 'INSERT' then
      workspace := new.workspace_id;
      audit_actor := coalesce(auth.uid(), new.updated_by, new.created_by);
      resource_key := new.id::text;
      event_action := 'CREATE_FOLDER';
      details := jsonb_build_object('name', new.name, 'parent_folder_id', new.parent_folder_id);
    else
      workspace := coalesce(new.workspace_id, old.workspace_id);
      audit_actor := coalesce(auth.uid(), new.updated_by, new.created_by, old.updated_by, old.created_by);
      resource_key := coalesce(new.id, old.id)::text;
      event_action := case
        when old.deleted_at is null and new.deleted_at is not null then 'DELETE_FOLDER'
        when old.deleted_at is not null and new.deleted_at is null then 'RESTORE_FOLDER'
        when old.parent_folder_id is distinct from new.parent_folder_id then 'MOVE_FOLDER'
        when old.name is distinct from new.name then 'RENAME_FOLDER'
        when old.archived_at is distinct from new.archived_at then 'ARCHIVE_FOLDER'
        else 'UPDATE_FOLDER'
      end;
      details := jsonb_build_object('name', new.name, 'parent_folder_id', new.parent_folder_id);
    end if;
  else
    resource := 'general_information_document';
    if tg_op = 'INSERT' then
      if new.resource_type <> 'general_information_document' then return new; end if;
      workspace := new.workspace_id;
      audit_actor := coalesce(auth.uid(), new.updated_by, new.uploaded_by);
      resource_key := new.id::text;
      event_action := case when new.replaces_file_id is not null then 'REPLACE_DOCUMENT' else 'UPLOAD_DOCUMENT' end;
      details := jsonb_build_object('name', new.display_name, 'folder_id', new.folder_id, 'batch_id', new.batch_id);
    else
      if coalesce(new.resource_type, old.resource_type) <> 'general_information_document' then return new; end if;
      workspace := coalesce(new.workspace_id, old.workspace_id);
      audit_actor := coalesce(auth.uid(), new.updated_by, new.uploaded_by, old.updated_by, old.uploaded_by);
      resource_key := coalesce(new.id, old.id)::text;
      event_action := case
        when old.deleted_at is null and new.deleted_at is not null then 'DELETE_DOCUMENT'
        when old.deleted_at is not null and new.deleted_at is null then 'RESTORE_DOCUMENT'
        when old.folder_id is distinct from new.folder_id then 'MOVE_DOCUMENT'
        when old.reference_type is distinct from new.reference_type then 'CHANGE_REFERENCE_TYPE'
        when old.validity_status is distinct from new.validity_status then 'CHANGE_VALIDITY'
        else 'UPDATE_DOCUMENT'
      end;
      details := jsonb_build_object('name', new.display_name, 'folder_id', new.folder_id, 'batch_id', new.batch_id);
    end if;
  end if;

  insert into public.audit_log(actor_id, action, resource_type, resource_id, metadata)
  values (audit_actor, event_action, resource, resource_key, details || jsonb_build_object('workspace_id', workspace));
  return new;
end;
$$;

create trigger document_folders_audit
after insert or update on public.document_folders
for each row execute function public.audit_general_information_change();
create trigger general_information_documents_audit
after insert or update on public.file_objects
for each row execute function public.audit_general_information_change();

alter table public.document_folders enable row level security;
alter table public.document_upload_batches enable row level security;

create policy document_folders_authenticated_read on public.document_folders
for select to authenticated using (
  public.can_access_general_information_workspace(workspace_id)
  and (deleted_at is null or public.is_administrator())
);
create policy document_folders_admin_insert on public.document_folders
for insert to authenticated with check (
  public.is_administrator()
  and public.can_access_general_information_workspace(workspace_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
);
create policy document_folders_admin_update on public.document_folders
for update to authenticated using (
  public.is_administrator() and public.can_access_general_information_workspace(workspace_id)
) with check (
  public.is_administrator() and public.can_access_general_information_workspace(workspace_id)
);

create policy document_upload_batches_admin_read on public.document_upload_batches
for select to authenticated using (
  public.is_administrator() and public.can_access_general_information_workspace(workspace_id)
);
create policy document_upload_batches_admin_insert on public.document_upload_batches
for insert to authenticated with check (
  public.is_administrator()
  and public.can_access_general_information_workspace(workspace_id)
  and created_by = auth.uid()
);
create policy document_upload_batches_admin_update on public.document_upload_batches
for update to authenticated using (
  public.is_administrator() and public.can_access_general_information_workspace(workspace_id)
) with check (
  public.is_administrator() and public.can_access_general_information_workspace(workspace_id)
);

drop policy if exists file_objects_select_scope on public.file_objects;
create policy file_objects_select_scope on public.file_objects
for select to authenticated
using (
  (
    resource_type = 'general_information_document'
    and public.can_access_general_information_workspace(workspace_id)
    and (deleted_at is null or public.is_administrator())
  )
  or (
    resource_type <> 'general_information_document'
    and (
      public.is_administrator()
      or (
        deleted_at is null
        and (
          uploaded_by = auth.uid()
          or (
            public.is_internal_user()
            and (
              (process_id is not null and public.has_process_access(process_id))
              or (module_id is not null and public.has_module_permission(module_id, 'view'))
            )
          )
          or (
            external_organization_id in (select public.current_organization_ids())
            and (
              audience = 'shared'
              or (audience = 'customer' and public.current_user_type() = 'customer')
              or (audience = 'supplier' and public.current_user_type() = 'supplier')
            )
          )
        )
      )
    )
  )
);

drop policy if exists file_objects_insert_scope on public.file_objects;
create policy file_objects_insert_scope on public.file_objects
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    (
      resource_type = 'general_information_document'
      and public.is_administrator()
      and public.can_access_general_information_workspace(workspace_id)
    )
    or (
      resource_type <> 'general_information_document'
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and (
            (process_id is not null and public.has_process_access(process_id))
            or (module_id is not null and public.has_module_permission(module_id, 'create'))
          )
        )
        or external_organization_id in (select public.current_organization_ids())
      )
    )
  )
);

drop policy if exists file_objects_update_owner on public.file_objects;
create policy file_objects_update_owner on public.file_objects
for update to authenticated
using (
  public.is_administrator()
  or (resource_type <> 'general_information_document' and uploaded_by = auth.uid())
)
with check (
  public.is_administrator()
  or (resource_type <> 'general_information_document' and uploaded_by = auth.uid())
);

drop policy if exists integraq_storage_select_authorized on storage.objects;
create policy integraq_storage_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'integraq-private'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1 from public.file_objects file
      where file.bucket_id = storage.objects.bucket_id
        and file.resource_type <> 'general_information_document'
        and (file.object_path = storage.objects.name or file.preview_path = storage.objects.name)
        and (file.deleted_at is null or public.is_administrator())
    )
  )
);

revoke delete on public.document_folders from authenticated;
revoke delete on public.document_upload_batches from authenticated;
grant select, insert, update on public.document_folders to authenticated;
grant select, insert, update on public.document_upload_batches to authenticated;
grant execute on function public.can_access_general_information_workspace(uuid) to authenticated;

comment on table public.document_folders is 'Jerarquía ilimitada de carpetas para Información Documentada / Información General.';
comment on table public.document_upload_batches is 'Trazabilidad de cargas masivas de Información General.';

commit;
