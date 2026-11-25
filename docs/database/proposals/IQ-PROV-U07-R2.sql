-- IntegraQ U07-R2. Approved target: yptrqowmviixlkrxjrqr. Pending installation authorization.

BEGIN;

-- IQ-PROV-CONTACTOS-LEGACY-GUARD.sql | SHA-256 17ed8ae38888bf2af9fae4de205c343bf9516d407f39759d2b71609e5a54334d

create function public.iq_supplier_audit_contact_collection_guard()
returns trigger language plpgsql set search_path = '' as $$
declare previous_contact jsonb;
begin
  if old.kind = 'supplier'
    and jsonb_typeof(old.metadata #> '{supplierQualityContacts,contacts}') = 'array'
    and jsonb_array_length(old.metadata #> '{supplierQualityContacts,contacts}') > 0 then
    if jsonb_typeof(new.metadata #> '{supplierQualityContacts,contacts}') is distinct from 'array' then
      raise exception using errcode = '23514', message = 'AUDIT_CONTACTS_MISSING';
    end if;
    for previous_contact in
      select value from jsonb_array_elements(old.metadata #> '{supplierQualityContacts,contacts}')
    loop
      if jsonb_typeof(previous_contact->'id') is distinct from 'string'
        or not exists (
          select 1 from jsonb_array_elements(new.metadata #> '{supplierQualityContacts,contacts}') as current_contact(value)
          where current_contact.value->>'id' = previous_contact->>'id'
        ) then
        raise exception using errcode = '23514', message = 'AUDIT_CONTACTS_MISSING';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger supplier_audit_contact_collection_guard
before update on public.organizations for each row
execute function public.iq_supplier_audit_contact_collection_guard();

create function public.iq_supplier_audit_contact_log_guard()
returns trigger language plpgsql set search_path = '' as $$
declare supplier_metadata jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.action = 'supplier.contacts.updated' then
      raise exception using errcode = '42501', message = 'AUDIT_CONTACT_LOG_IMMUTABLE';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.action = 'supplier.contacts.updated' then
      raise exception using errcode = '42501', message = 'AUDIT_CONTACT_LOG_RPC_ONLY';
    end if;
    return new;
  end if;
  if new.action <> 'supplier.contacts.updated' then return new; end if;
  if current_user <> 'postgres' or new.actor_id is distinct from auth.uid()
    or new.module is distinct from 'suppliers' or new.resource_type is distinct from 'supplier'
    or new.resource_id is null then
    raise exception using errcode = '42501', message = 'AUDIT_CONTACT_LOG_RPC_ONLY';
  end if;
  select o.metadata->'supplierQualityContacts' into supplier_metadata
    from public.organizations o where o.id::text = new.resource_id and o.kind = 'supplier';
  if supplier_metadata is null or new.new_value is distinct from supplier_metadata then
    raise exception using errcode = '42501', message = 'AUDIT_CONTACT_LOG_SNAPSHOT';
  end if;
  return new;
end $$;

create trigger supplier_audit_contact_log_guard
before insert or update or delete on public.audit_log for each row
execute function public.iq_supplier_audit_contact_log_guard();

revoke all on function public.iq_supplier_audit_contact_collection_guard() from public, anon, authenticated;
revoke all on function public.iq_supplier_audit_contact_log_guard() from public, anon, authenticated;

-- IQ-PROV-CONTACTOS-MULTIPLES.sql | SHA-256 05586ddaac78d96c7b65918ec06caadf0524cea31366af353396c83de43d771e

create function public.iq_supplier_audit_contacts_v2(
  p_supplier uuid, p_contacts jsonb, p_expected_updated_at timestamptz, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  selected_org uuid := public.iq_supplier_audit_org();
  company public.organizations%rowtype;
  item jsonb;
  existing_item jsonb;
  normalized jsonb := '[]'::jsonb;
  seen_ids text[] := array[]::text[];
  seen_emails text[] := array[]::text[];
  contact_id text;
  contact_email text;
  old_contacts jsonb;
  safe_contacts jsonb;
begin
  if not public.has_module_permission('suppliers', 'update') or not (
    public.iq_supplier_audit_inspector(selected_org) or exists (
      select 1 from public.profiles p where p.id = auth.uid()
        and p.organization_id = selected_org and p.status = 'active'
        and p.workspace_mode = 'production' and p.user_type = 'administrator'
    )
  ) then raise exception using errcode = '42501', message = 'AUDIT_CONTACTS_DENIED'; end if;

  if not public.iq_supplier_audit_supplier_allowed(p_supplier, selected_org) then
    raise exception using errcode = '42501', message = 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED';
  end if;
  select * into company from public.organizations
    where id = p_supplier and kind = 'supplier' and active for update;
  if company.id is null or not public.iq_supplier_audit_supplier_allowed(p_supplier, selected_org) then
    raise exception using errcode = '42501', message = 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED';
  end if;
  if company.updated_at is distinct from p_expected_updated_at then raise exception 'AUDIT_CONFLICT'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 2000
    or jsonb_typeof(p_contacts) is distinct from 'object'
    or jsonb_typeof(p_contacts->'contacts') is distinct from 'array'
    or (p_contacts - 'contacts') <> '{}'::jsonb then
    raise exception 'AUDIT_CONTACTS_INVALID';
  end if;

  for item in select value from jsonb_array_elements(p_contacts->'contacts') loop
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['id','name','position','email','phone','purpose','notifyRncp','retired'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string'
      or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'position') is distinct from 'string'
      or jsonb_typeof(item->'email') is distinct from 'string'
      or jsonb_typeof(item->'phone') is distinct from 'string'
      or jsonb_typeof(item->'purpose') is distinct from 'string'
      or jsonb_typeof(item->'notifyRncp') is distinct from 'boolean'
      or (item ? 'retired' and jsonb_typeof(item->'retired') is distinct from 'boolean')
      or (item->'retired' = 'true'::jsonb and item->'notifyRncp' = 'true'::jsonb)
      or length(item->>'name') > 500 or length(item->>'position') > 500
      or length(item->>'email') > 500 or length(item->>'phone') > 500
      or length(item->>'purpose') > 500 then raise exception 'AUDIT_CONTACTS_INVALID'; end if;
    contact_id := item->>'id';
    contact_email := lower(trim(item->>'email'));
    if contact_id !~* '^(legacy-primary|legacy-alternate|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
      or trim(item->>'name') = '' then raise exception 'AUDIT_CONTACTS_INVALID'; end if;
    if contact_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      then raise exception 'AUDIT_EMAIL_INVALID'; end if;
    if contact_id = any(seen_ids) or contact_email = any(seen_emails) then
      raise exception 'AUDIT_CONTACTS_DUPLICATE';
    end if;
    seen_ids := array_append(seen_ids, contact_id);
    seen_emails := array_append(seen_emails, contact_email);
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'id', contact_id, 'name', trim(item->>'name'), 'position', trim(item->>'position'),
      'email', contact_email, 'phone', trim(item->>'phone'),
      'purpose', trim(item->>'purpose'), 'notifyRncp', item->'notifyRncp', 'retired', coalesce(item->'retired','false'::jsonb)
    ));
  end loop;

  if not public.iq_supplier_contacts_ready() then raise exception 'AUDIT_CONTACTS_GUARD_REQUIRED'; end if;
  old_contacts := coalesce(company.metadata->'supplierQualityContacts', '{}'::jsonb);
  if jsonb_typeof(old_contacts) is distinct from 'object' then raise exception 'AUDIT_CONTACTS_INVALID'; end if;
  if old_contacts ? 'contacts' and jsonb_typeof(old_contacts->'contacts') is distinct from 'array' then raise exception 'AUDIT_CONTACTS_INVALID'; end if;
  for existing_item in select value from jsonb_array_elements(coalesce(old_contacts->'contacts', '[]'::jsonb)) loop
    if jsonb_typeof(existing_item->'id') is distinct from 'string'
      or not ((existing_item->>'id') = any(seen_ids)) then raise exception 'AUDIT_CONTACTS_MISSING'; end if;
  end loop;
  safe_contacts := jsonb_set(old_contacts, '{contacts}', normalized, true);
  safe_contacts := jsonb_set(safe_contacts, '{updatedBy}', to_jsonb(auth.uid()), true);
  update public.organizations set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb),
    '{supplierQualityContacts}', safe_contacts, true), updated_at = now() where id = p_supplier;
  insert into public.audit_log(actor_id, organization_id, module, action, resource_type,
    resource_id, previous_value, new_value, reason, user_name_snapshot, metadata)
  select p.id, selected_org, 'suppliers', 'supplier.contacts.updated', 'supplier',
    p_supplier::text, old_contacts, safe_contacts, p_reason, p.full_name,
    jsonb_build_object('delivery', 'disabled', 'externalPublication', false)
  from public.profiles p where p.id = auth.uid() and p.status = 'active';
end $$;

revoke all on function public.iq_supplier_audit_contacts_v2(uuid,jsonb,timestamptz,text) from public, anon;
grant execute on function public.iq_supplier_audit_contacts_v2(uuid,jsonb,timestamptz,text) to authenticated;
create function public.iq_supplier_contacts_ready() returns boolean
language sql stable security invoker set search_path = '' as $$
  select has_function_privilege('authenticated', 'public.iq_supplier_audit_contacts_v2(uuid,jsonb,timestamptz,text)', 'EXECUTE')
    and exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.organizations'::regclass
      and tgname='supplier_audit_contact_collection_guard' and tgenabled in ('O','A'))
    and exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.audit_log'::regclass
      and tgname='supplier_audit_contact_log_guard' and tgenabled in ('O','A'));
$$;
revoke all on function public.iq_supplier_contacts_ready() from public, anon;
grant execute on function public.iq_supplier_contacts_ready() to authenticated;

-- IQ-PROV-MEJORAS-02-audit-withdrawal.sql | SHA-256 74650c67a6318940260d2f5b6f3ac63311717bae2efb1a4fba814554b8725970

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
  if to_regprocedure('public.iq_supplier_audit_save(uuid,integer,jsonb,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_save(uuid,integer,jsonb,text)'))) is distinct from '9a48effba6c53ce5395a9bb7258d67a9' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_save'; end if;
  if to_regprocedure('public.iq_supplier_audit_file(uuid,integer,jsonb)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_file(uuid,integer,jsonb)'))) is distinct from 'e941c76fc18c939527ddee147cacac7e' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_file'; end if;
  if to_regprocedure('public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text)'))) is distinct from 'ae49f78bfca8544c4a961fd406a3d996' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_result'; end if;
  if to_regprocedure('public.iq_supplier_audit_context()') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_context()'))) is distinct from '7a684208dd2dccc5dd51243a075e44a5' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_context'; end if;
  if to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)'))) is distinct from 'd07864f7f1ffcfab7b5c6931834e7d98' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_log'; end if;
  if to_regprocedure('public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text)') is not null then
    raise exception 'AUDIT_WITHDRAWAL_ALREADY_INSTALLED_REVIEW_REQUIRED';
  end if;
END;
$preflight$;

ALTER TABLE public.supplier_audit_events
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdrawn_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN withdrawal_reason text,
  ADD CONSTRAINT supplier_audit_withdrawal_complete CHECK (
    (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL
      AND char_length(btrim(withdrawal_reason)) BETWEEN 5 AND 2000)
  );

CREATE FUNCTION public.iq_supplier_audit_set_withdrawn(
  p_event uuid, p_expected_revision integer, p_withdrawn boolean, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $withdraw$
DECLARE
  selected_org uuid := public.iq_supplier_audit_org();
  previous public.supplier_audit_events%rowtype;
  saved public.supplier_audit_events%rowtype;
  reason text := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  action_name text;
BEGIN
  -- Fresh authorization before a row lock, even for direct RPC calls.
  if not public.iq_supplier_audit_inspector(selected_org) or not exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=selected_org
      and p.user_type='administrator' and p.status='active' and p.workspace_mode='production'
  ) then raise exception using errcode='42501', message='AUDIT_ADMIN_REQUIRED'; end if;
  if p_event is null or p_expected_revision is null or p_expected_revision<1 or p_withdrawn is null then
    raise exception 'AUDIT_WITHDRAWAL_INPUT';
  end if;
  if reason is null or char_length(reason) not between 5 and 2000 then raise exception 'AUDIT_WITHDRAWAL_REASON'; end if;
  select * into previous from public.supplier_audit_events
    where id=p_event and organization_id=selected_org for update;
  if not found then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
  if previous.revision is distinct from p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if (previous.withdrawn_at is not null)=p_withdrawn then raise exception 'AUDIT_WITHDRAWAL_TRANSITION'; end if;
  update public.supplier_audit_events set
    withdrawn_at=case when p_withdrawn then now() else null end,
    withdrawn_by=case when p_withdrawn then auth.uid() else null end,
    withdrawal_reason=case when p_withdrawn then reason else null end,
    revision=revision+1, updated_at=now(), updated_by=auth.uid()
    where id=previous.id and organization_id=selected_org returning * into saved;
  action_name:=case when p_withdrawn then 'audit.withdrawn' else 'audit.restored' end;
  perform public.iq_supplier_audit_log(action_name,saved.id,to_jsonb(previous),to_jsonb(saved),reason);
  -- The existing helper can insert zero rows if a profile becomes inactive: fail atomically.
  if not exists(select 1 from public.audit_log l where l.resource_type='supplier_audit_event'
    and l.resource_id=saved.id::text and l.organization_id=selected_org and l.actor_id=auth.uid()
    and l.action=action_name and l.reason=reason
    and l.previous_value=to_jsonb(previous) and l.new_value=to_jsonb(saved))
  then raise exception 'AUDIT_WITHDRAWAL_LOG_REQUIRED'; end if;
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'withdrawn_at',saved.withdrawn_at);
END;
$withdraw$;
ALTER FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) TO authenticated;

