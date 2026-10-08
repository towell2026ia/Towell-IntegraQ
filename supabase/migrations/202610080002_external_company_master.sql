begin;

create table public.external_company_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index external_company_sites_company_active_idx
  on public.external_company_sites(company_id, active, name);
create trigger external_company_sites_set_updated_at
before update on public.external_company_sites
for each row execute function public.set_updated_at();

alter table public.profiles
  add column external_site_id uuid references public.external_company_sites(id) on delete restrict;
create index profiles_external_site_idx on public.profiles(external_site_id);

alter table public.profiles drop constraint external_scope_required;
alter table public.profiles add constraint external_scope_required check (
  (
    user_type in ('administrator', 'internal')
    and external_party_kind is null
    and external_party_id is null
    and external_party_name is null
    and external_site_id is null
  )
  or (
    user_type = 'customer'
    and ((status = 'inactive' and external_party_id is null and external_site_id is null) or
      (external_party_kind = 'customer' and external_party_id is not null and external_party_name is not null))
  )
  or (
    user_type = 'supplier'
    and ((status = 'inactive' and external_party_id is null and external_site_id is null) or
      (external_party_kind = 'supplier' and external_party_id is not null and external_party_name is not null))
  )
);

alter table public.audits
  add column external_site_id uuid references public.external_company_sites(id) on delete restrict;
alter table public.quality_cases
  add column external_site_id uuid references public.external_company_sites(id) on delete restrict;
alter table public.corrective_actions
  add column external_site_id uuid references public.external_company_sites(id) on delete restrict;
alter table public.supplier_quality_evaluations
  add column site_id uuid references public.external_company_sites(id) on delete restrict;
alter table public.supplier_rncp_reports
  add column site_id uuid references public.external_company_sites(id) on delete restrict;

alter table public.supplier_quality_evaluations
  drop constraint supplier_quality_evaluations_supplier_id_period_start_period_end_key;
create unique index supplier_quality_evaluations_scope_period_uidx
  on public.supplier_quality_evaluations(supplier_id, site_id, period_start, period_end)
  nulls not distinct;
create index audits_external_site_idx on public.audits(external_site_id);
create index supplier_rncp_site_idx on public.supplier_rncp_reports(site_id, status, response_due_date);

create or replace function public.validate_external_company_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create trigger profiles_validate_external_site before insert or update of external_party_id, external_site_id on public.profiles for each row execute function public.validate_external_company_site();
create trigger audits_validate_external_site before insert or update of external_organization_id, external_site_id on public.audits for each row execute function public.validate_external_company_site();
create trigger quality_cases_validate_external_site before insert or update of external_organization_id, external_site_id on public.quality_cases for each row execute function public.validate_external_company_site();
create trigger corrective_actions_validate_external_site before insert or update of external_organization_id, external_site_id on public.corrective_actions for each row execute function public.validate_external_company_site();
create trigger supplier_evaluations_validate_site before insert or update of supplier_id, site_id on public.supplier_quality_evaluations for each row execute function public.validate_external_company_site();
create trigger supplier_rncp_validate_site before insert or update of supplier_id, site_id on public.supplier_rncp_reports for each row execute function public.validate_external_company_site();

create or replace function public.current_external_site_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select external_site_id from public.profiles where id = auth.uid();
$$;

create or replace function public.has_external_organization_scope(
  requested_kind public.organization_kind,
  requested_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.organizations organization on organization.id = profile.external_party_id
    where profile.id = auth.uid()
      and profile.status = 'active'
      and organization.active
      and profile.external_party_kind = requested_kind
      and profile.external_party_id = requested_organization_id
  );
$$;

create or replace function public.has_external_site_scope(requested_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        profile.external_site_id is null
        or (
          exists (
            select 1 from public.external_company_sites site
            where site.id = profile.external_site_id and site.active
          )
          and (requested_site_id is null or profile.external_site_id = requested_site_id)
        )
      )
  );
$$;

alter table public.external_company_sites enable row level security;
create policy external_company_sites_select_scope on public.external_company_sites
for select to authenticated using (
  public.is_administrator()
  or public.is_internal_user()
  or (
    company_id in (select public.current_organization_ids())
    and (public.current_external_site_id() is null or id = public.current_external_site_id())
  )
);
create policy external_company_sites_admin_write on public.external_company_sites
for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
grant select, insert, update on public.external_company_sites to authenticated;
grant execute on function public.current_external_site_id() to authenticated;
grant execute on function public.has_external_site_scope(uuid) to authenticated;

