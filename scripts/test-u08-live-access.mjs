import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";

const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const proposal = name => read("docs/database/proposals/IQ-ROOT2CAUSE-U08-"+name+".sql");

// Runs in the existing in-memory draft/finalize fixture, after Release 1.
export async function verifyLiveAccess(db) {
  const rows = async (sql,params=[]) => (await db.query(sql,params)).rows;
  await db.exec("alter type corrective_action_source add value 'supplier'");
  for(const status of ["in_progress","completed","cancelled"]) await db.exec("alter type action_item_status add value '"+status+"'");
  await db.exec(`create role service_role; create schema storage;
    alter table corrective_actions add column if not exists deleted_at timestamptz,add column owner_id uuid;
    alter table corrective_action_plans add column completed_at timestamptz,add column evidence_file_id uuid;
    create table corrective_action_effectiveness_reviews(corrective_action_id uuid);
    create table storage.objects(bucket_id text,name text);
    create table file_objects(id uuid primary key,workspace_id uuid,module_id text,audience text,bucket_id text,
      resource_type text,resource_key text,resource_id uuid,process_id text,is_current boolean,deleted_at timestamptz,
      original_name text,created_at timestamptz,uploaded_by uuid,object_path text,preview_path text);
    create table workspace_data(workspace_id uuid,payload jsonb,area text,deleted_at timestamptz,workspace_mode text);
    create function current_workspace_mode() returns text language sql as $$select 'production'$$;
    create function is_internal_user() returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id=auth.uid() and user_type in ('internal','administrator'))$$;
    create function has_external_organization_scope(text,uuid) returns boolean language sql as $$select false$$;
    create function has_permission(text,text,text,text,text,boolean,uuid) returns boolean language sql as $$select false$$;`);
  const granular=read("supabase/migrations/202608230006_granular_user_permissions.sql");
  const triggersEnd=granular.indexOf("insert into public.corrective_action_participants (",granular.indexOf("create trigger corrective_plan_owner_participant"));
  await db.exec(granular.slice(granular.indexOf("create type public.corrective_action_participant_role"),triggersEnd));
  const deployed=read("supabase/migrations/202609240002_transversal_evidence_permissions.sql");
  await db.exec(deployed.slice(deployed.indexOf("create or replace function public.can_access_corrective_action("),deployed.indexOf("drop policy if exists supplier_evaluations_select_scope")));
  const policies=read("supabase/migrations/202608230004_quality_audits_and_portals.sql");
  await db.exec(policies.slice(policies.indexOf("create policy corrective_actions_select_scope"),policies.indexOf("-- RLS de proveedores.")));
  await db.exec(`alter table corrective_actions enable row level security;
    alter table corrective_action_a3 enable row level security;
    alter table corrective_action_plans enable row level security;
    alter table file_objects enable row level security; alter table storage.objects enable row level security;
    create policy existing_file_reader on file_objects for select to authenticated using(true);
    create policy existing_storage_reader on storage.objects for select to authenticated using(true);
    grant usage on schema storage to authenticated;
    grant select on corrective_actions,corrective_action_a3,corrective_action_plans,file_objects,storage.objects to authenticated;`);
  await db.exec("alter table corrective_action_participants enable row level security; alter table corrective_action_effectiveness_reviews enable row level security; grant select on corrective_action_participants,corrective_action_effectiveness_reviews to authenticated;");
  await db.exec(granular.slice(granular.indexOf("create policy corrective_participants_select_scope"),granular.indexOf("create or replace function public.guard_indicator_result")));
  // Exercise both the recorded catalog and the optional historical tenant guards.
  const tenant = read("supabase/migrations/20261102210001_root2cause_select_organization_scope.sql");
  if (process.argv.includes("--with-tenant-guards")) {
    await db.exec(tenant.slice(tenant.indexOf("create function"), tenant.indexOf("create policy iq_root2cause_files_tenant_select")));
    await db.exec(tenant.slice(tenant.indexOf("create policy iq_root2cause_files_tenant_select"),tenant.indexOf("-- PR #19")));
  }
  const pdfPolicies=proposalFromFile("20-DRAFT-PDF");
  const evidencePolicies=proposalFromFile("20-EVIDENCE");
  function proposalFromFile(name) { return read("docs/database/proposals/IQ-ROOT2CAUSE-"+name+".sql"); }
  function readPolicy(source,name) {
    const start=source.indexOf("create policy "+name+" on");
    assert.ok(start>=0);
    return source.slice(start,source.indexOf(";",start)+1);
  }
  const evidenceStart=pdfPolicies.indexOf("create or replace function public.iq_root2cause_evidence_access(");
  const evidenceEnd=pdfPolicies.indexOf(" to authenticated;",evidenceStart) + " to authenticated;".length;
  await db.exec(pdfPolicies.slice(evidenceStart,evidenceEnd));
  await db.exec(readPolicy(evidencePolicies,"root2cause_evidence_read_guard"));
  await db.exec(readPolicy(pdfPolicies,"root2cause_official_pdf_select_guard"));
  await db.exec(readPolicy(pdfPolicies,"root2cause_official_pdf_storage_read_guard"));
  await db.exec(readPolicy(evidencePolicies,"root2cause_storage_read_guard"));
  await db.exec(proposal("FOLLOWUP"));

  const [org,foreignOrg,admin,first,second,other,foreign,reader,caseId,plan,secondPlan,otherCase,pdf,file,nextFile,stageFile] =
    Array.from({length:16},()=>randomUUID());
  for(const [id,tenant,role] of [[admin,org,"administrator"],[first,org,"internal"],[second,org,"internal"],[other,org,"internal"],[reader,org,"internal"],[foreign,foreignOrg,"administrator"]]) {
    await rows("insert into profiles values($1,$2,'active',$3,'production','Calidad')",[id,tenant,role]);
  }
  await rows("select set_config('test.actor',$1,false)",[admin]);
  await rows("insert into processes values('QA-07',$1,$2)",[org,reader]);
  for(const [id,folio] of [[caseId,"AC-TEST-07"],[otherCase,"AC-TEST-08"]]) {
    await rows("insert into corrective_actions(id,folio,source,status,organization_id,process_id,created_by) values($1,$2,'internal','implementation',$3,'QA-07',$4)",[id,folio,org,admin]);
    await rows("insert into corrective_action_a3(corrective_action_id,workflow_metadata) values($1,'{}')",[id]);
  }
  for(const id of [plan,secondPlan]) await rows("insert into corrective_action_plans(id,corrective_action_id,description,owner_id,status) values($1,$2,'Acción',$3,'pending')",[id,caseId,first]);
  await rows("insert into corrective_action_effectiveness_reviews values($1)",[caseId]);
  // Historic participant whose last plan no longer belongs to them.
  await rows("insert into corrective_action_participants(corrective_action_id,profile_id,participant_role,assigned_by) values($1,$2,'action',$3)",[caseId,other,admin]);
  const pdfPath="root2cause-official-pdf/"+org+"/"+caseId+"/version.pdf";
  for(const [id,key,path,kind] of [[pdf,caseId,pdfPath,"root2cause_official_pdf"],[file,caseId+"_plan_"+plan,"plan-one","root2cause_evidence"],[nextFile,caseId+"_plan_"+secondPlan,"plan-two","root2cause_evidence"],[stageFile,caseId+"_step_0","opening","root2cause_evidence"]]) {
    const objectPath=kind==="root2cause_evidence" ? admin+"/attachments/corrective-actions/root2cause_evidence/"+key+"/"+path : path;
    await rows("insert into file_objects(id,workspace_id,module_id,audience,bucket_id,resource_type,resource_key,resource_id,process_id,is_current,uploaded_by,object_path,preview_path) values($1,$2,'corrective-actions','internal','integraq-private',$3,$4,$5,'QA-07',true,$6,$7,$8)",[id,org,kind,key,caseId,admin,objectPath,objectPath+".preview"]);
    await rows("insert into storage.objects values('integraq-private',$1),('integraq-private',$2)",[objectPath,objectPath+".preview"]);
  }
  await db.exec(proposal("LIVE-ACCESS"));
  async function as(id) {
    await db.exec("reset role");
    await rows("select set_config('test.actor',$1,false)",[id]);
    await db.exec("set role authenticated");
  }
  const visible=async()=>({
    cases:(await rows("select a.id from corrective_actions a where a.id=$1 and iq_u08_case_visible(a)",[caseId])).length,
    details:(await rows("select corrective_action_id from corrective_action_a3 where corrective_action_id=$1",[caseId])).length,
    plans:(await rows("select id from corrective_action_plans where corrective_action_id=$1",[caseId])).length,
    assigned:(await rows("select plan_id from iq_u08_plan_queue() where plan_id in ($1,$2)",[plan,secondPlan])).length,
    files:(await rows("select id from file_objects")).length,
    objects:(await rows("select name from storage.objects")).length,
  });
  const none={cases:0,details:0,plans:0,assigned:0,files:0,objects:0};
  const complete={cases:1,details:1,plans:2,assigned:0,files:4,objects:8};
  const assign=async(id,revision,to)=>rows("select iq_u08_update_plan($1,$2,'assign','Cambio de responsable',null,$3)",[id,revision,to]);
  await as(other);assert.deepEqual(await visible(),none);
  await as(first);assert.deepEqual(await visible(),{...none,assigned:2,files:2,objects:4});
  await as(admin);await assign(plan,0,second);
  await as(first);assert.deepEqual(await visible(),{...none,assigned:1,files:1,objects:2});
  assert.deepEqual(await rows("select id from file_objects"),[{id:nextFile}]);
  await as(admin);await assign(secondPlan,0,second);
  await assert.rejects(assign(secondPlan,0,second),/revisión/);
  await as(first);assert.deepEqual(await visible(),none);
  await assert.rejects(rows("select iq_u08_update_plan($1,1,'progress','Avance simulado',null,null)",[plan]),/Plan no disponible/);
  await as(second);assert.deepEqual(await visible(),{...none,assigned:2,files:2,objects:4});
  assert.equal((await rows("select id from corrective_actions where id=$1",[otherCase])).length,0);
  await as(admin);await assign(secondPlan,1,second);
  await as(second);assert.deepEqual(await visible(),{...none,assigned:2,files:2,objects:4});
  await as(reader);assert.deepEqual(await visible(),complete);
  for(const id of [other,foreign]) {
    await as(id);assert.deepEqual(await visible(),none);
    assert.deepEqual(await rows("select profile_id from corrective_action_participants where corrective_action_id=$1",[caseId]),[]);
    assert.deepEqual(await rows("select * from corrective_action_effectiveness_reviews where corrective_action_id=$1",[caseId]),[]);
  }
  await as(admin);assert.deepEqual(await visible(),{...complete,assigned:2});
  assert.equal((await rows("select profile_id from corrective_action_participants where corrective_action_id=$1 and profile_id=$2",[caseId,first])).length,1);
  await db.exec("reset role");
  assert.equal((await rows("select * from corrective_action_participants where corrective_action_id=$1 and profile_id=$2 and participant_role='action'",[caseId,first])).length,1);
  const history=await rows("select metadata from audit_log where resource_id in ($1,$2) and action='root2cause.plan_followup'",[plan,secondPlan]);
  assert.equal(history.length,3);
  assert.equal(history.filter(e=>e.metadata.previous_owner===first && e.metadata.assigned_owner===second).length,2);
  assert.equal(history.filter(e=>e.metadata.previous_owner===second && e.metadata.assigned_owner===second).length,1);
  assert.equal((await rows("select 1 from corrective_action_participants where corrective_action_id=$1 and profile_id=$2 and participant_role='action'",[caseId,second])).length,0);
  await rows("insert into corrective_action_participants(corrective_action_id,profile_id,participant_role,assigned_by) values($1,$2,'viewer',$3)",[caseId,first,admin]);
  await as(first);assert.deepEqual(await visible(),complete);
  await db.exec("reset role");
  await db.exec(`create function reject_qa_event() returns trigger language plpgsql as $$begin raise exception 'QA rollback'; end$$;
    create trigger fail_qa_event before insert on audit_log for each row execute function reject_qa_event();`);
  await as(admin);await assert.rejects(assign(plan,1,other),/QA rollback/);
  await db.exec("reset role");
  const after=await rows("select owner_id,followup_revision from corrective_action_plans where id=$1",[plan]);
  assert.deepEqual(after,[{owner_id:second,followup_revision:1}]);
  assert.equal((await rows("select * from audit_log where resource_id in ($1,$2) and action='root2cause.plan_followup'",[plan,secondPlan])).length,3);
  await as(other);assert.deepEqual(await visible(),none);
  await db.exec("reset role");
  console.log("PASS T-RCA-07-02 · RLS de expediente, A3, planes, evidencia/PDF y Storage; último plan, otro plan, historial, permisos independientes, organización, reintento y rollback.");
}