-- Existing iq_supplier_audit_save: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_save(p_id uuid, p_expected_revision integer, p_payload jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); previous public.supplier_audit_events%rowtype; saved public.supplier_audit_events%rowtype; selected_supplier uuid; selected_state text; selected_precision text;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 if p_id is not null then
  select * into previous from public.supplier_audit_events where id=p_id and organization_id=selected_org for update;
  if previous.id is null then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
  if previous.revision is distinct from p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if previous.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if previous.state='completed' then raise exception 'AUDIT_FINALIZED_USE_RESULT_CORRECTION'; end if;
 end if;
 selected_supplier:=nullif(p_payload->>'supplierId','')::uuid;
 if selected_supplier is null or not public.iq_supplier_audit_supplier_allowed(selected_supplier,selected_org) then raise exception 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; end if;
 if not exists(select 1 from public.organizations where id=selected_supplier and active) then raise exception 'AUDIT_SUPPLIER_INACTIVE'; end if;
 if previous.supplier_id is not null and selected_supplier<>previous.supplier_id then raise exception 'AUDIT_SUPPLIER_IMMUTABLE'; end if;
 if previous.supplier_id is null and previous.id is not null and exists(select 1 from public.file_objects where resource_id=previous.id and resource_type in ('supplier_audit_report','supplier_audit_action_plan')) then raise exception 'AUDIT_RECONCILIATION_BLOCKED'; end if;
 selected_state:=coalesce(p_payload->>'state','scheduled'); selected_precision:=p_payload->>'precision';
 if selected_state not in ('scheduled','confirmed','rescheduled','pending','cancelled','performed') then raise exception 'AUDIT_STATE_INVALID'; end if;
 if previous.id is null and selected_state not in ('scheduled','confirmed','pending') then raise exception 'AUDIT_INITIAL_STATE_INVALID'; end if;
 if selected_state='confirmed' and selected_precision<>'date' then raise exception 'AUDIT_EXACT_DATE_REQUIRED'; end if;
 if previous.id is not null and selected_state<>'cancelled' and previous.actual_date is not null and nullif(p_payload->>'actualDate','')::date is distinct from previous.actual_date and previous.source_sha256 is not null then raise exception 'AUDIT_HISTORICAL_ACTUAL_DATE_IMMUTABLE'; end if;
 if selected_state='performed' and (nullif(p_payload->>'actualDate','') is null or (not (previous.source_sha256 is not null and previous.actual_date is not null and previous.state='performed') and not exists(select 1 from public.file_objects f join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path where f.resource_id=previous.id and f.resource_type='supplier_audit_report' and f.is_current and f.deleted_at is null))) then raise exception 'AUDIT_ACTUAL_DATE_AND_REPORT_REQUIRED'; end if;
 if previous.source_sha256 is not null and previous.state='performed' and nullif(p_payload->>'actualDate','')::date is distinct from previous.actual_date then raise exception 'AUDIT_HISTORICAL_ACTUAL_DATE_IMMUTABLE'; end if;
 if previous.id is null then
  insert into public.supplier_audit_events(organization_id,supplier_id,calendar_year,calendar_month,date_precision,planned_date,week_start,state,criteria,audit_method,responsible_names,observations,created_by,updated_by)
  values(selected_org,selected_supplier,(p_payload->>'year')::int,(p_payload->>'month')::int,selected_precision,nullif(p_payload->>'plannedDate','')::date,nullif(p_payload->>'weekStart','')::date,selected_state,
   coalesce(p_payload->>'criteria',''),coalesce(p_payload->>'method',''),coalesce(p_payload->>'responsible',''),coalesce(p_payload->>'observations',''),auth.uid(),auth.uid()) returning * into saved;
 else
  update public.supplier_audit_events set supplier_id=selected_supplier,calendar_year=(p_payload->>'year')::int,calendar_month=(p_payload->>'month')::int,date_precision=selected_precision,
   planned_date=nullif(p_payload->>'plannedDate','')::date,week_start=nullif(p_payload->>'weekStart','')::date,actual_date=coalesce(previous.actual_date,nullif(p_payload->>'actualDate','')::date),state=selected_state,
   criteria=coalesce(p_payload->>'criteria',''),audit_method=coalesce(p_payload->>'method',''),responsible_names=coalesce(p_payload->>'responsible',''),observations=coalesce(p_payload->>'observations',''),
   revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=previous.id returning * into saved;
 end if;
 if saved.actual_date>current_date then raise exception 'AUDIT_ACTUAL_DATE_IN_FUTURE'; end if;
 perform public.iq_supplier_audit_log(case when previous.id is null then 'audit.created' when saved.state='cancelled' then 'audit.cancelled' when saved.planned_date is distinct from previous.planned_date or saved.week_start is distinct from previous.week_start then 'audit.rescheduled' else 'audit.updated' end,saved.id,to_jsonb(previous),to_jsonb(saved),p_reason);
 return saved.id;
end $function$;

