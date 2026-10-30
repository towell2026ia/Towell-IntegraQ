-- HOME-FIX-02. PREPARED ONLY: execution and acceptance PENDING.
-- Depends on workspace_data, its existing organization/mode policies,
-- prepare_workspace_data and audit_workspace_data_change (already inspected).
-- Reserve only the new homeAppearance key; no existing rows are updated.
-- Apply only after approval, before enabling the appearance write endpoint.
begin;
create policy workspace_data_home_appearance_insert
on public.workspace_data as restrictive for insert to authenticated
with check (area <> 'homeAppearance' or public.is_administrator());

create policy workspace_data_home_appearance_update
on public.workspace_data as restrictive for update to authenticated
using (area <> 'homeAppearance' or public.is_administrator())
with check (area <> 'homeAppearance' or public.is_administrator());

create policy workspace_data_home_appearance_delete
on public.workspace_data as restrictive for delete to authenticated
using (area <> 'homeAppearance' or public.is_administrator());
commit;