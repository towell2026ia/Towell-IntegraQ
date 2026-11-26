import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
// Use the same in-memory engine as the U08 contract checks. No network connection.
const db = new PGlite();
const uuid = randomUUID,
  sha = (s) => createHash("sha256").update(s).digest("hex");
const org = uuid(),
  otherOrg = uuid(),
  a = uuid(),
  b = uuid(),
  admin = uuid(),
  user = uuid(),
  second = uuid(),
  site = uuid(),
  siteB = uuid(),
  event = uuid(),
  report = uuid(),
  otherReport = uuid(),
  request = uuid();
const q = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) =>
  Object.values((await q(sql, args)).rows[0])[0];
const act = (id) => q("select set_config('fixture.actor',$1,false)", [id]);
async function reject(sql, args = []) {
  await assert.rejects(
    q(sql, args),
    (e) =>
      e.code === "42501" ||
      [
        "CONTACT_REQUIRED",
        "REISSUE_LIMIT",
        "SITE_DENIED",
        "INVALID_INVITATION",
        "IDENTITY_CONFLICT",
        "REVIEW_CHANGED",
        "ACTION_HAS_EVIDENCE",
        "REQUEST_CONFLICT",
      ].includes(e.message),
  );
}
try {
  await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;
 create type supplier_response_status as enum('pending','in_progress','submitted','accepted','rejected','closed');
 create type account_status as enum('active','inactive');
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,encrypted_password text default null);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fixture.actor',true),'')::uuid $$;
 create table organizations(id uuid primary key,kind text,active boolean default true,deleted_at timestamptz,owning_organization_id uuid,contact_email text,metadata jsonb default '{}');
 create table external_company_sites(id uuid primary key,company_id uuid,active boolean default true);
 create table profiles(id uuid primary key,organization_id uuid,external_party_id uuid,external_site_id uuid,external_party_kind text,status account_status,user_type text,workspace_mode text default 'production',full_name text,short_name text);
 create table audit_log(actor_id uuid,organization_id uuid,module text,action text,resource_type text,resource_id text,metadata jsonb);
 create table supplier_audit_events(id uuid primary key,organization_id uuid,supplier_id uuid,manual_record jsonb,manual_classification text,state text,withdrawn_at timestamptz);
 create table supplier_rncp_reports(id uuid primary key,organization_id uuid,supplier_id uuid,site_id uuid,source_kind text,status text,portal_visible boolean,notified_at timestamptz,deleted_at timestamptz);
 create table supplier_rncp_actions(id uuid primary key default gen_random_uuid(),report_id uuid,created_by uuid,executed_at date,supplier_comment text);
 create table supplier_rncp_action_evidence(action_id uuid,file_id uuid,created_by uuid);
 create table file_upload_policies(resource_type text,max_size_bytes bigint,allowed_mime_types text[]);
 create function iq_rncp_refresh_response_progress(uuid) returns void language sql as $$select$$;
 create table supplier_rncp_initial_photo_sets(report_id uuid,organization_id uuid,file_ids uuid[]);
 create table file_objects(id uuid primary key default gen_random_uuid(),workspace_id uuid,bucket_id text,object_path text unique,original_name text,mime_type text,size_bytes bigint,sha256 text,module_id text,audience text,resource_type text,resource_id uuid,resource_key text,category text,uploaded_by uuid,created_at timestamptz default now(),deleted_at timestamptz,external_organization_id uuid,external_site_id uuid);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 alter table file_objects enable row level security;alter table storage.objects enable row level security;
 create function iq_supplier_audit_supplier_allowed(s uuid,o uuid) returns boolean language sql as $$select exists(select 1 from public.organizations where id=s and owning_organization_id=o and active) and exists(select 1 from public.profiles where id=auth.uid() and user_type in ('administrator','internal') and status='active' and organization_id=o)$$;
 create function iq_rncp_actor_org(boolean) returns uuid language sql as $$select organization_id from public.profiles where id=auth.uid() and user_type='administrator'$$;
 create table roles(id uuid primary key default gen_random_uuid(),code text unique,scope_type text,status text default 'active');
 create table permissions(id uuid primary key default gen_random_uuid(),code text unique,status text default 'active');
 create table user_roles(user_id uuid,role_id uuid,organization_id uuid,assigned_by uuid,area_id uuid,process_id text,status text default 'active', starts_at timestamptz default now(),ends_at timestamptz,unique(user_id,role_id,organization_id));
 create table role_permissions(role_id uuid,permission_id uuid,allowed boolean default true);
 create table user_permission_overrides(user_id uuid,permission_id uuid,allowed boolean);
 create function is_administrator() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type='administrator')$$;
 create function iq_rncp_read_scope(uuid) returns boolean language sql as $$select true$$;
 create function iq_rncp_save_response(p_action_id uuid,p_report_id uuid,p_payload jsonb) returns uuid language plpgsql as $$declare x uuid;begin
 if p_action_id is null then insert into public.supplier_rncp_actions(report_id,created_by) values(p_report_id,auth.uid()) returning id into x;
 else select id into strict x from public.supplier_rncp_actions where id=p_action_id and report_id=p_report_id and created_by=auth.uid();end if;return x;end$$;`);
  const manual = readFileSync(
    "docs/database/proposals/IQ-PROV-AUDITORIAS-MANUALES.sql",
    "utf8",
  );
  const scope = manual.match(
    /CREATE FUNCTION public\.iq_supplier_audit_manual_portal_scope\(p_event uuid\)[\s\S]*?\$sql\$;/i,
  );
  assert.ok(scope);
  const permissions = readFileSync(
    "supabase/migrations/202609240002_transversal_evidence_permissions.sql", "utf8",
  ).match(/create or replace function public\.has_permission\([\s\S]*?\$\$;/i);
  assert.ok(permissions);
  await db.exec(permissions[0]);
  await db.exec(`insert into roles(code,scope_type) values('EXTERNAL_SUPPLIER','company');
    insert into permissions(code) values('portal_proveedores.acceder');
    insert into role_permissions(role_id,permission_id) select r.id,p.id from roles r cross join permissions p;`);
  await db.exec(scope[0]);
  await db.exec(
    readFileSync("docs/database/proposals/IQ-PROV-U07-R5.sql", "utf8"),
  );
  await q(
    "insert into organizations(id,kind) values($1,'internal'),($2,'internal')",
    [org, otherOrg],
  );
  await q(
    "insert into organizations(id,kind,owning_organization_id,contact_email) values($1,'supplier',$2,'one@example.invalid'),($3,'supplier',$4,'two@example.invalid')",
    [a, org, b, otherOrg],
  );
  await q(
    "insert into external_company_sites(id,company_id) values($1,$2),($3,$4)",
    [site, a, siteB, b],
  );
  await q(
    "insert into profiles(id,organization_id,status,user_type) values($1,$2,'active','administrator')",
    [admin, org],
  );
  await q(
    "insert into profiles(id,status,user_type) values($1,'inactive','supplier'),($2,'inactive','supplier')",
    [user, second],
  );
  await q(
    "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'one@example.invalid',now(),jsonb_build_object('supplier_enrollment',$2::text)),($3,'two@example.invalid',now(),'{}')",
    [user, a, second],
  );
  await q(
    "insert into supplier_rncp_reports values($1,$2,$3,null,'historical','closed',true,now(),null),($4,$5,$6,$7,'native','submitted',true,now(),null)",
    [otherReport, otherOrg, b, report, org, a, site],
  );
  await q(
    "insert into supplier_audit_events values($1,$2,$3,$4,'manual','completed',null)",
    [
      event,
      org,
      a,
      JSON.stringify({
        publicationSupplierId: a,
        record: {
          portalVisible: true,
          actions: [{ id: "a1", description: "Acción", status: "in_progress" }],
        },
      }),
    ],
  );
  await q(
    "alter table supplier_rncp_reports add column folio text, add column report_date date",
  );
  await q("alter table supplier_audit_events add column actual_date date");
  await q("alter table supplier_rncp_actions add column description text");
  await q(
    "create function iq_supplier_audit_manual_file_valid(uuid,uuid) returns boolean language sql as \'select false\'",
  );
  await q(
    "alter table supplier_rncp_actions add column status text default \'in_progress\'",
  );
  await q(
    "insert into file_upload_policies values(\'supplier_rncp_action_evidence\',1000,array[\'application/pdf\'])",
  );
  await act(admin);
  await q("set role authenticated");
  await reject("select * from supplier_portal_invitations");
  await reject("select iq_supplier_portal_admin($1)", [b]);
  await reject("select iq_supplier_portal_issue($1,$2,$3,$4,$5)", [
    a,
    siteB,
    "one@example.invalid",
    sha("code/x"), sha("x"),
  ]);
  await reject("select iq_supplier_portal_issue($1,null,$2,$3,$4)", [
    a,
    "other@example.invalid",
    sha("code/bad"), sha("bad"),
  ]);
  const issue = (key, branch = null) =>
    value("select iq_supplier_portal_issue($1,$2,$3,$4,$5)", [
      a,
      branch,
      "one@example.invalid",
      sha("code/"+key), sha(key),
    ]);
  const t = await issue("first");
  assert.equal(t.enroll, true);
  const resolve = "select * from iq_supplier_portal_enrollment($1,$2,$3)";
  // A registered contact without an Auth identity can receive an invitation.
  await q("reset role");
  await q("update organizations set metadata=$2::jsonb where id=$1", [
    a, JSON.stringify({supplierQualityContacts:{contacts:[{email:"new@example.invalid"}]}}),
  ]);
  await q("set role authenticated");
  await q("select iq_supplier_portal_issue($1,$2,$3,$4,$5)", [a, site, "new@example.invalid", sha("code/fresh"), sha("fresh")]);
  await q("set role service_role");
  assert.deepEqual((await q(resolve, [sha("fresh"), sha("code/fresh"), "new@example.invalid"])).rows, [
    { supplier_id: a, email: "new@example.invalid", needs_account: true },
  ]);
  await q("reset role");
  assert.equal(await value("select count(*)::int from auth.users where email='new@example.invalid'"), 0);
  await q("set role authenticated");
  const proof = [sha("first"), sha("code/first"), "one@example.invalid"];
  await reject(resolve, proof);
  await q("set role anon");
  await reject(resolve, proof);
  await q("set role service_role");
  assert.deepEqual((await q(resolve, proof)).rows, [
    { supplier_id: a, email: proof[2], needs_account: false },
  ]);
  assert.equal((await q(resolve, [proof[0], proof[1], "two@example.invalid"])).rows.length, 0);
  assert.equal((await q(resolve, [proof[0], sha("wrong-code"), proof[2]])).rows.length, 0);
  assert.equal((await q("select * from iq_supplier_portal_enrollment($1,$2,$3,$4)",
    [...proof, user])).rows.length, 1);
  for (let i=0;i<3;i++) await q(resolve,[proof[0],null,proof[2]]);
  await q("set role authenticated");
  await act(user);
  // Even a session verified before the fifth failure cannot subsequently redeem.
  await reject("select iq_supplier_portal_accept($1,'Invitado')",[proof[0]]);
  // A provider may not replace its own invitation.
  await reject("select iq_supplier_portal_issue($1,null,$2,$3,$4)", [
    a, "one@example.invalid", sha("forbidden-code"), sha("forbidden-link"),
  ]);
  await act(admin);
  await q("select iq_supplier_portal_access($1,$2,'withdraw')", [a, t.id]);
  await q("set role service_role");
  assert.equal((await q(resolve, proof)).rows.length, 0);
  await q("set role authenticated");
  await act(user);
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [
    sha("first"),
  ]);
  await act(admin);
  const freshEmail = "new@example.invalid";
  const freshLink = sha("fresh");
  const freshCode = sha("code/fresh");
  const failedCount = async () => {
    await q("reset role");
    const n = await value("select failed_attempts from supplier_portal_invitations where link_digest=$1", [freshLink]);
    await q("set role service_role");
    return n;
  };
  await q("set role service_role");
  await q(resolve, [freshLink, null, freshEmail]);
  assert.equal(await failedCount(), 1);
  await act(second);
  await q(resolve, [freshLink, sha("mistyped"), freshEmail]);
  assert.equal(await failedCount(), 2);
  await act(user);
  await q("begin");
  assert.equal((await q(resolve, [freshLink, freshCode, freshEmail])).rows.length, 1);
  await q("commit");
  // PGlite is single-backend. Verify the actual row-locking lookup's query plan
  // as well as the final state of overlapping callers below.
  const verifierBody = await value("select pg_get_functiondef('iq_supplier_portal_enrollment(text,text,text,uuid)'::regprocedure)");
  const lookup = verifierBody.match(/select \* into t from public\.supplier_portal_invitations where link_digest=p_link for update/i);
  assert.ok(lookup);
  await q("reset role"); // The lookup runs with the SQL function owner's permissions.
  const queryPlan = await q("explain (format json) "+lookup[0].replace(" into t","").replace("=p_link","=$1"),[freshLink]);
  assert.match(JSON.stringify(queryPlan.rows), /"Node Type":"LockRows"/);
  await q("set role service_role");
  assert.equal(await failedCount(), 2);
  await q(resolve, [freshLink, null, freshEmail]);
  await q(resolve, [freshLink, null, freshEmail]);
  assert.equal(await failedCount(), 4);
  assert.equal((await q(resolve, [freshLink, freshCode, freshEmail])).rows.length, 1);
  // Submit overlapping callers on the existing PGlite instance without sharing a JS counter.
  const simultaneous = await Promise.all(Array.from({length:8}, () => q(resolve, [freshLink,null,freshEmail])));
  assert.ok(simultaneous.every(r => r.rows.length===0));
  assert.equal(await failedCount(), 5);
  assert.equal((await q(resolve, [freshLink,freshCode,freshEmail])).rows.length, 0);
  await q("reset role");
  const events = await q(`select l.action,l.metadata from audit_log l join supplier_portal_invitations i
    on l.resource_id=i.id::text where i.link_digest=$1 and l.action in ('supplier.portal.invalid_proof','supplier.portal.blocked')`,[freshLink]);
  assert.deepEqual(events.rows.filter(x=>x.action.endsWith("invalid_proof")).map(x=>x.metadata.attempt).sort(),[1,2,3,4,5]);
  assert.equal(events.rows.filter(x=>x.action.endsWith("blocked")).length,1);
  assert.ok(events.rows.every(x=>!x.metadata || Object.keys(x.metadata).every(k=>k==="attempt")));
  await q("set role authenticated");
  await act(admin);
  const reissue = key => q("select iq_supplier_portal_issue($1,null,$2,$3,$4)",[a,freshEmail,sha("code/"+key),sha(key)]);
  await reissue("second");
  await q("set role service_role");
  assert.equal((await q(resolve,[freshLink,freshCode,freshEmail])).rows.length,0);
  assert.equal((await q(resolve,[sha("second"),sha("code/second"),freshEmail])).rows.length,1);
  await q("set role authenticated");
  await reissue("third");
  await assert.rejects(reissue("fourth"), /REISSUE_LIMIT/);
  await q("reset role");
  const lineage = await q(`select child.id, parent.withdrawn_at, child.replaces_id
    from supplier_portal_invitations child join supplier_portal_invitations parent
    on parent.id=child.replaces_id where child.link_digest=$1`,[sha("third")]);
  assert.ok(lineage.rows[0].withdrawn_at);
  await q("set role service_role");
  assert.equal((await q(resolve,[sha("second"),sha("code/second"),freshEmail])).rows.length,0);
  assert.equal((await q(resolve,[sha("third"),sha("code/third"),freshEmail])).rows.length,1);
  await q("set role authenticated");
  await q("select iq_supplier_portal_access($1,$2,'withdraw')", [a,lineage.rows[0].id]);
  await assert.rejects(reissue("after-withdrawal"), /REISSUE_LIMIT/);
  await q("set role service_role");
  assert.equal((await q(resolve,[sha("third"),sha("code/third"),freshEmail])).rows.length,0);
  await q("set role authenticated");
  const expired = await issue("expired");
  await q("reset role");
  await q(
    "update supplier_portal_invitations set expires_at=now()-interval '1 second' where id=$1",
    [expired.id],
  );
  await q("set role service_role");
  assert.equal((await q(resolve,[sha("expired"),sha("code/expired"),proof[2]])).rows.length,0);
  await q("set role authenticated");
  await act(user);
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [
    sha("expired"),
  ]);
  await act(admin);
  await issue("usable");
  await act(second);
  await reject("select iq_supplier_portal_accept($1,'Otro')", [sha("usable")]);
  await act(user);
  await q("reset role");
  await q("update auth.users set email_confirmed_at=null where id=$1", [user]);
  await q("set role authenticated");
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [
    sha("usable"),
  ]);
  await q("reset role");
  await q(
    "update auth.users set email_confirmed_at=now(),encrypted_password=\'fixture\' where id=$1",
    [user],
  );
  await q("set role authenticated");
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [sha("usable")]);
  await q("set role service_role");
  const confirmed = await q("select * from iq_supplier_portal_enrollment($1,$2,$3,$4)", [
    sha("usable"), sha("code/usable"), "one@example.invalid", user,
  ]);
  assert.equal(confirmed.rows.length,1);
  await q("reset role");
  await q("insert into user_permission_overrides select $1,id,false from permissions", [user]);
  await q("set role authenticated");
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [sha("usable")]);
  await q("reset role");
  assert.equal(await value("select count(*)::int from user_roles where user_id=$1",[user]), 0);
  assert.equal(await value("select status from profiles where id=$1",[user]), "inactive");
  await q("delete from user_permission_overrides where user_id=$1",[user]);
  await q("set role authenticated");
  const redeem = () => value("select iq_supplier_portal_accept($1,'Invitado')", [sha("usable")]);
  const redemptions = await Promise.allSettled([redeem(), redeem()]);
  assert.deepEqual(redemptions.filter(x=>x.status==="fulfilled").map(x=>x.value),[a]);
  assert.equal(redemptions.filter(x=>x.status==="rejected" && x.reason.message==="INVALID_INVITATION").length,1);
  assert.equal(await value("select has_permission('portal_proveedores.acceder',null,null,null,null,false,$1)", [a]), true);
  assert.equal(await value("select has_permission('portal_proveedores.acceder',null,null,null,null,false,$1)", [b]), false);
  await reject("select iq_supplier_portal_accept($1,'Invitado')", [
    sha("usable"),
  ]);
  await reject("select iq_supplier_portal_report($1)", [otherReport]);
  assert.equal(
    await value("select iq_supplier_portal_report($1)", [report]),
    org,
  );
  const save = () =>
    value("select iq_supplier_portal_save_response($1,null,$2,$3)", [
      request,
      report,
      { description: "Acción de prueba", executedAt: "2026-01-01" },
    ]);
  const action = await save();
  assert.equal(await save(), action);
  const rh = sha("rncp");
  await q("reset role");
  await q("insert into storage.objects values(\'integraq-private\',$1,$2)", [
    ["supplier-rncp-responses", user, action, rh].join("/"),
    { mimetype: "application/pdf", size: 8 },
  ]);
  await q("set role authenticated");
  const attach = () =>
    value(
      "select iq_supplier_portal_rncp_evidence($1,\'2026-01-01\',$2,\'plan.pdf\',\'application/pdf\',8)",
      [action, rh],
    );
  assert.equal(await attach(), await attach());
  await q("reset role");
  const original = uuid(),
    privateFile = uuid();
  await q(
    "update supplier_rncp_reports set source_kind='historical' where id=$1",
    [report],
  );
  await q(
    "insert into file_objects(id,resource_id,workspace_id,resource_type,bucket_id,object_path,original_name) values($1,$2,$3,'supplier_rncp_original','integraq-private',$4,'Original'),($5,$2,$3,'internal_memo','integraq-private','interno','Privado')",
    [original, report, org, "rncp-originals/" + org + "/original", privateFile],
  );
  await q("set role authenticated");
  const files = await q("select * from iq_supplier_portal_report_files($1)", [
    report,
  ]);
  assert.deepEqual(
    files.rows.map((f) => f.id),
    [original],
  );
  await q("reset role");
  await q("update supplier_rncp_reports set source_kind='native' where id=$1", [
    report,
  ]);
  await q("set role authenticated");
  await reject("select iq_supplier_portal_evidence_scope($1,'wrong')", [event]);
  assert.equal(
    await value("select iq_supplier_portal_evidence_scope($1,'a1')", [event]),
    org,
  );
  const digest = sha("fixture"),
    path = [
      "supplier-audit-responses",
      user,
      event,
      sha("a1"),
      "2026-01-01",
      digest,
    ].join("/");
  const add = () =>
    value(
      "select iq_supplier_portal_evidence_add($1,'a1','2026-01-01',$2,'file.pdf','application/pdf',10)",
      [event, digest],
    );
  await assert.rejects(add(), /UNCONFIRMED_FILE/);
  await q("reset role");
  await q("insert into storage.objects values('integraq-private',$1,$2)", [
    path,
    { mimetype: "application/pdf", size: 10 },
  ]);
  await q("set role authenticated");
  const file = await add();
  assert.equal(await add(), file);
  const index = await q(
    "select * from iq_supplier_portal_evidence_index(null,\'\',\'\',\'\',0)",
  );
  assert.equal(index.rows.length, 2);
  await reject(
    "select iq_supplier_portal_evidence_review($1,'pending','accepted','ok')",
    [file],
  );
  await act(admin);
  await q(
    "select iq_supplier_portal_evidence_review($1,'pending','returned','Revisar fecha')",
    [file],
  );
  await reject(
    "select iq_supplier_portal_evidence_review($1,'pending','accepted','ok')",
    [file],
  );
  await q("select iq_supplier_portal_access($1,$2,'revoke')", [a, user]);
  await act(user);
  await reject("select iq_supplier_portal_report($1)", [report]);
  await reject("select iq_supplier_portal_evidence_scope($1,'a1')", [event]);
  await act(admin);
  await q("select iq_supplier_portal_access($1,$2,'reactivate')", [a, user]);
  await q("reset role");
  await q("update profiles set external_site_id=$1 where id=$2", [site, user]);
  await act(user);
  await q("set role authenticated");
  assert.equal(
    await value("select iq_supplier_portal_report($1)", [report]),
    org,
  );
  await reject("select iq_supplier_portal_evidence_scope($1,'a1')", [event]);
  await q("reset role");
  assert.equal(
    await value("select count(*)::int from supplier_rncp_actions"),
    1,
  );
  assert.equal(await value("select count(*)::int from file_objects"), 4);
  console.log(
    "PASS U07-R5.1: committed SQL, five persistent failures, LockRows plan, blocked redemption, reissue budget and lineage, single-use redemption, supplier/site isolation and original U07-R5 regressions (local PGlite).",
  );
} finally {
  await db.close();
}
