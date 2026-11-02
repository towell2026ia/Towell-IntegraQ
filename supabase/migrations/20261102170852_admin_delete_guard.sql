-- IQ-ADMIN-DELETE-02. PROPOSAL ONLY: do not apply without an isolated RLS test.
-- No existing rows, files, policies, or functions are removed.
begin;

-- Keep historic rows intact. These nullable fields do not change existing writes.
alter table public.management_reviews add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.quality_cases add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.supplier_quality_evaluations add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.supplier_assessments add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.form_definitions add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid, add column if not exists deletion_reason text;
alter table public.form_records add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid, add column if not exists deletion_reason text;
alter table public.audit_programs add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.audit_findings add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid, add column if not exists deletion_reason text;
alter table public.organizations add column if not exists owning_organization_id uuid,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;
alter table public.measurement_assets add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid, add column if not exists deletion_reason text;

-- Restrictive policies are ANDed with *every* permissive DELETE/ALL policy.
-- Physical deletion remains closed even to admins: it needs separate explicit approval.
create policy iq_admin_delete_no_physical_corrective_actions on public.corrective_actions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_items on public.risk_items
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_form_records on public.form_records
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_form_definitions on public.form_definitions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_management_reviews on public.management_reviews
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_quality_cases on public.quality_cases
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_organizations on public.organizations
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audits on public.audits
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_programs on public.audit_programs
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_findings on public.audit_findings
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_supplier_quality_evaluations on public.supplier_quality_evaluations
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_supplier_assessments on public.supplier_assessments
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_projects on public.improvement_projects
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_measurement_assets on public.measurement_assets
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_workspace_data on public.workspace_data
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_controlled_documents on public.controlled_documents
  as restrictive for delete to authenticated using (false);

create policy iq_admin_delete_no_physical_corrective_action_a3 on public.corrective_action_a3
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_corrective_action_effectiveness_reviews on public.corrective_action_effectiveness_reviews
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_corrective_action_participants on public.corrective_action_participants
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_corrective_action_plans on public.corrective_action_plans
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_actions on public.risk_actions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_assessments on public.risk_assessments
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_effectiveness_reviews on public.risk_effectiveness_reviews
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_item_indicators on public.risk_item_indicators
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_item_processes on public.risk_item_processes
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_item_swot_sources on public.risk_item_swot_sources
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_registers on public.risk_registers
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_risk_treatments on public.risk_treatments
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_swot_items on public.swot_items
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_swot_registers on public.swot_registers
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_strategic_axes on public.strategic_axes
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_strategic_axis_indicators on public.strategic_axis_indicators
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_strategic_axis_processes on public.strategic_axis_processes
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_documents on public.audit_documents
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_finding_actions on public.audit_finding_actions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_participants on public.audit_participants
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_responses on public.audit_responses
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_series on public.audit_series
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_standard_links on public.audit_standard_links
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_template_items on public.audit_template_items
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_audit_templates on public.audit_templates
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_management_review_approvals on public.management_review_approvals
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_management_review_decisions on public.management_review_decisions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_management_review_sections on public.management_review_sections
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_management_review_sources on public.management_review_sources
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_actions on public.improvement_actions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_phases on public.improvement_phases
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_project_members on public.improvement_project_members
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_score_criteria on public.improvement_score_criteria
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_improvement_tools on public.improvement_tools
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_kaizen_reports on public.kaizen_reports
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_form_fields on public.form_fields
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_form_dashboard_definitions on public.form_dashboard_definitions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_form_dashboard_insights on public.form_dashboard_insights
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_measurement_asset_standards on public.measurement_asset_standards
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_measurement_events on public.measurement_events
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_supplier_rncp_actions on public.supplier_rncp_actions
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_supplier_quality_profiles on public.supplier_quality_profiles
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_external_company_sites on public.external_company_sites
  as restrictive for delete to authenticated using (false);
create policy iq_admin_delete_no_physical_file_objects on public.file_objects
  as restrictive for delete to authenticated using (false);

