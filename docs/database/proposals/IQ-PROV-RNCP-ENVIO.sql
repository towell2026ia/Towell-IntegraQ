-- PROPOSAL ONLY. Never executed by this task. Requires reviewed RNCP flow + photos V2.
-- Extends the existing outbox; no accounts, fixtures, cleanup or sending at installation.
begin;
do $$ begin
 if to_regprocedure('public.iq_rncp_pdf_snapshot(uuid)') is null
  or to_regprocedure('public.iq_rncp_followup_command(uuid,text,jsonb)') is null
  or to_regprocedure('public.iq_rncp_actor_org(boolean)') is null
  or to_regprocedure('public.iq_rncp_is_inspector(uuid)') is null then raise exception 'RNCP_MAIL_BASE_REQUIRED'; end if;
end $$;
alter table public.supplier_rncp_notification_outbox drop constraint supplier_rncp_notification_outbox_event_type_check;
alter table public.supplier_rncp_notification_outbox add constraint supplier_rncp_notification_outbox_event_type_check check(event_type in ('unattended','overdue','validation','initial'));
alter table public.supplier_rncp_notification_outbox
 add column initial_phase text check(initial_phase in ('prepared','dispatching','unknown','failed','accepted_pending_record','accepted')),
 add column initial_payload jsonb,
 add column initial_receipt jsonb,
 add column initial_draft_id text;
create unique index rncp_one_initial_mail on public.supplier_rncp_notification_outbox(report_id) where event_type='initial';

create function public.iq_rncp_prepare_initial_mail(p_report uuid,p_expected jsonb,p_reason text) returns public.supplier_rncp_notification_outbox
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); snap jsonb; r jsonb; contacts jsonb; sender text; reply_to text;
 f public.file_objects%rowtype; job public.supplier_rncp_notification_outbox%rowtype; payload jsonb; verified timestamptz;
begin
 if not (public.is_administrator() or public.iq_rncp_is_inspector(org)) or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_MAIL_FORBIDDEN'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'RNCP_MAIL_REASON_REQUIRED'; end if;
 snap:=public.iq_rncp_pdf_snapshot(p_report);r:=snap->'snapshot'->'report';
 select * into job from public.supplier_rncp_notification_outbox where report_id=p_report and event_type='initial' and organization_id=org for update;
 if job.initial_phase in ('accepted','accepted_pending_record') then return job; end if;
 if (r->>'report_date')::date>(now() at time zone 'America/Mexico_City')::date then raise exception 'RNCP_MAIL_REPORT_DATE_INVALID'; end if;
 if r->>'status'='draft' or r->>'notified_at' is not null or r->>'closed_at' is not null then raise exception 'RNCP_MAIL_NOT_PENDING'; end if;
 select u.email into sender from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 select u.email into reply_to from auth.users u join public.profiles p on p.id=u.id
  where p.id=(r->>'created_by')::uuid and p.organization_id=org and p.status='active' and p.user_type in ('administrator','internal') and u.email_confirmed_at is not null;
 select metadata->'supplierQualityContacts' into contacts from public.organizations where id=(r->>'supplier_id')::uuid and kind='supplier' and active;
 if sender is null or reply_to is null or coalesce(contacts->>'emailVerified','false')<>'true' or nullif(contacts->>'emailVerifiedAt','') is null or nullif(contacts->>'email','') is null then raise exception 'RNCP_MAIL_CONTACT_REQUIRED'; end if;
 verified:=(contacts->>'emailVerifiedAt')::timestamptz;
 if verified>now() then raise exception 'RNCP_MAIL_CONTACT_REQUIRED'; end if;
 select * into f from public.file_objects where id=(p_expected->>'fileId')::uuid and workspace_id=org
  and resource_id=p_report and resource_type='supplier_rncp_original' and resource_key='generated:'||(snap->>'fingerprint') and deleted_at is null and is_current;
 if f.id is null or f.bucket_id<>'integraq-private' or f.object_path not like 'rncp-originals/'||org::text||'/%'
  or f.sha256 !~ '^[a-f0-9]{64}$' or f.size_bytes not between 8 and 4194304 then raise exception 'RNCP_MAIL_PDF_REQUIRED'; end if;
 payload:=jsonb_build_object('actorId',auth.uid(),'sender',sender,'recipient',contacts->>'email','replyTo',reply_to,'fileId',f.id,
  'sha256',f.sha256,'size',f.size_bytes,'version',f.version,'name',f.original_name,'path',f.object_path,'bucket',f.bucket_id,
  'snapshot',snap->>'fingerprint','folio',r->>'folio','provider','microsoft-graph');
 if p_expected->>'fingerprint' is distinct from snap->>'fingerprint' or p_expected->>'recipient' is distinct from contacts->>'email'
  or p_expected->>'replyTo' is distinct from reply_to or p_expected->>'sender' is distinct from sender then raise exception 'RNCP_MAIL_CONFIRMATION_CHANGED'; end if;
 if job.id is not null then
  if job.initial_payload is distinct from payload then
   if job.initial_phase<>'prepared' or job.attempts<>0 then raise exception 'RNCP_MAIL_FROZEN_REVIEW_REQUIRED'; end if;
   insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
    values(auth.uid(),'suppliers','rncp.mail_preparation_revised','supplier_rncp_report',p_report::text,job.initial_payload,payload,p_reason);
   update public.supplier_rncp_notification_outbox set initial_payload=payload,recipient_email=contacts->>'email',recipient_verified_at=verified,updated_at=now() where id=job.id returning * into job;
  end if;
  return job;
 end if;
 insert into public.supplier_rncp_notification_outbox(organization_id,report_id,event_type,occurrence,recipient_kind,recipient_email,recipient_verified_at,delivery_state,initial_phase,initial_payload)
 values(org,p_report,'initial',(r->>'created_at')::timestamptz,'supplier',contacts->>'email',verified,'disabled','prepared',payload) returning * into job;
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
 values(auth.uid(),'suppliers','rncp.mail_prepared','supplier_rncp_report',p_report::text,null,to_jsonb(job),p_reason);
 return job;
