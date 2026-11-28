begin;
CREATE OR REPLACE FUNCTION public.iq_re04_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.iq_re04_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
update public.permissions set status='inactive' where code in ('revision_direccion.reabrir_acuerdos','revision_direccion.reabrir_acciones');
commit;
