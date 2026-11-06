-- Ephemeral CI database only. Synthetic records; column types/defaults mirror read-only schema metadata.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create type public.account_status as enum('active','inactive');
create type public.activity_origin as enum('human','system','import','migration','integration','ai','admin_override');
create type public.app_user_type as enum('administrator','internal','customer','supplier');
create type public.file_audience as enum('internal','customer','supplier','shared');
create type public.improvement_role as enum('submitter','manager');
create type public.organization_kind as enum('internal','customer','supplier');
create type public.supplier_response_status as enum('pending','in_progress','submitted','accepted','rejected','closed');
create table public.audit_log(
 "id" uuid default gen_random_uuid() not null primary key,
 "actor_id" uuid,
 "action" text not null,
 "resource_type" text not null,
 "resource_id" text,
 "metadata" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "organization_id" uuid,
 "user_name_snapshot" text,
 "module" text,
 "entity_code_snapshot" text,
 "previous_value" jsonb,
 "new_value" jsonb,
 "reason" text,
 "origin" public.activity_origin default 'human'::activity_origin not null,
 "ip_address" inet,
 "user_agent" text
);
create table public.external_company_sites(
 "id" uuid default gen_random_uuid() not null primary key,
 "company_id" uuid not null,
 "code" text not null,
 "name" text not null,
 "address" text,
 "active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
create table public.file_objects(
 "id" uuid default gen_random_uuid() not null primary key,
 "bucket_id" text default 'integraq-private'::text not null,
 "object_path" text not null,
 "original_name" text not null,
 "mime_type" text,
 "size_bytes" bigint,
 "sha256" text,
 "process_id" text,
 "module_id" text,
 "external_organization_id" uuid,
 "audience" public.file_audience default 'internal'::file_audience not null,
 "resource_type" text not null,
 "resource_id" uuid,
 "category" text,
 "uploaded_by" uuid default auth.uid() not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "resource_key" text,
 "version" integer default 1 not null,
 "is_current" boolean default true not null,
 "replaces_file_id" uuid,
 "preview_path" text,
 "preview_status" text default 'pending'::text not null,
 "preview_generated_at" timestamp with time zone,
 "preview_error" text,
 "deleted_at" timestamp with time zone,
 "deleted_by" uuid,
 "workspace_id" uuid,
 "folder_id" uuid,
 "display_name" text,
 "reference_type" text,
 "external_origin" text,
 "validity_status" text,
 "valid_from" date,
 "valid_until" date,
 "description" text,
 "observations" text,
 "batch_id" uuid,
 "deletion_reason" text,
 "updated_by" uuid,
 "external_site_id" uuid
);
create table public.organizations(
 "id" uuid default gen_random_uuid() not null primary key,
 "code" text not null,
 "name" text not null,
 "kind" public.organization_kind not null,
 "active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "category" text,
 "contact_name" text,
 "contact_email" text,
 "metadata" jsonb default '{}'::jsonb not null,
 "owning_organization_id" uuid,
 "legal_name" text,
 "tax_id" text,
 "address" text,
 "deleted_at" timestamp with time zone,
 "deleted_by" uuid,
 "deletion_reason" text
);
create table public.profiles(
 "id" uuid not null primary key,
 "external_id" text not null,
 "full_name" text not null,
 "short_name" text,
 "initials" text,
 "organization_id" uuid,
 "position_id" text,
 "position_name" text,
 "department" text,
 "company" text,
 "site" text,
 "user_type" public.app_user_type default 'internal'::app_user_type not null,
 "status" public.account_status default 'active'::account_status not null,
 "continuous_improvement_role" public.improvement_role,
 "external_party_kind" public.organization_kind,
 "external_party_id" uuid,
 "external_party_name" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "area_id" uuid,
 "workspace_mode" text default 'production'::text not null,
 "external_site_id" uuid
);
create table public.supplier_rncp_action_evidence(
 "action_id" uuid not null,
 "file_id" uuid not null,
 "created_by" uuid default auth.uid() not null,
 "created_at" timestamp with time zone default now() not null
);
create table public.supplier_rncp_actions(
 "id" uuid default gen_random_uuid() not null primary key,
 "report_id" uuid not null,
 "description" text not null,
 "due_date" date not null,
 "status" public.supplier_response_status default 'pending'::supplier_response_status not null,
 "supplier_comment" text,
 "evidence_file_id" uuid,
 "submitted_at" timestamp with time zone,
 "validated_by" uuid,
 "validated_at" timestamp with time zone,
 "validation_comment" text,
 "created_by" uuid default auth.uid() not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "responsible_name" text,
 "executed_at" date
);
create table public.supplier_rncp_reports(
 "id" uuid default gen_random_uuid() not null primary key,
 "folio" text not null,
 "supplier_id" uuid,
 "report_date" date,
 "purchase_order" text,
 "material_or_service" text,
 "finding_type" text,
 "rejected_quantity" numeric,
 "description" text,
 "immediate_disposition" text,
 "response_due_date" date,
 "status" text default 'draft'::text not null,
 "generated_pdf_file_id" uuid,
 "portal_visible" boolean default true not null,
 "created_by" uuid default auth.uid() not null,
 "created_at" timestamp with time zone default now() not null,
 "closed_at" timestamp with time zone,
 "updated_at" timestamp with time zone default now() not null,
 "site_id" uuid,
 "responsible_name" text,
 "submitted_at" timestamp with time zone,
 "updated_by" uuid,
 "deleted_at" timestamp with time zone,
 "deleted_by" uuid,
 "delete_reason" text
);
create table public.workspace_data(
 "id" uuid default gen_random_uuid() not null primary key,
 "workspace_id" uuid not null,
 "workspace_mode" text default 'production'::text not null,
 "area" text not null,
 "payload" jsonb default '{}'::jsonb not null,
 "revision" integer default 1 not null,
 "created_at" timestamp with time zone default now() not null,
 "created_by" uuid default auth.uid() not null,
 "updated_at" timestamp with time zone default now() not null,
 "updated_by" uuid default auth.uid() not null,
 "deleted_at" timestamp with time zone,
 "deleted_by" uuid,
 "deletion_reason" text
);
create table storage.objects(
 "id" uuid default gen_random_uuid() not null primary key,
 "bucket_id" text,
 "name" text,
 "owner" uuid,
 "created_at" timestamp with time zone default now(),
 "updated_at" timestamp with time zone default now(),
 "last_accessed_at" timestamp with time zone default now(),
 "metadata" jsonb,
 "path_tokens" text[],
 "version" text,
 "owner_id" text,
 "user_metadata" jsonb,
 "archived_at" timestamp with time zone,
 "is_delete_marker" boolean default false not null,
 "is_versioned" boolean default false not null
);

alter table public.profiles add column test_view boolean default true,add column test_update boolean default true;
alter table public.supplier_rncp_reports add constraint fixture_folio_unique unique(folio),add constraint fixture_report_status check(status in ('draft','submitted','in_progress','closed'));
alter table public.workspace_data add unique(workspace_id,workspace_mode,area);
alter table storage.objects add unique(bucket_id,name);
create function public.is_administrator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator' and status='active') $$;
create function public.has_module_permission(text,text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal') and case when $2='view' then test_view else test_update end) $$;
create function public.has_permission(text) returns boolean language sql stable as $$ select public.has_module_permission('suppliers','view') $$;
create function public.can_access_supplier_report(uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.supplier_rncp_reports r on r.id=$1 where p.id=auth.uid() and p.status='active' and (
 (p.user_type in ('administrator','internal') and p.test_view) or (p.user_type='supplier' and p.external_party_id=r.supplier_id and r.portal_visible and r.deleted_at is null))) $$;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant all on all tables in schema public,auth,storage to service_role;
grant all on all tables in schema public,storage to authenticated;
alter table public.supplier_rncp_reports enable row level security;
create policy fixture_permissive_or on public.supplier_rncp_reports for all to authenticated using(true) with check(true);
alter table public.supplier_rncp_actions enable row level security;
create policy fixture_permissive_or on public.supplier_rncp_actions for all to authenticated using(true) with check(true);
alter table public.supplier_rncp_action_evidence enable row level security;
create policy fixture_permissive_or on public.supplier_rncp_action_evidence for all to authenticated using(true) with check(true);
alter table public.file_objects enable row level security;
create policy fixture_permissive_or on public.file_objects for all to authenticated using(true) with check(true);
alter table public.workspace_data enable row level security;
create policy fixture_permissive_or on public.workspace_data for all to authenticated using(true) with check(true);
alter table storage.objects enable row level security;
create policy fixture_permissive_or on storage.objects for all to authenticated using(true) with check(true);
insert into public.organizations(id,code,name,kind,active) values
 ('00000000-0000-4000-8000-000000000001','TEST-A','Synthetic Internal A','internal',true),
 ('00000000-0000-4000-8000-000000000002','TEST-B','Synthetic Internal B','internal',true);
insert into public.organizations(id,code,name,kind,active,owning_organization_id) values
 ('20000000-0000-4000-8000-000000000001','PR00001','Synthetic supplier A','supplier',true,'00000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','PR00002','Synthetic supplier B','supplier',true,'00000000-0000-4000-8000-000000000002');
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000001','SYNTHETIC-1','Synthetic actor 1','00000000-0000-4000-8000-000000000001','administrator','active','production',null,true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000002','SYNTHETIC-2','Synthetic actor 2','00000000-0000-4000-8000-000000000001','internal','active','production',null,true,false);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000003','SYNTHETIC-3','Synthetic actor 3','00000000-0000-4000-8000-000000000001','customer','active','production',null,true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000004','SYNTHETIC-4','Synthetic actor 4','00000000-0000-4000-8000-000000000001','supplier','active','production','20000000-0000-4000-8000-000000000001',true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000005','SYNTHETIC-5','Synthetic actor 5','00000000-0000-4000-8000-000000000002','administrator','active','production',null,true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000006','SYNTHETIC-6','Synthetic actor 6','00000000-0000-4000-8000-000000000001','administrator','inactive','production',null,true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000007','SYNTHETIC-7','Synthetic actor 7','00000000-0000-4000-8000-000000000001','internal','active','production',null,true,true);
insert into public.profiles(id,external_id,full_name,organization_id,user_type,status,workspace_mode,external_party_id,test_view,test_update) values(
 '10000000-0000-4000-8000-000000000008','SYNTHETIC-8','Synthetic actor 8','00000000-0000-4000-8000-000000000002','supplier','active','production','20000000-0000-4000-8000-000000000002',true,true);
insert into auth.users select id,case when external_id='SYNTHETIC-7' then 'inspectormp@example.test' else external_id||'@example.test' end,now() from public.profiles;
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function public.test_denied(command text,expected text,label text) returns void language plpgsql as $$ declare result text; begin
 begin execute command; exception when others then result:=sqlerrm; end;
 if result is null or position(expected in result)=0 then raise exception 'FAIL: %; actual=%',label,result; end if; raise notice 'PASS: %',label; end $$;

