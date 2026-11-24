import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const sql = name => readFileSync(new URL("../docs/database/proposals/" + name + ".sql", import.meta.url), "utf8");
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.actor')::uuid $$;
    create table organizations(id uuid primary key,kind text,active boolean,owning_organization_id uuid);
    create table profiles(id uuid primary key,organization_id uuid,status text,user_type text,workspace_mode text,full_name text);
    create table processes(id text primary key,organization_id uuid,process_owner_user_id uuid);
    create table user_process_permissions(user_id uuid,process_id text);
    create table quality_cases(id uuid primary key,kind text,external_organization_id uuid);
    create type module_permission_action as enum ('view','create','update');
    create function has_module_permission(text,module_permission_action) returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type in ('internal','administrator')) $$;
    create function has_process_access(text) returns boolean language sql stable as $$
      select exists(select 1 from public.processes where id=$1 and process_owner_user_id=auth.uid()) $$;
    create function is_administrator() returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator') $$;
    create type corrective_action_source as enum ('internal','customer','sgc');
    create type corrective_action_severity as enum ('medium');
    create type action_item_status as enum ('pending');
    create table corrective_actions(id uuid primary key,folio text unique,title text,problem text,source corrective_action_source,
      severity corrective_action_severity,process_id text,area text,owner_name text,quality_case_id uuid,external_organization_id uuid,
      deleted_at timestamptz,due_date date,status text,progress int,root_cause text,portal_visible boolean,organization_id uuid,created_by uuid);
    create table corrective_action_a3(corrective_action_id uuid primary key,event_type text,severity_justification text,five_w_two_h jsonb,
      brainstorm jsonb,ishikawa jsonb,non_detection_cause text,non_detection_whys jsonb,root_cause text,root_cause_whys jsonb,ai_draft jsonb,updated_by uuid);
    create table corrective_action_plans(id uuid primary key,corrective_action_id uuid,description text,owner_name text,owner_id uuid,due_date date,status action_item_status);
    create table audit_log(actor_id uuid,organization_id uuid,module text,action text,resource_type text,resource_id text,previous_value jsonb,new_value jsonb,reason text,metadata jsonb);
    grant usage on schema auth to authenticated;
    grant select on profiles,processes to authenticated;`);
  await db.exec(sql("IQ-ROOT2CAUSE-20-FLOW"));
  const historic = sql("IQ-ROOT2CAUSE-20-DRAFT-PDF");
  await db.exec(historic.slice(0, historic.indexOf("-- Official PDF versions")) + "\ncommit;");
  const [org, customer, actor, outsider, claim, id, planId] = Array.from({length:7}, () => randomUUID());
  await db.query("insert into organizations values ($1,'internal',true,null),($2,'customer',true,$1)", [org,customer]);
  await db.query("insert into profiles values ($1,$3,'active','internal','production','Responsable QA'),($2,$3,'active','internal','production','Otra persona')", [actor,outsider,org]);
  await db.query("insert into processes values ('PROC-QA',$1,$2)",[org,actor]);
  await db.query("insert into quality_cases values ($1,'claim',$2)",[claim,customer]);
  const who = uid => db.query("select set_config('test.actor',$1,false)",[uid]);
  const draft = { evidenceId:id, title:"Descripción de análisis local", problem:"Problema reproducible de calidad", origin:"customer", processId:"PROC-QA",
    relatedPartyId:customer, qualityCaseId:claim, externalClaimReference:"REC-QA-47", owner:"Titular QA", dueDate:"2026-12-01", severity:"medium",
    severityJustification:"Justificación QA", fiveW2H:{what:"A",why:"B",when:"C",where:"D",who:"E",how:"F",howMuch:"G"},
    brainstorm:["a","b","c"], causeItems:["method","material","measurement"].map(category=>({id:randomUUID(),text:category,category})),
    nonDetectionCause:"Control", rootCause:"Método", nonDetectionWhys:["a","b","c"],rootCauseWhys:["d","e","f"],
    plans:[{id:planId,description:"Revisar el método",ownerUserId:actor,owner:"Nombre en caché",causeCategory:"method",dueDate:"2026-12-02"}]};
  const save = async (rev, step, value=draft) => (await db.query(
    "select iq_root2cause_save_draft($1,$2,$3,$4,'PROC-QA','customer',$5,$6) as result",
    [id,rev,step,JSON.stringify({step,draft:value}),customer,claim])).rows[0].result;
  const finalize = async (name,revision) => (await db.query("select "+name+"($1,$2) as result",[id,revision])).rows[0].result;
  const rows = async (query,params=[]) => (await db.query(query,params)).rows;
  await who(actor);
  await db.exec("set role authenticated");
  for(let step=0;step<8;step++) {
    assert.equal((await save(step,step)).revision,step+1);
    const [saved]=await rows("select id,payload,current_step from root2cause_drafts where id=$1",[id]);
    assert.equal(saved.id,id); assert.deepEqual(saved.payload,{step,draft}); assert.equal(saved.current_step,step);
  }
  console.log("PASS T-RCA-02-01 · ocho etapas y vínculos recuperados");
  await assert.rejects(finalize("iq_root2cause_finalize_draft",8),/carece de causa/);
  await db.exec("reset role");
  const legacyId=randomUUID();
  const legacy={id:legacyId,source:"internal",severity:"medium",area:"QA",owner:"QA",dueDate:draft.dueDate,problem:draft.problem,
    a3:{plans:[{id:randomUUID(),owner:"QA",description:"Histórico",dueDate:draft.dueDate,cause:"Causa",expectedResult:"Resultado",completionEvidence:"Registro",effectivenessMethod:"Método"}]}};
  await db.query("select iq_root2cause_create_action($1)",[JSON.stringify(legacy)]);
  const legacyBefore=await rows("select to_jsonb(a) as original from corrective_actions a where id=$1",[legacyId]);
  await db.exec(sql("IQ-ROOT2CAUSE-U08-PLAN"));
  await db.exec(sql("IQ-ROOT2CAUSE-U08-DRAFT-SYNC"));
  assert.deepEqual(await rows("select to_jsonb(a) as original from corrective_actions a where id=$1",[legacyId]),legacyBefore);
  assert.equal((await rows("select iq_root2cause_create_action($1) as a",[JSON.stringify(legacy)]))[0].a.replayed,true);
  await db.exec("set role authenticated");
  assert.equal((await save(7,7)).replayed,true);
  await assert.rejects(save(7,7,{...draft,title:"Otro contenido"}),/REVISION_CONFLICT/);
  assert.equal((await rows("select revision from root2cause_drafts where id=$1",[id]))[0].revision,8);
  console.log("PASS T-RCA-02-02 · reintento idéntico y conflicto de revisión");
  await who(outsider);
  assert.equal((await rows("select id from root2cause_drafts")).length,0);
  await assert.rejects(finalize("iq_root2cause_finalize_plan",8),/NOT_AVAILABLE/);
  await who(actor);
  const invalid={...draft, plans:[{...draft.plans[0],ownerUserId:outsider}]};
  await save(8,7,invalid);
  await assert.rejects(finalize("iq_root2cause_finalize_plan",9),/Responsable no disponible/);
  assert.deepEqual(await rows("select status,revision from root2cause_drafts"),[{status:"draft",revision:9}]);
  await save(9,7);
  const created=await finalize("iq_root2cause_finalize_plan",10);
  const repeat=await finalize("iq_root2cause_finalize_plan",10);
  assert.match(created.folio,/^AC-\d+$/); assert.equal(created.id,id);
  assert.equal(repeat.folio,created.folio); assert.equal(repeat.id,id); assert.equal(repeat.replayed,true);
  await db.exec("reset role");
  assert.deepEqual(await rows("select id,folio,source,quality_case_id,external_reference,external_organization_id,portal_visible from corrective_actions where id=$1",[id]),
    [{id,folio:created.folio,source:"customer",quality_case_id:claim,external_reference:"REC-QA-47",external_organization_id:customer,portal_visible:false}]);
  assert.equal((await rows("select workflow_metadata->>'descriptiveTitle' as title from corrective_action_a3 where corrective_action_id=$1",[id]))[0].title,draft.title);
  assert.deepEqual(await rows("select id,description,cause_category,owner_id,owner_name,due_date::text,expected_result,completion_evidence,effectiveness_method from corrective_action_plans where corrective_action_id=$1",[id]),
    [{id:planId,description:draft.plans[0].description,cause_category:"method",owner_id:actor,owner_name:"Responsable QA",due_date:"2026-12-02",expected_result:null,completion_evidence:null,effectiveness_method:null}]);
  assert.equal((await rows("select count(*)::int n from audit_log where action='root2cause.created' and resource_id=$1",[id]))[0].n,1);
  console.log("PASS T-RCA-03-01/02 · folio, conservación tras fallo, reintento, única alta");
  console.log("PASS T-RCA-06-01/02 · plan simplificado persistido, ID y responsable reales del fixture");
  await db.exec("set role authenticated");
  await who(actor);
  const partialId = randomUUID();
  const partial = {evidenceId:partialId,origin:"system",processId:"",plans:[{description:""}]};
  for (const [revision,step] of [...Array(8).keys(),...Array.from({length:7},(_,i)=>6-i)].entries()) {
    const payload={step,draft:partial};
    const result=await rows("select iq_root2cause_save_draft($1,$2,$3,$4,null,'sgc') as ack",[partialId,revision,step,payload]);
    assert.equal(result[0].ack.revision,revision+1);
    assert.deepEqual((await rows("select payload from root2cause_drafts where id=$1",[partialId]))[0].payload,payload);
  }
  await assert.rejects(rows("select iq_root2cause_finalize_plan($1,15)",[partialId]), /responsable|incomplet|plan|REQUIRED/i);
  const duplicateId=randomUUID();
  await assert.rejects(rows("select iq_root2cause_save_draft($1,0,0,$2,'PROC-QA','customer',$3,$4)",
    [duplicateId,{step:0,draft:{...draft,evidenceId:duplicateId}},customer,claim]),/CLAIM_ALREADY_LINKED/);
  await db.exec("reset role");
  console.log("PASS P0 · SGC incompleto, ocho etapas en ambos sentidos, revisión confirmada, finalización bloqueada y reclamo sin duplicación");
  if (process.argv.includes("--with-live-access")) {
    const { verifyLiveAccess } = await import("./test-u08-live-access.mjs");
    await verifyLiveAccess(db);
  }
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
