-- Add verified ownership and seed only AV-PL-01 client names and abbreviations.
-- Existing organizations remain unchanged; unverified ownership stays NULL.
alter table public.organizations
  add column if not exists owning_organization_id uuid,
  add column if not exists legal_name text,
  add column if not exists tax_id text,
  add column if not exists address text;

do $ownership_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_owning_organization_id_fkey'
  ) then
    alter table public.organizations
      add constraint organizations_owning_organization_id_fkey
      foreign key (owning_organization_id) references public.organizations(id) on delete restrict;
  end if;
end
$ownership_fk$;

create or replace function public.iq_validate_external_company_owner() returns trigger
language plpgsql security invoker set search_path = '' as $guard$
declare
  owner_kind public.organization_kind;
  owner_active boolean;
begin
  if tg_op = 'UPDATE' and old.kind in ('customer', 'supplier') then
    if new.kind is distinct from old.kind or
      new.owning_organization_id is distinct from old.owning_organization_id then
      raise exception using errcode = '42501', message = 'EXTERNAL_COMPANY_OWNER_IMMUTABLE';
    end if;
    if old.owning_organization_id is null then return new; end if;
  end if;
  if new.kind not in ('customer', 'supplier') then return new; end if;
  if new.owning_organization_id is null then
    if tg_op = 'INSERT' then
      raise exception using errcode = '23514', message = 'EXTERNAL_COMPANY_OWNER_REQUIRED';
    end if;
    return new;
  end if;
  select owner.kind, owner.active into owner_kind, owner_active
    from public.organizations owner where owner.id = new.owning_organization_id;
  if not found or owner_kind <> 'internal' or not owner_active then
    raise exception using errcode = '23514', message = 'EXTERNAL_COMPANY_OWNER_MUST_BE_ACTIVE_INTERNAL';
  end if;
  if current_user not in ('service_role', 'postgres', 'supabase_admin') and (
    not public.is_administrator() or
    not exists (select 1 from public.current_organization_ids() as membership(organization_id)
      where membership.organization_id = new.owning_organization_id)
  ) then
    raise exception using errcode = '42501', message = 'EXTERNAL_COMPANY_OWNER_SCOPE_DENIED';
  end if;
  return new;
end;
$guard$;
revoke all on function public.iq_validate_external_company_owner() from public, anon, authenticated;
drop trigger if exists iq_validate_external_company_owner on public.organizations;
create trigger iq_validate_external_company_owner before insert or update on public.organizations
  for each row execute function public.iq_validate_external_company_owner();

lock table public.organizations in share row exclusive mode;

do $seed_preflight$
declare
  owner_id uuid;
  owner_count integer;
begin
  select count(*) into owner_count from public.organizations
    where code = 'TOWELL' and kind = 'internal' and active;
  if owner_count <> 1 then
    raise exception 'AV-PL-01 seed stopped: expected exactly one active internal TOWELL organization.';
  end if;
  select id into owner_id from public.organizations
    where code = 'TOWELL' and kind = 'internal' and active;

  if exists (
    with official(code, name) as (values
      ('AR','ARABELA'),('AV','AVON COSMETICS'),('CL','CASA LEY'),('CG','CASTELOG'),
      ('CH','CHEDRAUI'),('CP','COLAP'),('CC','COLCHAS MEXICO SA DE CV (CONCORD)'),
      ('DM','DM GRUPO EXPORTADOR'),('DW','DSW'),('FX','FAMTEX'),('GL','GUADALUPE SALLOUM'),
      ('HB','H.E.B.'),('HC','HENKEL CAPITAL'),('LE','HIGIENICA TEXTIL'),
      ('AL','INNOVA IMAGEN (ALPURA)'),('JM','JUGOMEX'),('KR','KROMASOL MEXICANA'),
      ('PL','LA PALESTINA'),('LX','LISANTEX'),('LV','LIVERPOOL'),('NT','NATURA'),
      ('OM','OPERADORA MERCO'),('OA','ORIFLAME'),('RD','RAYA DOM'),('SE','SEARS'),
      ('SR','SORIANA'),('SH','STANHOME'),('SB','SUBURBIA'),('3B','TIENDAS TRES B'),
      ('WS','WALDO''S DOLAR'),('WM','WALMART – BODEGA, SUPER CENTER, PRICHOS'),
      ('YR','YVES ROCHER'),('ZM','ZERMAT')
    )
    select 1 from official candidate
    join public.organizations existing
      on upper(btrim(existing.code)) = candidate.code
      or lower(btrim(existing.name)) = lower(candidate.name)
    where existing.kind <> 'customer'
      or existing.code <> candidate.code
      or existing.name <> candidate.name
      or existing.owning_organization_id is distinct from owner_id
  ) then
    raise exception 'AV-PL-01 seed stopped: a code or name already exists with different data or unverified ownership.';
  end if;
end
$seed_preflight$;

insert into public.organizations (code, name, kind, owning_organization_id)
with official(code, name) as (values
  ('AR','ARABELA'),('AV','AVON COSMETICS'),('CL','CASA LEY'),('CG','CASTELOG'),
  ('CH','CHEDRAUI'),('CP','COLAP'),('CC','COLCHAS MEXICO SA DE CV (CONCORD)'),
  ('DM','DM GRUPO EXPORTADOR'),('DW','DSW'),('FX','FAMTEX'),('GL','GUADALUPE SALLOUM'),
  ('HB','H.E.B.'),('HC','HENKEL CAPITAL'),('LE','HIGIENICA TEXTIL'),
  ('AL','INNOVA IMAGEN (ALPURA)'),('JM','JUGOMEX'),('KR','KROMASOL MEXICANA'),
  ('PL','LA PALESTINA'),('LX','LISANTEX'),('LV','LIVERPOOL'),('NT','NATURA'),
  ('OM','OPERADORA MERCO'),('OA','ORIFLAME'),('RD','RAYA DOM'),('SE','SEARS'),
  ('SR','SORIANA'),('SH','STANHOME'),('SB','SUBURBIA'),('3B','TIENDAS TRES B'),
  ('WS','WALDO''S DOLAR'),('WM','WALMART – BODEGA, SUPER CENTER, PRICHOS'),
  ('YR','YVES ROCHER'),('ZM','ZERMAT')
)
select candidate.code, candidate.name, 'customer', owner.id
from official candidate
cross join public.organizations owner
where owner.code = 'TOWELL' and owner.kind = 'internal' and owner.active
  and not exists (
    select 1 from public.organizations existing
    where upper(btrim(existing.code)) = candidate.code
      or lower(btrim(existing.name)) = lower(candidate.name)
  )
on conflict (code) do nothing;
