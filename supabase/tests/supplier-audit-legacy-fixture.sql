-- Only for the ephemeral CI database. Helpers mirror the existing legacy access model.
create or replace function public.is_internal_user() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal')) $$;
create or replace function public.current_user_type() returns public.app_user_type language sql stable security definer set search_path='' as $$ select user_type from public.profiles where id=auth.uid() $$;
create function public.current_organization_ids() returns setof uuid language sql stable security definer set search_path='' as $$ select organization_id from public.profiles where id=auth.uid() union select external_party_id from public.profiles where id=auth.uid() $$;
create function public.has_external_organization_scope(text,uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type::text=$1 and external_party_id=$2) $$;
create function public.has_external_site_scope(uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and (external_site_id is null or external_site_id=$1)) $$;
create function public.has_permission(text,text,text,text,text,boolean,uuid) returns boolean language sql stable as $$ select true $$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create or replace function public.validate_external_company_site() returns trigger language plpgsql set search_path='' as $$ begin
 if new.site_id is not null and not exists(select 1 from public.external_company_sites where id=new.site_id and company_id=new.supplier_id) then raise exception 'SITE_SCOPE_INVALID'; end if; return new;
end $$;
create table public.user_module_action_permissions(user_id uuid,module_id text,action text);
insert into public.user_module_action_permissions values('10000000-0000-4000-8000-000000000007','suppliers','update');
insert into public.organizations(id,code,name,kind) values('20000000-0000-4000-8000-000000000003','LEGACY-SYNTHETIC','Synthetic unowned supplier','supplier');
