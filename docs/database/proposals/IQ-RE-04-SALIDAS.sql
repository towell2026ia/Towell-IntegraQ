-- RE-04: official decisions are distinguished by origin_year. RE-03 uses neither
-- these columns nor the new RPCs. No existing review, approval or file is changed.
begin;
alter table public.management_review_decisions
  alter column review_id drop not null, alter column due_date drop not null,
  add column organization_id uuid references public.organizations(id),
  add column origin_year integer, add column serial_no integer,
  add column folio text generated always as (
    case when origin_year is not null then 'RPD-' || origin_year::text || '-' ||
      lpad(serial_no::text,greatest(4,length(serial_no::text)),'0') end) stored,
  add column source_link_id uuid references public.management_review_source_links(id),
  add column agreement_date date, add column classification text, add column section_id text,
  add column title text, add column justification text, add column resources text,
  add column process_id text references public.processes(id), add column actionable boolean,
  add column auth_state text, add column execution text, add column resolution text,
  add column created_by uuid references public.profiles(id), add column registered_at timestamptz,
  add column historic_item text, add column revision integer, add column historic boolean not null default false,
  add constraint review_output_folio unique(folio),
  add constraint review_output_shape check (
    case when origin_year is null then review_id is not null and due_date is not null and serial_no is null
    else organization_id is not null and serial_no>0 and serial_no is not null
      and origin_year between 1900 and 9999 and agreement_date is not null and extract(year from agreement_date)=origin_year
      and classification is not null and classification in ('improvement','change','resources')
      and section_id is not null and section_id in ('manual','policy','risks','objectives','organization','processes','customers','suppliers','audits','actions','improvement','satisfaction','history','outputs','attachments')
      and nullif(trim(title),'') is not null and length(trim(description))>0
      and actionable is not null and (not actionable or due_date>=agreement_date and due_date is not null)
      and auth_state is not null and auth_state in ('draft','review','authorized','cancelled')
      and execution is not null and execution in ('pending','in_progress','review','completed','cancelled')
      and created_by is not null and registered_at is not null and revision is not null and revision>0
    end);
create unique index review_output_original_item on public.management_review_decisions(organization_id,origin_year,lower(trim(historic_item))) where historic;
create index review_output_period on public.management_review_decisions(organization_id,origin_year,auth_state) where origin_year is not null;

create table public.review_output_actions(
  id uuid primary key, decision_id uuid not null references public.management_review_decisions(id),
  description text not null check(length(trim(description))>0), owner_id uuid not null references public.profiles(id),
  owner_name text not null, starts date not null, due date not null check(due>=starts),
  actual date, progress integer not null default 0 check(progress between 0 and 100),
  state text not null default 'pending' check(state in ('pending','in_progress','review','completed','cancelled')),
  result text, requires_evidence boolean not null default false,
  file_id uuid references public.file_objects(id), validated_by uuid references public.profiles(id), validated_at timestamptz
);
create index review_output_assignment on public.review_output_actions(decision_id,owner_id);
-- The insert is the operation receipt and chronological event. The AFTER trigger
-- applies the transition in the same transaction; retrying an operation cannot fire it twice.
create table public.review_output_events(
  operation_id uuid primary key, decision_id uuid not null references public.management_review_decisions(id) deferrable initially deferred,
  action_id uuid, actor uuid not null default auth.uid() references public.profiles(id),
  actor_name text, assignee_name text,
  command text not null, expected_revision integer not null, detail jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(), unique(decision_id,expected_revision)
);
create index review_output_chronology on public.review_output_events(decision_id,occurred_at);
alter table public.review_output_actions enable row level security;
alter table public.review_output_events enable row level security;
revoke all on public.review_output_actions,public.review_output_events from public,anon,authenticated;
grant select on public.review_output_actions,public.review_output_events to authenticated;
grant insert(operation_id,decision_id,action_id,command,expected_revision,detail) on public.review_output_events to authenticated;

create function public.iq_re04_org() returns uuid language sql stable security definer set search_path='' as $$
 select organization_id from public.profiles where id=auth.uid() and status='active'
 and workspace_mode='production' and public.is_internal_user() and public.has_module_permission('management-review','view');
