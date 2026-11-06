-- Read-only snapshot of existing trigger bodies. Only ephemeral synthetic CI uses this file.
create type public.notification_status as enum('unread','read','dismissed');
create type public.permission_source as enum('position','direct','system');
create table public.integration_outbox(
 "id" uuid default gen_random_uuid() not null primary key,
 "event_type" text not null,
 "resource_type" text not null,
 "resource_id" uuid,
 "recipient_email" text,
 "payload" jsonb default '{}'::jsonb not null,
 "status" text default 'pending'::text not null,
 "attempts" integer default 0 not null,
 "available_at" timestamp with time zone default now() not null,
 "processed_at" timestamp with time zone,
 "last_error" text,
 "created_at" timestamp with time zone default now() not null
);
create table public.notifications(
 "id" uuid default gen_random_uuid() not null primary key,
 "recipient_id" uuid not null,
 "title" text not null,
 "message" text not null,
 "module_id" text,
 "resource_type" text,
 "resource_id" uuid,
 "status" public.notification_status default 'unread'::notification_status not null,
 "action_url" text,
 "created_at" timestamp with time zone default now() not null,
 "read_at" timestamp with time zone
);
create table public.user_module_permissions(
 "user_id" uuid not null,
 "module_id" text not null,
 "can_view" boolean default true not null,
 "can_manage" boolean default false not null,
 "source" public.permission_source default 'direct'::permission_source not null,
 "inherited_from_position_id" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
create table public.supplier_assessments(id uuid primary key,supplier_id uuid,site_id uuid);
create function public.current_user_type() returns public.app_user_type language sql stable security definer set search_path='' as $$ select user_type from public.profiles where id=auth.uid() and status='active' $$;
create function public.is_internal_user() returns boolean language sql stable as $$ select public.current_user_type() in ('administrator','internal') $$;
alter table public.file_objects add constraint external_file_scope CHECK (((audience = 'internal'::file_audience) OR (external_organization_id IS NOT NULL)));
alter table public.file_objects add constraint file_objects_general_reference_check CHECK (((resource_type <> 'general_information_document'::text) OR (reference_type = ANY (ARRAY['internal'::text, 'external'::text]))));
alter table public.file_objects add constraint file_objects_general_scope_check CHECK (((resource_type <> 'general_information_document'::text) OR ((workspace_id IS NOT NULL) AND (folder_id IS NOT NULL) AND (display_name IS NOT NULL))));
alter table public.file_objects add constraint file_objects_general_valid_dates_check CHECK (((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_from <= valid_until)));
alter table public.file_objects add constraint file_objects_general_validity_check CHECK (((resource_type <> 'general_information_document'::text) OR (validity_status = ANY (ARRAY['current'::text, 'not_current'::text]))));
alter table public.file_objects add constraint file_objects_preview_ready_path_check CHECK (((preview_status <> 'ready'::text) OR (preview_path IS NOT NULL)));
alter table public.file_objects add constraint file_objects_preview_status_check CHECK ((preview_status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'error'::text, 'not_required'::text])));
alter table public.file_objects add constraint file_objects_size_bytes_check CHECK (((size_bytes IS NULL) OR (size_bytes >= 0)));
alter table public.file_objects add constraint file_objects_soft_delete_actor_check CHECK (((deleted_at IS NULL) OR (deleted_by IS NOT NULL)));
alter table public.file_objects add constraint file_objects_version_positive CHECK ((version > 0));
alter table public.supplier_rncp_reports add constraint supplier_rncp_reports_lifecycle_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'in_progress'::text, 'closed'::text])));
alter table public.supplier_rncp_reports add constraint supplier_rncp_reports_rejected_quantity_check CHECK (((rejected_quantity IS NULL) OR (rejected_quantity >= (0)::numeric)));
alter table public.supplier_rncp_reports add constraint supplier_rncp_reports_soft_delete_check CHECK ((((deleted_at IS NULL) AND (deleted_by IS NULL) AND (delete_reason IS NULL)) OR ((deleted_at IS NOT NULL) AND (deleted_by IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM delete_reason), ''::text) IS NOT NULL))));
CREATE OR REPLACE FUNCTION public.audit_general_information_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.audit_supplier_rncp_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_report public.supplier_rncp_reports%rowtype;
begin
  select * into selected_report from public.supplier_rncp_reports where id = new.report_id;
  if tg_op = 'INSERT' then
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (coalesce(auth.uid(), new.created_by), 'suppliers', 'rncp.action_added', 'supplier_rncp_report', new.report_id::text,
      selected_report.folio, jsonb_build_object('action_id', new.id, 'description', new.description),
      jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id));
  end if;
  if new.evidence_file_id is not null and (tg_op = 'INSERT' or old.evidence_file_id is null) then
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (coalesce(auth.uid(), new.created_by), 'suppliers', 'rncp.evidence_added', 'supplier_rncp_report', new.report_id::text,
      selected_report.folio, jsonb_build_object('action_id', new.id, 'evidence_file_id', new.evidence_file_id),
      jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id));
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.audit_supplier_rncp_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_report public.supplier_rncp_reports%rowtype;
  selected_file public.file_objects%rowtype;