-- Existing iq_supplier_audit_file: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_file(p_event uuid, p_revision integer, p_file jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); event_row public.supplier_audit_events%rowtype; file_id uuid; previous_file uuid; next_version integer; selected_type text:=p_file->>'type'; selected_path text:=p_file->>'path';
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into event_row from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if event_row.id is null or event_row.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(event_row.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if event_row.revision is distinct from p_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if event_row.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
 if event_row.state='cancelled' then raise exception 'AUDIT_CANCELLED'; end if;
 if length(trim(coalesce(p_file->>'reason','')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
 if coalesce(selected_type,'') not in ('supplier_audit_report','supplier_audit_action_plan') or p_file->>'mime' is distinct from 'application/pdf' or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$'
 or not exists(select 1 from public.file_upload_policies where resource_type=selected_type and (p_file->>'size')::bigint between 1 and least(max_size_bytes,4194304) and 'application/pdf'=any(allowed_mime_types))
 or selected_path not like auth.uid()::text||'/supplier-audits/'||p_event::text||'/%'
 or not exists(select 1 from storage.objects o where o.bucket_id='integraq-private' and o.name=selected_path and (o.metadata->>'size')::bigint=(p_file->>'size')::bigint and o.metadata->>'mimetype'='application/pdf')
 then raise exception 'AUDIT_FILE_INVALID'; end if;
 select id into file_id from public.file_objects where resource_id=p_event and resource_type=selected_type and sha256=p_file->>'sha256' and deleted_at is null limit 1;
 if file_id is not null then return file_id; end if;
 select id into previous_file from public.file_objects where resource_id=p_event and resource_type=selected_type and is_current order by version desc limit 1;
 select coalesce(max(version),0)+1 into next_version from public.file_objects where resource_id=p_event and resource_type=selected_type;
 update public.file_objects set is_current=false,updated_at=now() where resource_id=p_event and resource_type=selected_type and is_current;
 insert into public.file_objects(bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,workspace_id,external_organization_id,audience,resource_type,resource_id,resource_key,version,is_current,replaces_file_id,uploaded_by,preview_status)
 values('integraq-private',selected_path,left(p_file->>'name',240),'application/pdf',(p_file->>'size')::bigint,p_file->>'sha256','suppliers',selected_org,event_row.supplier_id,'internal',selected_type,p_event,p_event::text,next_version,true,previous_file,auth.uid(),'pending') returning id into file_id;
 update public.supplier_audit_events set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=p_event;
 -- New PDF does not silently change a finalized result. Explicit result correction is required.
 perform public.iq_supplier_audit_log('audit.report.attached',p_event,jsonb_build_object('previousFile',previous_file),jsonb_build_object('fileId',file_id,'version',next_version,'type',selected_type),p_file->>'reason');
 return file_id;
end $function$;

-- Existing iq_supplier_audit_result: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_result(p_event uuid, p_revision integer, p_result jsonb, p_finalize boolean, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); e public.supplier_audit_events%rowtype; previous public.supplier_assessments%rowtype; result_id uuid; expected_count integer; rubric integer; report_id uuid:=nullif(p_result->>'reportId','')::uuid; plan_id uuid:=nullif(p_result->>'planId','')::uuid;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into e from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if e.id is null or e.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(e.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if e.revision is distinct from p_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if e.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
 if e.state='cancelled' then raise exception 'AUDIT_CANCELLED'; end if;
 if coalesce(p_result->>'questionnaire','') not in ('manufacturers','distributors') then raise exception 'AUDIT_QUESTIONNAIRE_REQUIRED'; end if;
 expected_count:=case when p_result->>'questionnaire'='manufacturers' then 9 else 8 end;
 if jsonb_typeof(p_result->'scores') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_result->'scores'))<>expected_count then raise exception 'AUDIT_SCORES_INVALID'; end if;
 for rubric in 1..expected_count loop
  if jsonb_typeof(p_result->'scores'->rubric::text) is distinct from 'number' or not ((p_result->'scores'->>rubric::text)::numeric between 0 and 100) then raise exception 'AUDIT_SCORES_INVALID'; end if;
 end loop;
 if jsonb_typeof(p_result->'score') is distinct from 'number' or not ((p_result->>'score')::numeric between 0 and 100) or length(trim(coalesce(p_result->>'auditor','')))<2
 or nullif(p_result->>'evaluationDate','') is null or (p_result->>'evaluationDate')::date>current_date then raise exception 'AUDIT_RESULT_INVALID'; end if;
 if not exists(select 1 from public.file_objects f join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path where f.id=report_id and f.resource_id=e.id and f.resource_type='supplier_audit_report' and f.external_organization_id=e.supplier_id and f.workspace_id=selected_org and f.is_current and f.deleted_at is null) then raise exception 'AUDIT_PDF_REQUIRED'; end if;
 if plan_id is not null and not exists(select 1 from public.file_objects where id=plan_id and resource_id=e.id and resource_type='supplier_audit_action_plan' and deleted_at is null) then raise exception 'AUDIT_PLAN_INVALID'; end if;
 if nullif(p_result->>'actualDate','') is null or (p_result->>'actualDate')::date>current_date or (e.source_sha256 is not null and e.actual_date is not null and e.actual_date<>(p_result->>'actualDate')::date) then raise exception 'AUDIT_ACTUAL_DATE_INVALID'; end if;
 select * into previous from public.supplier_assessments where audit_event_id=e.id for update;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
 insert into public.supplier_assessments(supplier_id,assessment_type,assessment_date,evaluator_name,score,classification,observations,portal_visible,created_by,updated_by,audit_event_id,questionnaire,rubric_scores,findings,audit_report_file_id,action_plan_file_id)
 values(e.supplier_id,'supplier_audit',(p_result->>'evaluationDate')::date,trim(p_result->>'auditor'),(p_result->>'score')::numeric,nullif(p_result->>'classification',''),p_result->>'observations',false,auth.uid(),auth.uid(),e.id,p_result->>'questionnaire',p_result->'scores',p_result->>'findings',report_id,plan_id)
 on conflict(audit_event_id) do update set assessment_date=excluded.assessment_date,evaluator_name=excluded.evaluator_name,score=excluded.score,classification=excluded.classification,observations=excluded.observations,updated_by=auth.uid(),questionnaire=excluded.questionnaire,rubric_scores=excluded.rubric_scores,findings=excluded.findings,audit_report_file_id=report_id,action_plan_file_id=plan_id returning id into result_id;
 update public.supplier_audit_events set state=case when p_finalize then 'completed' else 'performed' end,actual_date=(p_result->>'actualDate')::date,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=e.id;
 perform public.iq_supplier_audit_log(case when p_finalize then 'audit.completed' else 'audit.result.saved' end,e.id,jsonb_build_object('event',to_jsonb(e),'result',to_jsonb(previous)),p_result||jsonb_build_object('assessmentId',result_id),p_reason);
 return result_id;
end $function$;

-- Capability is advertised only when this entire transaction succeeds.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org();
begin
 return jsonb_build_object('withdrawalVersion',1,'organizationId',selected_org,'canManage',public.iq_supplier_audit_inspector(selected_org),
 'administrator',exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator'));
end $function$;

-- Existing RPC ownership, grants, RLS and Storage policies remain unchanged.
NOTIFY pgrst, 'reload schema';

-- IQ-PROV-AUDITORIAS-MANUALES.sql | SHA-256 5f2db407a9b192cb12ee232ed01391f5b29c7ba1f604edd56186a347a11a2e19

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE name text; rel regclass;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'MANUAL_INSTALL_OWNER_REQUIRED'; END IF;
  FOREACH name IN ARRAY ARRAY['supplier_audit_events','supplier_assessments','profiles','organizations','file_objects','file_upload_policies','audit_log'] LOOP
    rel := to_regclass('public.' || name);
    IF rel IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=rel AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN
      RAISE EXCEPTION 'MANUAL_DEPENDENCY_TABLE_RLS_OWNER: %',name;
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['public.iq_supplier_audit_org()','public.iq_supplier_audit_inspector(uuid)',
    'public.iq_supplier_audit_supplier_allowed(uuid,uuid)','public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)',
    'public.iq_supplier_audit_can_read(uuid)','public.has_permission(text,uuid,uuid,text,uuid,boolean,uuid)',
    'public.iq_supplier_audit_file(uuid,integer,jsonb)','pg_catalog.sha256(bytea)'] LOOP
    IF to_regprocedure(name) IS NULL THEN RAISE EXCEPTION 'MANUAL_DEPENDENCY_FUNCTION: %',name; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='integraq-private' AND NOT public) THEN RAISE EXCEPTION 'MANUAL_PRIVATE_BUCKET_REQUIRED'; END IF;
  IF (SELECT count(*) FROM public.file_upload_policies WHERE resource_type IN ('supplier_audit_report','supplier_audit_action_plan')
    AND max_size_bytes>0 AND 'application/pdf'=ANY(allowed_mime_types))<>2 THEN RAISE EXCEPTION 'MANUAL_PDF_POLICIES_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit_events' AND policyname='supplier_audit_events_read')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='file_objects' AND policyname='supplier_audit_files_private' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='supplier_audit_storage_private' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_assessments' AND policyname='supplier_audit_result_scope' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_scope' AND permissive='RESTRICTIVE')
  THEN RAISE EXCEPTION 'MANUAL_EXISTING_RLS_REQUIRED'; END IF;
  -- Refuse drift in the existing RLS expressions captured in the local catalog.
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_insert' AND permissive='RESTRICTIVE' AND cmd='INSERT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='d41d8cd98f00b204e9800998ecf8427e' AND md5(coalesce(with_check,''))='994b930f246a0deb0e9e7970dce57601') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_log_insert'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_scope' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='6c6f49154361e34d603dfaba66ca1912' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_log_scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='file_objects' AND policyname='supplier_audit_files_private' AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='176bc0cb768ed3c77f4cc8a2145a279d' AND md5(coalesce(with_check,''))='176bc0cb768ed3c77f4cc8a2145a279d') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_files_private'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_assessments' AND policyname='supplier_audit_result_scope' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='16ad0fd9a32beb0fcc0225565823aa8f' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_result_scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit_events' AND policyname='supplier_audit_events_read' AND permissive='PERMISSIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='9bf2b91bcb2b3d0951d7fdebc9981c25' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_events_read'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='supplier_audit_storage_private' AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='9181f1ddf6544d1846514872cdce74ec' AND md5(coalesce(with_check,''))='9181f1ddf6544d1846514872cdce74ec') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_storage_private'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_org()'))) IS DISTINCT FROM '9536dc2957b8ea4e6b8c1bd1248fb96f' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_org'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_inspector(uuid)'))) IS DISTINCT FROM '0cea6eabb4f965790b0259afb36122f2' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_inspector'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_supplier_allowed(uuid,uuid)'))) IS DISTINCT FROM '5265eb240ba9a38c9c47588f3269c426' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_supplier_allowed'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_can_read(uuid)'))) IS DISTINCT FROM '676fea6665ffb3cddc30fbf16860321f' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_can_read'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)'))) IS DISTINCT FROM 'd07864f7f1ffcfab7b5c6931834e7d98' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_log'; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.supplier_audit_events'::regclass AND attname IN ('manual_record','manual_classification') AND NOT attisdropped)
    OR to_regprocedure('public.iq_supplier_audit_manual_read(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'MANUAL_ALREADY_INSTALLED_REVIEW_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE public.supplier_audit_events
  ADD COLUMN manual_record jsonb,
  -- This extracts the explicit human selection; it never infers a supplier type.
  ADD COLUMN manual_classification text GENERATED ALWAYS AS (manual_record #>> '{record,classification}') STORED,
  ADD CONSTRAINT supplier_audit_manual_classification_check CHECK (manual_classification IS NULL OR manual_classification IN ('manufacturer','distributor','service')),
  ADD CONSTRAINT supplier_audit_manual_envelope_check CHECK (manual_record IS NULL OR (jsonb_typeof(manual_record)='object' AND jsonb_typeof(manual_record->'record')='object' AND jsonb_typeof(manual_record->'receipt')='object'));
COMMENT ON COLUMN public.supplier_audit_events.manual_record IS 'Human-entered audit record, publication binding and last request receipt. History in audit_log. No conversion of V1/V2.';
COMMENT ON COLUMN public.supplier_audit_events.manual_classification IS 'Explicit Calidad selection: manufacturer/distributor/service. Original criteria/source_payload remain unchanged.';

-- All helpers are private by privilege, despite sharing the existing public schema.
CREATE FUNCTION public.iq_supplier_audit_manual_uuid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $sql$
  SELECT coalesce(jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$sql$;
CREATE FUNCTION public.iq_supplier_audit_manual_date(v jsonb,p_optional boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $date$
DECLARE d date; s text;
BEGIN
  IF v='null'::jsonb AND p_optional THEN RETURN true; END IF;
  IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s:=v#>>'{}'; IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN d:=s::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END;
  RETURN to_char(d,'YYYY-MM-DD')=s AND d BETWEEN DATE '2000-01-01' AND DATE '2200-12-31';
END;
$date$;
CREATE FUNCTION public.iq_supplier_audit_manual_ids(v jsonb,p_limit integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $ids$
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  RETURN jsonb_array_length(v)<=p_limit
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE NOT public.iq_supplier_audit_manual_uuid(x))
    AND (SELECT count(*)=count(DISTINCT lower(x#>>'{}')) FROM jsonb_array_elements(v) x);
END;
$ids$;
CREATE FUNCTION public.iq_supplier_audit_manual_validate(r jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $validate$
DECLARE a jsonb; s jsonb; k text;
BEGIN
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR octet_length(r::text)>1048576 THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  IF NOT (r ?& ARRAY['classification','discrepancy','methodology','auditDate','evaluatorName','score','actions','approvedFileIds','portalVisible'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) x WHERE x<>ALL(ARRAY['classification','discrepancy','methodology','auditDate','evaluatorName','score','actions','approvedFileIds','portalVisible'])) THEN RAISE EXCEPTION 'MANUAL_INPUT_KEYS'; END IF;
  IF r->'classification'<>'null'::jsonb AND (jsonb_typeof(r->'classification')<>'string' OR r->>'classification' NOT IN ('manufacturer','distributor','service')) THEN RAISE EXCEPTION 'MANUAL_CLASSIFICATION'; END IF;
  IF r->'methodology'<>'null'::jsonb AND (jsonb_typeof(r->'methodology')<>'string' OR r->>'methodology' NOT IN ('V1','V2','other')) THEN RAISE EXCEPTION 'MANUAL_METHODOLOGY'; END IF;
  IF jsonb_typeof(r->'portalVisible')<>'boolean' OR NOT public.iq_supplier_audit_manual_date(r->'auditDate',true)
    OR NOT public.iq_supplier_audit_manual_ids(r->'approvedFileIds',100) THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  FOREACH k IN ARRAY ARRAY['discrepancy','evaluatorName'] LOOP
    IF jsonb_typeof(r->k)<>'string' OR char_length(r->>k)>(CASE WHEN k='discrepancy' THEN 2000 ELSE 300 END) THEN RAISE EXCEPTION 'MANUAL_TEXT_INVALID'; END IF;
  END LOOP;
  IF (r->>'portalVisible')::boolean AND r->'classification'='null'::jsonb THEN RAISE EXCEPTION 'MANUAL_CLASSIFICATION_REQUIRED'; END IF;
  s:=r->'score';
  IF s<>'null'::jsonb THEN
    IF jsonb_typeof(s)<>'object' THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF NOT (s ?& ARRAY['value','sourceFileId','reference','verified']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) x WHERE x<>ALL(ARRAY['value','sourceFileId','reference','verified'])) THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF jsonb_typeof(s->'value')<>'number' OR s->'verified'<>'true'::jsonb OR NOT public.iq_supplier_audit_manual_uuid(s->'sourceFileId')
      OR jsonb_typeof(s->'reference')<>'string' OR char_length(btrim(s->>'reference')) NOT BETWEEN 1 AND 1000 OR r->'methodology'='null'::jsonb THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF (s->>'value')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF (r->>'portalVisible')::boolean AND NOT (r->'approvedFileIds' @> jsonb_build_array(s->>'sourceFileId')) THEN RAISE EXCEPTION 'MANUAL_SCORE_SOURCE_NOT_APPROVED'; END IF;
  END IF;
  IF jsonb_typeof(r->'actions')<>'array' THEN RAISE EXCEPTION 'MANUAL_ACTIONS_INVALID'; END IF;
  IF jsonb_array_length(r->'actions')>100 THEN RAISE EXCEPTION 'MANUAL_ACTIONS_LIMIT'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(r->'actions') LOOP
    IF jsonb_typeof(a)<>'object' THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    IF NOT (a ?& ARRAY['id','description','responsibleName','commitmentDate','status','completedDate','evidenceFileIds'])
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) x WHERE x<>ALL(ARRAY['id','description','responsibleName','commitmentDate','status','completedDate','evidenceFileIds'])) THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    IF NOT public.iq_supplier_audit_manual_uuid(a->'id') OR NOT public.iq_supplier_audit_manual_date(a->'commitmentDate',false)
      OR NOT public.iq_supplier_audit_manual_date(a->'completedDate',true) OR NOT public.iq_supplier_audit_manual_ids(a->'evidenceFileIds',30)
      OR jsonb_typeof(a->'status')<>'string' OR a->>'status' NOT IN ('pending','in_progress','closed') THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    FOREACH k IN ARRAY ARRAY['description','responsibleName'] LOOP
      IF jsonb_typeof(a->k)<>'string' OR char_length(btrim(a->>k)) NOT BETWEEN 1 AND (CASE WHEN k='description' THEN 5000 ELSE 300 END) THEN RAISE EXCEPTION 'MANUAL_ACTION_TEXT'; END IF;
    END LOOP;
    IF a->>'status'<>'closed' AND a->'completedDate'<>'null'::jsonb THEN RAISE EXCEPTION 'MANUAL_ACTION_CLOSURE'; END IF;
    IF (r->>'portalVisible')::boolean AND NOT (r->'approvedFileIds' @> a->'evidenceFileIds') THEN RAISE EXCEPTION 'MANUAL_ACTION_EVIDENCE_NOT_APPROVED'; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT lower(value->>'id')) FROM jsonb_array_elements(r->'actions')) THEN RAISE EXCEPTION 'MANUAL_ACTION_DUPLICATE'; END IF;
END;
$validate$;

CREATE FUNCTION public.iq_supplier_audit_manual_empty(p_date date) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $sql$
 SELECT jsonb_build_object('classification',null,'discrepancy','','methodology',null,'auditDate',p_date,'evaluatorName','','score',null,'actions','[]'::jsonb,'approvedFileIds','[]'::jsonb,'portalVisible',false)
$sql$;

-- Metadata + physical object check. Content/bytes are validated by the existing backend upload.
CREATE FUNCTION public.iq_supplier_audit_manual_file_valid(p_event uuid,p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $sql$
 SELECT EXISTS(SELECT 1 FROM public.supplier_audit_events e
   JOIN public.file_objects f ON f.resource_id=e.id AND f.id=p_file AND f.workspace_id=e.organization_id
   JOIN storage.objects o ON o.bucket_id=f.bucket_id AND o.name=f.object_path
   WHERE e.id=p_event AND e.supplier_id IS NOT NULL AND f.external_organization_id=e.supplier_id
     AND f.resource_type IN ('supplier_audit_report','supplier_audit_action_plan') AND f.module_id='suppliers'
     AND f.audience='internal' AND f.bucket_id='integraq-private' AND f.deleted_at IS NULL AND f.external_site_id IS NULL
     AND f.mime_type='application/pdf' AND f.size_bytes BETWEEN 1 AND 4194304 AND f.sha256 ~ '^[a-f0-9]{64}$'
     AND f.uploaded_by IS NOT NULL AND f.object_path LIKE f.uploaded_by::text||'/supplier-audits/'||e.id::text||'/%'
     AND o.metadata->>'mimetype'='application/pdf' AND o.metadata->>'size'=f.size_bytes::text)
$sql$;

CREATE FUNCTION public.iq_supplier_audit_manual_read(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $read$
DECLARE org uuid:=public.iq_supplier_audit_org(); e public.supplier_audit_events%rowtype; history jsonb;
BEGIN
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'at',l.created_at,'actorName',coalesce(l.user_name_snapshot,l.actor_id::text),
   'reason',l.reason,'before',l.previous_value->'record','after',l.new_value->'record') ORDER BY l.created_at,l.id),'[]'::jsonb)
 INTO history FROM public.audit_log l WHERE l.organization_id=org AND l.resource_type='supplier_audit_event'
   AND l.resource_id=e.id::text AND l.action='audit.manual.saved';
 RETURN jsonb_build_object('version',1,'eventId',e.id,'supplierId',e.supplier_id,'revision',e.revision,
   'record',coalesce(e.manual_record->'record',public.iq_supplier_audit_manual_empty(e.actual_date)),'history',history);
END;
$read$;

CREATE FUNCTION public.iq_supplier_audit_manual_save(p_event uuid,p_expected_revision integer,p_request_id uuid,p_record jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE org uuid:=public.iq_supplier_audit_org(); actor uuid:=auth.uid(); e public.supplier_audit_events%rowtype;
 previous jsonb; receipt jsonb; envelope jsonb; fingerprint text; fid uuid; assessment public.supplier_assessments%rowtype;
 reason text:=btrim(p_reason); saved_revision integer; old_guard text;
BEGIN
 -- Fresh identity and edit permission BEFORE the organization-scoped row lock.
 IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
 IF p_event IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 2147483646
   OR reason IS NULL OR char_length(reason) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'MANUAL_COMMAND_INVALID'; END IF;
 PERFORM public.iq_supplier_audit_manual_validate(p_record);
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('record',p_record,'reason',reason,'revision',p_expected_revision)::text,'UTF8')),'hex');
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
 IF to_jsonb(e)->>'withdrawn_at' IS NOT NULL THEN RAISE EXCEPTION 'AUDIT_WITHDRAWN'; END IF;
 IF e.state='cancelled' THEN RAISE EXCEPTION 'AUDIT_CANCELLED'; END IF;
 receipt:=e.manual_record->'receipt';
 IF receipt->>'requestId'=p_request_id::text THEN
   IF receipt->>'actorId' IS DISTINCT FROM actor::text OR receipt->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'MANUAL_REQUEST_REUSED'; END IF;
   IF e.revision IS DISTINCT FROM (receipt->>'revision')::integer THEN RAISE EXCEPTION 'MANUAL_REPLAY_STALE'; END IF;
   RETURN jsonb_build_object('eventId',e.id,'revision',e.revision,'requestId',p_request_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.audit_log l WHERE l.organization_id=org AND l.resource_type='supplier_audit_event' AND l.resource_id=e.id::text
   AND l.action='audit.manual.saved' AND l.new_value#>>'{receipt,requestId}'=p_request_id::text) THEN RAISE EXCEPTION 'MANUAL_REPLAY_STALE'; END IF;
 IF e.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'MANUAL_CONFLICT'; END IF;
 IF e.supplier_id IS NOT NULL AND (NOT public.iq_supplier_audit_supplier_allowed(e.supplier_id,org)
   OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=e.supplier_id AND active AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; END IF;
 IF (p_record->>'portalVisible')::boolean AND e.supplier_id IS NULL THEN RAISE EXCEPTION 'MANUAL_SUPPLIER_UNVERIFIED'; END IF;
 IF e.source_sha256 IS NOT NULL AND e.actual_date IS NOT NULL AND (p_record->>'auditDate')::date IS DISTINCT FROM e.actual_date THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_DATE'; END IF;
 IF (p_record->>'auditDate')::date>current_date OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_record->'actions') a WHERE (a->>'completedDate')::date>current_date) THEN RAISE EXCEPTION 'MANUAL_ACTUAL_DATE_FUTURE'; END IF;
 previous:=coalesce(e.manual_record->'record',public.iq_supplier_audit_manual_empty(e.actual_date));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(previous->'actions') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_record->'actions') b WHERE (a->>'id')::uuid=(b->>'id')::uuid)) THEN RAISE EXCEPTION 'MANUAL_ACTION_PRESERVATION'; END IF;
 IF previous->'score'<>'null'::jsonb AND (previous->'score' IS DISTINCT FROM p_record->'score' OR previous->'methodology' IS DISTINCT FROM p_record->'methodology') THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_SCORE'; END IF;
 SELECT * INTO assessment FROM public.supplier_assessments WHERE audit_event_id=e.id;
 IF FOUND AND p_record->'score'<>'null'::jsonb THEN RAISE EXCEPTION 'MANUAL_EXISTING_ASSESSMENT'; END IF;
 IF assessment.id IS NOT NULL AND (p_record->>'auditDate')::date IS DISTINCT FROM e.actual_date THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_DATE'; END IF;
 IF assessment.id IS NOT NULL AND previous->'methodology'<>'null'::jsonb AND previous->'methodology' IS DISTINCT FROM p_record->'methodology' THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_METHOD'; END IF;
 -- Lock metadata in deterministic order; the owning event serializes legacy uploads.
 FOR fid IN SELECT DISTINCT value::uuid FROM (
   SELECT jsonb_array_elements_text(p_record->'approvedFileIds') AS value
   UNION ALL SELECT jsonb_array_elements_text(a->'evidenceFileIds') FROM jsonb_array_elements(p_record->'actions') a
   UNION ALL SELECT p_record#>>'{score,sourceFileId}' WHERE p_record->'score'<>'null'::jsonb
 ) refs ORDER BY value::uuid LOOP
   PERFORM 1 FROM public.file_objects WHERE id=fid AND workspace_id=org AND resource_id=e.id FOR SHARE;
   IF NOT FOUND OR NOT public.iq_supplier_audit_manual_file_valid(e.id,fid) THEN RAISE EXCEPTION 'MANUAL_DOCUMENT_SCOPE'; END IF;
 END LOOP;
 IF p_record->'score'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.file_objects WHERE id=(p_record#>>'{score,sourceFileId}')::uuid AND resource_type='supplier_audit_report') THEN RAISE EXCEPTION 'MANUAL_SCORE_SOURCE'; END IF;
 receipt:=jsonb_build_object('requestId',p_request_id,'actorId',actor,'baseRevision',p_expected_revision,'revision',e.revision+1,'fingerprint',fingerprint,'at',clock_timestamp());
 envelope:=jsonb_build_object('record',p_record,'publicationSupplierId',CASE WHEN (p_record->>'portalVisible')::boolean THEN e.supplier_id ELSE NULL END,'receipt',receipt);
 old_guard:=current_setting('integraq.audit_manual_event',true);
 PERFORM set_config('integraq.audit_manual_event',e.id::text,true);
 UPDATE public.supplier_audit_events SET manual_record=envelope,actual_date=(p_record->>'auditDate')::date,
   revision=revision+1,updated_at=now(),updated_by=actor WHERE id=e.id AND organization_id=org RETURNING revision INTO saved_revision;
 PERFORM public.iq_supplier_audit_log('audit.manual.saved',e.id,jsonb_build_object('record',previous,'revision',e.revision),
   jsonb_build_object('record',p_record,'receipt',receipt,'revision',saved_revision,'publicationSupplierId',envelope->'publicationSupplierId'),reason);
 IF NOT EXISTS(SELECT 1 FROM public.audit_log l WHERE l.organization_id=org AND l.actor_id=actor AND l.resource_type='supplier_audit_event'
   AND l.resource_id=e.id::text AND l.action='audit.manual.saved' AND l.reason=reason AND l.previous_value->'record'=previous
   AND l.new_value->'record'=p_record AND l.new_value->'receipt'=receipt) THEN RAISE EXCEPTION 'MANUAL_AUDIT_REQUIRED'; END IF;
 PERFORM set_config('integraq.audit_manual_event',coalesce(old_guard,''),true);
 RETURN jsonb_build_object('eventId',e.id,'revision',saved_revision,'requestId',p_request_id);
END;
$save$;

-- No external permission comes from JWT user_metadata, supplied IDs or browser claims.
CREATE FUNCTION public.iq_supplier_audit_manual_portal_scope(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $sql$
 SELECT EXISTS(SELECT 1 FROM public.supplier_audit_events e
  JOIN public.profiles p ON p.id=auth.uid() AND p.status='active' AND p.user_type='supplier' AND p.workspace_mode='production'
    AND p.external_party_kind='supplier' AND p.external_party_id=e.supplier_id
  JOIN public.organizations s ON s.id=e.supplier_id AND s.kind='supplier' AND s.active AND s.deleted_at IS NULL
  JOIN public.organizations tenant ON tenant.id=e.organization_id AND tenant.kind='internal' AND tenant.active AND tenant.deleted_at IS NULL
  WHERE e.id=p_event AND to_jsonb(e)->>'withdrawn_at' IS NULL AND e.state<>'cancelled'
    AND e.manual_record#>>'{record,portalVisible}'='true' AND e.manual_classification IS NOT NULL
    AND e.manual_record->>'publicationSupplierId'=e.supplier_id::text
    AND (s.owning_organization_id=e.organization_id OR (s.owning_organization_id IS NULL AND (SELECT count(*) FROM public.organizations WHERE kind='internal')=1))
    -- Calendar events have no branch/site identity. Site-scoped accounts fail closed.
    AND p.external_site_id IS NULL
    AND public.has_permission('portal_proveedores.acceder',NULL,NULL,NULL,NULL,false,e.supplier_id))
$sql$;
CREATE FUNCTION public.iq_supplier_audit_manual_portal_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $actor$
DECLARE supplier uuid;
BEGIN
 SELECT p.external_party_id INTO supplier FROM public.profiles p JOIN public.organizations s ON s.id=p.external_party_id
 WHERE p.id=auth.uid() AND p.status='active' AND p.user_type='supplier' AND p.workspace_mode='production'
  AND p.external_party_kind='supplier' AND p.external_site_id IS NULL AND s.kind='supplier' AND s.active AND s.deleted_at IS NULL
  AND public.has_permission('portal_proveedores.acceder',NULL,NULL,NULL,NULL,false,s.id);
 IF supplier IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_ACCESS_DENIED'; END IF;
 RETURN supplier;
END;
$actor$;
CREATE FUNCTION public.iq_supplier_audit_portal_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $list$
DECLARE supplier uuid:=public.iq_supplier_audit_manual_portal_actor(); e public.supplier_audit_events%rowtype;
 r jsonb; files jsonb; actions jsonb; score numeric; source_id uuid; assessment public.supplier_assessments%rowtype; items jsonb:='[]'::jsonb;
BEGIN
 FOR e IN SELECT * FROM public.supplier_audit_events WHERE supplier_id=supplier AND public.iq_supplier_audit_manual_portal_scope(id) ORDER BY actual_date DESC NULLS LAST,id LOOP
  r:=e.manual_record->'record';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'resource_id',e.id,'resource_type',f.resource_type,'original_name',f.original_name,
    'version',f.version,'is_current',f.is_current,'created_at',f.created_at,'size_bytes',f.size_bytes) ORDER BY f.created_at,f.id),'[]'::jsonb)
  INTO files FROM public.file_objects f WHERE f.resource_id=e.id AND f.workspace_id=e.organization_id
    AND r->'approvedFileIds' @> jsonb_build_array(f.id::text) AND public.iq_supplier_audit_manual_file_valid(e.id,f.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a->'id','description',a->'description','responsibleName',a->'responsibleName',
    'commitmentDate',a->'commitmentDate','status',a->'status','completedDate',a->'completedDate','evidenceFileIds',
    (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(a->'evidenceFileIds') x WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(files) f WHERE f->'id'=x))) ORDER BY ord),'[]'::jsonb)
  INTO actions FROM jsonb_array_elements(r->'actions') WITH ORDINALITY a_rows(a,ord);
  score:=NULL; source_id:=NULL;
  IF r->'score'<>'null'::jsonb THEN score:=(r#>>'{score,value}')::numeric; source_id:=(r#>>'{score,sourceFileId}')::uuid;
  ELSE
    SELECT * INTO assessment FROM public.supplier_assessments WHERE audit_event_id=e.id AND supplier_id=supplier AND site_id IS NULL;
    IF FOUND THEN score:=assessment.score; source_id:=assessment.audit_report_file_id; END IF;
  END IF;
  IF source_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(files) f WHERE f->>'id'=source_id::text AND f->>'resource_type'='supplier_audit_report') THEN score:=NULL; END IF;
  items:=items||jsonb_build_array(jsonb_build_object('eventId',e.id,'supplierId',supplier,'auditDate',e.actual_date,
    'classification',e.manual_classification,'methodology',r->'methodology','score',score,'actions',actions,'files',files));
 END LOOP;
 RETURN jsonb_build_object('version',1,'audits',items);