-- RLS cannot compare OLD and NEW. A row trigger guards only deletion fields,
-- leaving ordinary edits governed by the existing UPDATE policies.
create function public.iq_guard_admin_soft_delete() returns trigger
language plpgsql security invoker set search_path = '' as $guard$
declare
  before_row jsonb := to_jsonb(old);
  after_row jsonb := to_jsonb(new);
  tenant_id uuid;
  changed boolean;
  reason text;
begin
  -- A caller cannot first change the tenant reference and then delete it.
  if current_user <> 'service_role' and (
    before_row->'organization_id' is distinct from after_row->'organization_id' or
    before_row->'workspace_id' is distinct from after_row->'workspace_id' or
    before_row->'owning_organization_id' is distinct from after_row->'owning_organization_id' or
    before_row->'form_id' is distinct from after_row->'form_id' or
    before_row->'register_id' is distinct from after_row->'register_id' or
    before_row->'audit_id' is distinct from after_row->'audit_id' or
    ((before_row->>'organization_id' is null or tg_table_name = 'form_definitions') and
      before_row->'process_id' is distinct from after_row->'process_id')
  ) then
    raise exception using errcode = '42501', message = 'DELETE_SCOPE_REASSIGNMENT_ROUTE_REQUIRED';
  end if;
  changed := (before_row->'deleted_at' is distinct from after_row->'deleted_at')
    or (before_row->'deleted_by' is distinct from after_row->'deleted_by')
    or (before_row->'deletion_reason' is distinct from after_row->'deletion_reason')
    or (tg_table_name in ('organizations', 'measurement_assets')
      and before_row->>'active' = 'true' and after_row->>'active' = 'false');
  if not changed then return new; end if;

  tenant_id := nullif(before_row->>'organization_id', '')::uuid;
  if tg_table_name = 'workspace_data' then
    tenant_id := nullif(before_row->>'workspace_id', '')::uuid;
    if before_row->>'workspace_mode' is distinct from public.current_workspace_mode() and current_user <> 'service_role' then
      raise exception using errcode = '42501', message = 'DELETE_WORKSPACE_SCOPE_DENIED';
    end if;
  elsif tg_table_name = 'organizations' then
    tenant_id := nullif(before_row->>'owning_organization_id', '')::uuid;
  elsif tg_table_name in ('corrective_actions', 'audits', 'improvement_projects', 'form_definitions', 'risk_items', 'measurement_assets') and tenant_id is null then
    select p.organization_id into tenant_id from public.processes p
      where p.id = before_row->>'process_id';
    if tg_table_name = 'risk_items' then
      select p.organization_id into tenant_id from public.risk_registers r
        join public.processes p on p.id = r.process_id
        where r.id = (before_row->>'register_id')::uuid;
    end if;
  elsif tg_table_name = 'form_records' then
    select p.organization_id into tenant_id from public.form_definitions f
      join public.processes p on p.id = f.process_id
      where f.id = (before_row->>'form_id')::uuid;
  elsif tg_table_name = 'audit_findings' then
    select a.organization_id into tenant_id from public.audits a
      where a.id = (before_row->>'audit_id')::uuid;
  end if;

  -- service_role is used only by server routes that check the authenticated
  -- actor and tenant before writing. It bypasses RLS already.
  if tenant_id is null then
    raise exception using errcode = '42501', message = 'DELETE_ORGANIZATION_SCOPE_UNKNOWN';
  end if;
  if current_user <> 'service_role' and (
    not public.is_administrator() or
    not exists (select 1 from public.current_organization_ids() as membership(organization_id)
      where membership.organization_id = tenant_id)
  ) then
    raise exception using errcode = '42501', message = 'DELETE_ADMIN_SCOPE_DENIED';
  end if;

  if after_row->>'deleted_at' is not null or
    (tg_table_name in ('organizations', 'measurement_assets') and after_row->>'active' = 'false') then
    reason := nullif(btrim(after_row->>'deletion_reason'), '');
    if reason is null or after_row->>'deleted_by' is null then
      raise exception using errcode = '23514', message = 'DELETE_REASON_ACTOR_REQUIRED';
    end if;
    if current_user <> 'service_role' and (after_row->>'deleted_by')::uuid is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'DELETE_ACTOR_MISMATCH';
    end if;
  end if;
  return new;