begin
  select report.* into selected_report
  from public.supplier_rncp_reports report
  join public.supplier_rncp_actions action on action.report_id = report.id
  where action.id = new.action_id;
  select * into selected_file from public.file_objects where id = new.file_id;
  insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
  values (
    new.created_by, 'suppliers', 'rncp.evidence_added', 'supplier_rncp_report', selected_report.id::text,
    selected_report.folio, jsonb_build_object('action_id', new.action_id, 'file_id', new.file_id, 'file_name', selected_file.original_name),
    jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id)
  );
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.audit_workspace_data_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  audit_action text;
begin
  audit_action := case
    when tg_op = 'INSERT' then 'CREATE'
    when old.deleted_at is null and new.deleted_at is not null then 'DELETE'
    when old.deleted_at is not null and new.deleted_at is null then 'RESTORE'
    else 'UPDATE'
  end;

  insert into public.audit_log (
    actor_id,
    organization_id,
    module,
    action,
    resource_type,
    resource_id,
    previous_value,
    new_value,
    reason,
    metadata
  ) values (
    auth.uid(),
    new.workspace_id,
    new.area,
    audit_action,
    'workspace_data',
    new.id::text,
    case when tg_op = 'UPDATE' then old.payload else null end,
    new.payload,
    new.deletion_reason,
    jsonb_build_object(
      'workspace_mode', new.workspace_mode,
      'revision', new.revision,
      'deleted_at', new.deleted_at
    )
  );
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.guard_supplier_action_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  report_status text;
  report_deleted_at timestamptz;
