-- Four empty image slots; no existing records or documents are changed.
begin;
create table public.home_image_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workspace_mode text not null check (workspace_mode in ('demo', 'production')),
  slot text not null check (slot in ('quality', 'environment', 'safety', 'objectives')),
  revision integer not null check (revision > 0),
  object_path text not null,
  file_name text not null,
  reason text not null check (length(trim(reason)) between 5 and 500),
  restored_from uuid references public.home_image_versions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, workspace_mode, slot, revision)
);
alter table public.home_image_versions enable row level security;
create policy home_images_read_scope on public.home_image_versions
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and p.status = 'active' and p.organization_id = home_image_versions.organization_id
    and coalesce(p.workspace_mode, 'production') = home_image_versions.workspace_mode
    and (p.user_type = 'administrator' or (p.user_type = 'internal' and public.can_view_home_section('quality-policy'))))
);
grant select on public.home_image_versions to authenticated;
revoke insert, update, delete on public.home_image_versions from authenticated, anon;
create function public.home_images_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'HOME_IMAGE_HISTORY_IMMUTABLE'; end;
$$;
create trigger home_images_history_immutable before update or delete on public.home_image_versions
for each row execute function public.home_images_immutable();

-- Dedicated private bucket. Only the secure backend uploads/signs objects.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('integraq-home-images', 'integraq-home-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']);

create policy home_images_backend_only on storage.objects as restrictive
for all to authenticated using (bucket_id <> 'integraq-home-images')
with check (bucket_id <> 'integraq-home-images');

create function public.publish_home_image(
  requested_slot text, expected_revision integer, requested_reason text,
  confirmed boolean, new_object_path text default null, new_file_name text default null,
  restore_version uuid default null
) returns public.home_image_versions
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  previous public.home_image_versions%rowtype;
  result public.home_image_versions%rowtype;
  restored public.home_image_versions%rowtype;
  workspace text;
  selected_path text;
  selected_name text;
begin
  select * into actor from public.profiles where id = auth.uid() for share;
  if actor.id is null or actor.status <> 'active' or actor.user_type <> 'administrator' or actor.organization_id is null then
    raise exception 'HOME_IMAGE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if confirmed is distinct from true or length(trim(coalesce(requested_reason, ''))) not between 5 and 500
    or requested_slot is null or requested_slot not in ('quality', 'environment', 'safety', 'objectives')
    or expected_revision is null or expected_revision < 0 then
    raise exception 'HOME_IMAGE_CONFIRMATION_REQUIRED';
  end if;
  workspace := coalesce(actor.workspace_mode, 'production');
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text || '/' || workspace || '/' || requested_slot, 0));
  select * into previous from public.home_image_versions
    where organization_id = actor.organization_id and workspace_mode = workspace and slot = requested_slot
    order by revision desc limit 1;
  if coalesce(previous.revision, 0) <> expected_revision then
    raise exception 'HOME_IMAGE_STALE_REVISION' using errcode = '40001';
  end if;
  if restore_version is not null then
    if new_object_path is not null or new_file_name is not null then raise exception 'HOME_IMAGE_INVALID_INPUT'; end if;
    select * into restored from public.home_image_versions where id = restore_version
      and organization_id = actor.organization_id and workspace_mode = workspace and slot = requested_slot;
    if restored.id is null then raise exception 'HOME_IMAGE_VERSION_NOT_FOUND'; end if;
    selected_path := restored.object_path;
    selected_name := restored.file_name;
  else
    selected_path := new_object_path;
    selected_name := new_file_name;
    if selected_path is null or selected_name is null or length(selected_name) not between 1 and 180
      or selected_path not like actor.organization_id::text || '/' || workspace || '/' || actor.id::text || '/%' then
      raise exception 'HOME_IMAGE_INVALID_PATH';
    end if;
    if exists(select 1 from public.home_image_versions where object_path = selected_path) then
      raise exception 'HOME_IMAGE_OBJECT_ALREADY_USED';
    end if;
  end if;
  if not exists(select 1 from storage.objects where bucket_id = 'integraq-home-images' and name = selected_path) then
    raise exception 'HOME_IMAGE_OBJECT_MISSING';
  end if;
  insert into public.home_image_versions(organization_id, workspace_mode, slot, revision, object_path, file_name, reason, restored_from, created_by)
  values(actor.organization_id, workspace, requested_slot, expected_revision + 1, selected_path, selected_name, trim(requested_reason), restore_version, actor.id)
  returning * into result;
  insert into public.audit_log(actor_id, action, resource_type, resource_id, previous_value, new_value, metadata)
  values(actor.id, 'home.image_published', 'home_image', result.id::text,
    case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(result),
    jsonb_build_object('reason', trim(requested_reason), 'confirmed', true));
  return result;
end;
$$;
revoke all on function public.publish_home_image(text, integer, text, boolean, text, text, uuid) from public, anon;
grant execute on function public.publish_home_image(text, integer, text, boolean, text, text, uuid) to authenticated;
commit;