$$;
create function public.iq_re04_director() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.positions t on t.id=p.position_id and t.organization_id=p.organization_id
 where p.id=auth.uid() and t.id='PU-02' and t.active and p.organization_id=public.iq_re04_org()
 and (public.has_module_permission('management-review','approve') or public.has_permission('management_review.approve',p.organization_id,null,null,null,false,null)));
$$;
create function public.iq_re04_visible(p_id uuid,p_action uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.management_review_decisions d where d.id=p_id and d.origin_year is not null
 and d.organization_id=public.iq_re04_org() and (d.process_id is null or public.has_process_access(d.process_id))
 and (public.is_administrator() or public.iq_re04_director()
 or (d.auth_state='authorized' and (d.owner_id=auth.uid() or exists(select 1 from public.review_output_actions a
 where a.decision_id=d.id and a.owner_id=auth.uid() and (p_action is null or a.id=p_action))))));
$$;
-- Restrictive guards intersect the legacy permissive policies, including admin write.
create policy re04_decisions_scope on public.management_review_decisions as restrictive for select to authenticated
 using(origin_year is null or public.iq_re04_visible(id));
create policy re04_decisions_read on public.management_review_decisions for select to authenticated
 using(origin_year is not null and public.iq_re04_visible(id));
create policy re04_legacy_insert on public.management_review_decisions as restrictive for insert to authenticated with check(origin_year is null);
create policy re04_legacy_update on public.management_review_decisions as restrictive for update to authenticated using(origin_year is null) with check(origin_year is null);
create policy re04_legacy_delete on public.management_review_decisions as restrictive for delete to authenticated using(origin_year is null);
create policy re04_actions_read on public.review_output_actions for select to authenticated using(public.iq_re04_visible(decision_id,id));
create policy re04_events_read on public.review_output_events for select to authenticated using(public.iq_re04_visible(decision_id,action_id));
-- Document visibility is tested as the caller under the installed file policies.
create policy re04_event_submit on public.review_output_events for insert to authenticated with check(
 actor=auth.uid() and public.iq_re04_org() is not null and jsonb_typeof(detail)='object'
 and (nullif(detail->>'file','') is null or exists(select 1 from public.file_objects f where f.id=(detail->>'file')::uuid
 and f.deleted_at is null and coalesce(f.workspace_id,(select organization_id from public.profiles where id=f.uploaded_by))=public.iq_re04_org())));

-- Resolve historical display names on the server, including reassignments.
create function public.iq_re04_event_names() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select full_name into new.actor_name from public.profiles where id=auth.uid();
 select full_name into new.assignee_name from public.profiles
 where id=nullif(new.detail->>'owner','')::uuid and organization_id=public.iq_re04_org();
 return new;
end $$;
revoke all on function public.iq_re04_event_names() from public,anon,authenticated;
create trigger re04_record_names before insert on public.review_output_events for each row execute function public.iq_re04_event_names();

create function public.iq_re04_apply() returns trigger language plpgsql security definer set search_path='' as $$
declare
 d public.management_review_decisions%rowtype;
 a public.review_output_actions%rowtype;
 org uuid:=public.iq_re04_org();
 admin boolean:=public.is_administrator(); director boolean:=public.iq_re04_director();
 j jsonb:=new.detail; cmd text:=new.command; reason text:=nullif(trim(j->>'note'),'');
 person public.profiles%rowtype; person_id uuid:=nullif(j->>'owner','')::uuid;
 doc uuid:=nullif(j->>'file','')::uuid; yr integer; seq integer;