begin
  select status, deleted_at into report_status, report_deleted_at
  from public.supplier_rncp_reports where id = new.report_id;
  if report_status is null or report_deleted_at is not null or report_status = 'closed' then
    raise exception using errcode = '22023', message = 'RNCP_ACTIONS_LOCKED';
  end if;
  if public.current_user_type() = 'supplier' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      if new.report_id <> old.report_id
        or new.due_date <> old.due_date
        or new.validated_by is distinct from old.validated_by
        or new.validated_at is distinct from old.validated_at
        or new.validation_comment is distinct from old.validation_comment then
        raise exception using errcode = '42501', message = 'RNCP_ACTION_CONTROL_FORBIDDEN';
      end if;
      new.created_by := old.created_by;
    end if;
    if new.status not in ('pending', 'in_progress', 'submitted') then
      raise exception using errcode = '42501', message = 'RNCP_ACTION_STATUS_FORBIDDEN';
    end if;
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.guard_supplier_assessment_file_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_assessment public.supplier_assessments%rowtype;
begin
  if tg_op = 'UPDATE' and (
    old.resource_type = 'supplier_assessment_source'
    or new.resource_type = 'supplier_assessment_source'
  ) and not public.is_administrator() then
    raise exception using errcode = '42501', message = 'SUPPLIER_ASSESSMENT_FILE_IMMUTABLE';
  end if;
  if new.resource_type <> 'supplier_assessment_source' then return new; end if;
  if auth.uid() is null then return new; end if;
  if not (
    public.is_administrator()
    or (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_ASSESSMENT_FILE_FORBIDDEN';
  end if;
  select * into selected_assessment from public.supplier_assessments where id = new.resource_id;
  if selected_assessment.id is null
    or new.module_id <> 'suppliers'
    or new.external_organization_id is distinct from selected_assessment.supplier_id
    or new.external_site_id is distinct from selected_assessment.site_id
    or not exists (
      select 1 from public.file_upload_policies policy
      where policy.resource_type = 'supplier_assessment_source'
        and new.size_bytes between 1 and policy.max_size_bytes
        and new.mime_type = any(policy.allowed_mime_types)
    ) then
    raise exception using errcode = '23514', message = 'SUPPLIER_ASSESSMENT_FILE_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.iq_guard_certification_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user<>'service_role' and old.resource_type='customer_certification_document' then
    raise exception using errcode='42501',message='CERTIFICATION_SERVER_COMMAND_REQUIRED';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.iq_guard_claim_reclassification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user<>'service_role' then
    if tg_table_name='quality_cases' and to_jsonb(old)->>'kind'='claim' then
      raise exception using errcode='42501',message='CLAIM_SERVER_COMMAND_REQUIRED';
    elsif tg_table_name='file_objects' and to_jsonb(old)->>'resource_type'='customer_claim_evidence' then
      raise exception using errcode='42501',message='CLAIM_EVIDENCE_SERVER_COMMAND_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.notify_supplier_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  report_folio text;
begin
  if new.status <> 'submitted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select folio into report_folio
  from public.supplier_rncp_reports where id = new.report_id;

  insert into public.notifications (
    recipient_id, title, message, module_id, resource_type, resource_id, action_url
  )
  select distinct p.id,
    'Respuesta de proveedor recibida',
    'El proveedor actualizó acciones o evidencias del RNCP ' || report_folio || '.',
    'suppliers', 'supplier_rncp_report', new.report_id,
    '/#suppliers'
  from public.profiles p
  join public.user_module_permissions m on m.user_id = p.id
  where p.status = 'active' and m.module_id = 'suppliers' and m.can_view;

  insert into public.integration_outbox (
    event_type, resource_type, resource_id, payload
  ) values (
    'supplier_response_submitted', 'supplier_rncp_report', new.report_id,
    jsonb_build_object('folio', report_folio, 'action_id', new.id)
  );
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.prepare_workspace_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    if new.workspace_id is distinct from old.workspace_id
      or new.workspace_mode is distinct from old.workspace_mode
      or new.area is distinct from old.area then
      raise exception using errcode = '42501', message = 'WORKSPACE_IDENTITY_IMMUTABLE';
    end if;
    if (
      new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by
      or new.deletion_reason is distinct from old.deletion_reason
    ) and not public.is_administrator() then
      raise exception using errcode = '42501', message = 'ADMIN_REQUIRED_FOR_SOFT_DELETE';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.validate_external_company_site()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requested_site_id uuid;
  requested_company_id uuid;
begin
  requested_site_id := nullif(coalesce(to_jsonb(new)->>'external_site_id', to_jsonb(new)->>'site_id'), '')::uuid;
  requested_company_id := nullif(coalesce(to_jsonb(new)->>'external_party_id', to_jsonb(new)->>'external_organization_id', to_jsonb(new)->>'supplier_id'), '')::uuid;
  if requested_site_id is not null and not exists (
    select 1 from public.external_company_sites site
    where site.id = requested_site_id and site.company_id = requested_company_id
  ) then
    raise exception using errcode = '23514', message = 'EXTERNAL_SITE_COMPANY_MISMATCH';
  end if;
  return new;
end;
$function$;
CREATE TRIGGER file_objects_guard_supplier_assessment_scope BEFORE INSERT OR UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION guard_supplier_assessment_file_scope();
CREATE TRIGGER file_objects_set_updated_at BEFORE UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER file_objects_validate_external_site BEFORE INSERT OR UPDATE OF external_organization_id, external_site_id ON public.file_objects FOR EACH ROW EXECUTE FUNCTION validate_external_company_site();
CREATE TRIGGER general_information_documents_audit AFTER INSERT OR UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION audit_general_information_change();
CREATE TRIGGER iq_certification_file_guard BEFORE UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION iq_guard_certification_file();
CREATE TRIGGER iq_claim_file_reclassification_guard BEFORE UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION iq_guard_claim_reclassification();
CREATE TRIGGER supplier_rncp_evidence_audit AFTER INSERT ON public.supplier_rncp_action_evidence FOR EACH ROW EXECUTE FUNCTION audit_supplier_rncp_evidence();
CREATE TRIGGER supplier_action_guard BEFORE INSERT OR UPDATE ON public.supplier_rncp_actions FOR EACH ROW EXECUTE FUNCTION guard_supplier_action_update();
CREATE TRIGGER supplier_response_notify AFTER INSERT OR UPDATE OF status ON public.supplier_rncp_actions FOR EACH ROW EXECUTE FUNCTION notify_supplier_response();
CREATE TRIGGER supplier_rncp_action_audit AFTER INSERT OR UPDATE OF evidence_file_id ON public.supplier_rncp_actions FOR EACH ROW EXECUTE FUNCTION audit_supplier_rncp_action();
CREATE TRIGGER supplier_rncp_actions_set_updated_at BEFORE UPDATE ON public.supplier_rncp_actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER supplier_rncp_reports_set_updated_at BEFORE UPDATE ON public.supplier_rncp_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER supplier_rncp_validate_site BEFORE INSERT OR UPDATE OF supplier_id, site_id ON public.supplier_rncp_reports FOR EACH ROW EXECUTE FUNCTION validate_external_company_site();
CREATE TRIGGER workspace_data_audit AFTER INSERT OR UPDATE ON public.workspace_data FOR EACH ROW EXECUTE FUNCTION audit_workspace_data_change();
CREATE TRIGGER workspace_data_prepare BEFORE INSERT OR UPDATE ON public.workspace_data FOR EACH ROW EXECUTE FUNCTION prepare_workspace_data();
