-- Proposed only: close direct external reads of internal General Information.
-- Apply only after PR #19 and PR #20 have been validated in an isolated environment.
-- No rows, files, existing policies, grants to other modules, or historical migrations are removed.
begin;

create or replace function public.can_access_general_information_workspace(requested_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $check$
  select exists (
    select 1 from public.profiles profile
    join public.organizations workspace on workspace.id = requested_workspace_id
    where profile.id = auth.uid()
      and profile.status = 'active'
      and profile.user_type in ('administrator', 'internal')
      and profile.organization_id = requested_workspace_id
  );
$check$;

-- A restrictive policy closes access even if a permissive SELECT or ALL policy exists.
create policy iq_general_information_internal_folders_select on public.document_folders
  as restrictive for select to authenticated using (
    public.is_administrator() or public.is_internal_user()
  );
create policy iq_general_information_internal_files_select on public.file_objects
  as restrictive for select to authenticated using (
    resource_type is distinct from 'general_information_document'
    or public.is_administrator() or public.is_internal_user()
  );

-- storage.objects can grant SELECT to an owner independently of file_objects RLS.
-- A SECURITY DEFINER lookup is needed so a hidden file row cannot turn NOT EXISTS into a false allow.
create function public.iq_general_information_storage_read_allowed(requested_bucket text, requested_path text)
returns boolean language sql stable security definer set search_path = '' as $check$
  select auth.uid() is not null and (
    public.is_administrator() or public.is_internal_user()
    or not exists (
      select 1 from public.file_objects file
      where file.bucket_id = requested_bucket
        and file.resource_type = 'general_information_document'
        and (file.object_path = requested_path or file.preview_path = requested_path)
    )
  );
$check$;
revoke all on function public.iq_general_information_storage_read_allowed(text, text) from public;
grant execute on function public.iq_general_information_storage_read_allowed(text, text) to authenticated;
create policy iq_general_information_internal_storage_select on storage.objects
  as restrictive for select to authenticated using (
    public.iq_general_information_storage_read_allowed(bucket_id, name)
  );

commit;
