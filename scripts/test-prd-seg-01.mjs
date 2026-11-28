// Only synthetic, disposable databases are supported.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const read=p=>readFileSync(p,"utf8");
const sql=[];
const migration="supabase/migrations/";
function definition(file, pattern) {
  const match=read(file).match(pattern);
  assert.ok(match,`Missing fixture definition in ${file}: ${pattern}`);
  return match[0];
}
const fixture = read("supabase/tests/rncp-matrix-fixture.sql");
// PostgreSQL roles belong to the cluster. The preceding CI suite creates these
// same roles in its own database on the shared PostgreSQL service.
sql.push(fixture.replace(/^create role (anon|authenticated|service_role) nologin( bypassrls)?;$/gm,
  (_, role, bypass = "") => `do $bootstrap$ begin
    if not exists(select from pg_roles where rolname='${role}') then create role ${role} nologin${bypass}; end if;
    if not exists(select from pg_roles where rolname='${role}' and not rolcanlogin and not rolsuper and rolbypassrls=${Boolean(bypass)}) then
      raise exception 'Unexpected test role privileges: ${role}';
    end if;
  end $bootstrap$;`));
sql.push(`alter table supplier_rncp_reports add column organization_id uuid,add column source_kind text, add column notified_at timestamptz;
alter table auth.users add column raw_app_meta_data jsonb;
create table areas(id uuid primary key);create table processes(id text primary key);create table positions(id text primary key);create table workspace_modules(id text primary key);
drop function public.has_module_permission(text,text) cascade;
drop function if exists public.has_permission(text) cascade;`);
const identity=migration+"202608230001_identity_and_access.sql";
const core=migration+"202608230002_platform_core.sql";
const authz=migration+"202609070004_access_traceability_approvals.sql";
const specific=migration+"202609240002_transversal_evidence_permissions.sql";
for(const [file,types] of [[identity,["document_access_role","permission_source"]],[core,["module_permission_action"]],[authz,["permission_scope_type","permission_risk_level","role_assignment_status"]]]) {
  for(const name of types) sql.push(definition(file,new RegExp("create type public\\."+name+" as enum[\\s\\S]*?;","i")));
}
for(const [file,tables] of [[identity,["user_process_permissions","user_module_permissions"]],[core,["user_module_action_permissions"]],[authz,["roles","permissions","role_permissions","user_roles"]],[specific,["user_permission_overrides"]]]) {
  for(const name of tables) sql.push(definition(file,new RegExp("create table (?:if not exists )?public\\."+name+" \\([\\s\\S]*?\\n\\);","i")));
}
function routine(file,name) {
  sql.push(definition(file,new RegExp("create (?:or replace )?function public\\."+name+"\\([\\s\\S]*?\\bas\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;","i")));
}
routine(core,"has_module_permission");
routine(specific,"has_permission");
routine("supabase/tests/supplier-audit-legacy-fixture.sql","is_internal_user");
routine(migration+"20261106163011_rncp_matrix_followup.sql","iq_rncp_actor_org");
routine(migration+"20261106163011_rncp_matrix_followup.sql","iq_rncp_read_scope");
routine(migration+"20261107012723_supplier_audit_access_navigation.sql","iq_supplier_audit_supplier_allowed");
const r5="docs/database/proposals/IQ-PROV-U07-R5.sql";
sql.push(read(r5).split("begin;")[1].split("create function public.iq_supplier_portal_admin")[0]);
for(const name of ["iq_supplier_portal_admin","iq_supplier_portal_contact","iq_supplier_portal_issue","iq_supplier_portal_access"])routine(r5,name);
sql.push(read("docs/database/proposals/IQ-PROV-U07-R6.sql"));
sql.push(`drop policy fixture_permissive_or on supplier_rncp_reports;
create policy supplier_rncp_select_scope on supplier_rncp_reports for select to authenticated using(can_access_supplier_report(id));
create policy rncp_organization_read_guard on supplier_rncp_reports as restrictive for select to authenticated using(organization_id is null or iq_rncp_read_scope(id));
insert into workspace_modules values('suppliers'),('supplier-portal'),('home');
insert into permissions(code,module,action,description,risk_level) select x,'suppliers','view',x,'LOW' from unnest(array['proveedores.ver','proveedores.acceder','portal_proveedores.acceder']) x;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
insert into user_module_permissions(user_id,module_id) select p.id,m.id from (select id from profiles where external_id='SYNTHETIC-2') p cross join workspace_modules m;
insert into user_permission_overrides(user_id,permission_id,allowed) select p.id,k.id,true from profiles p cross join permissions k where p.external_id='SYNTHETIC-2';
update organizations set contact_email='member@example.invalid' where code='PR00001';`);
const candidate=migration+"20261128010704_prd_seg_01_1_portal_permissions.sql";
const links = read("docs/database/proposals/IQ-CUSTOMER-PORTAL-LINKS.sql");
sql.push(links.slice(links.indexOf("create table public.customer_portal_links"),links.indexOf("alter table public.customer_portal_document_events")));
sql.push(`alter table public.user_permission_overrides enable row level security;
create policy fixture_self_read on public.user_permission_overrides for select to authenticated using(user_id=auth.uid() or is_administrator());
create policy fixture_grant_manage on public.user_permission_overrides for all to authenticated using(is_administrator() or has_permission('usuarios.administrar_permisos')) with check(is_administrator() or has_permission('usuarios.administrar_permisos'));
grant insert,update,delete on public.user_permission_overrides to authenticated;`);
sql.push(read(candidate));
sql.push(read("supabase/tests/prd-seg-01-permissions.sql"));
const rncpSchema = read(migration + "20261106163011_rncp_matrix_followup.sql");
sql.push(rncpSchema.slice(rncpSchema.indexOf("alter table public.supplier_rncp_reports"),rncpSchema.indexOf("create function public.iq_rncp_actor_org"))
  .replace("add column organization_id uuid references public.organizations(id) on delete restrict,","")
  .replace("add column source_kind text check(source_kind in ('native','historical','legacy')),","")
  .replace("add column notified_at timestamptz,",""));