begin
 if org is null or new.actor is distinct from auth.uid() then raise exception 'RE04_DENIED'; end if;
 if person_id is not null then
   select * into person from public.profiles where id=person_id and organization_id=org and status='active'
     and user_type in ('administrator','internal') and workspace_mode='production';
   if not found then raise exception 'RE04_OWNER'; end if;
 end if;
 if cmd='create' then
   if not admin or new.expected_revision<>0 or new.action_id is not null then raise exception 'RE04_DENIED'; end if;
   yr:=(j->>'year')::int;
   if yr is null or yr>extract(year from current_date) or (j->>'date')::date>current_date then raise exception 'RE04_DATE'; end if;
   if nullif(j->>'process','') is not null and not exists(select 1 from public.processes p where p.id=j->>'process' and p.active and p.organization_id=org)
     then raise exception 'RE04_PROCESS'; end if;
   if nullif(j->>'review','') is not null and not exists(select 1 from public.management_reviews r join public.profiles author on author.id=r.generated_by
      where r.id=(j->>'review')::uuid and r.year=yr and author.organization_id=org and r.ai_mode<>'demo') then raise exception 'RE04_REVIEW'; end if;
   if nullif(j->>'source','') is not null and not exists(select 1 from public.management_review_source_links s where s.id=(j->>'source')::uuid and s.review_id=nullif(j->>'review','')::uuid) then raise exception 'RE04_SOURCE'; end if;
   if coalesce((j->>'historic')::boolean,false) and (nullif(trim(j->>'item'),'') is null or not exists(select 1 from public.file_objects f
      where f.id=doc and f.module_id='management-review' and f.resource_type='management_review_minutes' and f.resource_key=yr::text and f.deleted_at is null))
      then raise exception 'RE04_HISTORIC'; end if;
   perform pg_advisory_xact_lock(70404,yr);
   select coalesce(max(serial_no),0)+1 into seq from public.management_review_decisions where origin_year=yr;
   insert into public.management_review_decisions(id,organization_id,origin_year,serial_no,agreement_date,classification,section_id,
     title,description,justification,resources,process_id,priority,actionable,due_date,owner_id,owner_name,review_id,source_link_id,evidence_file_id,historic,historic_item,
     auth_state,execution,created_by,registered_at,revision)
   values(new.decision_id,org,yr,seq,(j->>'date')::date,j->>'classification',j->>'section',trim(j->>'title'),trim(j->>'description'),
     j->>'justification',j->>'resources',nullif(j->>'process',''),j->>'priority',(j->>'actionable')::boolean,nullif(j->>'due','')::date,
     person_id,person.full_name,nullif(j->>'review','')::uuid,nullif(j->>'source','')::uuid,doc,coalesce((j->>'historic')::boolean,false),case when (j->>'historic')::boolean then trim(j->>'item') end,'draft','pending',new.actor,new.occurred_at,1);
   return new;
 end if;
 select * into d from public.management_review_decisions where id=new.decision_id and organization_id=org and origin_year is not null for update;
 if not found or not public.iq_re04_visible(d.id,new.action_id) then raise exception 'RE04_DENIED'; end if;
 if d.revision<>new.expected_revision then raise exception 'RE04_CHANGED'; end if;
 if d.auth_state='cancelled' then raise exception 'RE04_STATE'; end if;
 if (cmd in ('action','assign_action','progress','validate_action','cancel_action','reopen_action'))<>(new.action_id is not null)
   then raise exception 'RE04_ACTION'; end if;
 if new.action_id is not null and cmd<>'action' then
   select * into a from public.review_output_actions where id=new.action_id and decision_id=d.id;
   if not found then raise exception 'RE04_ACTION'; end if;
 end if;
 if cmd='amend' then
   if not admin or d.auth_state<>'draft' then raise exception 'RE04_STATE'; end if;
   update public.management_review_decisions set title=trim(j->>'title'),description=trim(j->>'description'),
     classification=j->>'classification',section_id=j->>'section',priority=j->>'priority',due_date=nullif(j->>'due','')::date,
     justification=j->>'justification',resources=j->>'resources' where id=d.id;
 elsif cmd='assign' then
   if not admin or person_id is null or reason is null or d.execution='completed' then raise exception 'RE04_ASSIGN'; end if;
   update public.management_review_decisions set owner_id=person_id,owner_name=person.full_name where id=d.id;
 elsif cmd='submit' then
   if not admin or d.auth_state<>'draft' or d.owner_id is null then raise exception 'RE04_STATE'; end if;
   update public.management_review_decisions set auth_state='review' where id=d.id;
 elsif cmd='authorize' then
   if not director or d.auth_state<>'review' or exists(select 1 from public.review_output_events e
      where e.operation_id=(select s.operation_id from public.review_output_events s where s.decision_id=d.id and s.command='submit' order by s.expected_revision desc limit 1) and e.actor=new.actor)
     or not exists(select 1 from public.profiles where id=d.owner_id and status='active' and organization_id=org)
    or (d.historic and reason is null) then raise exception 'RE04_APPROVAL'; end if;
   update public.management_review_decisions set auth_state='authorized' where id=d.id;
 elsif cmd='return' then
   if not director or d.auth_state<>'review' or reason is null then raise exception 'RE04_APPROVAL'; end if;
   update public.management_review_decisions set auth_state='draft' where id=d.id;
 elsif cmd='cancel' then
   if not admin or reason is null or d.execution='completed' then raise exception 'RE04_CANCEL'; end if;
   update public.management_review_decisions set auth_state='cancelled',execution='cancelled',status='cancelled' where id=d.id;
   update public.review_output_actions set state='cancelled' where decision_id=d.id and state not in ('completed','cancelled');
 elsif cmd='action' then
   if not admin or not d.actionable or d.auth_state not in ('draft','authorized') or d.execution='completed' or person_id is null then raise exception 'RE04_ACTION'; end if;
   insert into public.review_output_actions(id,decision_id,description,owner_id,owner_name,starts,due,requires_evidence)
     values(new.action_id,d.id,trim(j->>'description'),person_id,person.full_name,(j->>'start')::date,(j->>'due')::date,coalesce((j->>'evidence')::boolean,false));
 elsif cmd='assign_action' then
   if not admin or person_id is null or reason is null or a.state in ('cancelled','completed') or d.execution='completed' then raise exception 'RE04_ASSIGN'; end if;
   update public.review_output_actions set owner_id=person_id,owner_name=person.full_name where id=a.id;
 elsif cmd='cancel_action' then
   if not admin or reason is null or a.state in ('cancelled','completed') or d.execution='completed' then raise exception 'RE04_CANCEL'; end if;
   update public.review_output_actions set state='cancelled' where id=a.id;
 elsif cmd='progress' then
   if d.auth_state<>'authorized' or d.execution='completed' or a.state not in ('pending','in_progress')
     or (not admin and (a.owner_id<>new.actor or not public.has_module_permission('management-review','update')))
     or reason is null or (j->>'progress')::int is null then raise exception 'RE04_PROGRESS'; end if;
   if (j->>'progress')::int=100 and (nullif(trim(j->>'result'),'') is null or nullif(j->>'actual','') is null
      or (j->>'actual')::date>current_date or (a.requires_evidence and doc is null and a.file_id is null)) then raise exception 'RE04_RESULT'; end if;
   update public.review_output_actions set progress=(j->>'progress')::int,actual=nullif(j->>'actual','')::date,result=j->>'result',
     file_id=coalesce(doc,file_id),state=case when (j->>'progress')::int=100 then 'review' else 'in_progress' end where id=a.id;
 elsif cmd in ('validate_action','reopen_action') then
   if not (admin or director) or d.auth_state<>'authorized' or d.execution='completed' or reason is null or
      (cmd='validate_action' and a.state<>'review') or (cmd='reopen_action' and a.state not in ('review','completed')) then raise exception 'RE04_VALIDATE'; end if;
   update public.review_output_actions set state=case when cmd='validate_action' then 'completed' else 'in_progress' end,
     validated_by=case when cmd='validate_action' then new.actor end,validated_at=case when cmd='validate_action' then new.occurred_at end where id=a.id;
 elsif cmd in ('close','reopen') then
   if not (admin or director) or d.auth_state<>'authorized' or reason is null then raise exception 'RE04_VALIDATE'; end if;
   if cmd='close' then
     if d.execution='completed' or (d.actionable and not exists(select 1 from public.review_output_actions where decision_id=d.id and state='completed'))
       or exists(select 1 from public.review_output_actions where decision_id=d.id and state not in ('completed','cancelled')) then raise exception 'RE04_INCOMPLETE'; end if;
     update public.management_review_decisions set execution='completed',status='completed',completed_at=new.occurred_at,resolution=reason where id=d.id;
   else
     if d.execution<>'completed' then raise exception 'RE04_STATE'; end if;
     update public.management_review_decisions set execution='in_progress',status='in_progress',completed_at=null where id=d.id;
   end if;
 else raise exception 'RE04_COMMAND';
 end if;
 if d.auth_state='authorized' and cmd in ('action','progress','validate_action','cancel_action','reopen_action') then
   update public.management_review_decisions set execution=case
    when exists(select 1 from public.review_output_actions where decision_id=d.id and state<>'cancelled')
     and not exists(select 1 from public.review_output_actions where decision_id=d.id and state in ('pending','in_progress')) then 'review'
    else 'in_progress' end,status='in_progress' where id=d.id;
 end if;
 update public.management_review_decisions set revision=revision+1 where id=d.id;
 return new;
