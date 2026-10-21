import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {buildDemoRiskWorkspace} from "./risk-opportunity-data";

const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
let db:PGlite;
const seed=buildDemoRiskWorkspace();
async function rpc(actor:number,operation="update",reason:string|null=null,category:string|null=null,state=seed,events:unknown[]=[]) {
  const current=await db.query<{stamp:string}>("select updated_at::text stamp from public.form_records where id=$1",[id(50)]);
  return db.query<{result:{state:typeof seed;notifiedUsers:number}}>("select public.commit_risk_workspace($1,$2,$3,$4,$5,$6,$7,$8,$9) result",[id(50),id(actor),current.rows[0].stamp,JSON.stringify(state),JSON.stringify(events),operation,"RYO-2025-002",reason,category]);
}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
    create table public.organizations(id uuid primary key);
    create table public.profiles(id uuid primary key,organization_id uuid,user_type text,status text,workspace_mode text default 'production');
    create table public.permissions(id uuid primary key,code text);
    create table public.user_permission_overrides(user_id uuid,permission_id uuid,allowed boolean);
    create table public.user_process_permissions(user_id uuid,process_id text);
    create table public.user_module_permissions(user_id uuid,module_id text,can_view boolean);
    create table public.user_module_action_permissions(user_id uuid,module_id text,action text);
    create table public.processes(id text primary key,organization_id uuid);
    create table public.form_definitions(id uuid primary key,process_id text);
    create table public.form_records(id uuid primary key,form_id uuid,record_number text,values jsonb,updated_at timestamptz default now());
    alter table public.form_records enable row level security;
    create policy form_records_fixture_permissive on public.form_records for all to authenticated using(true) with check(true);
    grant select,insert,update on public.form_records to authenticated;
    create function public.touch_record() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end;$$;
    create trigger touch_record before update on public.form_records for each row execute function public.touch_record();
    create table public.audit_log(id uuid default gen_random_uuid(),actor_id uuid,action text,resource_type text,resource_id text,previous_value jsonb,new_value jsonb,metadata jsonb,created_at timestamptz default now());
    create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid references public.profiles(id),title text,message text,module_id text,resource_type text,resource_id uuid,status text default 'unread',action_url text,created_at timestamptz default now(),read_at timestamptz);
    alter table public.notifications enable row level security;
    create policy notifications_select_own on public.notifications for select to authenticated using(true);
    create policy notifications_update_own on public.notifications for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
    grant usage on schema public,auth to authenticated;
    grant select,update on public.notifications to authenticated;
  `);
  await db.query("insert into public.organizations values($1),($2)",[id(90),id(91)]);
  for(let n=1;n<=9;n++) {
    await db.query("insert into auth.users values($1,$2,$3)",[id(n),n===9?null:`user${n}@example.invalid`,JSON.stringify({workspace_mode:n===7?"demo":"production"})]);
    await db.query("insert into public.profiles(id,organization_id,user_type,status) values($1,$2,$3,$4)",[id(n),id(n===8?91:90),n===1?"administrator":n===5?"customer":"internal",n===6?"inactive":"active"]);
    if([2,5,6,7,8,9].includes(n)) {
      await db.query("insert into public.user_module_action_permissions values($1,'risks','update')",[id(n)]);
      await db.query("insert into public.user_process_permissions values($1,'P-10')",[id(n)]);
    }
  }
  await db.query("insert into public.user_module_permissions values($1,'risks',true)",[id(3)]);
  await db.query("insert into public.user_process_permissions values($1,'P-03')",[id(3)]);
  await db.query("insert into public.processes values('P-03',$1)",[id(90)]);
  await db.query("insert into public.form_definitions values($1,'P-03')",[id(49)]);
  await db.query("insert into public.form_records(id,form_id,record_number,values) values($1,$2,'RYO-WORKSPACE-2025',$3)",[id(50),id(49),JSON.stringify(seed)]);
  await db.exec(await readFile("supabase/migrations/202610150001_risk_lifecycle_notifications.sql","utf8"));
  await db.exec(await readFile("supabase/migrations/202610210002_risk_notification_scope.sql","utf8"));
},30000);
afterAll(async()=>{await db?.close();});

describe("risk PostgreSQL security and transactions",()=>{
  it("rejects production demo reseeding while allowing an empty productive workspace",async()=>{
    await expect(db.query("insert into public.form_records(id,form_id,record_number,values) values($1,$2,'RYO-WORKSPACE-PRODUCTION',$3)",[id(51),id(49),JSON.stringify(seed)])).rejects.toThrow(/cannot be seeded/);
    await db.query("insert into public.form_records(id,form_id,record_number,values) values($1,$2,'RYO-WORKSPACE-PRODUCTION','{\"risks\":[]}'::jsonb)",[id(51),id(49)]);
  });
  it("resolves active same-organization editors, all admins and view-only Direction",async()=>{
    const result=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production','risk.created','P-10')",[id(90)]);
    expect(result.rows.map(r=>r.user_id).sort()).toEqual([1,2,3,9].map(id));
    const analysis=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production','risk.analysis_started',null)",[id(90)]);
    expect(analysis.rows.map(r=>r.user_id).sort()).toEqual([1,2,3,9].map(id));
    const demo=await db.query("select * from public.risk_notification_recipients($1,'demo','risk.created','P-10')",[id(90)]);
    expect(demo.rows).toHaveLength(0);
  });
  it("applies the event matrix for deadlines and administrative lifecycle",async()=>{
    for(const [event,expected] of [["risk.action_due",[2,9]],["risk.action_overdue",[1,2,3]],["risk.deleted",[1,3]],["risk.restored",[1,3]]] as const){
      const result=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production',$2,'P-10',$3)",[id(90),event,id(2)]);
      expect(result.rows.map(r=>r.user_id).sort()).toEqual(expected.map(id));
    }
  });
  it("honors explicit effective denial overrides",async()=>{
    await db.query("insert into public.permissions values($1,'risks.edit')",[id(60)]);
    await db.query("insert into public.user_permission_overrides values($1,$2,false)",[id(2),id(60)]);
    const result=await db.query<{allowed:boolean}>("select public.risk_has_access($1,'update') allowed",[id(2)]);
    expect(result.rows[0].allowed).toBe(false);
    await db.query("delete from public.user_permission_overrides where user_id=$1",[id(2)]);
  });
  it("creates persistent inbox and email outbox atomically and deduplicates replay",async()=>{
    const event={type:"risk.created",resourceId:"RYO-2025-001",processId:"P-10",title:"Test event",body:"Risk details",targetUrl:"/?risk=RYO-2025-001#risks",occurrence:"event-1"};
    for(let i=0;i<2;i++)await db.query("select public.enqueue_risk_notifications($1,$2,'production',$3)",[id(50),id(90),JSON.stringify([event])]);
    const inbox=await db.query("select * from public.notifications");expect(inbox.rows).toHaveLength(4);
    const deliveries=await db.query<{status:string}>("select * from public.notification_deliveries");expect(deliveries.rows).toHaveLength(4);
    expect(deliveries.rows.filter(d=>d.status==="blocked_missing_address")).toHaveLength(1);
  });
  it("prevents even an administrator from reading or marking another user's inbox",async()=>{
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(1)}',false);`);
    try {
      const result=await db.query<{recipient_id:string}>("select recipient_id from public.notifications");expect(result.rows.map(r=>r.recipient_id)).toEqual([id(1)]);
      const other=await db.query("update public.notifications set read_at=now(),status='read' where recipient_id=$1 returning id",[id(2)]);expect(other.rows).toHaveLength(0);
      const own=await db.query("update public.notifications set read_at=now(),status='read' where recipient_id=$1 returning id",[id(1)]);expect(own.rows).toHaveLength(1);
      const unread=await db.query<{unread:number}>("select count(*)::int unread from public.notifications where read_at is null");expect(unread.rows[0].unread).toBe(0);
      await expect(db.query("update public.notifications set message='tampered'")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.claim_notification_emails(20)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.risk_has_access($1,'view')",[id(2)])).rejects.toThrow(/permission denied/);
    }finally{await db.exec("reset role");}
  });
  it("requires admin, reason and category, and preserves actions while auditing delete/restore",async()=>{
    await expect(rpc(2,"delete","test","test")).rejects.toThrow(/Administrator/);
    await expect(rpc(1,"delete",null,"test")).rejects.toThrow(/reason/);
    await expect(rpc(1,"delete","test","other")).rejects.toThrow(/category/);
    const deleted=await rpc(1,"delete","Explicit demo fingerprint verified","test");
    expect(deleted.rows[0].result.state.risks[1].deletedBy).toBe(id(1));
    expect(deleted.rows[0].result.state.actions).toEqual(JSON.parse(JSON.stringify(seed.actions)));
    await expect(rpc(1,"update",null,null,seed)).rejects.toThrow(/History/);
    const restored=await rpc(1,"restore","Reopened for review");
    expect(restored.rows[0].result.state.risks[1].deletedAt).toBeUndefined();
    const audit=await db.query<{action:string;previous_value:unknown}>("select action,previous_value from public.audit_log order by created_at");
    expect(audit.rows.map(r=>r.action)).toEqual(["risk.deleted","risk.restored"]);
    expect(audit.rows[0].previous_value).toEqual(JSON.parse(JSON.stringify(seed.risks[1])));
    await expect(db.query("delete from public.audit_log")).rejects.toThrow(/append only/);
    await expect(db.query("update public.audit_log set action='tampered'")).rejects.toThrow(/append only/);
  });
  it("rejects hard deletion, direct workspace updates and stale writes",async()=>{
    await expect(db.query("delete from public.form_records where id=$1",[id(50)])).rejects.toThrow(/physically/);
    await expect(db.query("update public.form_records set values='{}' where id=$1",[id(50)])).rejects.toThrow(/transaction/);
    await expect(db.query("select public.commit_risk_workspace($1,$2,'2000-01-01',$3,'[]')",[id(50),id(1),JSON.stringify(seed)])).rejects.toThrow(/STALE_WORKSPACE/);
  });
  it("rolls back workspace and audit when notification enqueue fails",async()=>{
    const changed=structuredClone(seed);changed.risks[0].title="Must roll back";
    const events=[{type:"risk.updated",resourceId:seed.risks[0].id,ownerId:"invalid-uuid",title:"Broken event",body:"Test",targetUrl:"/#risks",occurrence:"rollback"}];
    await expect(rpc(1,"update",null,null,changed,events)).rejects.toThrow();
    const current=await db.query<{values:typeof seed}>("select values from public.form_records where id=$1",[id(50)]);
    expect(current.rows[0].values.risks[0].title).toBe(seed.risks[0].title);
    const audit=await db.query("select * from public.audit_log where action='risk.workspace_updated'");expect(audit.rows).toHaveLength(0);
  });
  it("claims each queued email once and leaves missing-address deliveries blocked",async()=>{
    const first=await db.query<{status:string;attempts:number}>("select * from public.claim_notification_emails(50)");
    expect(first.rows.length).toBeGreaterThan(0);expect(first.rows.every(d=>d.status==="sending"&&d.attempts===1)).toBe(true);
    const repeat=await db.query("select * from public.claim_notification_emails(50)");expect(repeat.rows).toHaveLength(0);
  });
  it("sends old unattempted queue entries but stops retries before provider idempotency expires",async()=>{
    await db.query("insert into public.notifications(id,recipient_id,title,message,resource_id) values($1,$2,'Legacy resource','Body',$3::uuid)",[id(70),id(1),id(50)]);
    await db.query("insert into public.notification_deliveries(id,notification_id,recipient_address,created_at) values($1,$2,'user1@example.invalid',now()-interval '3 days')",[id(71),id(70)]);
    const claimed=await db.query<{id:string}>("select * from public.claim_notification_emails(50)");expect(claimed.rows.map(r=>r.id)).toContain(id(71));
    await db.query("update public.notification_deliveries set first_attempt_at=now()-interval '24 hours',locked_at=now()-interval '11 minutes' where id=$1",[id(71)]);
    const retry=await db.query("select * from public.claim_notification_emails(50)");expect(retry.rows).toHaveLength(0);
    const expired=await db.query<{status:string;last_error:string}>("select status,last_error from public.notification_deliveries where id=$1",[id(71)]);
    expect(expired.rows[0]).toEqual({status:"failed",last_error:"EMAIL_RETRY_WINDOW_EXPIRED_REVIEW_REQUIRED"});
  });
});