end $$;

create function public.iq_rncp_claim_initial_mail(p_report uuid,p_expected jsonb,p_reason text) returns public.supplier_rncp_notification_outbox
language plpgsql security definer set search_path='' as $$
declare job public.supplier_rncp_notification_outbox%rowtype; prior jsonb;
begin
 job:=public.iq_rncp_prepare_initial_mail(p_report,p_expected,p_reason);
 if job.initial_phase in ('accepted','accepted_pending_record') then return job; end if;
 if job.initial_payload->>'actorId' is distinct from auth.uid()::text then raise exception using errcode='42501',message='RNCP_MAIL_SENDER_REQUIRED'; end if;
 if job.initial_phase not in ('prepared','failed') or job.attempts>=5 then raise exception 'RNCP_MAIL_RECONCILE_REQUIRED'; end if;
 prior:=to_jsonb(job);
 update public.supplier_rncp_notification_outbox set initial_phase='dispatching',initial_receipt=null,
   lease_id=gen_random_uuid(),lease_until=null,attempts=attempts+1,delivery_state='disabled',last_error_code=null,updated_at=now()
 where id=job.id returning * into job;
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
 values(auth.uid(),'suppliers','rncp.mail_claimed','supplier_rncp_report',p_report::text,prior,to_jsonb(job),p_reason);
 return job;
end $$;

-- Backend only: users cannot manufacture provider acceptance. Does not impersonate JWT users.
create function public.iq_rncp_attest_initial_mail(p_id uuid,p_lease uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare job public.supplier_rncp_notification_outbox%rowtype; prior jsonb; result text:=p_result->>'outcome';
begin
 select * into job from public.supplier_rncp_notification_outbox where id=p_id and event_type='initial' for update;
 if job.id is null or job.lease_id is distinct from p_lease or p_lease is null then raise exception 'RNCP_MAIL_LEASE_CONFLICT'; end if;
 if job.initial_phase in ('accepted','accepted_pending_record') then
  if result='accepted' and job.provider_message_id=p_result->>'messageId' then return true; end if;
  raise exception 'RNCP_MAIL_RECEIPT_IMMUTABLE';
 end if;
 if job.initial_phase not in ('dispatching','unknown') then raise exception 'RNCP_MAIL_PHASE_CONFLICT'; end if;
 prior:=to_jsonb(job);
 if result='draft' then
  if nullif(p_result->>'messageId','') is null or job.initial_draft_id is not null and job.initial_draft_id<>p_result->>'messageId' then raise exception 'RNCP_MAIL_DRAFT_CONFLICT'; end if;
  update public.supplier_rncp_notification_outbox set initial_draft_id=p_result->>'messageId',updated_at=now() where id=job.id;
 elsif result='accepted' then
  if nullif(p_result->>'messageId','') is null or nullif(p_result->>'acceptedAt','') is null
   or (p_result->>'acceptedAt')::timestamptz>now()+interval '30 seconds'
   or (p_result->>'acceptedAt')::timestamptz<job.created_at-interval '30 seconds' then raise exception 'RNCP_MAIL_RECEIPT_INVALID'; end if;
  update public.supplier_rncp_notification_outbox set initial_phase='accepted_pending_record',initial_receipt=p_result,
   provider_message_id=p_result->>'messageId',sent_at=least((p_result->>'acceptedAt')::timestamptz,now()),updated_at=now() where id=job.id;
 elsif result in ('rejected','unknown') then
  if p_result->>'code' not in ('AUTHENTICATION','CONNECTION','PROVIDER_FAILURE','CONFIGURATION','RECIPIENT_INVALID','DOCUMENT_MISMATCH','UNCERTAIN') then raise exception 'RNCP_MAIL_ERROR_INVALID'; end if;
  update public.supplier_rncp_notification_outbox set initial_phase=case when result='rejected' then 'failed' else 'unknown' end,
    initial_receipt=p_result,last_error_code=p_result->>'code',updated_at=now() where id=job.id;
 else raise exception 'RNCP_MAIL_RESULT_INVALID'; end if;
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,metadata)
 select (job.initial_payload->>'actorId')::uuid,'suppliers','rncp.mail_transport_result','supplier_rncp_report',job.report_id::text,prior,to_jsonb(n),jsonb_build_object('technical_acceptance_not_delivery',true)
 from public.supplier_rncp_notification_outbox n where n.id=job.id;
 return true;