end $$;
revoke all on function public.iq_re04_apply() from public,anon,authenticated;
create trigger re04_transition after insert on public.review_output_events for each row execute function public.iq_re04_apply();

create function public.iq_re04_send(p_operation uuid,p_decision uuid,p_action uuid,p_command text,p_revision int,p_detail jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved public.review_output_events%rowtype;
begin
 if public.iq_re04_org() is null then raise exception 'RE04_DENIED'; end if;
 insert into public.review_output_events(operation_id,decision_id,action_id,command,expected_revision,detail)
 values(p_operation,p_decision,p_action,p_command,p_revision,p_detail) on conflict do nothing;
 select * into saved from public.review_output_events where operation_id=p_operation and actor=auth.uid();
 if not found or (saved.decision_id,saved.action_id,saved.command,saved.expected_revision,saved.detail)
 is distinct from (p_decision,p_action,p_command,p_revision,p_detail) then raise exception 'RE04_CHANGED'; end if;
 return saved.decision_id;
end $$;

-- Catalogs are read on opening the output screen. Do not expose the organization directory to assignees.
create function public.iq_re04_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.iq_re04_org();
begin
 if org is null then raise exception 'RE04_DENIED'; end if;
 return jsonb_build_object('admin',public.is_administrator(),'director',public.iq_re04_director(),
 'update',public.has_module_permission('management-review','update'),'actor',auth.uid(),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'position',p.position_name,'process',
    (select string_agg(pr.name,', ' order by pr.name) from public.user_process_permissions u join public.processes pr on pr.id=u.process_id and pr.organization_id=org where u.user_id=p.id))
    order by p.full_name) from public.profiles p where public.is_administrator() and p.organization_id=org and p.status='active' and p.user_type in ('administrator','internal') and p.workspace_mode='production'),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'year',r.year,'label',r.period_label,'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'type',s.source_type) order by s.id) from public.management_review_source_links s where s.review_id=r.id),'[]'::jsonb)) order by r.year desc) from public.management_reviews r join public.profiles p on p.id=r.generated_by where public.is_administrator() and p.organization_id=org and r.ai_mode<>'demo'),'[]'::jsonb),
 'processes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.processes where public.is_administrator() and organization_id=org and active),'[]'::jsonb));
