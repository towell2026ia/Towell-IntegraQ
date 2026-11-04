-- IQ-ROOT2CAUSE-ACCESS-01: proposed only. Do not apply without approval and isolated RLS tests.
-- Existing permissive SELECT policies, grants, rows, files and historical permissions remain unchanged.
begin;

-- RESTRICTIVE policies are ANDed with every existing permissive policy, including FOR ALL.
-- The own-organization check is anchored to the active administrator profile.
create policy iq_root2cause_admin_actions_insert on public.corrective_actions
  as restrictive for insert to authenticated with check (
    public.is_administrator() and exists (
      select 1 from public.profiles p where p.id = auth.uid()
        and p.organization_id = corrective_actions.organization_id
    )
  );
create policy iq_root2cause_admin_actions_update on public.corrective_actions
  as restrictive for update to authenticated using (
    public.is_administrator() and exists (
      select 1 from public.profiles p where p.id = auth.uid()
        and p.organization_id = corrective_actions.organization_id
    )
  ) with check (
    public.is_administrator() and exists (
      select 1 from public.profiles p where p.id = auth.uid()
        and p.organization_id = corrective_actions.organization_id
    )
  );
create policy iq_root2cause_admin_actions_delete on public.corrective_actions
  as restrictive for delete to authenticated using (
    public.is_administrator() and exists (
      select 1 from public.profiles p where p.id = auth.uid()
        and p.organization_id = corrective_actions.organization_id
    )
  );

-- Child rows cannot be written by viewers with legacy module update grants.
-- Every child must belong to an action in the administrator's organization.
create function public.iq_root2cause_admin_child_action(action_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $check$
  select public.is_administrator() and exists (
    select 1 from public.corrective_actions a
    join public.profiles p on p.organization_id = a.organization_id
    where a.id = action_id and p.id = auth.uid()
  );
$check$;

create policy iq_root2cause_admin_a3_insert on public.corrective_action_a3
  as restrictive for insert to authenticated with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_a3_update on public.corrective_action_a3
  as restrictive for update to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id))
  with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_a3_delete on public.corrective_action_a3
  as restrictive for delete to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id));

create policy iq_root2cause_admin_plans_insert on public.corrective_action_plans
  as restrictive for insert to authenticated with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_plans_update on public.corrective_action_plans
  as restrictive for update to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id))
  with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_plans_delete on public.corrective_action_plans
  as restrictive for delete to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id));

create policy iq_root2cause_admin_participants_insert on public.corrective_action_participants
  as restrictive for insert to authenticated with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_participants_update on public.corrective_action_participants
  as restrictive for update to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id))
  with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_participants_delete on public.corrective_action_participants
  as restrictive for delete to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id));

create policy iq_root2cause_admin_effectiveness_insert on public.corrective_action_effectiveness_reviews
  as restrictive for insert to authenticated with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_effectiveness_update on public.corrective_action_effectiveness_reviews
  as restrictive for update to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id))
  with check (public.iq_root2cause_admin_child_action(corrective_action_id));
create policy iq_root2cause_admin_effectiveness_delete on public.corrective_action_effectiveness_reviews
  as restrictive for delete to authenticated using (public.iq_root2cause_admin_child_action(corrective_action_id));

-- Attachment metadata tagged for Root2Cause also needs an administrator.
-- Other modules retain their existing file policies.
create function public.iq_root2cause_file_write_allowed(file_module text, file_type text, file_resource uuid)
returns boolean language sql stable security invoker set search_path = '' as $check$
  select case
    when file_module = 'corrective-actions' or file_type like 'corrective_action%'
      then public.is_administrator() and (
        file_resource is null or exists (
          select 1 from public.corrective_actions a
          join public.profiles p on p.organization_id = a.organization_id
          where a.id = file_resource and p.id = auth.uid()
        )
      )
    else true
  end;
$check$;

-- The customer portal exposes only explicitly shared summary fields through its API.
-- Root2Cause attachments are not published with an analysis; external accounts cannot
-- read their metadata through a direct file_objects request. Other modules are unchanged.
create policy iq_root2cause_internal_files_select on public.file_objects
  as restrictive for select to authenticated using (
    case when module_id = 'corrective-actions' or resource_type like 'corrective_action%'
      then public.is_administrator() or public.is_internal_user()
      else true
    end
  );
create policy iq_root2cause_admin_files_insert on public.file_objects
  as restrictive for insert to authenticated with check (
    public.iq_root2cause_file_write_allowed(module_id, resource_type, resource_id)
  );
create policy iq_root2cause_admin_files_update on public.file_objects
  as restrictive for update to authenticated using (
    public.iq_root2cause_file_write_allowed(module_id, resource_type, resource_id)
  ) with check (
    public.iq_root2cause_file_write_allowed(module_id, resource_type, resource_id)
  );
create policy iq_root2cause_admin_files_delete on public.file_objects
  as restrictive for delete to authenticated using (
    public.iq_root2cause_file_write_allowed(module_id, resource_type, resource_id)
  );

commit;