END;
$list$;
CREATE FUNCTION public.iq_supplier_audit_portal_file(p_event uuid,p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $file$
DECLARE supplier uuid:=public.iq_supplier_audit_manual_portal_actor(); e public.supplier_audit_events%rowtype; f public.file_objects%rowtype;
BEGIN
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND supplier_id=supplier AND public.iq_supplier_audit_manual_portal_scope(id);
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 IF NOT (e.manual_record#>'{record,approvedFileIds}' @> jsonb_build_array(p_file::text)) OR NOT public.iq_supplier_audit_manual_file_valid(e.id,p_file) THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 SELECT * INTO f FROM public.file_objects WHERE id=p_file AND resource_id=e.id AND workspace_id=e.organization_id AND external_organization_id=supplier;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 RETURN jsonb_build_object('eventId',e.id,'id',f.id,'supplierId',supplier,'organizationId',e.organization_id,'bucket',f.bucket_id,'path',f.object_path,'name',f.original_name,'authorized',true);
END;
$file$;

-- Additive guards only. No replacement of approved calendar/withdrawal functions.
CREATE FUNCTION public.iq_supplier_audit_manual_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_USE_RPC'; END IF;
 ELSIF TG_OP='DELETE' THEN
  IF OLD.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_PHYSICAL_DELETE_DENIED'; END IF;
  RETURN OLD;
 ELSE
  IF NEW.manual_record IS DISTINCT FROM OLD.manual_record THEN
   IF current_user<>'postgres' OR current_setting('integraq.audit_manual_event',true) IS DISTINCT FROM NEW.id::text
     OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN RAISE EXCEPTION 'MANUAL_USE_RPC'; END IF;
  ELSIF OLD.manual_record IS NOT NULL AND NEW.actual_date IS DISTINCT FROM OLD.actual_date THEN RAISE EXCEPTION 'MANUAL_DATE_USE_CAPTURE'; END IF;
  IF OLD.manual_record IS NOT NULL AND (NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256 OR NEW.source_payload IS DISTINCT FROM OLD.source_payload
    OR NEW.historical_supplier_name IS DISTINCT FROM OLD.historical_supplier_name OR NEW.source_sheet IS DISTINCT FROM OLD.source_sheet
    OR NEW.source_row IS DISTINCT FROM OLD.source_row OR NEW.source_column IS DISTINCT FROM OLD.source_column OR NEW.source_status IS DISTINCT FROM OLD.source_status) THEN RAISE EXCEPTION 'MANUAL_SOURCE_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_audit_events FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_event_guard();
CREATE FUNCTION public.iq_supplier_audit_manual_assessment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE e public.supplier_audit_events%rowtype; eid uuid; org uuid;
BEGIN
 eid:=CASE WHEN TG_OP='INSERT' THEN NEW.audit_event_id ELSE OLD.audit_event_id END;
 IF eid IS NOT NULL THEN
  org:=public.iq_supplier_audit_org();
  IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
  SELECT * INTO e FROM public.supplier_audit_events WHERE id=eid AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
  IF e.manual_record IS NOT NULL AND (TG_OP<>'INSERT' OR e.manual_record#>'{record,score}'<>'null'::jsonb OR e.manual_record#>>'{record,methodology}'='V1') THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_ASSESSMENT'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.audit_event_id IS DISTINCT FROM OLD.audit_event_id AND NEW.audit_event_id IS NOT NULL THEN
  org:=public.iq_supplier_audit_org();
  IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
  SELECT * INTO e FROM public.supplier_audit_events WHERE id=NEW.audit_event_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
  IF e.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_ASSESSMENT'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_assessment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_assessments FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_assessment_guard();
CREATE FUNCTION public.iq_supplier_audit_manual_log_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.action='audit.manual.saved' AND OLD.resource_type='supplier_audit_event' THEN RAISE EXCEPTION 'MANUAL_LOG_IMMUTABLE'; END IF;
 IF TG_OP<>'DELETE' AND NEW.action='audit.manual.saved' THEN
  IF TG_OP<>'INSERT' OR NEW.resource_type<>'supplier_audit_event' OR current_user<>'postgres'
    OR current_setting('integraq.audit_manual_event',true) IS DISTINCT FROM NEW.resource_id THEN RAISE EXCEPTION 'MANUAL_LOG_USE_RPC'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_log_guard BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_log_guard();

CREATE UNIQUE INDEX supplier_audit_manual_request_unique ON public.audit_log(organization_id,resource_id,(new_value#>>'{receipt,requestId}'))
 WHERE resource_type='supplier_audit_event' AND action='audit.manual.saved';

-- Existing RLS remains in force. No new portal table policy and no Storage policy relaxation.
-- Default Supabase function ACLs may grant service_role too: revoke explicitly.
DO $privileges$
DECLARE sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.iq_supplier_audit_manual_uuid(jsonb)','public.iq_supplier_audit_manual_date(jsonb,boolean)',
  'public.iq_supplier_audit_manual_ids(jsonb,integer)','public.iq_supplier_audit_manual_validate(jsonb)',
  'public.iq_supplier_audit_manual_empty(date)','public.iq_supplier_audit_manual_file_valid(uuid,uuid)',
  'public.iq_supplier_audit_manual_read(uuid)','public.iq_supplier_audit_manual_save(uuid,integer,uuid,jsonb,text)',
  'public.iq_supplier_audit_manual_portal_scope(uuid)','public.iq_supplier_audit_manual_portal_actor()',
  'public.iq_supplier_audit_portal_list()','public.iq_supplier_audit_portal_file(uuid,uuid)',
  'public.iq_supplier_audit_manual_event_guard()','public.iq_supplier_audit_manual_assessment_guard()','public.iq_supplier_audit_manual_log_guard()'] LOOP
  EXECUTE 'ALTER FUNCTION '||sig||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC, anon, authenticated, service_role';
 END LOOP;
END;
$privileges$;
GRANT EXECUTE ON FUNCTION public.iq_supplier_audit_manual_read(uuid),public.iq_supplier_audit_manual_save(uuid,integer,uuid,jsonb,text),
 public.iq_supplier_audit_portal_list(),public.iq_supplier_audit_portal_file(uuid,uuid) TO authenticated;

-- IQ-PROV-MEJORAS-02-initial-photos.sql | SHA-256 d02cdc2b72c650c38ed935f655d77d1a41ea2179b8e5e879b679d640c20182e4

-- Abort rather than change pre-existing initial-photo records or install over V1.
do $$
begin
 if not exists(select 1 from storage.buckets b where b.id='integraq-private' and b.public=false) then
  raise exception 'PHOTO_PRIVATE_BUCKET_REQUIRED';
 end if;
 if exists(select 1 from public.file_objects where resource_type='supplier_rncp_initial_photo'
   or (bucket_id='integraq-private' and (object_path like 'rncp-initial/%' or preview_path like 'rncp-initial/%')))
  or exists(select 1 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/%') then
  raise exception 'PHOTO_NAMESPACE_NOT_EMPTY_REVIEW_REQUIRED';
 end if;
end $$;
create table public.supplier_rncp_initial_photo_sets (
 report_id uuid primary key references public.supplier_rncp_reports(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 file_ids uuid[] not null default '{}', revision integer not null check(revision>0),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 check(cardinality(file_ids)<=12)
);
create table public.supplier_rncp_photo_draft_requests (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references public.profiles(id),
 request_key uuid not null, request_payload jsonb not null, report_id uuid not null references public.supplier_rncp_reports(id) on delete restrict,
 primary key(organization_id,actor_id,request_key)
);
create table public.supplier_rncp_initial_photo_reservations (
 file_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 report_id uuid not null references public.supplier_rncp_reports(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 object_path text not null unique,
 size_bytes bigint not null check(size_bytes between 1 and 4194304),
 file_data jsonb not null check(jsonb_typeof(file_data)='object'),
 created_at timestamptz not null default now(),
 verified_at timestamptz,
 unique(organization_id,report_id,file_id)
);
create index rncp_initial_reservation_org_report on public.supplier_rncp_initial_photo_reservations(organization_id,report_id);
alter table public.supplier_rncp_initial_photo_reservations enable row level security;
revoke all on public.supplier_rncp_initial_photo_reservations from public,anon,authenticated,service_role;
alter table public.supplier_rncp_initial_photo_sets enable row level security;
alter table public.supplier_rncp_photo_draft_requests enable row level security;
revoke all on public.supplier_rncp_initial_photo_sets,public.supplier_rncp_photo_draft_requests from public,anon,authenticated;
-- No direct table writes for API roles, including service_role; only guarded RPCs.
revoke all on public.supplier_rncp_initial_photo_sets,public.supplier_rncp_photo_draft_requests from service_role;
-- These records and objects are only served through the guarded backend/RPC.
create policy rncp_initial_photo_files_private on public.file_objects as restrictive for all to authenticated
 using(resource_type<>'supplier_rncp_initial_photo') with check(resource_type<>'supplier_rncp_initial_photo');
create policy rncp_initial_photo_objects_private on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'integraq-private' or name not like 'rncp-initial/%')
 with check(bucket_id<>'integraq-private' or name not like 'rncp-initial/%');

create function public.iq_rncp_initial_photo_guard(p_report uuid,p_edit boolean) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); r public.supplier_rncp_reports%rowtype;
begin
 if p_edit and not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org and deleted_at is null and source_kind='native';
 if r.id is null then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 if p_edit and (r.status<>'draft' or r.notified_at is not null) then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 return org;
end $$;

create function public.iq_rncp_initial_photo_manifest(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid; ids uuid[]; rev integer; photos jsonb;
begin
 if p_report is null then perform public.iq_rncp_actor_org(false); return jsonb_build_object('available',true); end if;
 org:=public.iq_rncp_initial_photo_guard(p_report,false);
 select file_ids,revision into ids,rev from public.supplier_rncp_initial_photo_sets where report_id=p_report and organization_id=org;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'sha256',f.sha256,'size',f.size_bytes,'mime',f.mime_type,
  'width',(f.observations::jsonb)->'width','height',(f.observations::jsonb)->'height') order by v.pos),'[]'::jsonb) into photos
 from unnest(coalesce(ids,'{}'::uuid[])) with ordinality v(id,pos) join public.file_objects f on f.id=v.id
 where f.resource_id=p_report and f.resource_type='supplier_rncp_initial_photo' and f.workspace_id=org and f.deleted_at is null;
 if jsonb_array_length(photos)<>coalesce(cardinality(ids),0) then raise exception 'PHOTO_MANIFEST_INCOMPLETE'; end if;
 return jsonb_build_object('revision',coalesce(rev,0),'files',photos);
end $$;

-- Canonical metadata only; no caller-supplied organization, actor, resource type or bucket.
create function public.iq_rncp_initial_photo_reserve(p_report uuid,p_file jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; prior public.supplier_rncp_initial_photo_reservations%rowtype;
 expected_path text; raw_hex text; expected_id uuid; object_count bigint; object_bytes bigint;
begin
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 -- Serializes reservations across reports of the SAME authorized organization.
 perform 1 from public.organizations where id=org and active and kind='internal' for update;
 if not found then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 if jsonb_typeof(p_file) is distinct from 'object'
  or jsonb_typeof(p_file->'name') is distinct from 'string'
  or coalesce(length(trim(p_file->>'name')),0) not between 1 and 180
  or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_file->>'mime','') not in ('image/jpeg','image/png','image/webp')
  or jsonb_typeof(p_file->'size') is distinct from 'number'
  or jsonb_typeof(p_file->'width') is distinct from 'number'
  or jsonb_typeof(p_file->'height') is distinct from 'number'
  or coalesce(p_file->>'size','') !~ '^[0-9]+$'
  or coalesce(p_file->>'width','') !~ '^[0-9]+$'
  or coalesce(p_file->>'height','') !~ '^[0-9]+$' then raise exception 'PHOTO_INVALID'; end if;
 if (p_file->>'size')::numeric not between 1 and 4194304
  or (p_file->>'width')::numeric not between 1 and 8192 or (p_file->>'height')::numeric not between 1 and 8192
  or (p_file->>'width')::numeric*(p_file->>'height')::numeric>25000000 then raise exception 'PHOTO_INVALID'; end if;
 expected_path:='rncp-initial/'||org::text||'/'||p_report::text||'/'||(p_file->>'sha256')||
  case p_file->>'mime' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
 raw_hex:=encode(sha256(convert_to(org::text||':'||p_report::text||':'||(p_file->>'sha256'),'UTF8')),'hex');
 expected_id:=(substr(raw_hex,1,8)||'-'||substr(raw_hex,9,4)||'-5'||substr(raw_hex,14,3)||'-a'||substr(raw_hex,18,3)||'-'||substr(raw_hex,21,12))::uuid;
 if p_file is distinct from jsonb_build_object('id',expected_id,'path',expected_path,'name',p_file->>'name',
   'sha256',p_file->>'sha256','mime',p_file->>'mime','size',(p_file->>'size')::bigint,
   'width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer) then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
 select * into prior from public.supplier_rncp_initial_photo_reservations where file_id=expected_id;
 if found then
  if prior.organization_id is distinct from org or prior.report_id is distinct from p_report
   or prior.actor_id is distinct from auth.uid() or prior.file_data is distinct from p_file then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
  return jsonb_build_object('id',prior.file_id,'path',prior.object_path,'verified',prior.verified_at is not null);
 end if;
 -- ALL reservations count: staged, committed, removed and abandoned; no expiry or quota release.
 select count(*),coalesce(sum(size_bytes),0) into object_count,object_bytes
 from public.supplier_rncp_initial_photo_reservations where organization_id=org and report_id=p_report;
 if object_count>=24 or object_bytes+(p_file->>'size')::bigint>50331648 then raise exception 'PHOTO_REPORT_PREPARED_QUOTA'; end if;
 select count(*),coalesce(sum(size_bytes),0) into object_count,object_bytes
 from public.supplier_rncp_initial_photo_reservations where organization_id=org;
 if object_count>=240 or object_bytes+(p_file->>'size')::bigint>503316480 then raise exception 'PHOTO_ORG_PREPARED_QUOTA'; end if;
 insert into public.supplier_rncp_initial_photo_reservations(file_id,organization_id,report_id,actor_id,object_path,size_bytes,file_data)
 values(expected_id,org,p_report,auth.uid(),expected_path,(p_file->>'size')::bigint,p_file);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.reserved','supplier_rncp_report',p_report::text,
  jsonb_build_object('file_id',expected_id,'size',(p_file->>'size')::bigint,'sha256',p_file->>'sha256'));
 return jsonb_build_object('id',expected_id,'path',expected_path,'verified',false);
end $$;

-- Trusted backend ONLY. It must DOWNLOAD the private object and decode/hash its ACTUAL
-- bytes before attesting, deriving this JSON itself. Never forward a browser's JSON.
-- SQL cannot decode image bytes or independently prove the hash of a Storage object.
create function public.iq_rncp_initial_photo_attest(p_file_id uuid,p_verified jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare reserved public.supplier_rncp_initial_photo_reservations%rowtype; object_count bigint; object_bytes numeric;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='PHOTO_BACKEND_ONLY'; end if;
 select * into reserved from public.supplier_rncp_initial_photo_reservations where file_id=p_file_id for update;
 if not found or reserved.file_data is distinct from p_verified then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 if not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=reserved.object_path
  and (metadata->>'size')::numeric=reserved.size_bytes and metadata->>'mimetype'=p_verified->>'mime') then raise exception 'PHOTO_OBJECT_UNVERIFIED'; end if;
 -- Actual-object reconciliation detects privileged uploads outside the reservation protocol.
 if exists(select 1 from storage.objects o where o.bucket_id='integraq-private'
  and o.name like 'rncp-initial/'||reserved.organization_id::text||'/%'
  and not exists(select 1 from public.supplier_rncp_initial_photo_reservations a
   where a.organization_id=reserved.organization_id and a.object_path=o.name
    and (o.metadata->>'size')::numeric=a.size_bytes)) then raise exception 'PHOTO_UNRESERVED_OBJECT_REVIEW_REQUIRED'; end if;
 select count(*),coalesce(sum((metadata->>'size')::numeric),0) into object_count,object_bytes
 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/'||reserved.organization_id::text||'/'||reserved.report_id::text||'/%';
 if object_count>24 or object_bytes>50331648 then raise exception 'PHOTO_REPORT_PREPARED_QUOTA'; end if;
 select count(*),coalesce(sum((metadata->>'size')::numeric),0) into object_count,object_bytes
 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/'||reserved.organization_id::text||'/%';
 if object_count>240 or object_bytes>503316480 then raise exception 'PHOTO_ORG_PREPARED_QUOTA'; end if;
 if reserved.verified_at is null then
  update public.supplier_rncp_initial_photo_reservations set verified_at=now() where file_id=p_file_id;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
  values(reserved.actor_id,reserved.organization_id,'suppliers','rncp.initial_photo.backend_verified','supplier_rncp_report',reserved.report_id::text,
   jsonb_build_object('file_id',p_file_id,'sha256',p_verified->>'sha256'));
 end if;
end $$;

-- Prevent namespace aliases, reclassification and file lifecycle RPCs bypassing the manifest.
-- Applies only to the NEW resource/prefix; other file rows return unchanged.
create function public.iq_rncp_initial_photo_file_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare reserved public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 if tg_op in ('UPDATE','DELETE') and (old.resource_type='supplier_rncp_initial_photo'
  or (old.bucket_id='integraq-private' and old.object_path like 'rncp-initial/%')) then
  raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST';
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.bucket_id='integraq-private' and new.preview_path like 'rncp-initial/%' then
  raise exception 'PHOTO_RESERVED_PREVIEW_PATH';
 end if;
 if new.resource_type<>'supplier_rncp_initial_photo'
  and not (new.bucket_id='integraq-private' and new.object_path like 'rncp-initial/%') then return new; end if;
 if tg_op<>'INSERT' then raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST'; end if;
 select * into reserved from public.supplier_rncp_initial_photo_reservations where file_id=new.id;
 if not found or reserved.verified_at is null or new.resource_type is distinct from 'supplier_rncp_initial_photo'
  or new.bucket_id is distinct from 'integraq-private' or new.object_path is distinct from reserved.object_path
  or new.workspace_id is distinct from reserved.organization_id or new.resource_id is distinct from reserved.report_id
  or new.uploaded_by is distinct from reserved.actor_id or new.deleted_at is not null
  or new.original_name is distinct from reserved.file_data->>'name' or new.sha256 is distinct from reserved.file_data->>'sha256'
  or new.mime_type is distinct from reserved.file_data->>'mime' or new.size_bytes is distinct from reserved.size_bytes
  or new.audience::text is distinct from 'internal' or new.module_id is distinct from 'suppliers'
  or new.external_organization_id is distinct from (select supplier_id from public.supplier_rncp_reports where id=reserved.report_id)
  or new.observations::jsonb is distinct from jsonb_build_object('width',(reserved.file_data->>'width')::integer,'height',(reserved.file_data->>'height')::integer)
 then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 return new;
end $$;
create trigger rncp_initial_photo_file_guard before insert or update or delete on public.file_objects
 for each row execute function public.iq_rncp_initial_photo_file_guard();

-- Institutional/home signed URLs follow controlled_document_versions.file_id with a
-- privileged client. Prevent an initial photo ever entering that alternative chain.
create function public.iq_rncp_initial_photo_controlled_link_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.file_objects f where f.id=new.file_id and
  (f.resource_type='supplier_rncp_initial_photo' or (f.bucket_id='integraq-private' and f.object_path like 'rncp-initial/%'))) then
  raise exception 'PHOTO_NOT_A_CONTROLLED_DOCUMENT';
 end if;
 return new;
end $$;
create trigger rncp_initial_photo_controlled_link_guard before insert or update of file_id on public.controlled_document_versions
 for each row execute function public.iq_rncp_initial_photo_controlled_link_guard();

create function public.iq_rncp_initial_photo_stage(p_report uuid,p_file jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; existing public.file_objects%rowtype; file_id uuid:=(p_file->>'id')::uuid; expected_path text; reservation public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 -- Same report lock as registration: photos cannot be attached after submit.
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 select a.* into reservation from public.supplier_rncp_initial_photo_reservations a where a.file_id=iq_rncp_initial_photo_stage.file_id;
 if reservation.file_id is null or reservation.organization_id is distinct from org
  or reservation.report_id is distinct from p_report or reservation.actor_id is distinct from auth.uid()
  or reservation.file_data is distinct from p_file or reservation.verified_at is null then
  raise exception using errcode='42501',message='PHOTO_BACKEND_VERIFICATION_REQUIRED';
 end if;
 if coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_file->>'mime','') not in ('image/jpeg','image/png','image/webp')
  or not (coalesce((p_file->>'size')::bigint,0) between 1 and 4194304) or coalesce(length(trim(p_file->>'name')),0) not between 1 and 180
  or not (coalesce((p_file->>'width')::integer,0) between 1 and 8192) or not (coalesce((p_file->>'height')::integer,0) between 1 and 8192)
  or (p_file->>'width')::bigint*(p_file->>'height')::bigint>25000000 then raise exception 'PHOTO_INVALID'; end if;
 expected_path:='rncp-initial/'||org::text||'/'||p_report::text||'/'||(p_file->>'sha256')||
  case p_file->>'mime' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
 if p_file->>'path' is distinct from expected_path or not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=expected_path
  and (metadata->>'size')::bigint=(p_file->>'size')::bigint and metadata->>'mimetype'=p_file->>'mime') then raise exception 'PHOTO_OBJECT_UNVERIFIED'; end if;
 select * into existing from public.file_objects where object_path=expected_path;
 if existing.id is not null then
  if existing.resource_type<>'supplier_rncp_initial_photo' or existing.workspace_id<>org or existing.resource_id<>p_report or existing.sha256<>p_file->>'sha256' or existing.deleted_at is not null
   or existing.id is distinct from file_id or existing.bucket_id is distinct from 'integraq-private'
   or existing.original_name is distinct from p_file->>'name' or existing.mime_type is distinct from p_file->>'mime'
   or existing.size_bytes is distinct from (p_file->>'size')::bigint
   or existing.observations::jsonb is distinct from jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)
   then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
  return existing.id;
 end if;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,resource_type,resource_id,
  resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
 values(file_id,'integraq-private',expected_path,p_file->>'name',p_file->>'mime',(p_file->>'size')::bigint,p_file->>'sha256','suppliers','internal',
  'supplier_rncp_initial_photo',p_report,r.folio,org,1,true,auth.uid(),'not_required',
  jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)::text,r.supplier_id);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.staged','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('file_id',file_id,'sha256',p_file->>'sha256'));
 return file_id;