create or replace function public.can_access_supplier_report(requested_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_rncp_reports report
    where report.id = requested_report_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('suppliers', 'view')
          and public.has_permission('proveedores.acceder')
          and public.has_permission('proveedores.ver')
        )
        or (
          report.portal_visible
          and public.has_external_organization_scope('supplier', report.supplier_id)
          and public.has_external_site_scope(report.site_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, report.supplier_id)
        )
      )
  );
$$;

create or replace function public.can_access_audit(requested_audit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.audits audit
    where audit.id = requested_audit_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('audits', 'view')
          and (audit.process_id is null or public.has_process_access(audit.process_id))
        )
        or (
          public.current_user_type() = 'customer'
          and audit.portal_visible
          and audit.external_organization_id is not null
          and public.has_external_organization_scope('customer', audit.external_organization_id)
          and public.has_external_site_scope(audit.external_site_id)
          and public.has_permission('portal_clientes.acceder', null, null, null, null, false, audit.external_organization_id)
        )
        or (
          public.current_user_type() = 'supplier'
          and audit.portal_visible
          and audit.audit_type = 'supplier'
          and public.has_external_organization_scope('supplier', audit.external_organization_id)
          and public.has_external_site_scope(audit.external_site_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, audit.external_organization_id)
        )
      )
  );
$$;

drop policy if exists supplier_evaluations_select_scope on public.supplier_quality_evaluations;
create policy supplier_evaluations_select_scope on public.supplier_quality_evaluations
for select to authenticated using (
  public.is_administrator()
  or (
    public.is_internal_user()
    and public.has_module_permission('suppliers', 'view')
    and public.has_permission('proveedores.acceder')
    and public.has_permission('proveedores.ver')
  )
  or (
    public.has_external_organization_scope('supplier', supplier_id)
    and public.has_external_site_scope(site_id)
    and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, supplier_id)
  )
);

create temporary table provider_master_seed (
  code text primary key,
  name text not null,
  category text not null
) on commit drop;

insert into provider_master_seed(code, name, category) values
  ('PR00350', 'Industrial Jecal, S.A. de C.V.', 'QAC'),
  ('PR01168', 'Diproquin', 'QAC'),
  ('PR00736', 'Productos Químicos Básicos', 'QAC'),
  ('PR02253', 'Eksa Mills', 'QAC'),
  ('PR00465', 'Química Hernández Ramírez', 'QAC'),
  ('PR02413', 'Rudolf Chemicals', 'QAC'),
  ('PR02504', 'Dacamex', 'QAC'),
  ('PR00341', 'Farbitex', 'QAC'),
  ('PR02304', 'Industria Técnica Textil', 'QAC'),
  ('PR02311', 'CB Química - Almidón', 'Almidón'),
  ('PR02373', 'CB Química - Resina', 'Resina'),
  ('PR02589', 'Auxitex Solutions', 'Auxiliares'),
  ('PR02604', 'Industrias Polyvac', 'Colorantes'),
  ('065', 'Hilaturas Jiutepec', 'Hilaza'),
  ('012', 'PYT Textil', 'Hilaza'),
  ('022', 'DJ Global', 'Torzal'),
  ('063-T', 'Triton Industrial', 'Hilaza'),
  ('063-P', 'Portatex', 'Hilaza'),
  ('076', 'TTM', 'Hilaza'),
  ('105', 'United Dragon', 'Hilaza'),
  ('102', 'Antex Textil', 'Hilaza'),
  ('099', 'Estiel', 'Poliéster'),
  ('025', 'Filafil', 'Hilaza'),
  ('084', 'Hilados de Alta Calidad', 'Rayón'),
  ('049', 'Kamafil', 'Poliéster'),
  ('098', 'Parra Jaramillo', 'Rayón'),
  ('104', 'Sajitex', 'Poliéster'),
  ('021', 'Turbo Yarn', 'Hilaza'),
  ('004', 'Zagis', 'Hilaza'),
  ('007-G', 'Gonzalo García', 'Torzal'),
  ('007-L', 'Lombartex', 'Torzal'),
  ('015', 'Puentedey', 'Hilo de costura'),
  ('005', 'Ferale', 'Hilo de costura'),
  ('006', 'Albricia', 'Hilo de costura'),
  ('023', 'La Confianza', 'Torzal'),
  ('S/N-01', 'Teñidos Terry', 'Hilaza'),
  ('PR02494', 'Progressive Label de México', 'Avíos'),
  ('PR00015', 'Etiquetas Industriales', 'Avíos'),
  ('PR02345', 'Impresos Personalizados', 'Avíos'),
  ('PR01381', 'North American Packaging', 'Avíos'),
  ('PR01443', 'Top Label', 'Avíos'),
  ('PR02083', 'Etikame', 'Avíos'),
  ('PR00091', 'EXE Etiquetas Tejidas', 'Avíos'),
  ('PR02400', 'Etiquetas Bordadas Mundiales', 'Avíos'),
  ('PR02145', 'Etiquetas Flexo', 'Avíos'),
  ('PR02507', 'Premium PKG', 'Avíos'),
  ('PR01047', 'Textiles Brito', 'Avíos'),
  ('PR02449', 'VICMA', 'Avíos'),
  ('PR02377', 'Fabricantes de Cintas El Elefante', 'Avíos'),
  ('103', 'Kinob Traders', 'Hilo'),
  ('PR02472', 'Crea Diseño & Imprenta', 'Avíos'),
  ('S/N-02', 'Estampados Camarasa', 'Avíos'),
  ('PR00810', 'Etiflex', 'Avíos'),
  ('101', 'Skytex México', 'Hilo'),
  ('106', 'Grupo Comercial Nuzca', 'Hilo'),
  ('PR02570', 'Carlos Arturo Suárez Morales', 'Avíos'),
  ('PR01165', 'Subliexpress', 'Avíos'),
  ('S/N-03', 'Plastintlax', 'Avíos'),
  ('PR02698', 'Decorados y Sublimados', 'Avíos'),
  ('S/N-04', 'Poli-Tlax', 'Avíos');