end $$;
revoke all on function public.iq_rncp_attest_initial_mail(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.iq_rncp_attest_initial_mail(uuid,uuid,jsonb) to service_role;

create function public.iq_rncp_complete_initial_mail(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); job public.supplier_rncp_notification_outbox%rowtype; r public.supplier_rncp_reports%rowtype; rid uuid; ref text; prior jsonb;
begin
 if not (public.is_administrator() or public.iq_rncp_is_inspector(org)) then raise exception using errcode='42501',message='RNCP_MAIL_FORBIDDEN'; end if;
 select report_id into rid from public.supplier_rncp_notification_outbox where id=p_id and organization_id=org and event_type='initial';
 select * into r from public.supplier_rncp_reports where id=rid and organization_id=org and deleted_at is null for update;
 select * into job from public.supplier_rncp_notification_outbox where id=p_id and organization_id=org and event_type='initial' for update;
 if r.id is null or job.id is null then raise exception using errcode='42501',message='RNCP_MAIL_FORBIDDEN'; end if;
 if job.initial_phase='accepted' then return jsonb_build_object('state','accepted','messageId',job.provider_message_id,'acceptedAt',job.sent_at); end if;
 if job.initial_phase<>'accepted_pending_record' or job.initial_receipt->>'outcome' is distinct from 'accepted' or job.provider_message_id is null then raise exception 'RNCP_MAIL_ACCEPTANCE_REQUIRED'; end if;
 ref:='email:microsoft-graph:'||job.provider_message_id;prior:=to_jsonb(r);
 if r.notified_at is null then
  perform public.iq_rncp_followup_command(r.id,'record_notification',jsonb_build_object('notifiedAt',job.sent_at,'reference',ref,
    'containmentRequired',coalesce((r.response_requirements->>'containment')::boolean,false),'requiredDocuments',coalesce(r.response_requirements->'documents','[]'::jsonb)));
 elsif r.notified_at is distinct from job.sent_at or r.notification_reference is distinct from ref then raise exception 'RNCP_MAIL_NOTIFICATION_CONFLICT'; end if;
 update public.supplier_rncp_notification_outbox set initial_phase='accepted',delivery_state='sent',updated_at=now() where id=job.id;
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,metadata)
 select auth.uid(),'suppliers','rncp.mail_accepted','supplier_rncp_report',r.id::text,prior,to_jsonb(n),jsonb_build_object('jobId',job.id,'recipient',job.recipient_email,'pdf',job.initial_payload,'providerMessageId',job.provider_message_id,'acceptance_not_delivery',true)
 from public.supplier_rncp_reports n where n.id=r.id;
 return jsonb_build_object('state','accepted','messageId',job.provider_message_id,'acceptedAt',job.sent_at);
end $$;

create function public.iq_rncp_mail_freeze() returns trigger language plpgsql security definer set search_path='' as $$
declare job public.supplier_rncp_notification_outbox%rowtype;
begin
 select * into job from public.supplier_rncp_notification_outbox where report_id=old.id and event_type='initial'
  and initial_phase in ('dispatching','unknown','accepted_pending_record');
 if job.id is null then return new; end if;
 if job.initial_phase='accepted_pending_record' and new.notified_at=job.sent_at
  and new.notification_reference='email:microsoft-graph:'||job.provider_message_id
  and (to_jsonb(new)-array['notified_at','notification_reference','response_deadline','response_due_date','status','response_requirements','updated_at','updated_by'])
   =(to_jsonb(old)-array['notified_at','notification_reference','response_deadline','response_due_date','status','response_requirements','updated_at','updated_by'])
  and new.status='submitted'
  and new.response_requirements=jsonb_build_object('containment',coalesce((old.response_requirements->>'containment')::boolean,false),'documents',coalesce(old.response_requirements->'documents','[]'::jsonb)) then return new; end if;
 raise exception 'RNCP_MAIL_IN_FLIGHT_RECONCILE_REQUIRED';
end $$;
revoke all on function public.iq_rncp_mail_freeze() from public,anon,authenticated;
create trigger aaa_iq_rncp_mail_freeze before update on public.supplier_rncp_reports for each row execute function public.iq_rncp_mail_freeze();
revoke all on function public.iq_rncp_prepare_initial_mail(uuid,jsonb,text),public.iq_rncp_claim_initial_mail(uuid,jsonb,text),public.iq_rncp_complete_initial_mail(uuid) from public,anon;
grant execute on function public.iq_rncp_prepare_initial_mail(uuid,jsonb,text),public.iq_rncp_claim_initial_mail(uuid,jsonb,text),public.iq_rncp_complete_initial_mail(uuid) to authenticated;
commit;