end $$;

create function public.iq_rncp_initial_photo_commit(p_report uuid,p_ids uuid[],p_revision integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; previous public.supplier_rncp_initial_photo_sets%rowtype; found_count integer; total bigint;
begin
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 if p_revision is null or p_revision<0 or p_ids is null
  or coalesce(array_ndims(p_ids),1)<>1 or (cardinality(p_ids)>0 and array_lower(p_ids,1)<>1)
  or cardinality(p_ids)>12 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id)
  or coalesce(length(trim(p_reason)),0) not between 5 and 1000 then raise exception 'PHOTO_INVALID'; end if;
 select * into previous from public.supplier_rncp_initial_photo_sets where report_id=p_report and organization_id=org for update;
 if coalesce(previous.revision,0) is distinct from p_revision then
  -- Every stale revision is a conflict, even same actor/files. Recover with GET only.
  raise exception 'PHOTO_CONFLICT';
 end if;
 select count(*),coalesce(sum(f.size_bytes),0) into found_count,total from public.file_objects f
 where f.id=any(p_ids) and f.workspace_id=org and f.resource_id=p_report and f.resource_type='supplier_rncp_initial_photo' and f.deleted_at is null
  and f.bucket_id='integraq-private' and exists(select 1 from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path);
 if found_count<>cardinality(p_ids) or total>25165824 then raise exception 'PHOTO_INVALID'; end if;
 insert into public.supplier_rncp_initial_photo_sets(report_id,organization_id,file_ids,revision,updated_by)
 values(p_report,org,p_ids,coalesce(previous.revision,0)+1,auth.uid())
 on conflict(report_id) do update set file_ids=excluded.file_ids,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,reason)
 values(auth.uid(),org,'suppliers','rncp.initial_photos.saved','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('ids',coalesce(previous.file_ids,'{}'::uuid[]),'revision',coalesce(previous.revision,0)),
  jsonb_build_object('ids',p_ids,'revision',coalesce(previous.revision,0)+1),trim(p_reason));
 -- Removed photos remain private and intact; the audit preserves their earlier order.
 return public.iq_rncp_initial_photo_manifest(p_report);