end $$;
create function public.iq_re04_references(p_search text, p_minutes boolean, p_year int)
returns table(id uuid,label text) language sql stable security invoker set search_path='' as $$
 select f.id,coalesce(nullif(f.display_name,''),f.original_name)||' · '||f.original_name from public.file_objects f
 where public.iq_re04_org() is not null and f.deleted_at is null
 and coalesce(f.workspace_id,(select organization_id from public.profiles where id=f.uploaded_by))=public.iq_re04_org()
 and (not p_minutes or (f.module_id='management-review' and f.resource_type='management_review_minutes' and f.resource_key=p_year::text))
 and (f.original_name ilike '%'||p_search||'%' or f.display_name ilike '%'||p_search||'%')
 order by f.created_at desc,f.id limit 40;
$$;
revoke all on function public.iq_re04_references(text,boolean,int) from public,anon;
grant execute on function public.iq_re04_references(text,boolean,int) to authenticated;
create function public.iq_re04_years() returns setof integer language sql stable security invoker set search_path='' as $$
 select distinct origin_year from public.management_review_decisions where origin_year is not null;
$$;
revoke all on function public.iq_re04_org(), public.iq_re04_director(),public.iq_re04_visible(uuid,uuid),
 public.iq_re04_context(),public.iq_re04_years(),public.iq_re04_send(uuid,uuid,uuid,text,int,jsonb) from public,anon;
grant execute on function public.iq_re04_org(),public.iq_re04_director(),public.iq_re04_visible(uuid,uuid),
 public.iq_re04_context(),public.iq_re04_years(),public.iq_re04_send(uuid,uuid,uuid,text,int,jsonb) to authenticated;
commit;
