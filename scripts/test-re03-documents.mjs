import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const db = new PGlite();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => Object.values((await query(sql,args)).rows[0])[0];
const admin = randomUUID(), reader = randomUUID(), external = randomUUID(), foreign = randomUUID();
const organization = randomUUID(), otherOrganization = randomUUID();
const setActor = id => query("select set_config('fixture.actor',$1,false)",[id]);
const kind = "management_review_document", minutes = "management_review_minutes";
const bucket = "integraq-private";
const periods = () => query("select * from public.iq_review_periods()");
const readProposal = () => readFileSync(new URL("../docs/database/proposals/IQ-RE-03-DOCUMENTACION.sql",import.meta.url),"utf8");
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
    create table profiles(id uuid primary key, organization_id uuid not null, status text, role text);
    create function is_internal_user() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and role in ('admin','reader'))$$;
    create function is_administrator() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and role='admin')$$;
    create function has_module_permission(text,text) returns boolean language sql stable as $$select public.is_internal_user() and $1='management-review' and $2='view'$$;
    create table file_objects(id uuid primary key,bucket_id text,object_path text unique,original_name text,mime_type text,size_bytes bigint,
      sha256 text,module_id text,workspace_id uuid,audience text,resource_type text,resource_key text,category text,version integer,
      is_current boolean,replaces_file_id uuid references file_objects(id),preview_status text,preview_path text,uploaded_by uuid,updated_by uuid,
      display_name text,valid_from date,description text,observations text,reference_type text,deleted_at timestamptz,deleted_by uuid,
      deletion_reason text,updated_at timestamptz default clock_timestamp());
    create unique index file_current on file_objects(resource_type,resource_key,category) where is_current and deleted_at is null;
    create function fixture_touch() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
    create trigger touch before update on file_objects for each row execute function fixture_touch();
    create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
    create table audit_log(actor_id uuid,organization_id uuid,module text,action text,resource_type text,resource_id text,metadata jsonb,reason text);
    alter table file_objects enable row level security; alter table storage.objects enable row level security;
    create policy fixture_base on file_objects for all to authenticated using(true) with check(true);
    create policy fixture_base on storage.objects for all to authenticated using(true) with check(true);
    grant usage on schema public,storage,auth to authenticated;
    grant select on profiles to authenticated;
    grant select,insert,update,delete on file_objects,storage.objects to authenticated;
  `);
  for (const [actor,org,role] of [[admin,organization,"admin"],[reader,organization,"reader"],[external,organization,"supplier"],[foreign,otherOrganization,"admin"]]) {
    await query("insert into profiles values($1,$2,'active',$3)",[actor,org,role]);
  }
  const historic = randomUUID();
  await query("insert into file_objects(id,module_id,resource_type,resource_key,category,uploaded_by,is_current,version) values($1,'management-review',$2,'2025','original',$3,true,1)",[historic,minutes,admin]);
  await db.exec(readProposal());
  await db.exec("set role authenticated");
  await setActor(admin);
  const family = () => "2025:"+randomUUID();
  const first = family(), second = family(), other = "2024:"+randomUUID();
  async function stage(key, type=kind) {
    const id = randomUUID(), path = [admin,"attachments","management-review",type,key.replace(":","-"),id,"a.pdf"].join("/");
    await query("insert into storage.objects values($1,$2,$3,$4)",[bucket,path,admin,JSON.stringify({size:12,mimetype:"application/pdf"})]);
    return {id,path,sha:createHash("sha256").update(id).digest("hex"),size:12,mime:"application/pdf",name:"a.pdf",title:"Acta",responsible:"SGC",category:"support",section:"policy",date:key.slice(0,4)+"-01-21",notes:type===minutes?"En revisión":"Notas"};
  }
  const write=(action,key,payload,previous=null,expected=null,type=kind)=>value(
    "select public.iq_review_write($1,$2,$3,$4,$5,$6)",[action,type,key,previous,expected,JSON.stringify(payload)]);
  const stamp=id=>value("select updated_at::text from file_objects where id=$1",[id]);
  const a=await stage(first), b=await stage(second), c=await stage(other);
  for(const [key,item] of [[first,a],[second,b],[other,c]]) assert.equal(await write("add",key,item),item.id);
  assert.equal(await write("add",first,a),a.id);
  assert.deepEqual((await periods()).rows.map(Object.values).flat().sort(),[2024,2025]);
  assert.equal(await value("select count(*)::int from file_objects where resource_type=$1 and resource_key like '2025:%'",[kind]),2);
  const version=await stage(first);
  const oldStamp=await stamp(a.id);
  await assert.rejects(write("replace",first,{...version,sha:a.sha},a.id,oldStamp),/REVIEW_DUPLICATE/);
  await assert.rejects(write("replace",first,{...version,size:13},a.id,oldStamp),/REVIEW_OBJECT/);
  assert.equal(await value("select is_current from file_objects where id=$1",[a.id]),true);
  assert.equal(await write("replace",first,version,a.id,oldStamp),version.id);
  assert.equal(await write("replace",first,version,a.id,oldStamp),version.id);
  assert.equal(await value("select version from file_objects where id=$1",[version.id]),2);
  assert.equal(await value("select is_current from file_objects where id=$1",[a.id]),false);
  const before=await stamp(version.id);
  await write("edit",first,{...version,title:"Título actualizado"},version.id,before);
  await assert.rejects(write("edit",first,version,version.id,before),/REVIEW_CHANGED/);
  assert.equal(await value("select object_path from file_objects where id=$1",[version.id]),version.path);
  await db.exec("reset role");
  assert.equal(await value("select count(*)::int from audit_log where action='REVIEW_REPLACE'"),1);
  await db.exec("set role authenticated");
  await setActor(reader);
  assert.equal(await value("select count(*)::int from storage.objects"),4);
  await assert.rejects(write("edit",first,version,version.id,before),/REVIEW_DENIED/);
  await assert.rejects(query("insert into file_objects(id,resource_type) values($1,$2)",[randomUUID(),kind]),/row-level security/);
  for(const id of [external,foreign]){
    await setActor(id);
    assert.equal((await periods()).rows.length,0);
    assert.equal(await value("select count(*)::int from storage.objects"),0);
  }
  await setActor(admin);
  await assert.rejects(write("retire",first,{reason:" "},version.id,await stamp(version.id)),/REVIEW_REASON/);
  await write("retire",first,{reason:"Documento retirado"},version.id,await stamp(version.id));
  assert.equal(await value("select count(*)::int from file_objects where resource_key=$1 and deleted_at is not null",[first]),2);
  assert.equal(await value("select count(*)::int from storage.objects"),4);
  assert.equal(await value("select is_current from file_objects where id=$1",[historic]),true);
  const acta = await stage("2025",minutes);
  await write("replace","2025",acta,historic,await stamp(historic),minutes);
  assert.equal(await value("select version from file_objects where id=$1",[acta.id]),2);
  await setActor(reader);
  assert.equal(await value("select count(*)::int from file_objects where resource_key=$1",[first]),0);
  assert.equal(await value("select count(*)::int from storage.objects where name=$1",[version.path]),0);
  assert.equal(await value("select count(*)::int from file_objects where id=$1",[b.id]),1);
  console.log("RE-03 · COMMIT íntegro, períodos, versiones y reintentos, metadatos, retiro lógico, bitácora, históricos y aislamiento comprobados.");
} finally {
  await db.close();
}
