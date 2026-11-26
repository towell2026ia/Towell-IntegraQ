import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Extend the synthetic supplier audit job in place, after its existing tests.
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.equal(process.env.PGDATABASE, "supplier_audit_test");
assert.equal(process.env.PGPORT, "5432");
assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
function sql(command) {
  const r = spawnSync("psql", args, { input: command, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim().split("\n").at(-1);
}
assert.equal(sql("select current_database();"), "supplier_audit_test");
const src = readFileSync("docs/database/proposals/IQ-PROV-U07-R5.sql");
assert.equal(createHash("sha256").update(src).digest("hex"), "52f0062f488dbcc7df47600ba330631850f3bb60f89d0985f6f3d78d80fb4d79");
sql(`alter table auth.users add column raw_app_meta_data jsonb default '{}', add column encrypted_password text;
alter table public.supplier_audit_events add column manual_record jsonb;
create table public.supplier_rncp_initial_photo_sets(report_id uuid,organization_id uuid,file_ids uuid[]);`);
sql(src.toString("utf8"));
const admin="10000000-0000-4000-8000-000000000001", member="10000000-0000-4000-8000-000000000004";
const org="00000000-0000-4000-8000-000000000001", supplier="20000000-0000-4000-8000-000000000001";
const secondOrg="00000000-0000-4000-8000-000000000002", secondSupplier="20000000-0000-4000-8000-000000000002";
const secondAdmin="10000000-0000-4000-8000-000000000005";
const email="member@example.invalid", site=randomUUID(), otherSite=randomUUID();
const registeredContact = { id:randomUUID(), name:"Portal member", email, position:"", phone:"", purpose:"", notifyRncp:false };
const actor = id => `set "request.jwt.claim.sub"='${id}';`;
const asAdmin = "set role authenticated;"+actor(admin);
const asMember = "set role authenticated;"+actor(member);
const asServer = "set role service_role;";
sql(`insert into external_company_sites(id,company_id,code,name) values
 ('${site}','${supplier}','PORTAL-A','Synthetic A'),('${otherSite}','${supplier}','PORTAL-B','Synthetic B');
 update profiles set external_site_id='${site}',external_party_kind='supplier' where id='${member}';
 update auth.users set email='${email}' where id='${member}';
 update organizations set metadata=jsonb_set(metadata,'{supplierQualityContacts}',
   jsonb_build_object('contacts',jsonb_build_array('${JSON.stringify(registeredContact)}'::jsonb)))
 where id='${supplier}';`);

// Hold a barrier until pg_locks proves every worker is waiting in its own backend.
async function race(commands) {
  const key = randomBytes(4).readUInt32BE() % 1000000000 + 1;
  const holder = spawn("psql", args, {stdio:["pipe","ignore","inherit"]});
  holder.stdin.write(`begin; select pg_advisory_xact_lock(${key});\n`);
  const locks = granted => sql(`select count(distinct pid) from pg_locks where
    locktype='advisory' and classid=0 and objid=${key} and granted=${granted};`);
  async function until(test) {
    for (let i=0; i<100; i++) { if (test()) return; await delay(50); }
    throw new Error("Independent PostgreSQL connections did not reach the barrier");
  }
  try {
    await until(()=>locks(true)==="1");
    const workers = commands.map(command=>new Promise((resolve,reject)=>{
      const c=spawn("psql", args);
      let out="",err="";
      c.stdout.on("data",data=>{out+=data;});
      c.stderr.on("data",data=>{err+=data;});
      c.on("error",reject);
      c.on("close",status=>resolve({status, result:out.trim().split("\n").at(-1),err}));
      c.stdin.end(`begin; select pg_advisory_xact_lock_shared(${key});\n${command}\ncommit;\n`);
    }));
    await until(()=>locks(false)===String(commands.length));
    holder.stdin.end("commit;\n");
    return await Promise.all(workers);
  } finally {
    if (!holder.stdin.writableEnded) holder.stdin.end("rollback;\n");
  }
}
const ticket = () => ({link:randomBytes(32).toString("hex"), digest:randomBytes(32).toString("hex")});
const issue = t => asAdmin + `select iq_supplier_portal_issue('${supplier}','${site}','${email}','${t.digest}','${t.link}');`;
const verify = (t, proof) => asServer + `select count(*) from iq_supplier_portal_enrollment('${t.link}',${proof},'${email}','${member}');`;
const redeem = t => asMember + `select iq_supplier_portal_accept('${t.link}','Synthetic member');`;
const first=ticket();
sql(issue(first));
const guesses=await race(Array(8).fill(verify(first,"null")));
assert.ok(guesses.every(r=>r.status===0 && r.result==="0"));
assert.equal(sql(`select failed_attempts||':'||(blocked_at is not null) from supplier_portal_invitations where link_digest='${first.link}';`),"5:true");
assert.equal(sql(verify(first,"'"+first.digest+"'")),"0");
assert.throws(()=>sql(redeem(first)),/INVALID_INVITATION/);
console.log("PASS: 8 independent backends, 5 committed failures, correct proof and redemption rejected after block");
const replacements=Array.from({length:5},ticket);
const issued=await race(replacements.map(issue));
assert.equal(issued.filter(r=>r.status===0).length,2);
assert.equal(issued.filter(r=>r.status!==0 && r.err.includes("REISSUE_LIMIT")).length,3);
assert.equal(sql("select count(*) from supplier_portal_invitations;"),"3");
const activeLink=sql("select link_digest from supplier_portal_invitations where withdrawn_at is null;");
const active=replacements.find(t=>t.link===activeLink);
assert.ok(active);
for(const t of [first,...replacements.filter((_,i)=>issued[i].status===0 && replacements[i]!==active)])
  assert.equal(sql(verify(t,"'"+t.digest+"'")),"0");
assert.equal(sql(verify(active,"'"+active.digest+"'")),"1");
const redeemed=await race([redeem(active),redeem(active)]);
assert.equal(redeemed.filter(r=>r.status===0 && r.result===supplier).length,1);
assert.equal(redeemed.filter(r=>r.status!==0 && r.err.includes("INVALID_INVITATION")).length,1);
assert.equal(sql("select count(*) from audit_log where action='supplier.portal.accepted';"),"1");
console.log("PASS: concurrent reissue cap, invalidated predecessors and exactly one committed redemption");
const reports=[randomUUID(), randomUUID(), randomUUID()];
for(const [i,id] of reports.entries()){
  const foreign=i===2;
  sql(actor(foreign?secondAdmin:admin)+`insert into supplier_rncp_reports(id,folio,organization_id,supplier_id,site_id,
    source_kind,status,portal_visible,created_by) values('${id}','R5-CI-${i}','${foreign?secondOrg:org}',
    '${foreign?secondSupplier:supplier}',${foreign?"null":"'"+(i===0?site:otherSite)+"'"},
    'historical','closed',true,'${foreign?secondAdmin:admin}');`);
}
const open=id=>asMember+`select iq_supplier_portal_report('${id}');`;
assert.equal(sql(open(reports[0])),org);
for(const id of reports.slice(1)) assert.throws(()=>sql(open(id)),/REPORT_SCOPE/);
const session = spawn("psql", args);
let visible="", denied="";
session.stdout.on("data",data=>{visible+=data;});
session.stderr.on("data",data=>{denied+=data;});
const disconnected = new Promise(resolve=>session.on("close",resolve));
try {
  session.stdin.write(open(reports[0])+"\n");
  for (let i=0; !visible.includes(org) && i<100; i++) await delay(50);
  assert.ok(visible.includes(org));
  sql(asAdmin+`select iq_supplier_portal_access('${supplier}','${member}','revoke');`);
  session.stdin.end(`select iq_supplier_portal_report('${reports[0]}');\n`);
  assert.notEqual(await disconnected,0);
  assert.match(denied,/REPORT_SCOPE/);
} finally {
  if (!session.stdin.writableEnded) session.stdin.end();
}
console.log("PASS: authorized report, company/site isolation and loss of access with the same identity after revocation");

// Verify the contact-only proposal in the SAME disposable PostgreSQL job.
const r2 = readFileSync("docs/database/proposals/IQ-PROV-U07-R2.sql", "utf8");
const startContacts = r2.indexOf("-- IQ-PROV-CONTACTOS-LEGACY-GUARD.sql |");
const endContacts = r2.indexOf("-- IQ-PROV-MEJORAS-02-audit-withdrawal.sql |");
assert.ok(startContacts > 0 && endContacts > startContacts);
sql(r2.slice(startContacts,endContacts));
sql(`alter table public.organizations enable row level security;
  create policy fixture_supplier_directory_read on public.organizations for select to authenticated
    using (id in (select public.current_organization_ids()) or public.is_administrator());`);
sql(readFileSync("docs/database/proposals/IQ-PROV-PORTAL-CONTACTOS-VISIBILIDAD.sql", "utf8"));
sql(asAdmin + `select iq_supplier_portal_access('${supplier}','${member}','reactivate');`);
const peer = { id:randomUUID(), name:"Contacto de prueba", position:"", phone:"", purpose:"", notifyRncp:false, email:"peer@example.invalid" };
const rows = [registeredContact, peer];
function saveVisibility(sites) {
  const changes = JSON.stringify({[peer.id]:{scope:"sites",sites}});
  return sql(asAdmin + `select iq_supplier_save_contact_publications('${supplier}','${JSON.stringify({contacts:rows})}'::jsonb,
    (select updated_at from organizations where id='${supplier}'),'Alcance por sucursal','${changes}'::jsonb);`);
}
assert.equal(sql(asMember + `select count(*) from organizations where id='${supplier}';`),"0");
assert.equal(sql(asMember + "select iq_supplier_portal_own_profile(true)->>'kind';"),"supplier");
const seesPeer = () => sql(asMember + `select exists(select 1 from jsonb_array_elements(iq_supplier_portal_own_profile()->'contacts') c where c->>'email'='${peer.email}');`);
assert.equal(seesPeer(),"f");
saveVisibility([otherSite]);
assert.equal(seesPeer(),"f");
saveVisibility([site]);
assert.equal(seesPeer(),"t");
sql(asAdmin + `select iq_supplier_portal_access('${supplier}','${member}','revoke');`);
assert.throws(()=>sql(asMember + 'select iq_supplier_portal_own_profile();'),/PORTAL_SCOPE/);
console.log("PASS: contact package committed, supplier master private, live publication scope and revocation verified");

sql(readFileSync("docs/database/proposals/IQ-PROV-U07-R6.sql", "utf8"));
function issuePeer(replaces = null) {
  const proof = ticket();
  return asAdmin + `select iq_supplier_portal_issue_selected('${supplier}',null,'${peer.email}',
    '${proof.digest}','${proof.link}',${replaces ? "'" + replaces + "'" : "null"})->>'id';`;
}
async function reserveOnce(replaces = null) {
  const concurrent = await race([issuePeer(replaces), issuePeer(replaces)]);
  const issued = concurrent.filter(result => result.status === 0);
  assert.equal(issued.length, 1);
  assert.equal(concurrent.filter(result => result.err.includes("INVITATION_CHANGED")).length, 1);
  return issued[0].result;
}
const firstPeerInvitation = await reserveOnce();
await reserveOnce(firstPeerInvitation);
assert.equal(sql(`select count(*) from supplier_portal_invitations where email='${peer.email}';`), "2");
console.log("PASS: concurrent selection and explicit reissue each reserve exactly one invitation");
