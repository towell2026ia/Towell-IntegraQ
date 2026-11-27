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
    create role authenticated; create role anon; create role service_role;
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
  const interrupted = randomUUID(), compensation = randomUUID();
  for (const [id,year] of [[interrupted,"2022"],[compensation,"2021"]]) {
    await query("insert into file_objects(id,module_id,resource_type,resource_key,category,uploaded_by,is_current,version) values($1,'management-review',$2,$3,'original',$4,true,1)",[id,minutes,year,admin]);
  }
  await db.exec("set role authenticated");
  await setActor(admin);
  await query("update file_objects set is_current=false where id in ($1,$2)",[interrupted,compensation]);
  await db.exec(`prepare legacy_put(uuid,text,text,uuid,int,text) as
    insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,uploaded_by,audience,
      resource_type,resource_key,category,version,is_current,replaces_file_id,display_name,valid_from,description)
    values($1,'integraq-private',$2,'acta.pdf','application/pdf',12,$3,'management-review',auth.uid(),'internal',
      'management_review_minutes',$6,'evidence:fixture',$5,true,$4,'SGC',($6||'-01-01')::date,'Finalizada') returning id`);
  await db.exec("reset role");
  await db.exec(readProposal());
  await db.exec("set role authenticated");
  await setActor(admin);
  const family = () => "2025:"+randomUUID();
  const first = family(), second = family(), other = "2024:"+randomUUID();
  const stamp=id=>value("select updated_at::text from file_objects where id=$1",[id]);
  const reserve=(id,type,key,previous,expected,payload)=>value("select iq_review_reserve($1,$2,$3,$4,$5,$6)",[id,type,key,previous,expected,JSON.stringify(payload)]);
  const lookup=id=>query("select * from iq_review_transfers() where id=$1",[id]).then(x=>x.rows[0]);
  async function stage(key, type=kind, previous=null) {
    const id = randomUUID(), path = [admin,"attachments","management-review",type,"r1-"+key.replace(":","-"),id,"original"].join("/");
    const payload = {sha:createHash("sha256").update(id).digest("hex"),size:12,mime:"application/pdf",name:"a.pdf",title:"Acta",responsible:"SGC",category:"support",section:"policy",date:key.slice(0,4)+"-01-21",notes:type===minutes?"En revisión":"Notas"};
    const expected=previous ? await stamp(previous) : null;
    assert.equal(await reserve(id,type,key,previous,expected,payload),id);
    assert.equal(await reserve(randomUUID(),type,key,previous,expected,payload),id);
    assert.equal((await lookup(id)).uploaded,false);
    await setActor("");
    assert.equal(await lookup(id),undefined);
    await setActor(foreign);
    assert.equal(await lookup(id),undefined);
    await setActor(admin);
    assert.equal((await lookup(id)).object_path,path);
    await query("insert into storage.objects values($1,$2,$3,$4)",[bucket,path,admin,JSON.stringify({size:12,mimetype:"application/pdf"})]);
    assert.equal((await lookup(id)).uploaded,true);
    const command="select public.iq_review_attest($1,$2,$3,$4)";
    await assert.rejects(query(command,[id,admin,payload.sha,12]),/permission denied/);
    await db.exec("set role service_role");
    await query(command,[id,admin,payload.sha,12]);
    await db.exec("set role authenticated");
    return (await lookup(id)).payload;
  }
  const write=(action,key,payload,previous=null,expected=null,type=kind)=>value(
    "select public.iq_review_write($1,$2,$3,$4,$5,$6)",[action,type,key,previous,expected,JSON.stringify(payload)]);
  const a=await stage(first), b=await stage(second), c=await stage(other);
  for(const [key,item] of [[first,a],[second,b],[other,c]]) assert.equal(await write("add",key,item),item.id);
  assert.equal(await write("add",first,a),a.id);
  assert.deepEqual((await periods()).rows.map(Object.values).flat().sort(),[2021,2022,2024,2025]);
  assert.equal(await value("select count(*)::int from file_objects where resource_type=$1 and resource_key like '2025:%'",[kind]),2);
  const version=await stage(first,kind,a.id);
  const oldStamp=await stamp(a.id);
  await assert.rejects(write("replace",first,{...version,sha:a.sha},a.id,oldStamp),/REVIEW_RESERVATION/);
  await assert.rejects(write("replace",first,{...version,size:13},a.id,oldStamp),/REVIEW_RESERVATION/);
  assert.equal(await value("select is_current from file_objects where id=$1",[a.id]),true);
  await db.exec("reset role");
  await db.exec("create function fixture_reject() returns trigger language plpgsql as $$begin raise exception 'TEST_REGISTRATION_FAILURE'; end$$; create trigger fail_audit before insert on audit_log for each row execute function fixture_reject()");
  await db.exec("set role authenticated");
  await assert.rejects(write("replace",first,version,a.id,oldStamp),/TEST_REGISTRATION_FAILURE/);
  assert.equal(await value("select is_current from file_objects where id=$1",[a.id]),true);
  assert.equal((await lookup(version.id)).result_id,null);
  await db.exec("reset role; drop trigger fail_audit on audit_log; set role authenticated");
  assert.deepEqual(await Promise.all([1,2,3].map(()=>write("replace",first,version,a.id,oldStamp))),Array(3).fill(version.id));
  assert.equal((await lookup(version.id)).result_id,version.id);
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
  const acta = await stage("2025",minutes,historic);
  await write("replace","2025",acta,historic,await stamp(historic),minutes);
  assert.equal(await value("select version from file_objects where id=$1",[acta.id]),2);
  await setActor(reader);
  assert.equal(await value("select count(*)::int from file_objects where resource_key=$1",[first]),0);
  assert.equal(await value("select count(*)::int from storage.objects where name=$1",[version.path]),0);
  assert.equal(await value("select count(*)::int from file_objects where id=$1",[b.id]),1);
  await setActor(admin);
  async function legacyPut(year,previous,version,alreadyDeactivated=false) {
    const id=randomUUID(), path=[admin,"attachments","management-review",minutes,year,id,"acta.pdf"].join("/");
    const sha=createHash("sha256").update(id).digest("hex");
    await query("insert into storage.objects values($1,$2,$3,$4)",[bucket,path,admin,JSON.stringify({size:12,mimetype:"application/pdf"})]);
    assert.equal(await value("select count(*)::int from storage.objects where name=$1",[path]),1);
    await setActor(foreign);
    assert.equal(await value("select count(*)::int from storage.objects where name=$1",[path]),0);
    await setActor(admin);
    if(previous && !alreadyDeactivated) {
      await query("update file_objects set is_current=false where id=$1 and is_current",[previous]);
      assert.equal(await value("select is_current from file_objects where id=$1",[previous]),true);
    }
    const previousSql=previous ? "'"+previous+"'::uuid" : "null::uuid";
    const put="execute legacy_put('"+id+"','"+path+"','"+sha+"',"+previousSql+","+version+",'"+year+"')";
    assert.equal(await value(put),id);
    assert.equal((await query("delete from storage.objects where name=$1 returning name",[path])).rows.length,0);
    return id;
  }
  const bridged=await legacyPut("2022",interrupted,2,true);
  assert.equal(await value("select replaces_file_id from file_objects where id=$1",[bridged]),interrupted);
  await query("update file_objects set is_current=true where id=$1",[interrupted]);
  assert.equal(await value("select is_current from file_objects where id=$1",[interrupted]),false);
  assert.equal(await value("update file_objects set is_current=true where id=$1 returning is_current",[compensation]),true);
  const legacy=await legacyPut("2023",null,1);
  const nextLegacy=await legacyPut("2023",legacy,2);
  assert.equal(await value("select is_current from file_objects where id=$1",[legacy]),false);
  const mixed=await legacyPut("2025",acta.id,3);
  assert.equal(await value("select replaces_file_id from file_objects where id=$1",[mixed]),acta.id);
  await assert.rejects(query("update file_objects set original_name='changed.pdf' where id=$1",[mixed]),/REVIEW_DENIED/);
  await assert.rejects(query("update file_objects set deleted_at=now(),deleted_by=auth.uid(),is_current=false where id=$1",[mixed]),/REVIEW_REASON/);
  assert.equal(await value("update file_objects set deleted_at=now(),deleted_by=auth.uid(),deletion_reason='Retiro autorizado',is_current=false where id=$1 returning id",[nextLegacy]),nextLegacy);
  assert.equal(await value("select count(*)::int from storage.objects where name like '%/2023/%'"),2);
  assert.equal(await write("replace","2025",acta,historic,await value("select expected_at::text from iq_review_uploads where id=$1",[acta.id]),minutes),acta.id);
  await setActor(reader);
  await assert.rejects(reserve(randomUUID(),kind,first,null,null,version),/REVIEW_DENIED/);
  console.log("RE-03-R1 · RE-02 preparado antes de instalar, alta, reemplazo, retiro, coexistencia y recuperación comprobados.");
  console.log("RE-03 · COMMIT íntegro, períodos, versiones y reintentos, metadatos, retiro lógico, bitácora, históricos y aislamiento comprobados.");
} finally {
  await db.close();
}