sql.push(`alter table public.supplier_rncp_reports add column classification text;
insert into public.permissions(code,module,action,description,risk_level) values('portal_clientes.acceder','customer-portal','view','Fixture','LOW');
insert into public.user_permission_overrides(user_id,permission_id,allowed)
select p.id,k.id,false from profiles p cross join permissions k where p.external_id='SYNTHETIC-7' and k.code='portal_clientes.acceder';
insert into user_module_permissions(user_id,module_id) select p.id,'suppliers' from profiles p where p.external_id='SYNTHETIC-7';
insert into user_module_action_permissions(user_id,module_id,action) select p.id,'suppliers','update' from profiles p where p.external_id='SYNTHETIC-7';
insert into user_permission_overrides(user_id,permission_id,allowed) select p.id,k.id,true from profiles p cross join permissions k where p.external_id='SYNTHETIC-7' and k.code in ('proveedores.acceder','proveedores.ver');
set integraq.seg01_recipient='10000000-0000-4000-8000-000000000007';
set integraq.seg01_administrator='10000000-0000-4000-8000-000000000001';`);
sql.push(read(migration+"20261128020100_prd_seg_01_1_rncp_faculties.sql"));
sql.push(`set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert(iq_rncp_faculty('00000000-0000-4000-8000-000000000001','cerrar_rncp'),'incumbent retains closing');
select test_assert(not iq_rncp_faculty('00000000-0000-4000-8000-000000000002','cerrar_rncp'),'cannot close outside workspace');
select test_assert(not iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'reopening is independent');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select test_assert(not iq_rncp_is_inspector('00000000-0000-4000-8000-000000000001'),'technical administrator cannot approve by default');
reset role;`);
routine(migration + "20261106163011_rncp_matrix_followup.sql","iq_rncp_missing_requirements");
sql.push(read("supabase/tests/prd-seg-01-rncp.sql"));
sql.push(read("supabase/tests/prd-seg-01-clients.sql"));
sql.push(read("supabase/operations/prd_seg_01_1_rncp_rollback.sql"));
sql.push(read("supabase/operations/prd_seg_01_1_rollback.sql"));
if (process.env.GITHUB_ACTIONS==="true") {
  assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
  assert.equal(process.env.PGHOST,"127.0.0.1");
  assert.equal(process.env.PGDATABASE,"seg01_test");
  const result=spawnSync("psql",["-X","-q","-v","ON_ERROR_STOP=1"],{input:sql.join("\n"),encoding:"utf8"});
  if(result.status!==0)throw Error(result.stderr);
} else {
  const {PGlite}=createRequire(import.meta.url)("@electric-sql/pglite");
  const db=new PGlite();
  try{for(const part of sql)await db.exec(part);}finally{await db.close();}
}
console.log("PASS: PRD-SEG-01.1 SQL, grants, authenticated sessions, individual operations and rollback.");