insert into public.organizations(code, name, kind, active)
select seed.code, seed.name, 'supplier', true from provider_master_seed seed
on conflict (code) do update set name = excluded.name, kind = 'supplier';

insert into public.supplier_quality_profiles(organization_id, category, active)
select organization.id, seed.category, true
from provider_master_seed seed
join public.organizations organization on organization.code = seed.code
on conflict (organization_id) do update set category = excluded.category;

insert into public.organizations(code, name, kind, active)
values ('ANAHUAC', 'Anáhuac', 'supplier', true)
on conflict (code) do update set name = excluded.name, kind = 'supplier', active = true;

insert into public.supplier_quality_profiles(organization_id, category, active)
select id, 'Hilaza', true from public.organizations where code = 'ANAHUAC'
on conflict (organization_id) do update set category = excluded.category, active = true;

insert into public.external_company_sites(company_id, code, name, active)
select organization.id, site.code, site.name, true
from public.organizations organization
cross join (values
  ('035-A', 'Planta Algodón anillo'),
  ('035-OE', 'Planta Open End')
) site(code, name)
where organization.code = 'ANAHUAC'
on conflict (company_id, code) do update set name = excluded.name, active = true;

update public.supplier_rncp_reports report
set supplier_id = parent.id, site_id = site.id
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where report.supplier_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.supplier_quality_evaluations evaluation
set supplier_id = parent.id, site_id = site.id
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where evaluation.supplier_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.audits audit
set external_organization_id = parent.id, external_site_id = site.id
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where audit.external_organization_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.quality_cases quality_case
set external_organization_id = parent.id, external_site_id = site.id
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where quality_case.external_organization_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.corrective_actions action
set external_organization_id = parent.id, external_site_id = site.id
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where action.external_organization_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.profiles profile
set external_party_id = parent.id,
    external_party_name = parent.name,
    external_site_id = site.id,
    site = site.name
from public.organizations legacy
join public.external_company_sites site on site.code = legacy.code
join public.organizations parent on parent.id = site.company_id
where profile.external_party_id = legacy.id and legacy.code in ('035-A', '035-OE');

update public.organizations set active = false where code in ('035-A', '035-OE');

comment on table public.external_company_sites is
  'Sucursales o plantas de una empresa externa. Los códigos históricos se conservan aquí.';
comment on column public.profiles.external_site_id is
  'Alcance opcional por sucursal; null conserva alcance para toda la empresa.';

commit;