describe("risk notification access after permission and workspace changes",()=>{
  it("removes inbox read/update access when the recipient loses risks:view",async()=>{
    await db.query("delete from public.user_module_permissions where user_id=$1",[id(3)]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(3)}',false);`);
    try {
      expect((await db.query("select id from public.notifications where module_id='risks'")).rows).toHaveLength(0);
      expect((await db.query("update public.notifications set read_at=now(),status='read' where module_id='risks' returning id")).rows).toHaveLength(0);
    } finally {
      await db.exec("reset role");
      await db.query("insert into public.user_module_permissions values($1,'risks',true)",[id(3)]);
    }
  });
  it("does not expose imported notifications from another organization or workspace",async()=>{
    await db.query("insert into public.notifications(id,recipient_id,organization_id,workspace_mode,module_id,title,message) values($1,$2,$3,'production','risks','Wrong organization','Private'),($4,$2,$5,'demo','risks','Wrong workspace','Private')",[id(80),id(3),id(91),id(81),id(90)]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(3)}',false);`);
    try {
      expect((await db.query("select id from public.notifications where id in ($1,$2)",[id(80),id(81)])).rows).toHaveLength(0);
      expect((await db.query("update public.notifications set status='read' where id in ($1,$2) returning id",[id(80),id(81)])).rows).toHaveLength(0);
    } finally {await db.exec("reset role");}
  });
  it("does not expose risk notification contents to an external recipient",async()=>{
    await db.query("insert into public.notifications(id,recipient_id,organization_id,module_id,title,message) values($1,$2,$3,'risks','Imported external notification','Private')",[id(82),id(5),id(90)]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(5)}',false);`);
    try {expect((await db.query("select id from public.notifications where module_id='risks'")).rows).toHaveLength(0);}
    finally {await db.exec("reset role");}
  });
  it("excludes Direction when profile workspace differs from Auth workspace",async()=>{
    await db.query("update public.profiles set workspace_mode='demo' where id=$1",[id(3)]);
    try {
      const recipients=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production','risk.created','P-10')",[id(90)]);
      expect(recipients.rows.map(r=>r.user_id)).not.toContain(id(3));
    } finally {await db.query("update public.profiles set workspace_mode='production' where id=$1",[id(3)]);}
  });
});