end $$;

create function public.iq_rncp_initial_photo_draft(p_request uuid,p_payload jsonb) returns public.supplier_rncp_reports
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); report_id uuid; r public.supplier_rncp_reports%rowtype;
begin
 if p_request is null or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||auth.uid()::text||p_request::text,0));
 select d.report_id into report_id from public.supplier_rncp_photo_draft_requests d where d.organization_id=org and d.actor_id=auth.uid() and d.request_key=p_request;
 if report_id is not null then
  perform public.iq_rncp_initial_photo_guard(report_id,false);
  if (select d.request_payload from public.supplier_rncp_photo_draft_requests d
      where d.organization_id=org and d.actor_id=auth.uid() and d.request_key=p_request) is distinct from p_payload then
   raise exception 'PHOTO_REQUEST_REUSED_WITH_DIFFERENT_PAYLOAD';
  end if;
  -- Return CURRENT data. Never re-apply an old payload, change status or write audit on retry.
  select * into r from public.supplier_rncp_reports where id=report_id and organization_id=org
   and source_kind='native' and deleted_at is null;
  if not found then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
  return r;
 end if;
 select * into r from public.save_supplier_rncp(null,'draft',p_payload,null);
 insert into public.supplier_rncp_photo_draft_requests(organization_id,actor_id,request_key,request_payload,report_id)
 values(org,auth.uid(),p_request,p_payload,r.id);
 return r;
end $$;
revoke all on function public.iq_rncp_initial_photo_guard(uuid,boolean),public.iq_rncp_initial_photo_manifest(uuid),
 public.iq_rncp_initial_photo_stage(uuid,jsonb),public.iq_rncp_initial_photo_commit(uuid,uuid[],integer,text),public.iq_rncp_initial_photo_draft(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.iq_rncp_initial_photo_manifest(uuid),public.iq_rncp_initial_photo_stage(uuid,jsonb),
 public.iq_rncp_initial_photo_commit(uuid,uuid[],integer,text),public.iq_rncp_initial_photo_draft(uuid,jsonb) to authenticated;
revoke all on function public.iq_rncp_initial_photo_reserve(uuid,jsonb),
 public.iq_rncp_initial_photo_attest(uuid,jsonb),public.iq_rncp_initial_photo_file_guard(),
 public.iq_rncp_initial_photo_controlled_link_guard() from public,anon,authenticated,service_role;
grant execute on function public.iq_rncp_initial_photo_reserve(uuid,jsonb) to authenticated;
grant execute on function public.iq_rncp_initial_photo_attest(uuid,jsonb) to service_role;

-- IQ-PROV-RNCP-PHOTO-KEY.sql | SHA-256 8a655ccc6cfdeaf31960ac3ec54d9b1a2fbee3db4a29f8b8116c440916ea9f90

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE t text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'PHOTO_KEY_OWNER_REQUIRED'; END IF;
 FOREACH t IN ARRAY ARRAY['supplier_rncp_initial_photo_sets','supplier_rncp_initial_photo_reservations','supplier_rncp_photo_draft_requests'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'PHOTO_KEY_V2_REQUIRED'; END IF;
 END LOOP;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_stage(uuid,jsonb)'))) IS DISTINCT FROM 'b4b19244589fafd07978483248a074a8'
  OR md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_file_guard()'))) IS DISTINCT FROM 'd7610fe3c6ad2f922570bf85a884d003'
 THEN RAISE EXCEPTION 'PHOTO_KEY_V2_FUNCTION_DRIFT'; END IF;
 IF md5(pg_get_indexdef(to_regclass('public.file_objects_one_current_resource_uidx'))) IS DISTINCT FROM '69b8f6acfd9971d405d24c32e7f82aba' THEN RAISE EXCEPTION 'PHOTO_KEY_INDEX_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM public.file_objects WHERE resource_type='supplier_rncp_initial_photo'
   OR (bucket_id='integraq-private' AND (object_path LIKE 'rncp-initial/%' OR preview_path LIKE 'rncp-initial/%')))
  OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='integraq-private' AND name LIKE 'rncp-initial/%')
  OR EXISTS(SELECT 1 FROM public.supplier_rncp_initial_photo_reservations)
  OR EXISTS(SELECT 1 FROM public.supplier_rncp_initial_photo_sets)
 THEN RAISE EXCEPTION 'PHOTO_KEY_EXISTING_DATA_REVIEW_NO_BACKFILL'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.iq_rncp_initial_photo_stage(p_report uuid,p_file jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; existing public.file_objects%rowtype; file_id uuid:=(p_file->>'id')::uuid; expected_path text; reservation public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 -- Same report lock as registration: photos cannot be attached after submit.
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 select a.* into reservation from public.supplier_rncp_initial_photo_reservations a where a.file_id=iq_rncp_initial_photo_stage.file_id;
 if reservation.file_id is null or reservation.organization_id is distinct from org
  or reservation.report_id is distinct from p_report or reservation.actor_id is distinct from auth.uid()
  or reservation.file_data is distinct from p_file or reservation.verified_at is null then
  raise exception using errcode='42501',message='PHOTO_BACKEND_VERIFICATION_REQUIRED';
 end if;
 if coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_file->>'mime','') not in ('image/jpeg','image/png','image/webp')
  or not (coalesce((p_file->>'size')::bigint,0) between 1 and 4194304) or coalesce(length(trim(p_file->>'name')),0) not between 1 and 180
  or not (coalesce((p_file->>'width')::integer,0) between 1 and 8192) or not (coalesce((p_file->>'height')::integer,0) between 1 and 8192)
  or (p_file->>'width')::bigint*(p_file->>'height')::bigint>25000000 then raise exception 'PHOTO_INVALID'; end if;
 expected_path:='rncp-initial/'||org::text||'/'||p_report::text||'/'||(p_file->>'sha256')||
  case p_file->>'mime' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
 if p_file->>'path' is distinct from expected_path or not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=expected_path
  and (metadata->>'size')::bigint=(p_file->>'size')::bigint and metadata->>'mimetype'=p_file->>'mime') then raise exception 'PHOTO_OBJECT_UNVERIFIED'; end if;
 select * into existing from public.file_objects where object_path=expected_path;
 if existing.id is not null then
  if existing.resource_type<>'supplier_rncp_initial_photo' or existing.workspace_id<>org or existing.resource_id<>p_report or existing.sha256<>p_file->>'sha256' or existing.deleted_at is not null
   or existing.resource_key is distinct from 'initial-photo:'||file_id::text
   or existing.category is not null or existing.version is distinct from 1 or existing.is_current is distinct from true
   or existing.id is distinct from file_id or existing.bucket_id is distinct from 'integraq-private'
   or existing.original_name is distinct from p_file->>'name' or existing.mime_type is distinct from p_file->>'mime'
   or existing.size_bytes is distinct from (p_file->>'size')::bigint
   or existing.observations::jsonb is distinct from jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)
   then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
  return existing.id;
 end if;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,resource_type,resource_id,
  resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
 values(file_id,'integraq-private',expected_path,p_file->>'name',p_file->>'mime',(p_file->>'size')::bigint,p_file->>'sha256','suppliers','internal',
  'supplier_rncp_initial_photo',p_report,'initial-photo:'||file_id::text,org,1,true,auth.uid(),'not_required',
  jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)::text,r.supplier_id);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.staged','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('file_id',file_id,'sha256',p_file->>'sha256'));
 return file_id;
end $$;
CREATE OR REPLACE FUNCTION public.iq_rncp_initial_photo_file_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare reserved public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 if tg_op in ('UPDATE','DELETE') and (old.resource_type='supplier_rncp_initial_photo'
  or (old.bucket_id='integraq-private' and old.object_path like 'rncp-initial/%')) then
  raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST';
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.bucket_id='integraq-private' and new.preview_path like 'rncp-initial/%' then
  raise exception 'PHOTO_RESERVED_PREVIEW_PATH';
 end if;
 if new.resource_type<>'supplier_rncp_initial_photo'
  and not (new.bucket_id='integraq-private' and new.object_path like 'rncp-initial/%') then return new; end if;
 if tg_op<>'INSERT' then raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST'; end if;
 select * into reserved from public.supplier_rncp_initial_photo_reservations where file_id=new.id;
 if not found or reserved.verified_at is null or new.resource_type is distinct from 'supplier_rncp_initial_photo'
  or new.bucket_id is distinct from 'integraq-private' or new.object_path is distinct from reserved.object_path
  or new.workspace_id is distinct from reserved.organization_id or new.resource_id is distinct from reserved.report_id
  or new.resource_key is distinct from 'initial-photo:'||reserved.file_id::text
  or new.category is not null or new.version is distinct from 1 or new.is_current is distinct from true
  or new.uploaded_by is distinct from reserved.actor_id or new.deleted_at is not null
  or new.original_name is distinct from reserved.file_data->>'name' or new.sha256 is distinct from reserved.file_data->>'sha256'
  or new.mime_type is distinct from reserved.file_data->>'mime' or new.size_bytes is distinct from reserved.size_bytes
  or new.audience::text is distinct from 'internal' or new.module_id is distinct from 'suppliers'
  or new.external_organization_id is distinct from (select supplier_id from public.supplier_rncp_reports where id=reserved.report_id)
  or new.observations::jsonb is distinct from jsonb_build_object('width',(reserved.file_data->>'width')::integer,'height',(reserved.file_data->>'height')::integer)
 then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 return new;
end $$;
ALTER FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.iq_rncp_initial_photo_file_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb),public.iq_rncp_initial_photo_file_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

-- IQ-PROV-RNCP-AUDIT-SECURITY.sql | SHA-256 76c948a8d294165fff4320cf3b96229deae5d6c90f5dcdd8ed367caff10c23e0

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE t text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'RNCP_AUDIT_OWNER_REQUIRED'; END IF;
 FOREACH t IN ARRAY ARRAY['audit_log','supplier_rncp_reports','supplier_rncp_notification_outbox','supplier_rncp_initial_photo_sets'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'RNCP_AUDIT_BASE_REQUIRED: %',t; END IF;
 END LOOP;
 IF to_regprocedure('public.iq_rncp_actor_org(boolean)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_stage(uuid,jsonb)')
    AND pg_get_userbyid(proowner)='postgres' AND position('initial-photo:' in prosrc)>0)
 THEN RAISE EXCEPTION 'RNCP_AUDIT_PHOTO_KEY_REQUIRED'; END IF;
 IF to_regprocedure('public.iq_rncp_audit_integrity()') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.audit_log'::regclass
   AND polname IN ('rncp_initial_photo_audit_organization','rncp_initial_photo_audit_server_insert','rncp_audit_no_update','rncp_audit_no_delete'))
 THEN RAISE EXCEPTION 'RNCP_AUDIT_ALREADY_PRESENT_REVIEW'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_log'::regclass AND tgname='audit_log_prepare' AND tgenabled<>'D')
 THEN RAISE EXCEPTION 'RNCP_AUDIT_PREPARE_TRIGGER_REQUIRED'; END IF;
END;
$preflight$;

-- Parent organization is authoritative; never trust actor_id or supplied organization alone.
-- Extends the existing proposed photo guard to reserve the mail/PDF namespaces too.
CREATE POLICY rncp_initial_photo_audit_organization ON public.audit_log
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
  CASE WHEN resource_type='supplier_rncp_report' THEN
   EXISTS(
    SELECT 1 FROM public.profiles p
    JOIN public.organizations o ON o.id=p.organization_id
    JOIN public.supplier_rncp_reports r ON r.id::text=audit_log.resource_id
    WHERE p.id=auth.uid() AND r.organization_id=p.organization_id
     AND p.status='active' AND p.user_type IN ('administrator','internal')
     AND coalesce(p.workspace_mode,'production')='production' AND o.kind='internal' AND o.active
     AND (r.deleted_at IS NULL OR p.user_type='administrator')
     AND public.has_module_permission('suppliers','view')
     AND public.has_permission('proveedores.acceder') AND public.has_permission('proveedores.ver')
   )
  WHEN left(action,18)='rncp.initial_photo' OR left(action,10)='rncp.mail_'
   OR action IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification') THEN false
  ELSE true END
 );
-- Authoritative SECURITY DEFINER RPCs owned by postgres bypass RLS.
-- Direct authenticated inserts cannot forge RNCP events, including their own records.
CREATE POLICY rncp_initial_photo_audit_server_insert ON public.audit_log
 AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (
  coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification')
 );
