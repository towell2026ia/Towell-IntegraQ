-- Propuesta local. Aplicar sólo tras autorización y validación en Preview aislado.
-- Conserva supplierQualityContacts y sus campos históricos; agrega exclusivamente contacts[].
begin;

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
language sql stable security invoker set search_path = '' as $
  select has_function_privilege('authenticated', 'public.iq_supplier_audit_contacts_v2(uuid,jsonb,timestamptz,text)', 'EXECUTE')
    and exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.organizations'::regclass
      and tgname='supplier_audit_contact_collection_guard' and tgenabled in ('O','A'))
    and exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.audit_log'::regclass
      and tgname='supplier_audit_contact_log_guard' and tgenabled in ('O','A'));
$;
revoke all on function public.iq_supplier_contacts_ready() from public, anon;
grant execute on function public.iq_supplier_contacts_ready() to authenticated;
commit;