end;
$guard$;
revoke all on function public.iq_guard_admin_soft_delete() from public, anon, authenticated;

create trigger iq_admin_delete_guard_corrective_actions before update on public.corrective_actions
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_risk_items before update on public.risk_items
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_form_records before update on public.form_records
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_form_definitions before update on public.form_definitions
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_management_reviews before update on public.management_reviews
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_quality_cases before update on public.quality_cases
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_organizations before update on public.organizations
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_audits before update on public.audits
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_audit_programs before update on public.audit_programs
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_audit_findings before update on public.audit_findings
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_supplier_quality_evaluations before update on public.supplier_quality_evaluations
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_supplier_assessments before update on public.supplier_assessments
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_improvement_projects before update on public.improvement_projects
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_measurement_assets before update on public.measurement_assets
  for each row execute function public.iq_guard_admin_soft_delete();
create trigger iq_admin_delete_guard_workspace_data before update on public.workspace_data
  for each row execute function public.iq_guard_admin_soft_delete();

-- A record inside either shared JSON workspace must never disappear as a
-- side effect of an ordinary PUT. Service routes may mark a row deleted but
-- cannot omit its original JSON entry or its related history.
create function public.iq_guard_shared_workspace_items() returns trigger
language plpgsql security invoker set search_path = '' as $guard$
declare
  item_key text;
  before_item jsonb;
  after_item jsonb;
begin
  if old.record_number not in ('RYO-WORKSPACE-2025', 'METROLOGY-WORKSPACE') then return new; end if;
  if old.record_number is distinct from new.record_number or old.form_id is distinct from new.form_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_IDENTITY_MUST_REMAIN';
  end if;
  if old.values is not distinct from new.values then return new; end if;
  foreach item_key in array case when old.record_number = 'RYO-WORKSPACE-2025'
    then array['risks','actions','axes','swotItems','contributions','directionCandidates','importIssues']
    else array['assets','reports'] end loop
    if jsonb_typeof(old.values->item_key) = 'array' then
      if jsonb_typeof(new.values->item_key) is distinct from 'array' then
        raise exception using errcode = '23514', message = 'WORKSPACE_HISTORY_MUST_REMAIN';
      end if;
      for before_item in select value from jsonb_array_elements(old.values->item_key) loop
        select element.item into after_item from jsonb_array_elements(new.values->item_key) as element(item)
          where element.item->>'id' = before_item->>'id' limit 1;
        if after_item is null then
          raise exception using errcode = '23514', message = 'WORKSPACE_HISTORY_MUST_REMAIN';
        end if;
        if item_key = 'risks' and before_item->'processId' is distinct from after_item->'processId'
          and current_user <> 'service_role' then
          raise exception using errcode = '42501', message = 'WORKSPACE_PROCESS_REASSIGNMENT_ROUTE_REQUIRED';
        end if;
        if (before_item->'deletedAt' is distinct from after_item->'deletedAt'
          or before_item->'deletedBy' is distinct from after_item->'deletedBy'
          or before_item->'deletionReason' is distinct from after_item->'deletionReason')
          and current_user <> 'service_role' then
          raise exception using errcode = '42501', message = 'WORKSPACE_DELETE_ROUTE_REQUIRED';
        end if;
        after_item := null;
      end loop;
    end if;
  end loop;
  return new;
end;
$guard$;
revoke all on function public.iq_guard_shared_workspace_items() from public, anon, authenticated;
create trigger iq_admin_delete_guard_shared_workspace before update of values, record_number, form_id on public.form_records
  for each row execute function public.iq_guard_shared_workspace_items();