CREATE POLICY rncp_audit_no_update ON public.audit_log
 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'))
 WITH CHECK (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'));
CREATE POLICY rncp_audit_no_delete ON public.audit_log
 AS RESTRICTIVE FOR DELETE TO authenticated
 USING (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'));

-- SECURITY INVOKER deliberately: the trigger must observe the actual DML execution role.
-- A SECURITY DEFINER trigger here would incorrectly turn an authenticated insert into postgres.
CREATE FUNCTION public.iq_rncp_audit_integrity() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $integrity$
DECLARE protected_old boolean:=false; protected_new boolean:=false;
 r public.supplier_rncp_reports%rowtype; job jsonb; is_mail boolean;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  protected_old:=coalesce(OLD.resource_type,'')='supplier_rncp_report'
   OR left(coalesce(OLD.action,''),18)='rncp.initial_photo'
   OR left(coalesce(OLD.action,''),10)='rncp.mail_'
   OR coalesce(OLD.action,'') IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification');
  IF protected_old THEN RAISE EXCEPTION 'RNCP_AUDIT_IMMUTABLE'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 protected_new:=coalesce(NEW.resource_type,'')='supplier_rncp_report'
  OR left(coalesce(NEW.action,''),18)='rncp.initial_photo'
  OR left(coalesce(NEW.action,''),10)='rncp.mail_'
  OR coalesce(NEW.action,'') IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification');
 IF NOT protected_new THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING errcode='42501',message='RNCP_AUDIT_RPC_ONLY';
 END IF;
 IF NEW.resource_type IS DISTINCT FROM 'supplier_rncp_report' OR NEW.module IS DISTINCT FROM 'suppliers'
  OR NEW.actor_id IS NULL THEN RAISE EXCEPTION 'RNCP_AUDIT_IDENTITY_REQUIRED'; END IF;
 SELECT * INTO r FROM public.supplier_rncp_reports WHERE id::text=NEW.resource_id;
 IF r.id IS NULL OR r.organization_id IS NULL THEN RAISE EXCEPTION 'RNCP_AUDIT_PARENT_REQUIRED'; END IF;
 -- Runs AFTER audit_log_prepare: override inferred actor organization with the actual parent.
 NEW.organization_id:=r.organization_id;
 NEW.entity_code_snapshot:=r.folio;
 is_mail:=left(coalesce(NEW.action,''),10)='rncp.mail_';
 IF is_mail THEN
  -- JSON projection lets this guard be installed BEFORE the ENVIO columns exist.
  SELECT to_jsonb(j) INTO job FROM public.supplier_rncp_notification_outbox j
   WHERE j.report_id=r.id AND j.organization_id=r.organization_id AND j.event_type='initial';
  IF job IS NULL OR job->>'initial_phase' IS NULL THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_JOB_REQUIRED'; END IF;
  IF NEW.action IN ('rncp.mail_prepared','rncp.mail_preparation_revised','rncp.mail_claimed','rncp.mail_transport_result') THEN
   IF NEW.actor_id::text IS DISTINCT FROM job#>>'{initial_payload,actorId}' THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_ACTOR'; END IF;
  END IF;
  IF NEW.action='rncp.mail_preparation_revised' THEN
   IF job->>'initial_phase'<>'prepared' OR NEW.new_value IS DISTINCT FROM job->'initial_payload'
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_STATE'; END IF;
  ELSIF NEW.action IN ('rncp.mail_prepared','rncp.mail_claimed','rncp.mail_transport_result') THEN
   IF NEW.new_value IS DISTINCT FROM job THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_SNAPSHOT'; END IF;
   IF (NEW.action='rncp.mail_prepared' AND job->>'initial_phase'<>'prepared')
    OR (NEW.action='rncp.mail_claimed' AND job->>'initial_phase'<>'dispatching')
    OR (NEW.action='rncp.mail_transport_result' AND job->>'initial_phase' NOT IN ('dispatching','unknown','failed','accepted_pending_record'))
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_STATE'; END IF;
   IF job->>'initial_phase'='accepted_pending_record' AND (
     job#>>'{initial_receipt,outcome}' IS DISTINCT FROM 'accepted'
     OR nullif(job->>'provider_message_id','') IS NULL
     OR job->>'provider_message_id' IS DISTINCT FROM job#>>'{initial_receipt,messageId}'
     OR job->>'sent_at' IS NULL)
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_RECEIPT'; END IF;
  ELSIF NEW.action='rncp.mail_accepted' THEN
   IF NEW.actor_id IS DISTINCT FROM auth.uid()
    OR job->>'initial_phase'<>'accepted' OR job->>'delivery_state' IS DISTINCT FROM 'sent'
    OR job#>>'{initial_receipt,outcome}' IS DISTINCT FROM 'accepted'
    OR nullif(job->>'provider_message_id','') IS NULL
    OR job->>'provider_message_id' IS DISTINCT FROM job#>>'{initial_receipt,messageId}'
    OR job->>'sent_at' IS NULL
    OR NEW.new_value IS DISTINCT FROM to_jsonb(r)
    OR NEW.metadata->>'jobId' IS DISTINCT FROM job->>'id'
    OR NEW.metadata->'pdf' IS DISTINCT FROM job->'initial_payload'
    OR NEW.metadata->>'recipient' IS DISTINCT FROM job->>'recipient_email'
    OR r.notified_at IS DISTINCT FROM (job->>'sent_at')::timestamptz
    OR r.notification_reference IS DISTINCT FROM 'email:microsoft-graph:'||(job->>'provider_message_id')
   THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_ACCEPTANCE_REQUIRED'; END IF;
  ELSE RAISE EXCEPTION 'RNCP_MAIL_AUDIT_EVENT_UNSUPPORTED';
  END IF;
 END IF;
 RETURN NEW;
END;
$integrity$;
ALTER FUNCTION public.iq_rncp_audit_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_rncp_audit_integrity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_iq_rncp_audit_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log
 FOR EACH ROW EXECUTE FUNCTION public.iq_rncp_audit_integrity();
NOTIFY pgrst,'reload schema';

-- IQ-PROV-RNCP-FLUJO-FINAL.sql | SHA-256 5c214c57a4d6f4b7a8d9215a8851adb9be932c752760bb8a3b11c16f07d05d9d

-- Fail before any DDL if the reviewed dependencies or private storage guard are absent.
do $$
begin
 if to_regprocedure('public.iq_rncp_actor_org(boolean)') is null
   or to_regprocedure('public.iq_rncp_initial_photo_manifest(uuid)') is null
   or to_regprocedure('public.iq_rncp_is_inspector(uuid)') is null
   or to_regprocedure('public.save_supplier_rncp(uuid,text,jsonb,text)') is null
   then raise exception 'RNCP_FLOW_DEPENDENCIES_MISSING'; end if;
 if not exists(select 1 from storage.buckets where id='integraq-private' and not public) then raise exception 'RNCP_PRIVATE_BUCKET_REQUIRED'; end if;
 if not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='rncp_original_storage_guard'
   and not polpermissive and polcmd='*' and pg_get_expr(polqual,polrelid) like '%rncp-originals/%'
   and pg_get_expr(polwithcheck,polrelid) like '%rncp-originals/%') then raise exception 'RNCP_ORIGINAL_STORAGE_GUARD_REQUIRED'; end if;
 if not has_table_privilege('service_role','public.file_objects','SELECT') then raise exception 'RNCP_FILE_METADATA_SELECT_REQUIRED'; end if;
end $$;
alter table public.supplier_rncp_reports add column classification text
  constraint supplier_rncp_classification_check check (classification in ('QAC','Hilo','Avíos'));
CREATE OR REPLACE FUNCTION public.save_supplier_rncp(requested_report_id uuid, requested_action text, requested_payload jsonb DEFAULT '{}'::jsonb, requested_reason text DEFAULT NULL::text)
 RETURNS supplier_rncp_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_org uuid := public.iq_rncp_actor_org(false);
  selected_classification text := nullif(requested_payload->>'classification','');
  actor_type public.app_user_type;
  current_report public.supplier_rncp_reports%rowtype;
  saved_report public.supplier_rncp_reports%rowtype;
  report_id uuid := coalesce(requested_report_id, gen_random_uuid());
  report_folio text;
  supplier_id uuid := nullif(requested_payload->>'supplierId', '')::uuid;
  site_id uuid := nullif(requested_payload->>'siteId', '')::uuid;
  report_date date := nullif(requested_payload->>'reportDate', '')::date;
  finding_type text := nullif(trim(requested_payload->>'findingType'), '');
  material_or_service text := nullif(trim(requested_payload->>'materialOrService'), '');
  description text := nullif(trim(requested_payload->>'description'), '');
  responsible_name text := nullif(trim(requested_payload->>'responsibleName'), '');
  response_due_date date := nullif(requested_payload->>'responseDueDate', '')::date;
  reason text := nullif(trim(coalesce(requested_reason, '')), '');
  next_status text;
  audit_action text;
begin
  select user_type into actor_type from public.profiles where id = actor_id and status = 'active';
  if actor_id is null or actor_type not in ('administrator', 'internal')
    or not public.has_module_permission('suppliers', 'update') then
    raise exception using errcode = '42501', message = 'RNCP_WRITE_FORBIDDEN';
  end if;
  if requested_action='close' then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  if requested_action not in ('draft', 'submit', 'progress', 'close', 'reopen', 'correct') then
    raise exception using errcode = '22023', message = 'RNCP_ACTION_INVALID';
  end if;

  if requested_report_id is not null then
    select * into current_report from public.supplier_rncp_reports where id = requested_report_id and organization_id = actor_org for update;
    if current_report.id is null then
      raise exception using errcode = '22023', message = 'RNCP_NOT_FOUND';
    end if;
    if current_report.deleted_at is not null then
      raise exception using errcode = '22023', message = 'RNCP_DELETED';
    end if;
  end if;

  if requested_action in ('draft','submit','correct') then
    if not (requested_payload ? 'classification') then selected_classification := current_report.classification; end if;
    if current_report.source_kind='historical' and selected_classification is distinct from current_report.classification then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
    if current_report.id is null or current_report.source_kind='native' then
      if (selected_classification is null and requested_action <> 'draft') or selected_classification not in ('QAC','Hilo','Avíos') then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
    end if;
  end if;

  if requested_action in ('submit', 'correct') then
    if supplier_id is null or report_date is null or finding_type is null
      or material_or_service is null or description is null or responsible_name is null
      then
      raise exception using errcode = '23514', message = 'RNCP_REQUIRED_FIELDS_MISSING';
    end if;
    if exists (
      select 1 from public.external_company_sites site
      where site.company_id = supplier_id and site.active
    ) and site_id is null then
      raise exception using errcode = '23514', message = 'RNCP_SITE_REQUIRED';
    end if;
  end if;
  if supplier_id is not null and not exists (
    select 1 from public.organizations organization
    where organization.id = supplier_id and organization.kind = 'supplier' and organization.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SUPPLIER_INVALID';
  end if;
  if site_id is not null and not exists (
    select 1 from public.external_company_sites site
    where site.id = site_id and site.company_id = supplier_id and site.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SITE_INVALID';
  end if;

  if current_report.id is null then
    if requested_action not in ('draft', 'submit') then
      raise exception using errcode = '22023', message = 'RNCP_CREATE_ACTION_INVALID';
    end if;
    next_status := case when requested_action = 'submit' then 'submitted' else 'draft' end;
    report_folio := 'ASSIGNED_BY_TRIGGER';
    insert into public.supplier_rncp_reports(
      id, folio, classification, supplier_id, site_id, report_date, purchase_order,
      material_or_service, finding_type, rejected_quantity, description,
      immediate_disposition, response_due_date, responsible_name, status,
      submitted_at, portal_visible, created_by, updated_by
    ) values (
      report_id, report_folio, selected_classification, supplier_id, site_id, report_date,
      null, material_or_service,
      finding_type, nullif(requested_payload->>'rejectedQuantity', '')::numeric,
      description, nullif(trim(requested_payload->>'immediateDisposition'), ''),
      response_due_date, responsible_name, next_status,
      case when next_status = 'submitted' then now() else null end,
      coalesce((requested_payload->>'portalVisible')::boolean, true), actor_id, actor_id
    ) returning * into saved_report;
    report_folio := saved_report.folio;
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (actor_id, 'suppliers', 'rncp.created', 'supplier_rncp_report', report_id::text, report_folio,
      jsonb_build_object('status', next_status), jsonb_build_object('supplier_id', supplier_id, 'site_id', site_id));
    audit_action := case when next_status = 'submitted' then 'rncp.submitted' else 'rncp.draft_saved' end;
  else
    report_folio := current_report.folio;
    if requested_action = 'draft' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_DRAFT_LOCKED'; end if;
      next_status := 'draft'; audit_action := 'rncp.draft_saved';
    elsif requested_action = 'submit' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_ALREADY_SUBMITTED'; end if;
      next_status := 'submitted'; audit_action := 'rncp.submitted';
    elsif requested_action = 'progress' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := coalesce(responsible_name, current_report.responsible_name);
      response_due_date := coalesce(response_due_date, current_report.response_due_date);
      next_status := 'in_progress'; audit_action := 'rncp.assigned';
    elsif requested_action = 'close' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'closed'; audit_action := 'rncp.closed';
    elsif requested_action = 'reopen' then
      if actor_type <> 'administrator' or reason is null then raise exception using errcode = '42501', message = 'RNCP_ADMIN_REASON_REQUIRED'; end if;
      if current_report.status <> 'closed' then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'in_progress'; audit_action := 'rncp.reopened';
    else
      if actor_type <> 'administrator' or reason is null then raise exception using errcode = '42501', message = 'RNCP_ADMIN_REASON_REQUIRED'; end if;
      next_status := current_report.status; audit_action := 'rncp.corrected';
    end if;

    perform set_config('integraq.rncp.change_reason',coalesce(reason,''),true);
    update public.supplier_rncp_reports set
      supplier_id = save_supplier_rncp.supplier_id,
      site_id = save_supplier_rncp.site_id,
      report_date = save_supplier_rncp.report_date,
      purchase_order = current_report.purchase_order,
      classification = case when requested_action in ('draft','submit','correct') then selected_classification else current_report.classification end,
      material_or_service = save_supplier_rncp.material_or_service,
      finding_type = save_supplier_rncp.finding_type,
      rejected_quantity = case when requested_action in ('draft', 'submit', 'correct') then nullif(requested_payload->>'rejectedQuantity', '')::numeric else rejected_quantity end,
      description = save_supplier_rncp.description,
      immediate_disposition = case when requested_action in ('draft', 'submit', 'progress', 'correct') then coalesce(nullif(trim(requested_payload->>'immediateDisposition'), ''), immediate_disposition) else immediate_disposition end,
      response_due_date = save_supplier_rncp.response_due_date,
      responsible_name = save_supplier_rncp.responsible_name,
      status = next_status,
      submitted_at = case when requested_action = 'submit' then now() else submitted_at end,
      closed_at = case when requested_action = 'close' then now() when requested_action = 'reopen' then null else closed_at end,
      updated_by = actor_id
    where id = current_report.id
    returning * into saved_report;
  end if;

  insert into public.audit_log(
    actor_id, module, action, resource_type, resource_id, entity_code_snapshot,
    previous_value, new_value, reason, metadata
  ) values (
    actor_id, 'suppliers', audit_action, 'supplier_rncp_report', saved_report.id::text,
    saved_report.folio,
    case when current_report.id is null then null else to_jsonb(current_report) end,
    to_jsonb(saved_report),
    reason, jsonb_build_object('supplier_id', saved_report.supplier_id, 'site_id', saved_report.site_id)
  );
  return saved_report;
end;
$function$;
revoke all on function public.save_supplier_rncp(uuid,text,jsonb,text) from public,anon;
grant execute on function public.save_supplier_rncp(uuid,text,jsonb,text) to authenticated;

create function public.iq_rncp_flow_contract() returns integer language plpgsql stable security definer set search_path='' as $$
begin perform public.iq_rncp_actor_org(false); return 1; end $$;
revoke all on function public.iq_rncp_flow_contract() from public,anon;
grant execute on function public.iq_rncp_flow_contract() to authenticated;

-- Snapshot is derived from stored data only. It serializes behind authorized report writes.
create function public.iq_rncp_pdf_snapshot(p_report uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); r public.supplier_rncp_reports%rowtype; payload jsonb;
begin
 if not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org and deleted_at is null for update;
 if r.id is null or r.source_kind is distinct from 'native' or r.supplier_id is null then raise exception using errcode='42501',message='RNCP_PDF_NATIVE_ONLY'; end if;
 if r.folio !~ '^RNCP[0-9]+$' then raise exception 'RNCP_FOLIO_REVIEW_REQUIRED'; end if;
 if r.classification is null then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
 select jsonb_build_object('report',to_jsonb(r),
   'supplier',jsonb_build_object('id',s.id,'code',s.code,'name',s.name),
   'site', (select jsonb_build_object('name',x.name) from public.external_company_sites x where x.id=r.site_id and x.company_id=r.supplier_id),
   'photos',public.iq_rncp_initial_photo_manifest(r.id),
   'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'responsible',a.responsible_name,'dueDate',a.due_date,'status',a.status,'executedAt',a.executed_at,
     'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'sha256',f.sha256) order by f.id)
       from public.supplier_rncp_action_evidence e join public.file_objects f on f.id=e.file_id
       where e.action_id=a.id and f.deleted_at is null and f.workspace_id=org),'[]'::jsonb)) order by a.id)
     from public.supplier_rncp_actions a where a.report_id=r.id),'[]'::jsonb)) into payload
 from public.organizations s where s.id=r.supplier_id and s.kind='supplier' and s.active;
 if payload is null then raise exception 'RNCP_SUPPLIER_INVALID'; end if;
 return jsonb_build_object('snapshot',payload,'fingerprint',encode(extensions.digest(payload::text,'sha256'),'hex'));
