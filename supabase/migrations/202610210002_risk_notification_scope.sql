-- IQ-PRD-RISK-02A: keep notifications within current effective risk access.
-- Schema only: no user grants, fixtures or production data corrections.
begin;

create or replace function public.risk_notification_recipients(p_org uuid,p_mode text,p_event text,p_process text,p_owner uuid default null)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct p.id from public.profiles p join auth.users u on u.id=p.id
  where p.organization_id=p_org and p.status='active' and p.user_type in ('administrator','internal')
    and coalesce(u.raw_app_meta_data->>'workspace_mode','production')=p_mode
    and p_mode='production' and p.workspace_mode=p_mode
    and public.risk_has_access(p.id,'view')
    and (
      (p_event <> 'risk.action_due' and p.user_type='administrator')
      or (p_event not in ('risk.action_due') and exists(select 1 from public.user_process_permissions d where d.user_id=p.id and d.process_id='P-03') and public.risk_has_access(p.id,'view'))
      or (p_event='risk.analysis_started' and public.risk_has_access(p.id,'update'))
      or (p_event not in ('risk.deleted','risk.restored','risk.analysis_started','risk.action_overdue') and public.risk_has_access(p.id,'update') and exists(select 1 from public.user_process_permissions s where s.user_id=p.id and s.process_id=p_process))
      or (p_event in ('risk.action_assigned','risk.action_due','risk.action_overdue') and p.id=p_owner and public.risk_has_access(p.id,'view'))
    );
$$;

-- This policy helper checks only the authenticated actor. Permission evaluation
-- remains private; callers cannot use it to inspect another user's permissions.
create function public.can_read_risk_notification(p_organization uuid,p_mode text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=auth.uid() and p.status='active'
      and p.user_type in ('administrator','internal')
      and p.organization_id=p_organization
      and p_mode='production' and p.workspace_mode=p_mode
      and coalesce(u.raw_app_meta_data->>'workspace_mode','production')=p_mode
      and public.risk_has_access(p.id,'view')
  );
$$;
revoke all on function public.can_read_risk_notification(uuid,text) from public,anon;
grant execute on function public.can_read_risk_notification(uuid,text) to authenticated;

drop policy notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_id=auth.uid() and (
    module_id is distinct from 'risks'
    or public.can_read_risk_notification(organization_id,workspace_mode)
  ));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (recipient_id=auth.uid() and (
    module_id is distinct from 'risks'
    or public.can_read_risk_notification(organization_id,workspace_mode)
  ))
  with check (recipient_id=auth.uid() and (
    module_id is distinct from 'risks'
    or public.can_read_risk_notification(organization_id,workspace_mode)
  ));


-- A user with generic Form Builder access must not bypass the risk API.
-- Restrictive policies add this check to existing permissive form policies.
create function public.can_read_risk_workspace(p_form uuid,p_record_number text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    join public.form_definitions f on f.id=p_form
    join public.processes pr on pr.id=f.process_id
    where p.id=auth.uid() and p.status='active'
      and p.user_type in ('administrator','internal')
      and p.organization_id=pr.organization_id
      and p.workspace_mode=coalesce(u.raw_app_meta_data->>'workspace_mode','production')
      and (
        (p.workspace_mode='demo' and p_record_number='RYO-WORKSPACE-DEMO')
        or (p.workspace_mode='production' and p_record_number in ('RYO-WORKSPACE-2025','RYO-WORKSPACE-PRODUCTION'))
      )
      and public.risk_has_access(p.id,'view')
  );
$$;
revoke all on function public.can_read_risk_workspace(uuid,text) from public,anon;
grant execute on function public.can_read_risk_workspace(uuid,text) to authenticated;
create policy risk_workspace_read_scope on public.form_records
  as restrictive for select to authenticated
  using (record_number not like 'RYO-WORKSPACE-%' or public.can_read_risk_workspace(form_id,record_number));
create policy risk_workspace_no_direct_insert on public.form_records
  as restrictive for insert to authenticated
  with check (record_number not like 'RYO-WORKSPACE-%');
create policy risk_workspace_no_direct_update on public.form_records
  as restrictive for update to authenticated
  using (record_number not like 'RYO-WORKSPACE-%')
  with check (record_number not like 'RYO-WORKSPACE-%');

create or replace function public.guard_risk_workspace_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.record_number like 'RYO-WORKSPACE-%' then
    if tg_op='DELETE' then raise exception 'Risk workspace history cannot be physically deleted'; end if;
    if new.record_number is distinct from old.record_number or new.form_id is distinct from old.form_id then
      raise exception 'Risk workspace identity is immutable';
    end if;
    if new.values is distinct from old.values and coalesce(current_setting('integraq.risk_write',true),'') <> 'authorized' then
      raise exception 'Use the risk workspace transaction';
    end if;
  end if;
  return new;
end;
$$;
commit;