describe("effective read denial and administrator deduplication",()=>{
  it("does not enqueue risk contents for an editor with an explicit read denial",async()=>{
    await db.query("insert into public.permissions values($1,'risks.read')",[id(61)]);
    await db.query("insert into public.user_permission_overrides values($1,$2,false)",[id(2),id(61)]);
    try {
      expect((await db.query<{allowed:boolean}>("select public.risk_has_access($1,'update') allowed",[id(2)])).rows[0].allowed).toBe(true);
      const recipients=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production','risk.created','P-10')",[id(90)]);
      expect(recipients.rows.map(r=>r.user_id)).not.toContain(id(2));
    }finally{await db.query("delete from public.user_permission_overrides where user_id=$1 and permission_id=$2",[id(2),id(61)]);}
  });
  it("includes an administrator once when also assigned to P-03",async()=>{
    await db.query("insert into public.user_process_permissions values($1,'P-03')",[id(1)]);
    const recipients=await db.query<{user_id:string}>("select * from public.risk_notification_recipients($1,'production','risk.created','P-10')",[id(90)]);
    expect(recipients.rows.filter(r=>r.user_id===id(1))).toHaveLength(1);
  });
});


describe("risk workspace REST isolation",()=>{
  it("requires risks:view even if a generic form policy would allow reading",async()=>{
    await db.query("delete from public.user_module_permissions where user_id=$1",[id(3)]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(3)}',false);`);
    try {expect((await db.query("select id from public.form_records where record_number like 'RYO-WORKSPACE-%'")).rows).toHaveLength(0);}
    finally{await db.exec("reset role");await db.query("insert into public.user_module_permissions values($1,'risks',true)",[id(3)]);}
  });
  it("separates demo and production and keeps risk writes server-only",async()=>{
    await db.query("update public.profiles set workspace_mode='demo' where id=$1",[id(7)]);
    await db.query("insert into public.form_records(id,form_id,record_number,values) values($1,$2,'RYO-WORKSPACE-DEMO',$3)",[id(52),id(49),JSON.stringify(seed)]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(7)}',false);`);
    try{
      expect((await db.query<{id:string}>("select id from public.form_records")).rows.map(r=>r.id)).toEqual([id(52)]);
      expect((await db.query("update public.form_records set record_number='renamed' where id=$1 returning id",[id(52)])).rows).toHaveLength(0);
      await expect(db.query("insert into public.form_records(id,form_id,record_number,values) values($1,$2,'RYO-WORKSPACE-NEW','{}')",[id(53),id(49)])).rejects.toThrow(/row-level security/);
    }finally{await db.exec("reset role");}
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(3)}',false);`);
    try{expect((await db.query<{id:string}>("select id from public.form_records")).rows.map(r=>r.id).sort()).toEqual([id(50),id(51)]);}
    finally{await db.exec("reset role");}
  });
  it("cannot rename a risk workspace to bypass its history guard",async()=>{
    await expect(db.query("update public.form_records set record_number='renamed' where id=$1",[id(50)])).rejects.toThrow(/identity is immutable/);
  });
});