end $$;

-- Authenticated callers cannot write rncp-originals objects. Only the backend uploads
-- actual bytes and sets user_metadata. The RPC verifies that protected attestation.
create function public.iq_rncp_register_generated_pdf(p_report uuid,p_fingerprint text,p_file jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snap jsonb; r jsonb; obj storage.objects%rowtype; existing public.file_objects%rowtype;
 org uuid; path text; next_version integer; file_id uuid; bytes bigint; hash text;
begin
 snap:=public.iq_rncp_pdf_snapshot(p_report); r:=snap->'snapshot'->'report'; org:=(r->>'organization_id')::uuid;
 if r->>'status'='draft' then raise exception 'RNCP_REGISTERED_REPORT_REQUIRED'; end if;
 if p_fingerprint is null or p_fingerprint is distinct from snap->>'fingerprint' then raise exception 'RNCP_PDF_CONFLICT'; end if;
 path:='rncp-originals/'||org::text||'/'||auth.uid()::text||'/generated/'||p_report::text||'/'||p_fingerprint||'.pdf';
 select * into existing from public.file_objects where workspace_id=org and resource_type='supplier_rncp_original'
   and resource_id=p_report and resource_key='generated:'||p_fingerprint and deleted_at is null;
 if existing.id is not null then return jsonb_build_object('fileId',existing.id,'version',existing.version,'state','existing'); end if;
 select * into obj from storage.objects where bucket_id='integraq-private' and name=path;
 file_id:=(p_file->>'id')::uuid; bytes:=(p_file->>'sizeBytes')::bigint; hash:=p_file->>'sha256';
 if obj.id is null or file_id is null or bytes is null or hash is null or hash !~ '^[a-f0-9]{64}$' or bytes not between 8 and 4194304
   or obj.metadata->>'mimetype' is distinct from 'application/pdf' or (obj.metadata->>'size')::bigint is distinct from bytes
   or not coalesce(obj.user_metadata @> jsonb_build_object('rncpSnapshot',p_fingerprint,'sha256',hash,'fileId',file_id::text,'actorId',auth.uid()::text),false)
 then raise exception using errcode='42501',message='RNCP_PDF_UNVERIFIED'; end if;
 select coalesce(max(f.version),0)+1 into next_version from public.file_objects f where f.resource_type='supplier_rncp_original' and f.resource_id=p_report;
 update public.file_objects set is_current=false where resource_type='supplier_rncp_original' and resource_id=p_report and is_current;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,
   resource_type,resource_id,resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
 values(file_id,'integraq-private',path,(r->>'folio')||'-F-CA-25.pdf','application/pdf',bytes,hash,'suppliers','internal',
   'supplier_rncp_original',p_report,'generated:'||p_fingerprint,org,next_version,true,auth.uid(),'not_required',
   jsonb_build_object('kind','generated','snapshot',p_fingerprint,'method','F-CA-25 V1','reportUpdatedAt',r->>'updated_at')::text,(r->>'supplier_id')::uuid);
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,metadata)
 values(auth.uid(),'suppliers','rncp.pdf_generated','supplier_rncp_report',p_report::text,r->>'folio',null,
   jsonb_build_object('file_id',file_id,'version',next_version,'sha256',hash),jsonb_build_object('snapshot',p_fingerprint,'notified',false));
 return jsonb_build_object('fileId',file_id,'version',next_version,'state','created');
end $$;
revoke all on function public.iq_rncp_pdf_snapshot(uuid),public.iq_rncp_register_generated_pdf(uuid,text,jsonb) from public,anon;
grant execute on function public.iq_rncp_pdf_snapshot(uuid),public.iq_rncp_register_generated_pdf(uuid,text,jsonb) to authenticated;

-- Runs after iq_rncp_report_guard, so native origin and organization are already established.
create function public.iq_rncp_flow_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_org uuid; reason text:=nullif(trim(current_setting('integraq.rncp.change_reason',true)),'');
begin
 if tg_op='UPDATE' then
   if new.source_kind='native' and (new.closed_at is distinct from old.closed_at and new.closed_at is not null or new.status='closed' and old.status<>'closed')
     and (new.validation_outcome is distinct from 'accepted' or new.validated_at is null or not public.iq_rncp_is_inspector(new.organization_id))
     then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
   if new.folio is distinct from old.folio then raise exception 'RNCP_FOLIO_IMMUTABLE'; end if;
   if old.status='draft' and new.status<>'draft' and new.source_kind='native' and new.classification is null then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
   if new.classification is not distinct from old.classification then return new; end if;
   if old.source_kind='historical' then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
 end if;
 if new.source_kind='native' or (tg_op='UPDATE' and new.classification is distinct from old.classification) then
   actor_org:=public.iq_rncp_actor_org(false);
   if actor_org is distinct from new.organization_id or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
   if new.classification is null and new.status <> 'draft' then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
   if tg_op='INSERT' then
     perform pg_advisory_xact_lock(hashtextextended('integraq:rncp:official-folio',0));
     select 'RNCP'||lpad((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text,
       greatest(4,length((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text)),'0')
       into new.folio from public.supplier_rncp_reports r where r.folio ~ '^RNCP[0-9]+$';
   else
     if old.status<>'draft' and (reason is null or public.iq_rncp_actor_org(true) is distinct from actor_org) then raise exception 'RNCP_ADMIN_REASON_REQUIRED'; end if;
     insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
       values(auth.uid(),'suppliers','rncp.classification_changed','supplier_rncp_report',new.id::text,
       jsonb_build_object('classification',old.classification),jsonb_build_object('classification',new.classification),reason);
   end if;
 end if;
 return new;
end $$;
revoke all on function public.iq_rncp_flow_guard() from public,anon,authenticated;
create trigger zz_iq_rncp_flow_guard before insert or update on public.supplier_rncp_reports for each row execute function public.iq_rncp_flow_guard();
-- Preserve grants and all existing delivery, validation and reconciliation branches.
do $$
begin
  if (select md5(prosrc) from pg_proc where oid='public.iq_rncp_followup_command(uuid,text,jsonb)'::regprocedure) is distinct from 'e16c46a870b35422b6b494436fc10d67' then
    raise exception 'RNCP_FOLLOWUP_DEFINITION_CHANGED';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.iq_rncp_followup_command(p_report_id uuid, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.supplier_rncp_reports%rowtype; org uuid; a public.supplier_rncp_actions%rowtype; actor public.profiles%rowtype; missing text[];
  official public.file_objects%rowtype;
  revision_key text;
  proof jsonb := '{}'::jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  select * into r from public.supplier_rncp_reports where id=p_report_id and deleted_at is null for update;
  if actor.id is null or r.id is null or r.organization_id is null or not public.iq_rncp_read_scope(r.id) then
    raise exception using errcode='42501',message='RNCP_FORBIDDEN';
  end if;
  if r.source_kind='historical' and p_command<>'reconcile' then raise exception using errcode='55000',message='RNCP_HISTORICAL_NO_TIMER'; end if;
  if p_command='record_manual_notification' then
    org:=public.iq_rncp_actor_org();
    if not (public.is_administrator() or public.iq_rncp_is_inspector(org)) or r.organization_id<>org then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if r.notified_at is not null then raise exception using errcode='55000',message='RNCP_NOTIFICATION_IMMUTABLE'; end if;
    if length(trim(coalesce(p_payload->>'reference','')))<8 or nullif(p_payload->>'notifiedAt','') is null
      or (p_payload->>'notifiedAt')::timestamptz>now()
      or (p_payload->>'notifiedAt')::timestamptz<(r.report_date::timestamp at time zone 'America/Mexico_City') then
      raise exception using errcode='22023',message='RNCP_NOTIFICATION_PROOF_REQUIRED';
    end if;
    if r.source_kind is distinct from 'native' or r.status is distinct from 'submitted' or r.closed_at is not null then
      raise exception using errcode='55000',message='RNCP_REGISTERED_REPORT_REQUIRED';
    end if;
    revision_key := public.iq_rncp_pdf_snapshot(r.id)->>'fingerprint';
    select f.* into official from public.file_objects f
      where f.id=(p_payload->>'officialFileId')::uuid and f.version=(p_payload->>'officialVersion')::integer
        and f.workspace_id=org and f.resource_id=r.id and f.resource_type='supplier_rncp_original'
        and f.bucket_id='integraq-private' and f.is_current and f.deleted_at is null
        and f.resource_key='generated:'||revision_key and f.sha256 ~ '^[a-f0-9]{64}$'
        and f.created_at <= (p_payload->>'notifiedAt')::timestamptz
        and exists(select 1 from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path)
      for share of f;
    if official.id is null then raise exception using errcode='55000',message='RNCP_CURRENT_OFFICIAL_PDF_REQUIRED'; end if;
    proof := jsonb_build_object('communication','manual','communicatedAt',p_payload->>'notifiedAt',
      'officialFileId',official.id,'officialVersion',official.version,'officialSha256',official.sha256,'reportFingerprint',revision_key);
    update public.supplier_rncp_reports set notified_at=(p_payload->>'notifiedAt')::timestamptz,
      notification_reference=trim(p_payload->>'reference'),response_deadline=(p_payload->>'notifiedAt')::timestamptz+interval '7 days',
      response_due_date=(((p_payload->>'notifiedAt')::timestamptz+interval '7 days') at time zone 'America/Mexico_City')::date,
      status='submitted',response_requirements=jsonb_build_object('containment',coalesce((p_payload->>'containmentRequired')::boolean,false),
      'documents',coalesce(p_payload->'requiredDocuments','[]'::jsonb)),updated_by=auth.uid() where id=r.id;
  elsif p_command='submit_delivery' then
    if actor.user_type<>'supplier' or actor.external_party_id is distinct from r.supplier_id or r.notified_at is null then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    select * into a from public.supplier_rncp_actions where id=(p_payload->>'actionId')::uuid and report_id=r.id and created_by=auth.uid() for update;
    if a.status='submitted' and r.validation_outcome='pending' then return jsonb_build_object('state','validation','alreadySubmitted',true); end if;
    missing:=public.iq_rncp_missing_requirements(r.id,a.id);
    if a.id is null or cardinality(missing)>0 then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE',detail=array_to_string(missing,', '); end if;
    update public.supplier_rncp_actions set status='submitted',submitted_at=now() where id=a.id;
    update public.supplier_rncp_reports set complete_submitted_at=now(),validation_outcome='pending',status='in_progress',updated_by=auth.uid() where id=r.id;
  elsif p_command in ('approve','reject') then
    if not public.iq_rncp_is_inspector(r.organization_id) or r.complete_submitted_at is null or r.validation_outcome is distinct from 'pending' then
      raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED';
    end if;
    if nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='22023',message='RNCP_REASON_REQUIRED'; end if;
    select * into a from public.supplier_rncp_actions where report_id=r.id and status='submitted' order by submitted_at desc limit 1 for update;
    if p_command='approve' and (a.id is null or cardinality(public.iq_rncp_missing_requirements(r.id,a.id))>0) then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE'; end if;
    update public.supplier_rncp_actions set status=case when p_command='approve' then 'accepted'::public.supplier_response_status else 'rejected'::public.supplier_response_status end,
      validated_at=now(),validated_by=auth.uid(),validation_comment=trim(p_payload->>'reason') where id=a.id;
    update public.supplier_rncp_reports set validation_outcome=case when p_command='approve' then 'accepted' else 'rejected' end,
      validated_at=now(),validated_by=auth.uid(),validation_note=trim(p_payload->>'reason'),
      closed_at=case when p_command='approve' then now() else null end,status=case when p_command='approve' then 'closed' else 'in_progress' end,updated_by=auth.uid() where id=r.id;
  elsif p_command='reconcile' then
    org:=public.iq_rncp_actor_org(true);
    if org<>r.organization_id or r.supplier_id is not null or nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='42501',message='RNCP_RECONCILIATION_REQUIRED'; end if;
    if not exists(select 1 from public.organizations s where s.id=(p_payload->>'supplierId')::uuid and s.kind='supplier'
      and (s.owning_organization_id is null or s.owning_organization_id=org)) then raise exception using errcode='42501',message='RNCP_SUPPLIER_SCOPE_CONFLICT'; end if;
    update public.supplier_rncp_reports set supplier_id=(p_payload->>'supplierId')::uuid,updated_by=auth.uid() where id=r.id;
  else raise exception using errcode='22023',message='RNCP_COMMAND_INVALID';
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,reason,metadata)
    values(auth.uid(),'suppliers','rncp.'||p_command,'supplier_rncp_report',r.id::text,r.folio,p_payload->>'reason',
      jsonb_build_object('previous_deadline',r.response_deadline,'notification_reference',p_payload->>'reference','command',p_command) || proof);
  return jsonb_build_object('id',r.id,'folio',r.folio);
end $function$;

COMMIT;
