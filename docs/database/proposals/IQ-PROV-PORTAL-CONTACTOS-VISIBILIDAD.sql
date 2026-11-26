-- U07-R5.2. Consentimiento de publicación de contactos; todos comienzan privados.
begin;

-- El SELECT histórico de la empresa también alcanza su JSON completo, incluso con sucursal restringida.
-- Los titulares externos leen la proyección de abajo. Personal interno y clientes conservan sus reglas.
create policy supplier_directory_private_contacts on public.organizations as restrictive
for select to authenticated using (
  kind <> 'supplier' or (select p.user_type from public.profiles p where p.id=(select auth.uid()))
    in ('internal','administrator','customer')
);

-- No duplica nombres, teléfonos ni correos. Sólo el administrador puede conceder visibilidad.
create table public.supplier_contact_publications (
  supplier_id uuid not null references public.organizations(id),
  contact_id text not null,
  site_ids uuid[] check (site_ids is null or cardinality(site_ids) > 0),
  primary key (supplier_id, contact_id)
);
alter table public.supplier_contact_publications enable row level security;
revoke all on public.supplier_contact_publications from public, anon, authenticated, service_role;

-- Un cambio de identidad o datos publicados requiere una nueva decisión. También protege editores anteriores.
create function public.iq_supplier_expire_contact_publications() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  with removed as (
    delete from public.supplier_contact_publications g where g.supplier_id = new.id
    and not exists (
      select 1
      from jsonb_array_elements(old.metadata #> '{supplierQualityContacts,contacts}') old_contact
      join jsonb_array_elements(new.metadata #> '{supplierQualityContacts,contacts}') new_contact
        on new_contact->>'id' = old_contact->>'id'
      where new_contact->>'id' = g.contact_id and (old_contact - 'notifyRncp') = (new_contact - 'notifyRncp')
        and coalesce(new_contact->>'retired','false') = 'false'
    ) returning contact_id, site_ids
  )
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
  select auth.uid(), coalesce(new.owning_organization_id,(select organization_id from public.profiles where id=auth.uid())),
    'suppliers','supplier.contact.visibility.expired','supplier',new.id::text,
    jsonb_build_object('contactId',contact_id,'previousSites',site_ids) from removed;
  return new;
end
$fn$;
revoke all on function public.iq_supplier_expire_contact_publications() from public, anon, authenticated, service_role;
create trigger supplier_contact_visibility_on_change after update of metadata on public.organizations
for each row when (old.kind='supplier' and (old.metadata #> '{supplierQualityContacts,contacts}')
  is distinct from (new.metadata #> '{supplierQualityContacts,contacts}'))
execute function public.iq_supplier_expire_contact_publications();

create function public.iq_supplier_contact_publication_settings(p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.iq_supplier_portal_admin(p_supplier);
  return jsonb_build_object(
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
      from public.external_company_sites where company_id=p_supplier and active),'[]'::jsonb),
    'visibility',coalesce((select jsonb_object_agg(contact_id,case when site_ids is null then jsonb_build_object('scope','company')
      else jsonb_build_object('scope','sites','sites',site_ids) end)
      from public.supplier_contact_publications where supplier_id=p_supplier),'{}'::jsonb));
end
$fn$;

-- Se reutilizan la revisión, el bloqueo del proveedor, las validaciones y la bitácora de contactos V2.
create function public.iq_supplier_save_contact_publications(p_supplier uuid,p_contacts jsonb,
  p_expected_updated_at timestamptz,p_reason text,p_changes jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  tenant uuid := public.iq_supplier_portal_admin(p_supplier);
  change record;
  entry jsonb;
  selected_sites uuid[];
  old_scope jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'CONTACT_VISIBILITY_INVALID'; end if;
  perform public.iq_supplier_audit_contacts_v2(p_supplier,p_contacts,p_expected_updated_at,p_reason);
  for change in select key,value from jsonb_each(p_changes) order by key loop
    select c into entry from jsonb_array_elements(p_contacts->'contacts') c where c->>'id'=change.key;
    if entry is null then raise exception 'CONTACT_VISIBILITY_INVALID'; end if;
    select case when site_ids is null then jsonb_build_object('scope','company') else jsonb_build_object('scope','sites','sites',site_ids) end
      into old_scope from public.supplier_contact_publications where supplier_id=p_supplier and contact_id=change.key;
    if change.value = 'null'::jsonb then
      delete from public.supplier_contact_publications where supplier_id=p_supplier and contact_id=change.key;
    else
      if coalesce(entry->>'retired','false') <> 'false' or exists (
        select 1 from auth.users u join public.profiles p on p.id=u.id where lower(trim(u.email))=lower(trim(entry->>'email'))
        and (p.user_type <> 'supplier' or (p.external_party_id is not null and p.external_party_id <> p_supplier))
      ) then raise exception 'CONTACT_VISIBILITY_INELIGIBLE'; end if;
      if change.value = '{"scope":"company"}'::jsonb then
        selected_sites := null;
      elsif change.value->>'scope' = 'sites' and change.value - array['scope','sites'] = '{}'::jsonb
        and jsonb_typeof(change.value->'sites')='array' then
        select array_agg(s.id order by s.id) into selected_sites from public.external_company_sites s
          where s.company_id=p_supplier and s.active and change.value->'sites' @> jsonb_build_array(s.id::text);
        if selected_sites is null or cardinality(selected_sites) <> jsonb_array_length(change.value->'sites') then
          raise exception 'CONTACT_VISIBILITY_SITES';
        end if;
      else raise exception 'CONTACT_VISIBILITY_INVALID'; end if;
      insert into public.supplier_contact_publications(supplier_id,contact_id,site_ids)
      values(p_supplier,change.key,selected_sites) on conflict (supplier_id,contact_id) do update set site_ids=excluded.site_ids;
    end if;
    if coalesce(old_scope,'null'::jsonb) <> change.value then
      insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata,reason)
      values(auth.uid(),tenant,'suppliers','supplier.contact.visibility.changed','supplier',p_supplier::text,
        jsonb_build_object('contactId',change.key,'previous',old_scope,'current',change.value),p_reason);
    end if;
  end loop;
end
$fn$;

-- Proyección del expediente externo. La empresa y sucursal proceden de la cuenta vigente.
create function public.iq_supplier_portal_own_profile(p_identity_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  actor public.profiles%rowtype;
  supplier public.organizations%rowtype;
  verified_email text;
  directory jsonb;
  contacts jsonb;
begin
  perform public.iq_supplier_portal_tenant();
  select * into strict actor from public.profiles where id=auth.uid();
  select lower(trim(email)) into verified_email from auth.users where id=actor.id and email_confirmed_at is not null;
  if nullif(verified_email,'') is null then raise exception using errcode='42501',message='PORTAL_SCOPE'; end if;
  select * into strict supplier from public.organizations where id=actor.external_party_id;
  if p_identity_only then
    return jsonb_build_object('kind',supplier.kind,'name',supplier.name,'code',supplier.code);
  end if;
  directory := coalesce(supplier.metadata->'supplierQualityContacts','{}'::jsonb);
  with v2 as (
    select c from jsonb_array_elements(coalesce(directory->'contacts','[]'::jsonb)) c
  ), legacy(id,name,email,phone,purpose) as (values
    ('legacy-primary',coalesce(nullif(directory->>'notificationName',''),directory->>'qualityName',''),
      coalesce(nullif(directory->>'email',''),supplier.contact_email),directory->>'phone','Notificaciones RNCP'),
    ('legacy-alternate',directory->>'alternateName',directory->>'alternateEmail',directory->>'alternatePhone','Contacto alterno')
  ), entries as (
    select c from v2
    union all (select distinct on (lower(trim(l.email))) jsonb_build_object('id',l.id,'email',l.email,'name',l.name,'phone',l.phone,'purpose',l.purpose)
      from legacy l where lower(trim(l.email))=verified_email and not exists
      (select 1 from v2 where c->>'id'=l.id or lower(trim(c->>'email'))=verified_email)
      order by lower(trim(l.email)),(l.id='legacy-primary') desc)
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(c->>'name',''),'email',c->>'email',
    'purpose',coalesce(nullif(c->>'purpose',''),c->>'position',''),'phone',coalesce(c->>'phone',''))
    order by c->>'name',c->>'id'),'[]'::jsonb) into contacts from entries
  where coalesce(c->>'retired','false')='false' and nullif(trim(c->>'email'),'') is not null
    and not exists (select 1 from auth.users u join public.profiles p on p.id=u.id
      where lower(trim(u.email))=lower(trim(c->>'email')) and (p.user_type <> 'supplier' or (p.external_party_id is not null and p.external_party_id <> supplier.id)))
    and (lower(trim(c->>'email'))=verified_email or exists (
      select 1 from public.supplier_contact_publications g where g.supplier_id=supplier.id and g.contact_id=c->>'id'
        and (g.site_ids is null or exists (
          select 1 from public.external_company_sites s where s.company_id=supplier.id and s.active and s.id=any(g.site_ids)
            and (actor.external_site_id is null or actor.external_site_id=s.id)))));
  return jsonb_build_object('name',supplier.name,'code',supplier.code,'category',supplier.category,'contacts',contacts,
    'sites',coalesce((select jsonb_agg(name order by name,id) from public.external_company_sites
      where company_id=supplier.id and active and (actor.external_site_id is null or id=actor.external_site_id)),'[]'::jsonb));
end
$fn$;

revoke all on function public.iq_supplier_contact_publication_settings(uuid),
  public.iq_supplier_save_contact_publications(uuid,jsonb,timestamptz,text,jsonb),
  public.iq_supplier_portal_own_profile(boolean) from public, anon, service_role;
grant execute on function public.iq_supplier_contact_publication_settings(uuid),
  public.iq_supplier_save_contact_publications(uuid,jsonb,timestamptz,text,jsonb),
  public.iq_supplier_portal_own_profile(boolean) to authenticated;
commit;
