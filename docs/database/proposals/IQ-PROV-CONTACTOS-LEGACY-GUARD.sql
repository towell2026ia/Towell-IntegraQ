-- Protección complementaria de contactos múltiples. Propuesta local; no ejecutar sin autorización.
-- La RPC antigua reconstruye supplierQualityContacts y descartaría contacts[].
begin;

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
commit;
