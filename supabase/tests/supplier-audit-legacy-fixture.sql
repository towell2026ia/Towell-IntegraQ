-- Only for the ephemeral CI database. Helpers mirror the existing legacy access model.
create table public.file_upload_policies(resource_type text primary key,max_size_bytes bigint not null,allowed_mime_types text[] not null,updated_at timestamptz not null default now());
create function public.has_process_access(text) returns boolean language sql stable as $$ select false $$;
create or replace function public.is_internal_user() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal')) $$;
create or replace function public.current_user_type() returns public.app_user_type language sql stable security definer set search_path='' as $$ select user_type from public.profiles where id=auth.uid() $$;
create function public.current_organization_ids() returns setof uuid language sql stable security definer set search_path='' as $$ select organization_id from public.profiles where id=auth.uid() union select external_party_id from public.profiles where id=auth.uid() $$;
create function public.has_external_organization_scope(text,uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type::text=$1 and external_party_id=$2) $$;
create function public.has_external_site_scope(uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and (external_site_id is null or external_site_id=$1)) $$;
create function public.has_permission(text,text,text,text,text,boolean,uuid) returns boolean language sql stable as $$ select true $$;
-- Expand the shared RNCP fixture's three-column assessment stub to the existing schema.
alter table public.supplier_assessments
 alter column id set default gen_random_uuid(),alter column supplier_id set not null,
 add foreign key(supplier_id) references public.organizations(id) on delete restrict,
 add foreign key(site_id) references public.external_company_sites(id) on delete restrict,
 add column assessment_type text not null check(assessment_type in ('supplier_audit','semiannual_evaluation','annual_evaluation','quality_evaluation','other')),
 add column assessment_date date not null,add column evaluator_name text,
 add column score numeric check(score is null or score between 0 and 100),add column classification text,add column observations text,
 add column source_file_id uuid unique references public.file_objects(id) on delete restrict,
 add column portal_visible boolean not null default false,
 add column created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
 add column updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
 add column created_at timestamptz not null default now(),add column updated_at timestamptz not null default now();
create table public.user_module_action_permissions(user_id uuid,module_id text,action text);
insert into public.user_module_action_permissions values('10000000-0000-4000-8000-000000000007','suppliers','update');
insert into public.organizations(id,code,name,kind) values('20000000-0000-4000-8000-000000000003','LEGACY-SYNTHETIC','Synthetic unowned supplier','supplier');
