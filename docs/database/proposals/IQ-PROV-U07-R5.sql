-- Local proposal. Apply as one transaction only after release approval.
begin;

create table public.supplier_portal_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  supplier_id uuid not null references public.organizations,
  site_id uuid references public.external_company_sites,
  email text not null,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references public.profiles,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  withdrawn_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles
);
create unique index supplier_portal_one_pending on public.supplier_portal_invitations(lower(email))
where withdrawn_at is null and accepted_at is null;
alter table public.supplier_portal_invitations enable row level security;
revoke all on public.supplier_portal_invitations from public, anon, authenticated;
grant select on public.supplier_portal_invitations to service_role;

create function public.iq_supplier_portal_admin(p_supplier uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
  select organization_id into org from public.profiles where id=auth.uid() and user_type='administrator'
    and status='active' and workspace_mode='production';
  if org is distinct from public.iq_rncp_actor_org(true) or org is null or not exists(select 1 from public.organizations where id=p_supplier and kind='supplier' and active
    and deleted_at is null and public.iq_supplier_audit_supplier_allowed(id,org)) then
    raise exception using errcode='42501',message='PORTAL_SCOPE';
  end if;
  return org;
end $$;

create function public.iq_supplier_portal_contact(p_supplier uuid,dest text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s public.organizations%rowtype;c jsonb;
begin
 select * into strict s from public.organizations where id=p_supplier and active and deleted_at is null;
  c:=coalesce(s.metadata->'supplierQualityContacts','{}');
  if dest is null or dest !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or
    (not exists(select 1 from jsonb_array_elements(coalesce(c->'contacts','[]')) x
      where lower(trim(x->>'email'))=dest and coalesce(x->>'retired','false')='false')
     and not (dest in (lower(trim(coalesce(c->>'email',s.contact_email,''))),lower(trim(coalesce(c->>'alternateEmail',''))))
       and not exists(select 1 from jsonb_array_elements(coalesce(c->'contacts','[]')) x where lower(trim(x->>'email'))=dest or
          (x->>'id'='legacy-primary' and dest=lower(trim(coalesce(c->>'email',s.contact_email,'')))) or
          (x->>'id'='legacy-alternate' and dest=lower(trim(c->>'alternateEmail')))))) then return false; end if;
 return true;
end $$;
revoke all on function public.iq_supplier_portal_contact(uuid,text) from public,anon,authenticated;

create function public.iq_supplier_portal_issue(p_supplier uuid,p_site uuid,p_email text,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_supplier_portal_admin(p_supplier); dest text:=lower(trim(p_email));
  s public.organizations%rowtype; known uuid; prof public.profiles%rowtype; ticket uuid;
begin
  select * into strict s from public.organizations where id=p_supplier for share;
  if not public.iq_supplier_portal_contact(p_supplier,dest) then raise exception 'CONTACT_REQUIRED'; end if;
  if p_site is not null and not exists(select 1 from public.external_company_sites where id=p_site and company_id=p_supplier and active) then raise exception 'SITE_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(dest,0));
  select id into known from auth.users where lower(email)=dest;
  if known is not null then
    select * into strict prof from public.profiles where id=known for update;
    if prof.user_type<>'supplier' or prof.workspace_mode<>'production' or not (
      (prof.external_party_id=p_supplier and prof.external_site_id is not distinct from p_site and prof.status='active') is true
      or (prof.external_party_id is null and prof.status='inactive' and exists(select 1 from auth.users where id=known and
        raw_app_meta_data->>'supplier_enrollment'=p_supplier::text))) then raise exception 'IDENTITY_CONFLICT'; end if;
  end if;
  if exists(select 1 from public.supplier_portal_invitations where email=dest and supplier_id<>p_supplier and withdrawn_at is null and accepted_at is null and expires_at>now()) then raise exception 'IDENTITY_CONFLICT'; end if;
  update public.supplier_portal_invitations set withdrawn_at=now() where email=dest and accepted_at is null and withdrawn_at is null;
  insert into public.supplier_portal_invitations(organization_id,supplier_id,site_id,email,token_digest,invited_by)
    values(org,p_supplier,p_site,dest,p_digest,auth.uid()) returning id into ticket;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id)
    values(auth.uid(),org,'suppliers','supplier.portal.invited','supplier_invitation',ticket::text);
  return jsonb_build_object('id',ticket,'userId',known,'enroll',prof.external_party_id is null);
end $$;

create function public.iq_supplier_portal_accept(p_digest text,p_name text,p_prepare boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.supplier_portal_invitations%rowtype; p public.profiles%rowtype; u auth.users%rowtype; org uuid;
begin
  select * into t from public.supplier_portal_invitations where token_digest=p_digest for update;
  select * into u from auth.users where id=auth.uid();
  if t.id is null or t.expires_at<=now() or t.withdrawn_at is not null or t.accepted_at is not null
    or u.email_confirmed_at is null or lower(u.email) is distinct from t.email
    or length(trim(coalesce(p_name,''))) not between 2 and 160 then raise exception 'INVALID_INVITATION'; end if;
  select * into strict p from public.profiles where id=u.id for update;
  org:=t.organization_id;
  if not exists(select 1 from public.organizations s join public.organizations tenant on tenant.id=org and tenant.kind='internal' and tenant.active and tenant.deleted_at is null
    where s.id=t.supplier_id and s.active and s.deleted_at is null and s.kind='supplier'
    and (s.owning_organization_id=org or (s.owning_organization_id is null and (select count(*) from public.organizations where kind='internal')=1))) or
     not exists(select 1 from public.profiles where id=t.invited_by and organization_id=org and user_type='administrator' and status='active' and workspace_mode='production') or
     (t.site_id is not null and not exists(select 1 from public.external_company_sites where id=t.site_id and company_id=t.supplier_id and active)) or
     not public.iq_supplier_portal_contact(t.supplier_id,t.email) or p.user_type<>'supplier' or p.workspace_mode<>'production' then raise exception 'INVALID_INVITATION'; end if;
  if p.external_party_id is null and p.status='inactive' and u.raw_app_meta_data->>'supplier_enrollment'=t.supplier_id::text then
    if p_prepare then return t.supplier_id; end if;
    if nullif(u.encrypted_password,'') is null then raise exception 'CREDENTIALS_REQUIRED'; end if;
    update public.profiles set full_name=trim(p_name),short_name=trim(p_name),external_party_kind='supplier',
      external_party_id=t.supplier_id,external_site_id=t.site_id,status='active' where id=p.id;
  elsif p_prepare or p.external_party_id is distinct from t.supplier_id or p.external_site_id is distinct from t.site_id or p.status<>'active' then raise exception 'IDENTITY_CONFLICT'; end if;
  update public.supplier_portal_invitations set accepted_at=now(),accepted_by=u.id where id=t.id;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id)
    values(u.id,org,'suppliers','supplier.portal.accepted','supplier_invitation',t.id::text);
  return t.supplier_id;
end $$;

create function public.iq_supplier_portal_access(p_supplier uuid,p_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_supplier_portal_admin(p_supplier);
begin
  if p_action='withdraw' then
    update public.supplier_portal_invitations set withdrawn_at=now() where id=p_id and supplier_id=p_supplier and accepted_at is null and withdrawn_at is null;
  elsif p_action in ('revoke','reactivate') then
    update public.profiles set status=(case when p_action='revoke' then 'inactive' else 'active' end)::public.account_status
      where id=p_id and user_type='supplier' and external_party_kind='supplier' and external_party_id=p_supplier and workspace_mode='production'
        and (status='active')=(p_action='revoke') and (p_action='revoke' or external_site_id is null or exists(select 1 from public.external_company_sites s where s.id=external_site_id and s.company_id=p_supplier and s.active));
  else raise exception 'INVALID_OPERATION'; end if;
  if not found then raise exception 'ACCESS_CONFLICT'; end if;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id)
    values(auth.uid(),org,'suppliers','supplier.portal.'||p_action,'supplier_access',p_id::text);
end $$;
revoke all on function public.iq_supplier_portal_admin(uuid),public.iq_supplier_portal_issue(uuid,uuid,text,text),public.iq_supplier_portal_accept(text,text,boolean),public.iq_supplier_portal_access(uuid,uuid,text) from public, anon;
grant execute on function public.iq_supplier_portal_admin(uuid),public.iq_supplier_portal_issue(uuid,uuid,text,text),public.iq_supplier_portal_accept(text,text,boolean),public.iq_supplier_portal_access(uuid,uuid,text) to authenticated;

-- Actions are already part of manual_record. Only the association and its review are new.
create table public.supplier_audit_portal_evidence (
 file_id uuid primary key references public.file_objects,
 event_id uuid not null references public.supplier_audit_events,
 action_key text not null,
 performed_on date not null,
 review text not null default 'pending' check(review in ('pending','accepted','returned')),
 observation text not null default '',
 reviewed_by uuid references public.profiles,
 reviewed_at timestamptz
);
create index supplier_audit_portal_evidence_event on public.supplier_audit_portal_evidence(event_id,action_key);
alter table public.supplier_audit_portal_evidence enable row level security;
revoke all on public.supplier_audit_portal_evidence from public,anon,authenticated;
grant select on public.supplier_audit_portal_evidence to service_role;
create policy supplier_portal_evidence_private on public.file_objects as restrictive for all to public
 using(resource_type <> 'supplier_audit_portal_evidence' and object_path not like 'supplier-audit-responses/%')
 with check(resource_type <> 'supplier_audit_portal_evidence' and object_path not like 'supplier-audit-responses/%');
create policy supplier_portal_response_objects_private on storage.objects as restrictive for all to public
 using(bucket_id <> 'integraq-private' or name not like 'supplier-audit-responses/%')
 with check(bucket_id <> 'integraq-private' or name not like 'supplier-audit-responses/%');

create function public.iq_supplier_portal_keep_audit_actions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.supplier_audit_portal_evidence x where x.event_id=old.id and not exists(
  select 1 from jsonb_array_elements(new.manual_record#>'{record,actions}') a where a->>'id'=x.action_key))
 then raise exception 'ACTION_HAS_EVIDENCE'; end if;
 return new;
end $$;
revoke all on function public.iq_supplier_portal_keep_audit_actions() from public,anon,authenticated;
create trigger supplier_audit_preserve_evidence_action before update of manual_record on public.supplier_audit_events
for each row when(old.manual_record is distinct from new.manual_record) execute function public.iq_supplier_portal_keep_audit_actions();

create function public.iq_supplier_portal_evidence_scope(p_event uuid,p_action text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare e public.supplier_audit_events%rowtype;
begin
 select * into e from public.supplier_audit_events where id=p_event;
 if e.id is null then raise exception using errcode='42501',message='EVENT_SCOPE'; end if;
 if not public.iq_supplier_audit_manual_portal_scope(e.id) then
   if public.iq_supplier_portal_admin(e.supplier_id) is distinct from e.organization_id then raise exception using errcode='42501',message='EVENT_SCOPE'; end if;
 end if;
 if p_action is not null and not exists(select 1 from jsonb_array_elements(e.manual_record#>'{record,actions}') a where a->>'id'=p_action)
 then raise exception using errcode='42501',message='ACTION_SCOPE'; end if;
 return e.organization_id;
end $$;
create function public.iq_supplier_portal_evidence_add(p_event uuid,p_action text,p_date date,p_sha text,p_name text,p_mime text,p_bytes int) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.supplier_audit_events%rowtype; f uuid; path text; actor uuid:=auth.uid();
begin
 perform 1 from public.profiles where id=actor and status='active' for share;
 select * into strict e from public.supplier_audit_events where id=p_event for update;
 perform public.iq_supplier_portal_prepare_upload(p_event,p_action,p_date,p_sha,p_mime,p_bytes);
 perform public.iq_supplier_portal_evidence_scope(p_event,p_action);
 if not public.iq_supplier_audit_manual_portal_scope(p_event) or p_action is null then raise exception using errcode='42501',message='ACTION_SCOPE'; end if;
 if p_date is null or p_date>current_date or p_sha !~ '^[0-9a-f]{64}$' or length(p_name) not between 1 and 240 or p_bytes not between 1 and 4194304 then raise exception 'INVALID_FILE'; end if;
 path:='supplier-audit-responses/'||actor||'/'||p_event||'/'||encode(sha256(convert_to(p_action,'UTF8')),'hex')||'/'||p_date||'/'||p_sha;
 if not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=path and metadata->>'mimetype'=p_mime and (metadata->>'size')::bigint=p_bytes) then raise exception 'UNCONFIRMED_FILE'; end if;
 select file_id into f from public.supplier_audit_portal_evidence x join public.file_objects o on o.id=x.file_id where o.object_path=path and x.event_id=p_event and x.action_key=p_action and o.sha256=p_sha;
 if found then return f; end if;
 insert into public.file_objects(workspace_id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,resource_type,resource_id,category,uploaded_by)
 values(e.organization_id,'integraq-private',path,p_name,p_mime,p_bytes,p_sha,'suppliers','internal','supplier_audit_portal_evidence',e.id,'audit-response',actor) returning id into f;
 insert into public.supplier_audit_portal_evidence(file_id,event_id,action_key,performed_on) values(f,e.id,p_action,p_date);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id) values(actor,e.organization_id,'suppliers','supplier.evidence.submitted','supplier_audit_portal_evidence',f::text);
 return f;
end $$;
create function public.iq_supplier_portal_evidence_review(p_file uuid,p_expected text,p_decision text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.supplier_audit_events%rowtype;
begin
 select a.* into strict e from public.supplier_audit_events a join public.supplier_audit_portal_evidence x on a.id=x.event_id where x.file_id=p_file;
 if public.iq_supplier_portal_admin(e.supplier_id) is distinct from e.organization_id then raise exception using errcode='42501',message='REVIEW_SCOPE'; end if;
 if p_decision not in ('accepted','returned') or (p_decision='returned' and length(trim(coalesce(p_note,'')))<3) or length(p_note)>2000 then raise exception 'REVIEW_INVALID'; end if;
 update public.supplier_audit_portal_evidence set review=p_decision,observation=trim(coalesce(p_note,'')),reviewed_by=auth.uid(),reviewed_at=now()
 where file_id=p_file and review=p_expected and review='pending';
 if not found then raise exception 'REVIEW_CHANGED'; end if;
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata) values(auth.uid(),e.organization_id,'suppliers','supplier.evidence.'||p_decision,'supplier_audit_portal_evidence',p_file::text,jsonb_build_object('observation',p_note));
end $$;
revoke all on function public.iq_supplier_portal_evidence_scope(uuid,text),public.iq_supplier_portal_evidence_add(uuid,text,date,text,text,text,int),public.iq_supplier_portal_evidence_review(uuid,text,text,text) from public,anon;
grant execute on function public.iq_supplier_portal_evidence_scope(uuid,text),public.iq_supplier_portal_evidence_add(uuid,text,date,text,text,text,int),public.iq_supplier_portal_evidence_review(uuid,text,text,text) to authenticated;


create function public.iq_supplier_portal_tenant() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select tenant.id into org from public.profiles p join public.organizations s on s.id=p.external_party_id
 join public.organizations tenant on tenant.kind='internal' and tenant.active and tenant.deleted_at is null
 and (s.owning_organization_id=tenant.id or (s.owning_organization_id is null and (select count(*) from public.organizations where kind='internal')=1))
 where p.id=auth.uid() and p.status='active' and p.workspace_mode='production' and p.user_type='supplier' and p.external_party_kind='supplier'
 and s.kind='supplier' and s.active and s.deleted_at is null
 and (p.external_site_id is null or exists(select 1 from public.external_company_sites where id=p.external_site_id and company_id=s.id and active))
 and public.has_permission('portal_proveedores.acceder',null,null,null,null,false,s.id);
 if org is null then raise exception using errcode='42501',message='PORTAL_SCOPE'; end if;
 return org;
end $$;
revoke all on function public.iq_supplier_portal_tenant() from public,anon;
grant execute on function public.iq_supplier_portal_tenant() to authenticated;
create function public.iq_supplier_portal_report(p_report uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select r.organization_id into org from public.supplier_rncp_reports r
 join public.profiles p on p.id=auth.uid() and p.status='active' and p.workspace_mode='production'
   and p.user_type='supplier' and p.external_party_kind='supplier' and p.external_party_id=r.supplier_id
 join public.organizations s on s.id=r.supplier_id and s.active and s.deleted_at is null
 join public.organizations t on t.id=r.organization_id and t.kind='internal' and t.active and t.deleted_at is null
 where r.id=p_report and r.portal_visible and r.deleted_at is null and r.status<>'draft'
 and (s.owning_organization_id=t.id or (s.owning_organization_id is null and (select count(*) from public.organizations where kind='internal')=1))
 and (p.external_site_id is null or (r.site_id=p.external_site_id and exists(select 1 from public.external_company_sites where id=r.site_id and company_id=s.id and active)))
 and public.iq_rncp_read_scope(r.id) and public.has_permission('portal_proveedores.acceder',null,null,null,null,false,r.supplier_id);
 if org is null then raise exception using errcode='42501',message='REPORT_SCOPE'; end if;
 return org;
end $$;
create function public.iq_supplier_portal_report_files(p_report uuid)
returns table(id uuid,name text,kind text) language sql stable security definer set search_path='' as $$
 select f.id,f.original_name,f.resource_type from public.file_objects f
 join public.supplier_rncp_reports r on r.id=f.resource_id
 where r.id=p_report and f.workspace_id=public.iq_supplier_portal_report(p_report)
 and f.deleted_at is null and f.bucket_id='integraq-private' and
 ((f.resource_type='supplier_rncp_original' and f.object_path like 'rncp-originals/'||r.organization_id||'/%' and
   ((r.source_kind='historical' and coalesce(f.resource_key,'') not like 'generated:%') or
     exists(select 1 from public.audit_log l where l.resource_id=r.id::text and l.resource_type='supplier_rncp_report'
       and l.action='rncp.record_manual_notification' and l.metadata->>'officialFileId'=f.id::text and l.metadata->>'officialSha256'=f.sha256)))
 or (r.notified_at is not null and f.resource_type='supplier_rncp_initial_photo' and f.object_path like 'rncp-initial/'||r.organization_id||'/'||r.id||'/%'
  and exists(select 1 from public.supplier_rncp_initial_photo_sets ps where ps.report_id=r.id and ps.organization_id=r.organization_id and f.id=any(ps.file_ids))))
 order by f.created_at,f.id
$$;
alter table public.supplier_rncp_actions add column portal_request_id uuid;
create unique index supplier_rncp_action_portal_request on public.supplier_rncp_actions(created_by,portal_request_id) where portal_request_id is not null;
create function public.iq_supplier_portal_save_response(p_request uuid,p_action uuid,p_report uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; prior public.supplier_rncp_actions%rowtype; origin text; actual date:=nullif(p_payload->>'executedAt','')::date;
begin
 perform 1 from public.profiles where id=auth.uid() for share;
 select source_kind into origin from public.supplier_rncp_reports where id=p_report for update;
 perform public.iq_supplier_portal_report(p_report);
 if p_request is null or actual>current_date then raise exception 'INVALID_RESPONSE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 if p_action is null then
  select * into prior from public.supplier_rncp_actions where created_by=auth.uid() and portal_request_id=p_request;
  if found then
   if prior.report_id<>p_report then raise exception 'REQUEST_CONFLICT'; end if;
   return prior.id;
  end if;
 end if;
 if origin='native' then
  result:=public.iq_rncp_save_response(p_action,p_report,p_payload);
 elsif origin is null or origin='legacy' then
  select saved.id into result from public.save_supplier_rncp_action(p_action,p_report,p_payload->>'description',p_payload->>'responsibleName',
   nullif(p_payload->>'dueDate','')::date,actual,p_payload->>'comment','in_progress'::public.supplier_response_status) saved;
 else raise exception using errcode='42501',message='HISTORICAL_READ_ONLY'; end if;
 update public.supplier_rncp_actions set executed_at=actual,supplier_comment=p_payload->>'comment',
   portal_request_id=case when p_action is null then p_request else portal_request_id end where id=result and created_by=auth.uid() and report_id=p_report;
 if not found then raise exception 'ACTION_SCOPE'; end if;
 return result;
end $$;
revoke all on function public.iq_supplier_portal_report(uuid),public.iq_supplier_portal_report_files(uuid),public.iq_supplier_portal_save_response(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.iq_supplier_portal_report(uuid),public.iq_supplier_portal_report_files(uuid),public.iq_supplier_portal_save_response(uuid,uuid,uuid,jsonb) to authenticated;


alter table public.supplier_rncp_action_evidence add column performed_on date;
create policy supplier_rncp_portal_upload_objects on storage.objects as restrictive for all to public
 using(bucket_id<>'integraq-private' or name not like 'supplier-rncp-responses/%')
 with check(bucket_id<>'integraq-private' or name not like 'supplier-rncp-responses/%');
create policy supplier_rncp_portal_upload_register on public.file_objects as restrictive for insert to public
 with check(object_path not like 'supplier-rncp-responses/%');
create policy supplier_rncp_portal_upload_immutable on public.file_objects as restrictive for update to public
 using(object_path not like 'supplier-rncp-responses/%') with check(object_path not like 'supplier-rncp-responses/%');
create function public.iq_supplier_portal_rncp_evidence(p_action uuid,p_date date,p_sha text,p_name text,p_mime text,p_bytes int)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.supplier_rncp_actions%rowtype; r public.supplier_rncp_reports%rowtype; f uuid;
 path text; actor uuid:=auth.uid();
begin
 perform 1 from public.profiles where id=actor and status='active' for share;
 select rep.* into strict r from public.supplier_rncp_reports rep join public.supplier_rncp_actions ac on ac.report_id=rep.id where ac.id=p_action for update of rep;
 perform public.iq_supplier_portal_report(r.id);
 select * into strict a from public.supplier_rncp_actions where id=p_action and report_id=r.id for update;
 if a.created_by is distinct from actor or a.status not in ('pending','in_progress','rejected') or r.status not in ('submitted','in_progress')
   or r.source_kind='historical' or (r.source_kind='native' and r.notified_at is null) then raise exception using errcode='42501',message='ACTION_SCOPE'; end if;
 if p_date is null or p_date>current_date or p_sha !~ '^[0-9a-f]{64}$' or length(trim(p_name)) not between 1 and 240
 or not exists(select 1 from public.file_upload_policies where resource_type='supplier_rncp_action_evidence'
 and p_bytes between 1 and least(max_size_bytes,4194304) and p_mime=any(allowed_mime_types)) then raise exception 'INVALID_FILE'; end if;
 path:='supplier-rncp-responses/'||actor||'/'||p_action||'/'||p_sha;
 select x.file_id into f from public.supplier_rncp_action_evidence x join public.file_objects fo on fo.id=x.file_id
 where x.action_id=p_action and fo.resource_id=p_action and fo.resource_type='supplier_rncp_action_evidence'
 and fo.uploaded_by=actor and fo.sha256=p_sha and fo.deleted_at is null;
 if found then return f; end if;
 if not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=path and metadata->>'mimetype'=p_mime and (metadata->>'size')::bigint=p_bytes) then raise exception 'UNCONFIRMED_FILE'; end if;
 insert into public.file_objects(workspace_id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,external_organization_id,external_site_id,audience,resource_type,resource_id,resource_key,category,uploaded_by)
 values(r.organization_id,'integraq-private',path,p_name,p_mime,p_bytes,p_sha,'suppliers',r.supplier_id,r.site_id,'supplier','supplier_rncp_action_evidence',p_action,r.folio,'rncp-evidence:'||p_sha,actor) returning id into f;
 insert into public.supplier_rncp_action_evidence(action_id,file_id,created_by,performed_on) values(p_action,f,actor,p_date);
 if r.source_kind='native' then perform public.iq_rncp_refresh_response_progress(p_action); end if;
 return f;
end $$;
revoke all on function public.iq_supplier_portal_rncp_evidence(uuid,date,text,text,text,int) from public,anon;
grant execute on function public.iq_supplier_portal_rncp_evidence(uuid,date,text,text,text,int) to authenticated;


create function public.iq_supplier_portal_evidence_index(p_year int,p_kind text,p_search text,p_review text,p_offset int)
returns table(file_id uuid,expediente uuid,folio text,tipo text,accion text,nombre text,fecha date,estado text,origen text)
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.iq_supplier_portal_tenant(); perfil public.profiles%rowtype;
begin
 select * into strict perfil from public.profiles where id=auth.uid();
 if coalesce(p_kind,'') not in ('','RNCP','Auditoría') or coalesce(p_review,'') not in ('','pending','accepted','returned')
 or coalesce(p_offset,-1)<0 or length(p_search)>100 then raise exception 'INVALID_FILTER'; end if;
 return query with visible as(
  select f.id as file_id,r.id as expediente,r.folio::text as folio,'RNCP'::text as tipo,a.description::text as accion,
   f.original_name as nombre,x.performed_on as fecha,case when a.status in ('accepted','closed') then 'accepted' when a.status='rejected' then 'returned' else 'pending' end as estado,
   'rncp'::text as origen,r.report_date as period
  from public.supplier_rncp_reports r join public.supplier_rncp_actions a on a.report_id=r.id
  join public.supplier_rncp_action_evidence x on x.action_id=a.id join public.file_objects f on f.id=x.file_id and f.resource_id=a.id
  where r.organization_id=org and r.supplier_id=perfil.external_party_id and (perfil.external_site_id is null or perfil.external_site_id=r.site_id)
   and r.portal_visible and r.deleted_at is null and r.status<>'draft' and public.iq_rncp_read_scope(r.id)
   and f.resource_type='supplier_rncp_action_evidence' and f.deleted_at is null and f.bucket_id='integraq-private'
  union all
  select f.id,e.id,coalesce(e.actual_date::text,'Auditoría')||' · '||e.manual_classification::text,'Auditoría',a->>'description',f.original_name,
   x.performed_on,x.review,'audit',e.actual_date from public.supplier_audit_portal_evidence x join public.supplier_audit_events e on e.id=x.event_id
   join public.file_objects f on f.id=x.file_id and f.resource_id=e.id and f.workspace_id=e.organization_id
   cross join lateral jsonb_array_elements(e.manual_record#>'{record,actions}') a
   where a->>'id'=x.action_key and e.organization_id=org and e.supplier_id=perfil.external_party_id and public.iq_supplier_audit_manual_portal_scope(e.id)
   and f.resource_type='supplier_audit_portal_evidence' and f.deleted_at is null
  union all
  select f.id,e.id,coalesce(e.actual_date::text,'Auditoría')||' · '||e.manual_classification::text,'Auditoría',a->>'description',f.original_name,
   nullif(a->>'completedDate','')::date,'published','published',e.actual_date from public.supplier_audit_events e
   cross join lateral jsonb_array_elements(e.manual_record#>'{record,actions}') a
   join public.file_objects f on (a->'evidenceFileIds') @> jsonb_build_array(f.id::text) and f.resource_id=e.id
   where e.organization_id=org and e.supplier_id=perfil.external_party_id and public.iq_supplier_audit_manual_portal_scope(e.id)
   and (e.manual_record#>'{record,approvedFileIds}') @> jsonb_build_array(f.id::text)
   and public.iq_supplier_audit_manual_file_valid(e.id,f.id)
 )
 select v.file_id,v.expediente,v.folio,v.tipo,v.accion,v.nombre,v.fecha,v.estado,v.origen from visible v
 where (p_year is null or extract(year from v.period)=p_year) and (coalesce(p_kind,'')='' or v.tipo=p_kind)
 and (coalesce(p_review,'')='' or v.estado=p_review) and (coalesce(p_search,'')='' or position(lower(p_search) in lower(v.folio))>0)
 order by v.period desc nulls last,v.expediente,v.file_id,v.accion limit 51 offset p_offset;
end $$;
revoke all on function public.iq_supplier_portal_evidence_index(int,text,text,text,int) from public,anon;
grant execute on function public.iq_supplier_portal_evidence_index(int,text,text,text,int) to authenticated;


-- A Storage upload and PostgreSQL cannot commit together. Keep a replayable parent
-- reference before transferring bytes; publish the evidence link only after verification.
create function public.iq_supplier_portal_prepare_upload(p_event uuid,p_action text,p_date date,p_sha text,p_mime text,p_bytes int)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid; parent uuid; actor uuid:=auth.uid(); item uuid;
begin
 if p_action is null or p_date is null or p_date>current_date or p_sha is null or p_sha !~ '^[0-9a-f]{64}$' or not exists(
  select 1 from public.file_upload_policies where resource_type='supplier_rncp_action_evidence' and p_mime=any(allowed_mime_types)
   and p_bytes between 1 and least(max_size_bytes,4194304)) then raise exception 'INVALID_FILE'; end if;
 if p_event is not null then
  org:=public.iq_supplier_portal_evidence_scope(p_event,p_action);parent:=p_event;
  if not public.iq_supplier_audit_manual_portal_scope(p_event) or not exists(select 1 from public.supplier_audit_events e
   cross join lateral jsonb_array_elements(e.manual_record#>'{record,actions}') a where e.id=p_event and a->>'id'=p_action and a->>'status' in ('pending','in_progress'))
  then raise exception using errcode='42501',message='ACTION_SCOPE'; end if;
 else
  item:=p_action::uuid;
  select r.id into parent from public.supplier_rncp_actions a join public.supplier_rncp_reports r on r.id=a.report_id
  where a.id=item and a.created_by=actor and a.status in ('pending','in_progress','rejected') and r.status in ('submitted','in_progress')
   and (r.source_kind is null or r.source_kind='legacy' or (r.source_kind='native' and r.notified_at is not null));
  org:=public.iq_supplier_portal_report(parent);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||parent::text||p_action||p_sha,0));
 if not exists(select 1 from public.audit_log where actor_id=actor and organization_id=org and resource_type='supplier_portal_upload'
  and resource_id=parent::text and action='supplier.portal.upload_reserved' and metadata @> jsonb_build_object('action',p_action,'sha256',p_sha,'performedOn',p_date)) then
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata) values(actor,org,'suppliers',
   'supplier.portal.upload_reserved','supplier_portal_upload',parent::text,jsonb_build_object('action',p_action,'sha256',p_sha,'performedOn',p_date));
 end if;
end $$;
revoke all on function public.iq_supplier_portal_prepare_upload(uuid,text,date,text,text,int) from public,anon;
grant execute on function public.iq_supplier_portal_prepare_upload(uuid,text,date,text,text,int) to authenticated;

commit;
