-- Proposed only. Apply after 20261102170852, 20261102190001 and 20261102200001.
-- No data, existing policies, files or historical versions are changed.
begin;

-- Bypass parent RLS only to verify the active internal profile, organization,
-- module view grant and assigned process. External accounts always return false.
create function public.iq_root2cause_action_read_scope(requested_action_id uuid)
returns boolean language sql stable security definer set search_path = '' as $check$
  select exists (
    select 1 from public.corrective_actions action
    join public.profiles profile on profile.id = auth.uid()
    where action.id = requested_action_id
      and profile.status = 'active'
      and profile.user_type in ('administrator', 'internal')
      and profile.organization_id = action.organization_id
      and (
        profile.user_type = 'administrator'
        or (
          public.has_module_permission('corrective-actions', 'view')
          and (action.process_id is null or public.has_process_access(action.process_id))
        )
      )
  );
$check$;
revoke all on function public.iq_root2cause_action_read_scope(uuid) from public;
grant execute on function public.iq_root2cause_action_read_scope(uuid) to authenticated;

-- Existing permissive SELECT requires participation. Add a scoped view grant
-- for internal viewers, then AND it with every permissive SELECT and ALL policy.
-- The existing customer portal conditions remain in the permissive policies.
create policy iq_root2cause_actions_tenant_view on public.corrective_actions
  for select to authenticated using (public.iq_root2cause_action_read_scope(id));
create policy iq_root2cause_actions_tenant_select on public.corrective_actions
  as restrictive for select to authenticated using (
    not public.is_internal_user() or public.iq_root2cause_action_read_scope(id)
  );
create policy iq_root2cause_a3_tenant_view on public.corrective_action_a3
  for select to authenticated using (public.iq_root2cause_action_read_scope(corrective_action_id));
create policy iq_root2cause_a3_tenant_select on public.corrective_action_a3
  as restrictive for select to authenticated using (
    not public.is_internal_user() or public.iq_root2cause_action_read_scope(corrective_action_id)
  );
create policy iq_root2cause_plans_tenant_view on public.corrective_action_plans
  for select to authenticated using (public.iq_root2cause_action_read_scope(corrective_action_id));
create policy iq_root2cause_plans_tenant_select on public.corrective_action_plans
  as restrictive for select to authenticated using (
    not public.is_internal_user() or public.iq_root2cause_action_read_scope(corrective_action_id)
  );
create policy iq_root2cause_participants_tenant_view on public.corrective_action_participants
  for select to authenticated using (public.iq_root2cause_action_read_scope(corrective_action_id));
create policy iq_root2cause_participants_tenant_select on public.corrective_action_participants
  as restrictive for select to authenticated using (
    not public.is_internal_user() or public.iq_root2cause_action_read_scope(corrective_action_id)
  );
create policy iq_root2cause_effectiveness_tenant_view on public.corrective_action_effectiveness_reviews
  for select to authenticated using (public.iq_root2cause_action_read_scope(corrective_action_id));
create policy iq_root2cause_effectiveness_tenant_select on public.corrective_action_effectiveness_reviews
  as restrictive for select to authenticated using (
    not public.is_internal_user() or public.iq_root2cause_action_read_scope(corrective_action_id)
  );

-- Unlinked uploads remain visible only to their own active internal uploader.
create policy iq_root2cause_files_tenant_select on public.file_objects
  as restrictive for select to authenticated using (
    case when module_id = 'corrective-actions' or resource_type like 'corrective_action%'
      then case when resource_id is null
        then public.is_internal_user() and uploaded_by = auth.uid()
        else public.iq_root2cause_action_read_scope(resource_id)
      end
      else true
    end
  );

-- Storage's owner grant can bypass file_objects SELECT; inspect the file mapping
-- as definer and reject any Root2Cause object outside the actor's verified scope.
create function public.iq_root2cause_storage_read_allowed(requested_bucket text, requested_path text)
returns boolean language sql stable security definer set search_path = '' as $check$
  select auth.uid() is not null and not exists (
    select 1 from public.file_objects file
    where file.bucket_id = requested_bucket
      and (file.object_path = requested_path or file.preview_path = requested_path)
      and (file.module_id = 'corrective-actions' or file.resource_type like 'corrective_action%')
      and not (
        (file.resource_id is null and public.is_internal_user() and file.uploaded_by = auth.uid())
        or (file.resource_id is not null and public.iq_root2cause_action_read_scope(file.resource_id))
      )
  );
$check$;
revoke all on function public.iq_root2cause_storage_read_allowed(text, text) from public;
grant execute on function public.iq_root2cause_storage_read_allowed(text, text) to authenticated;
create policy iq_root2cause_storage_tenant_select on storage.objects
  as restrictive for select to authenticated using (
    public.iq_root2cause_storage_read_allowed(bucket_id, name)
  );

-- PR #19 introduces nullable ownership fields without backfilling old rows.
-- Unknown ownership fails closed; no customer or claim is reassigned here.
create policy iq_customer_internal_owner_select on public.organizations
  as restrictive for select to authenticated using (
    kind <> 'customer' or not public.is_internal_user() or exists (
      select 1 from public.profiles profile where profile.id = auth.uid()
        and profile.status = 'active' and profile.user_type in ('administrator', 'internal')
        and profile.organization_id = organizations.owning_organization_id
    )
  );
create policy iq_customer_claim_internal_owner_select on public.quality_cases
  as restrictive for select to authenticated using (
    not public.is_internal_user() or exists (
      select 1 from public.profiles profile where profile.id = auth.uid()
        and profile.status = 'active' and profile.user_type in ('administrator', 'internal')
        and profile.organization_id = quality_cases.organization_id
    )
  );

commit;