-- Root2Cause sample IDs exist in code, not in corrective_actions. A shared
-- tombstone row in the existing workspace_data table is the source of truth.
create policy iq_root2cause_retirements_insert on public.workspace_data
  as restrictive for insert to authenticated with check (
    area <> 'root2causeDemoRetirements' or
    (public.is_administrator() and workspace_id in (select public.current_organization_ids())
      and workspace_mode = public.current_workspace_mode())
  );
create policy iq_root2cause_retirements_update on public.workspace_data
  as restrictive for update to authenticated using (
    area <> 'root2causeDemoRetirements' or
    (public.is_administrator() and workspace_id in (select public.current_organization_ids())
      and workspace_mode = public.current_workspace_mode())
  ) with check (
    area <> 'root2causeDemoRetirements' or
    (public.is_administrator() and workspace_id in (select public.current_organization_ids())
      and workspace_mode = public.current_workspace_mode())
  );

create function public.iq_guard_root2cause_retirements() returns trigger
language plpgsql security invoker set search_path = '' as $guard$
declare
  before_item jsonb;
  after_item jsonb;
  candidate jsonb;
begin
  if tg_op = 'UPDATE' and old.area = 'root2causeDemoRetirements' and (
    new.area is distinct from old.area or
    new.workspace_id is distinct from old.workspace_id or
    new.workspace_mode is distinct from old.workspace_mode
  ) then
    raise exception using errcode = '23514', message = 'ROOT2CAUSE_RETIRE_SCOPE_IMMUTABLE';
  end if;
  if new.area <> 'root2causeDemoRetirements' then return new; end if;
  if tg_op = 'UPDATE' and old.area <> 'root2causeDemoRetirements' then
    raise exception using errcode = '23514', message = 'ROOT2CAUSE_RETIRE_NEW_ROW_REQUIRED';
  end if;
  if not public.is_administrator() or
    not exists (select 1 from public.current_organization_ids() as membership(organization_id)
      where membership.organization_id = new.workspace_id) or
    new.workspace_mode is distinct from public.current_workspace_mode() then
    raise exception using errcode = '42501', message = 'ROOT2CAUSE_RETIRE_ADMIN_SCOPE_DENIED';
  end if;
  if jsonb_typeof(new.payload->'retirements') is distinct from 'array' then
    raise exception using errcode = '23514', message = 'ROOT2CAUSE_RETIRE_HISTORY_REQUIRED';
  end if;
  if tg_op = 'UPDATE' then
    for before_item in select value from jsonb_array_elements(coalesce(old.payload->'retirements', '[]'::jsonb)) loop
      select element.item into after_item from jsonb_array_elements(new.payload->'retirements') as element(item)
        where element.item->>'id' = before_item->>'id' limit 1;
      if after_item is distinct from before_item then
        raise exception using errcode = '23514', message = 'ROOT2CAUSE_RETIRE_HISTORY_IMMUTABLE';
      end if;
      after_item := null;
    end loop;
  end if;
  for candidate in select value from jsonb_array_elements(new.payload->'retirements') loop
    if candidate->>'id' not in ('ca-001','ca-002','ca-003') or
      nullif(btrim(candidate->>'reason'), '') is null or
      candidate->>'deletedBy' is distinct from auth.uid()::text or
      nullif(candidate->>'deletedAt', '') is null or
      (select count(*) from jsonb_array_elements(new.payload->'retirements') as entry(item)
        where entry.item->>'id' = candidate->>'id') <> 1 then
      raise exception using errcode = '23514', message = 'ROOT2CAUSE_RETIRE_ENTRY_INVALID';
    end if;
  end loop;
  return new;
end;
$guard$;
revoke all on function public.iq_guard_root2cause_retirements() from public, anon, authenticated;
create trigger iq_root2cause_retirements_guard before insert or update on public.workspace_data
  for each row execute function public.iq_guard_root2cause_retirements();

commit;
