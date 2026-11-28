begin;

insert into public.permissions(code,module,action,description,risk_level) values
 ('rncp.consultar_rncp','suppliers','consultar_rncp','Consultar RNCP','LOW'),
 ('rncp.consultar_expedientes','suppliers','consultar_expedientes','Consultar expedientes','LOW'),
 ('rncp.consultar_dashboards','suppliers','consultar_dashboards','Consultar dashboards','LOW'),
 ('rncp.crear_rncp','suppliers','crear_rncp','Crear RNCP','HIGH'),
 ('rncp.editar_rncp','suppliers','editar_rncp','Editar RNCP','HIGH'),
 ('rncp.enviar_reclamos','suppliers','enviar_reclamos','Enviar reclamos','HIGH'),
 ('rncp.enviar_rncp','suppliers','enviar_rncp','Enviar RNCP por correo','HIGH'),
 ('rncp.enviar_seguimientos','suppliers','enviar_seguimientos','Enviar reportes de seguimiento','HIGH'),
 ('rncp.enviar_recordatorios','suppliers','enviar_recordatorios','Enviar recordatorios','HIGH'),
 ('rncp.gestionar_planes','suppliers','gestionar_planes','Gestionar planes de acción','HIGH'),
 ('rncp.revisar_evidencias','suppliers','revisar_evidencias','Cargar y revisar evidencias','HIGH'),
 ('rncp.validar_acciones','suppliers','validar_acciones','Validar acciones correctivas','HIGH'),
 ('rncp.verificar_efectividad','suppliers','verificar_efectividad','Verificar efectividad','HIGH'),
 ('rncp.cerrar_planes','suppliers','cerrar_planes','Cerrar planes de acción','HIGH'),
 ('rncp.cerrar_rncp','suppliers','cerrar_rncp','Cerrar RNCP','HIGH'),
 ('rncp.reabrir_rncp','suppliers','reabrir_rncp','Reabrir RNCP','HIGH'),
 ('rncp.configurar_modulo','suppliers','configurar_modulo','Configurar Gestión de calidad de proveedores','HIGH');

-- Organization and global role assignments can apply to an entire module. Finer scopes
-- require a matching resource context and never grant an entire organization here.
create function integraq_private.rncp_grant(p_actor uuid,p_org uuid,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((
   select o.allowed from public.user_permission_overrides o
   join public.permissions k on k.id=o.permission_id and k.status='active'
   where o.user_id=p_actor and k.code='rncp.'||p_action
 ), exists (
        select 1 from public.user_roles assignment
        join public.roles role on role.id = assignment.role_id and role.status = 'active'
        join public.role_permissions role_permission on role_permission.role_id = role.id and role_permission.allowed
        join public.permissions permission on permission.id = role_permission.permission_id and permission.status = 'active'
        join public.profiles profile on profile.id = assignment.user_id and profile.status = 'active'
        where assignment.user_id = p_actor and assignment.status = 'active'
          and assignment.starts_at <= now() and (assignment.ends_at is null or assignment.ends_at >= now())
          and permission.code = 'rncp.' || p_action
          and case role.scope_type
            when 'global' then true
            when 'organization' then assignment.organization_id = p_org
            else false end
      ));
$$;
revoke all on function integraq_private.rncp_grant(uuid,uuid,text) from public,anon,authenticated;

-- Resolve a reopening within the existing module and internal organization.
-- Only trusted module routines may supply their pre-existing entitlement.
create function integraq_private.may_reopen(p_code text, p_org uuid, p_existing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
   select 1 from public.profiles u
   join public.permissions k on k.code=p_code and k.status='active'
   left join public.user_permission_overrides o on o.user_id=u.id and o.permission_id=k.id
   where u.id=auth.uid() and u.organization_id=p_org and u.status='active'
     and u.workspace_mode='production' and u.user_type in ('internal','administrator')
     and k.action in ('reabrir_rncp','reabrir_acuerdos','reabrir_acciones')
     and public.has_module_permission(k.module,'view')
     and coalesce(o.allowed,public.is_administrator() or p_existing
       or public.has_permission(k.code,p_org,null,null,null,false,null))
 );
$$;
revoke all on function integraq_private.may_reopen(text,uuid,boolean) from public,anon,authenticated;

create function public.iq_rncp_faculty(p_organization_id uuid,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles u
   join public.organizations org on org.id=u.organization_id and org.kind='internal' and org.active
   join public.permissions k on k.code='rncp.'||p_action and k.status='active'
   left join public.user_permission_overrides o on o.user_id=u.id and o.permission_id=k.id
   where u.id=auth.uid() and u.status='active' and u.workspace_mode='production'
     and u.organization_id=p_organization_id and u.user_type in ('internal','administrator')
     and public.has_module_permission('suppliers','view') and public.has_permission('proveedores.acceder')
     and public.has_permission('proveedores.ver')
     and case
       when p_action in ('consultar_rncp','consultar_dashboards','consultar_expedientes') then u.user_type='administrator' or coalesce(o.allowed,true)
       when p_action in ('crear_rncp','editar_rncp') then coalesce(o.allowed,true) and public.has_module_permission('suppliers',(case when p_action='crear_rncp' then 'create' else 'update' end)::public.module_permission_action)
       when p_action='reabrir_rncp' then integraq_private.may_reopen(k.code,u.organization_id)
       when p_action='configurar_modulo' and u.user_type='administrator' then true
       else exists(select 1 from auth.users au where au.id=u.id and au.email_confirmed_at is not null) and public.has_module_permission('suppliers','update') and integraq_private.rncp_grant(u.id,u.organization_id,p_action)
     end);
$$;
revoke all on function public.iq_rncp_faculty(uuid,text) from public,anon;
grant execute on function public.iq_rncp_faculty(uuid,text) to authenticated;

create function public.iq_quality_session_permissions() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(k.code,case when k.module='suppliers' then
   public.iq_rncp_faculty(p.organization_id,k.action)
   else public.has_permission(k.code,p.organization_id) end),'{}'::jsonb)
 from public.profiles p cross join public.permissions k where p.id=auth.uid() and p.status='active'
   and p.workspace_mode='production' and p.user_type in ('internal','administrator')
   and k.status='active' and (k.code like 'rncp.%' or k.code in
   ('portal_proveedores.consultar_invitaciones','portal_proveedores.emitir_invitaciones','portal_proveedores.reenviar_invitaciones','portal_proveedores.revocar_invitaciones',
    'portal_clientes.consultar_invitaciones','portal_clientes.emitir_invitaciones','portal_clientes.reenviar_invitaciones','portal_clientes.revocar_invitaciones'));
$$;
revoke all on function public.iq_quality_session_permissions() from public,anon;
grant execute on function public.iq_quality_session_permissions() to authenticated;

alter policy rncp_organization_read_guard on public.supplier_rncp_reports using (
 case when (select public.is_internal_user()) then
    (select public.iq_rncp_faculty(p.organization_id,'consultar_rncp') from public.profiles p where p.id=(select auth.uid()))
    and ((organization_id is null and exists (select 1 from public.profiles author where author.id=created_by and author.organization_id=(select p.organization_id from public.profiles p where p.id=(select auth.uid()))) and (supplier_id is null or exists (select 1 from public.organizations s where s.id=supplier_id and s.owning_organization_id=(select p.organization_id from public.profiles p where p.id=(select auth.uid()))))) or organization_id=(select p.organization_id from public.profiles p where p.id=(select auth.uid())))
 else organization_id is null or public.iq_rncp_read_scope(id) end
);

-- A submitted response may be handled by one person or by different authorized people.
-- Keep each decision attached to the exact response and its latest validation.
create table if not exists integraq_private.rncp_plan_decisions (
 report_id uuid not null references public.supplier_rncp_reports(id),
 action_id uuid not null references public.supplier_rncp_actions(id),
 validated_at timestamptz not null,
 effectiveness_by uuid references public.profiles(id),
 effectiveness_at timestamptz,
 closed_by uuid references public.profiles(id),
 closed_at timestamptz,
 primary key(report_id,action_id,validated_at)
);
alter table integraq_private.rncp_plan_decisions enable row level security;
revoke all on integraq_private.rncp_plan_decisions from public,anon,authenticated;

create function public.iq_rncp_manual_mail(p_report uuid,p_kind text,p_request uuid,p_reference text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports; org uuid:=public.iq_rncp_actor_org(false); target text; sender text; receipt jsonb; event text;
begin
 if p_request is null or p_kind is null or p_kind not in ('enviar_reclamos','enviar_seguimientos','enviar_recordatorios')
    or not public.iq_rncp_faculty(org,p_kind) then raise insufficient_privilege using message='RNCP_FORBIDDEN'; end if;
 select * into strict r from public.supplier_rncp_reports where id=p_report and organization_id=org and deleted_at is null and source_kind='native' for share;
 if not public.iq_rncp_read_scope(r.id) or r.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(r.supplier_id,org) then raise insufficient_privilege; end if;
 select u.email into sender from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 select s.metadata->'supplierQualityContacts'->>'email' into target from public.organizations s where s.id=r.supplier_id and s.active and s.kind='supplier'
   and s.metadata->'supplierQualityContacts'->>'emailVerified'='true' and s.deleted_at is null;
 if sender is null or target is null or target !~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+[.][^[:space:]@<>,;]+$' then raise exception 'VERIFIED_RECIPIENT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rncp-mail:'||p_request::text,0));
 event:='rncp.'||p_kind||case when p_reference is null then '.prepared' else '.confirmed' end;
 select a.metadata into receipt from public.audit_log a where a.actor_id=auth.uid() and a.resource_id=r.id::text and a.action=event and a.metadata->>'request'=p_request::text;
 if receipt is not null then return receipt; end if;
 if p_reference is not null and (length(trim(p_reference)) not between 5 and 300 or not exists (
   select 1 from public.audit_log a where a.actor_id=auth.uid() and a.resource_id=r.id::text and a.action='rncp.'||p_kind||'.prepared' and a.metadata->>'request'=p_request::text
    and a.metadata->>'recipient'=target and a.metadata->>'sender'=sender
 )) then raise exception 'MAIL_PROOF_REQUIRED'; end if;
 receipt:=jsonb_build_object('request',p_request,'folio',r.folio,'sender',sender,'recipient',target,'confirmed',p_reference is not null);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,reason,metadata)
 values(auth.uid(),org,'suppliers',event,'supplier_rncp_report',r.id::text,trim(p_reference),receipt);
 return receipt;
end $$;
revoke all on function public.iq_rncp_manual_mail(uuid,text,uuid,text) from public,anon;
grant execute on function public.iq_rncp_manual_mail(uuid,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.iq_rncp_can_read_action_file(p_file_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.file_objects f
   join public.supplier_rncp_action_evidence e on e.file_id=f.id and e.action_id=f.resource_id
   join public.supplier_rncp_actions a on a.id=e.action_id join public.supplier_rncp_reports r on r.id=a.report_id
   where f.id=p_file_id and f.resource_type='supplier_rncp_action_evidence' and f.deleted_at is null
     and public.iq_rncp_read_scope(r.id)
     and (not public.is_internal_user() or (public.iq_rncp_faculty(r.organization_id,'consultar_expedientes') and public.iq_rncp_faculty(r.organization_id,'consultar_rncp'))));
$function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_staff_evidence(p_action uuid, p_date date, p_sha text, p_name text, p_mime text, p_bytes integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.supplier_rncp_actions%rowtype; r public.supplier_rncp_reports%rowtype; f uuid;
 path text; actor uuid:=auth.uid();
begin
 perform 1 from public.profiles where id=actor and status='active' for share;
 select rep.* into strict r from public.supplier_rncp_reports rep join public.supplier_rncp_actions ac on ac.report_id=rep.id where ac.id=p_action for update of rep;
 if not public.iq_rncp_faculty(r.organization_id,'revisar_evidencias') or not public.iq_rncp_read_scope(r.id) then raise insufficient_privilege; end if;
 select * into strict a from public.supplier_rncp_actions where id=p_action and report_id=r.id for update;
 if r.deleted_at is not null or r.closed_at is not null or a.created_by is distinct from actor or a.status not in ('pending','in_progress','rejected') or r.status not in ('submitted','in_progress')
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
 -- Staff evidence never advances the external supplier's response clock.
 return f;
end $function$;
revoke all on function public.iq_rncp_staff_evidence(uuid,date,text,text,text,integer) from public,anon;
grant execute on function public.iq_rncp_staff_evidence(uuid,date,text,text,text,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.review_supplier_rncp_action(requested_action_id uuid, requested_decision text, requested_comment text)
 RETURNS supplier_rncp_actions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  saved_action public.supplier_rncp_actions%rowtype;
  selected_action public.supplier_rncp_actions%rowtype;
  report_folio text;
begin
  if not public.is_internal_user() or not public.has_module_permission('suppliers', 'update') then
    raise exception using errcode = '42501', message = 'RNCP_REVIEW_FORBIDDEN';
  end if;
  if requested_decision not in ('accepted', 'rejected') then
    raise exception using errcode = '23514', message = 'RNCP_REVIEW_INVALID';
  end if;
  if requested_decision = 'rejected' and nullif(trim(requested_comment), '') is null then
    raise exception using errcode = '23514', message = 'RNCP_REJECTION_COMMENT_REQUIRED';
  end if;
  select action.* into selected_action
  from public.supplier_rncp_actions action
  join public.supplier_rncp_reports report on report.id = action.report_id
  where action.id = requested_action_id and report.deleted_at is null for update of action;
  if selected_action.id is null or selected_action.status <> 'submitted'
    or not public.can_access_supplier_report(selected_action.report_id)
    or not exists(select 1 from public.supplier_rncp_reports r where r.id=selected_action.report_id and public.iq_rncp_faculty(r.organization_id,'validar_acciones') and public.iq_rncp_read_scope(r.id)) then
    raise exception using errcode = '22023', message = 'RNCP_REVIEW_NOT_AVAILABLE';
  end if;
  select folio into report_folio from public.supplier_rncp_reports where id = selected_action.report_id;
  update public.supplier_rncp_actions set
    status = requested_decision::public.supplier_response_status,
    validated_by = actor_id,
    validated_at = now(),
    validation_comment = nullif(trim(requested_comment), '')
  where id = requested_action_id returning * into saved_action;

  insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, reason, metadata)
  values (
    actor_id, 'suppliers', case when requested_decision = 'accepted' then 'rncp.action_validated' else 'rncp.action_rejected' end,
    'supplier_rncp_report', saved_action.report_id::text, report_folio,
    jsonb_build_object('action_id', saved_action.id, 'status', saved_action.status),
    nullif(trim(requested_comment), ''), jsonb_build_object('action_id', saved_action.id)
  );
  return saved_action;
end;
$function$;

-- Release parameters identify the approved incumbent and the global administrator
-- accountable for the change. Abort the whole transaction if either no longer qualifies.
do $handover$
declare recipient public.profiles; administrator public.profiles; codes text[]:=array['rncp.consultar_rncp','rncp.consultar_expedientes','rncp.consultar_dashboards','rncp.crear_rncp','rncp.editar_rncp','rncp.enviar_reclamos','rncp.enviar_rncp','rncp.enviar_seguimientos','rncp.enviar_recordatorios','rncp.gestionar_planes','rncp.revisar_evidencias','rncp.validar_acciones','rncp.verificar_efectividad','rncp.cerrar_planes','rncp.cerrar_rncp','portal_proveedores.consultar_invitaciones','portal_proveedores.emitir_invitaciones','portal_proveedores.reenviar_invitaciones','portal_proveedores.revocar_invitaciones'];
begin
 select * into strict recipient from public.profiles where id=nullif(current_setting('integraq.seg01_recipient',true),'')::uuid
   and user_type='internal' and status='active' and workspace_mode='production' for update;
 select * into strict administrator from public.profiles where id=nullif(current_setting('integraq.seg01_administrator',true),'')::uuid
   and user_type='administrator' and status='active' and workspace_mode='production' and organization_id=recipient.organization_id for share;
 if not exists(select 1 from public.user_permission_overrides o join public.permissions k on o.permission_id=k.id where o.user_id=recipient.id and k.code='portal_clientes.acceder' and not o.allowed)
 then raise exception 'SEG01_APPROVED_SCOPE_CHANGED'; end if;
 if exists(select 1 from public.user_permission_overrides o join public.permissions k on k.id=o.permission_id where o.user_id=recipient.id and k.code=any(codes) and not o.allowed)
 then raise exception 'SEG01_EXISTING_DENIAL_REQUIRES_REVIEW'; end if;
 insert into public.user_permission_overrides(user_id,permission_id,allowed,granted_by)
 select recipient.id,k.id,true,administrator.id from public.permissions k where k.code=any(codes) and k.status='active' on conflict do nothing;
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,new_value)
 values(administrator.id,recipient.organization_id,'access','user.access_updated','profile',recipient.id::text,jsonb_build_object('release','PRD-SEG-01.1','granted',codes));
 update public.profiles set updated_at=clock_timestamp() where id=recipient.id;
end $handover$;

CREATE OR REPLACE FUNCTION public.iq_rncp_is_inspector(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.iq_rncp_faculty(p_organization_id,'validar_acciones');
$function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_followup_command(p_report_id uuid, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.supplier_rncp_reports%rowtype; org uuid; a public.supplier_rncp_actions%rowtype; actor public.profiles%rowtype; missing text[];
  official public.file_objects%rowtype;
  revision_key text;
  proof jsonb := '{}'::jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  select * into r from public.supplier_rncp_reports where id=p_report_id and deleted_at is null for update;
  if actor.id is null or r.id is null or r.organization_id is null or not public.iq_rncp_read_scope(r.id) then
    raise exception using errcode='42501',message='RNCP_FORBIDDEN';
  end if;
  if r.source_kind='historical' and p_command<>'reconcile' then raise exception using errcode='55000',message='RNCP_HISTORICAL_NO_TIMER'; end if;
  if p_command='record_manual_notification' then
    org:=public.iq_rncp_actor_org();
    if not (public.is_administrator() or public.iq_rncp_faculty(org,'enviar_rncp')) or r.organization_id<>org then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if r.notified_at is not null then raise exception using errcode='55000',message='RNCP_NOTIFICATION_IMMUTABLE'; end if;
    if length(trim(coalesce(p_payload->>'reference','')))<8 or nullif(p_payload->>'notifiedAt','') is null
      or (p_payload->>'notifiedAt')::timestamptz>now()
      or (p_payload->>'notifiedAt')::timestamptz<(r.report_date::timestamp at time zone 'America/Mexico_City') then
      raise exception using errcode='22023',message='RNCP_NOTIFICATION_PROOF_REQUIRED';
    end if;
    if r.source_kind is distinct from 'native' or r.status is distinct from 'submitted' or r.closed_at is not null then
      raise exception using errcode='55000',message='RNCP_REGISTERED_REPORT_REQUIRED';
    end if;
    revision_key := public.iq_rncp_pdf_snapshot(r.id)->>'fingerprint';
    select f.* into official from public.file_objects f
      where f.id=(p_payload->>'officialFileId')::uuid and f.version=(p_payload->>'officialVersion')::integer
        and f.workspace_id=org and f.resource_id=r.id and f.resource_type='supplier_rncp_original'
        and f.bucket_id='integraq-private' and f.is_current and f.deleted_at is null
        and f.resource_key='generated:'||revision_key and f.sha256 ~ '^[a-f0-9]{64}$'
        and f.created_at <= (p_payload->>'notifiedAt')::timestamptz
        and exists(select 1 from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path)
      for share of f;
    if official.id is null then raise exception using errcode='55000',message='RNCP_CURRENT_OFFICIAL_PDF_REQUIRED'; end if;
    proof := jsonb_build_object('communication','manual','communicatedAt',p_payload->>'notifiedAt',
      'officialFileId',official.id,'officialVersion',official.version,'officialSha256',official.sha256,'reportFingerprint',revision_key);
    update public.supplier_rncp_reports set notified_at=(p_payload->>'notifiedAt')::timestamptz,
      notification_reference=trim(p_payload->>'reference'),response_deadline=(p_payload->>'notifiedAt')::timestamptz+interval '7 days',
      response_due_date=(((p_payload->>'notifiedAt')::timestamptz+interval '7 days') at time zone 'America/Mexico_City')::date,
      status='submitted',response_requirements=jsonb_build_object('containment',coalesce((p_payload->>'containmentRequired')::boolean,false),
      'documents',coalesce(p_payload->'requiredDocuments','[]'::jsonb)),updated_by=auth.uid() where id=r.id;
  elsif p_command='submit_delivery' then
    if actor.user_type<>'supplier' or actor.external_party_id is distinct from r.supplier_id or r.notified_at is null then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    select * into a from public.supplier_rncp_actions where id=(p_payload->>'actionId')::uuid and report_id=r.id and created_by=auth.uid() for update;
    if a.status='submitted' and r.validation_outcome='pending' then return jsonb_build_object('state','validation','alreadySubmitted',true); end if;
    missing:=public.iq_rncp_missing_requirements(r.id,a.id);
    if a.id is null or cardinality(missing)>0 then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE',detail=array_to_string(missing,', '); end if;
    update public.supplier_rncp_actions set status='submitted',submitted_at=now() where id=a.id;
    update public.supplier_rncp_reports set complete_submitted_at=now(),validation_outcome='pending',status='in_progress',updated_by=auth.uid() where id=r.id;
    elsif p_command='manage_plan' then
    if not public.iq_rncp_faculty(r.organization_id,'gestionar_planes') or r.source_kind<>'native' or r.status not in ('submitted','in_progress') or r.closed_at is not null then raise insufficient_privilege using message='RNCP_PLAN_FORBIDDEN'; end if;
    if length(trim(coalesce(p_payload->>'description','')))<10 or nullif(trim(p_payload->>'owner'),'') is null or nullif(p_payload->>'due','') is null then raise exception 'RNCP_ACTION_REQUIRED_FIELDS'; end if;
    if p_payload->>'actionId' is null then
      insert into public.supplier_rncp_actions(report_id,description,responsible_name,due_date,created_by,status)
      values(r.id,trim(p_payload->>'description'),trim(p_payload->>'owner'),(p_payload->>'due')::date,auth.uid(),'in_progress') returning * into a;
    else
      update public.supplier_rncp_actions set description=trim(p_payload->>'description'),responsible_name=trim(p_payload->>'owner'),due_date=(p_payload->>'due')::date
      where id=(p_payload->>'actionId')::uuid and report_id=r.id and created_by=auth.uid() and status in ('pending','in_progress') returning * into a;
      if not found then raise insufficient_privilege using message='RNCP_PLAN_FORBIDDEN'; end if;
    end if;
    proof:=jsonb_build_object('actionId',a.id,'responsible',a.responsible_name,'due',a.due_date);
  elsif p_command in ('verify_effectiveness','close_plan','close_report') then
    if not public.iq_rncp_faculty(r.organization_id,case p_command when 'verify_effectiveness' then 'verificar_efectividad' when 'close_plan' then 'cerrar_planes' else 'cerrar_rncp' end) then raise insufficient_privilege using message='RNCP_FORBIDDEN'; end if;
    if nullif(trim(p_payload->>'reason'),'') is null then raise exception 'RNCP_REASON_REQUIRED'; end if;
    select * into a from public.supplier_rncp_actions where report_id=r.id and status='accepted' and submitted_at=r.complete_submitted_at and validated_at=r.validated_at order by id limit 1 for update;
    if r.source_kind<>'native' or r.closed_at is not null or r.validation_outcome is distinct from 'accepted' or a.id is null or cardinality(public.iq_rncp_missing_requirements(r.id,a.id)) is distinct from 0 then raise exception 'RNCP_REQUIREMENTS_INCOMPLETE'; end if;
    if p_command='verify_effectiveness' then
      insert into integraq_private.rncp_plan_decisions(report_id,action_id,validated_at,effectiveness_by,effectiveness_at)
      values(r.id,a.id,a.validated_at,auth.uid(),now()) on conflict do nothing;
      if not found then raise exception 'RNCP_DECISION_ALREADY_RECORDED'; end if;
    elsif p_command='close_plan' then
      update integraq_private.rncp_plan_decisions set closed_by=auth.uid(),closed_at=now()
      where report_id=r.id and action_id=a.id and validated_at=a.validated_at and effectiveness_at is not null and closed_at is null;
      if not found then raise exception 'RNCP_EFFECTIVENESS_REQUIRED'; end if;
    else
      if not exists(select 1 from integraq_private.rncp_plan_decisions where report_id=r.id and action_id=a.id and validated_at=a.validated_at and closed_at is not null) then raise exception 'RNCP_PLAN_CLOSURE_REQUIRED'; end if;
      update public.supplier_rncp_reports set status='closed',closed_at=now(),updated_by=auth.uid() where id=r.id;
    end if;
    proof:=jsonb_build_object('actionId',a.id,'validatedAt',a.validated_at);
  elsif p_command in ('approve','validate_actions','reject') then
    if not public.iq_rncp_faculty(r.organization_id,'validar_acciones') or (p_command='approve' and not (
      public.iq_rncp_faculty(r.organization_id,'verificar_efectividad') and public.iq_rncp_faculty(r.organization_id,'cerrar_planes') and public.iq_rncp_faculty(r.organization_id,'cerrar_rncp'))) or r.complete_submitted_at is null or r.validation_outcome is distinct from 'pending' then
      raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED';
    end if;
    if nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='22023',message='RNCP_REASON_REQUIRED'; end if;
    select * into a from public.supplier_rncp_actions where report_id=r.id and status='submitted' order by submitted_at desc limit 1 for update;
    if p_command in ('approve','validate_actions') and (a.id is null or cardinality(public.iq_rncp_missing_requirements(r.id,a.id)) is distinct from 0) then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE'; end if;
    update public.supplier_rncp_actions set status=case when p_command<>'reject' then 'accepted'::public.supplier_response_status else 'rejected'::public.supplier_response_status end,
      validated_at=now(),validated_by=auth.uid(),validation_comment=trim(p_payload->>'reason') where id=a.id;
    if p_command='approve' then
      insert into integraq_private.rncp_plan_decisions(report_id,action_id,validated_at,effectiveness_by,effectiveness_at,closed_by,closed_at)
      values(r.id,a.id,now(),auth.uid(),now(),auth.uid(),now());
    end if;
    update public.supplier_rncp_reports set validation_outcome=case when p_command<>'reject' then 'accepted' else 'rejected' end,
      validated_at=now(),validated_by=auth.uid(),validation_note=trim(p_payload->>'reason'),
      closed_at=case when p_command='approve' then now() else null end,status=case when p_command='approve' then 'closed' else 'in_progress' end,updated_by=auth.uid() where id=r.id;
  elsif p_command='reconcile' then
    org:=public.iq_rncp_actor_org(true);
    if org<>r.organization_id or r.supplier_id is not null or nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='42501',message='RNCP_RECONCILIATION_REQUIRED'; end if;
    if not exists(select 1 from public.organizations s where s.id=(p_payload->>'supplierId')::uuid and s.kind='supplier'
      and (s.owning_organization_id is null or s.owning_organization_id=org)) then raise exception using errcode='42501',message='RNCP_SUPPLIER_SCOPE_CONFLICT'; end if;
    update public.supplier_rncp_reports set supplier_id=(p_payload->>'supplierId')::uuid,updated_by=auth.uid() where id=r.id;
  else raise exception using errcode='22023',message='RNCP_COMMAND_INVALID';
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,reason,metadata)
    values(auth.uid(),'suppliers','rncp.'||p_command,'supplier_rncp_report',r.id::text,r.folio,p_payload->>'reason',
      jsonb_build_object('previous_deadline',r.response_deadline,'notification_reference',p_payload->>'reference','command',p_command) || proof);
  return jsonb_build_object('id',r.id,'folio',r.folio)||case when p_command='manage_plan' then jsonb_build_object('actionId',a.id) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_flow_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_org uuid; reason text:=nullif(trim(current_setting('integraq.rncp.change_reason',true)),'');
begin
 if tg_op='UPDATE' then
   if old.status='closed' and new.status<>'closed' then
     if not public.iq_rncp_faculty(old.organization_id,'reabrir_rncp') then raise insufficient_privilege using message='RNCP_REOPEN_FORBIDDEN'; end if;
     if reason is null then raise exception 'RNCP_REOPEN_REASON_REQUIRED'; end if;
     if new.status<>'in_progress' or new.closed_at is not null or new.validation_outcome is not null
       or new.complete_submitted_at is not null or new.validated_at is not null or new.validated_by is not null then raise exception 'RNCP_TRANSITION_INVALID'; end if;
     insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,reason)
     values(auth.uid(),old.organization_id,'suppliers','rncp.reopened','supplier_rncp_report',old.id::text,old.folio,to_jsonb(old),to_jsonb(new),reason);
   end if;
   if new.source_kind='native' and (new.closed_at is distinct from old.closed_at and new.closed_at is not null or new.status='closed' and old.status<>'closed')
     and (new.validation_outcome is distinct from 'accepted' or new.validated_at is null or not public.iq_rncp_faculty(new.organization_id,'cerrar_rncp'))
     then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
   if new.folio is distinct from old.folio then raise exception 'RNCP_FOLIO_IMMUTABLE'; end if;
   if old.status='draft' and new.status<>'draft' and new.source_kind='native' and new.classification is null then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
   if new.classification is not distinct from old.classification then return new; end if;
   if old.source_kind='historical' then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
 end if;
 if new.source_kind='native' or (tg_op='UPDATE' and new.classification is distinct from old.classification) then
   actor_org:=public.iq_rncp_actor_org(false);
   if actor_org is distinct from new.organization_id or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
   if new.classification is null and new.status <> 'draft' then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
   if tg_op='INSERT' then
     perform pg_advisory_xact_lock(hashtextextended('integraq:rncp:official-folio',0));
     select 'RNCP'||lpad((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text,
       greatest(4,length((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text)),'0')
       into new.folio from public.supplier_rncp_reports r where r.folio ~ '^RNCP[0-9]+$';
   else
     if old.status<>'draft' and (reason is null or public.iq_rncp_actor_org(true) is distinct from actor_org) then raise exception 'RNCP_ADMIN_REASON_REQUIRED'; end if;
     insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
       values(auth.uid(),'suppliers','rncp.classification_changed','supplier_rncp_report',new.id::text,
       jsonb_build_object('classification',old.classification),jsonb_build_object('classification',new.classification),reason);
   end if;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_guard_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.user_type in ('administrator','internal') and (tg_op='INSERT' or old.status is distinct from 'closed') and not public.iq_rncp_faculty(actor.organization_id,case when tg_op='INSERT' then 'crear_rncp' else 'editar_rncp' end) then raise insufficient_privilege using message='RNCP_FORBIDDEN'; end if;
  if tg_op='INSERT' and new.source_kind is null then
    if actor.user_type not in ('administrator','internal') or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    new.organization_id:=actor.organization_id; new.source_kind:='native'; new.response_due_date:=null;
  end if;
  if new.source_kind is null then return new; end if;
  if actor.id is null or coalesce(actor.workspace_mode,'production')<>'production' then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  if not exists(select 1 from public.organizations where id=new.organization_id and kind='internal' and active) then raise exception 'RNCP_ORGANIZATION_INVALID'; end if;
  if new.supplier_id is not null and not exists(select 1 from public.organizations s where s.id=new.supplier_id and s.kind='supplier'
    and (s.owning_organization_id is null or s.owning_organization_id=new.organization_id)) then raise exception 'RNCP_SUPPLIER_SCOPE_CONFLICT'; end if;
  if tg_op='UPDATE' and (new.organization_id,new.source_kind,new.source_sha256,new.source_row,new.historical_values,
    new.historical_supplier_name,new.historical_supplier_code,new.historical_status)
    is distinct from (old.organization_id,old.source_kind,old.source_sha256,old.source_row,old.historical_values,
    old.historical_supplier_name,old.historical_supplier_code,old.historical_status) then
    raise exception using errcode='42501',message='RNCP_SOURCE_IMMUTABLE';
  end if;
  if new.source_kind='historical' then
    if actor.user_type<>'administrator' or actor.organization_id<>new.organization_id then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if new.notified_at is not null or new.response_deadline is not null or new.first_valid_progress_at is not null
      or new.complete_submitted_at is not null then raise exception 'RNCP_HISTORICAL_NO_TIMER'; end if;
    if tg_op='UPDATE' and (new.folio,new.report_date,new.material_or_service,new.description,new.status,new.closed_at)
      is distinct from (old.folio,old.report_date,old.material_or_service,old.description,old.status,old.closed_at) then raise exception 'RNCP_SOURCE_IMMUTABLE'; end if;
    return new;
  end if;
  if actor.user_type in ('administrator','internal') then
    if actor.organization_id is distinct from new.organization_id or not (public.has_module_permission('suppliers','update') or (tg_op='UPDATE' and old.status='closed' and new.status='in_progress' and public.iq_rncp_faculty(actor.organization_id,'reabrir_rncp'))) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  elsif actor.user_type='supplier' then
    if tg_op='UPDATE' and old.closed_at is not null then raise exception 'RNCP_RESPONSE_LOCKED'; end if;
    if actor.external_party_id is distinct from new.supplier_id or not public.can_access_supplier_report(new.id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if tg_op='UPDATE' and (to_jsonb(new)-array['first_valid_progress_at','status','complete_submitted_at','validation_outcome','updated_at','updated_by'])
      is distinct from (to_jsonb(old)-array['first_valid_progress_at','status','complete_submitted_at','validation_outcome','updated_at','updated_by']) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  else raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  if new.notified_at is null then new.response_deadline:=null; new.response_due_date:=null;
  else
    if nullif(trim(new.notification_reference),'') is null or new.notified_at>now() then raise exception 'RNCP_NOTIFICATION_PROOF_REQUIRED'; end if;
    if tg_op='UPDATE' and old.notified_at is not null and (new.notified_at,new.response_deadline) is distinct from (old.notified_at,old.response_deadline) then raise exception 'RNCP_NOTIFICATION_IMMUTABLE'; end if;
    new.response_deadline:=new.notified_at+interval '7 days';
    new.response_due_date:=(new.response_deadline at time zone 'America/Mexico_City')::date;
  end if;
  if new.status='closed' and (tg_op='INSERT' or old.status is distinct from 'closed' or (new.closed_at,new.validated_at,new.validated_by,new.validation_outcome) is distinct from (old.closed_at,old.validated_at,old.validated_by,old.validation_outcome))
    and (new.validation_outcome is distinct from 'accepted' or new.validated_at is null
    or new.closed_at is null or not public.iq_rncp_faculty(new.organization_id,'cerrar_rncp') or not exists (select 1 from public.supplier_rncp_actions a where a.report_id=new.id and a.status='accepted' and a.submitted_at=new.complete_submitted_at and cardinality(public.iq_rncp_missing_requirements(new.id,a.id))=0)) then raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  if new.first_valid_progress_at is not null and (tg_op='INSERT' or new.first_valid_progress_at is distinct from old.first_valid_progress_at) and not exists(select 1 from public.supplier_rncp_actions a
    join public.profiles p on p.id=a.created_by where a.report_id=new.id and length(trim(a.description))>=10
    and p.user_type='supplier' and p.external_party_id=new.supplier_id) then raise exception 'RNCP_VALID_PROGRESS_REQUIRED'; end if;
  if new.first_valid_progress_at is not null and (tg_op='INSERT' or new.first_valid_progress_at is distinct from old.first_valid_progress_at)
    and new.first_valid_progress_at is distinct from (select min(a.valid_progress_at) from public.supplier_rncp_actions a join public.profiles p on p.id=a.created_by
      where a.report_id=new.id and a.valid_progress_at>=new.notified_at and length(trim(a.description))>=10 and p.user_type='supplier' and p.external_party_id=new.supplier_id) then raise exception 'RNCP_PROGRESS_TIMESTAMP_INVALID'; end if;
  if new.complete_submitted_at is not null and (tg_op='INSERT' or new.complete_submitted_at is distinct from old.complete_submitted_at)
    and not exists(select 1 from public.supplier_rncp_actions a where a.report_id=new.id and a.status in ('submitted','accepted')
      and a.submitted_at=new.complete_submitted_at and cardinality(public.iq_rncp_missing_requirements(new.id,a.id))=0) then raise exception 'RNCP_REQUIREMENTS_INCOMPLETE'; end if;
  if new.validation_outcome in ('accepted','rejected') and (tg_op='INSERT' or new.validation_outcome is distinct from old.validation_outcome)
    and not public.iq_rncp_is_inspector(new.organization_id) then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_guard_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.supplier_rncp_reports%rowtype; actor public.profiles%rowtype;
begin
  select * into r from public.supplier_rncp_reports where id=new.report_id for update;
  if r.source_kind is null then return new; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.id is null or coalesce(actor.workspace_mode,'production')<>'production' or r.source_kind='historical' or r.deleted_at is not null or r.closed_at is not null then raise exception using errcode='42501',message='RNCP_RESPONSE_LOCKED'; end if;
  if r.notified_at is null then raise exception 'RNCP_NOTIFICATION_REQUIRED'; end if;
  new.created_at:=case when tg_op='INSERT' then now() else old.created_at end;
  new.updated_at:=now();
  new.valid_progress_at:=case when tg_op='UPDATE' then old.valid_progress_at else null end;
  if tg_op='UPDATE' and (new.report_id,new.created_by) is distinct from (old.report_id,old.created_by) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
  if new.status in ('accepted','rejected') then
    if not public.iq_rncp_faculty(r.organization_id,'validar_acciones') then raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
    if new.validated_by is distinct from auth.uid() or new.validated_at is null then raise exception 'RNCP_VALIDATION_AUDIT_REQUIRED'; end if;
    if tg_op='INSERT' or (to_jsonb(new)-array['status','validated_by','validated_at','validation_comment','updated_at'])
      is distinct from (to_jsonb(old)-array['status','validated_by','validated_at','validation_comment','updated_at']) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
    if new.status='accepted' and cardinality(public.iq_rncp_missing_requirements(r.id,new.id))>0 then raise exception 'RNCP_REQUIREMENTS_INCOMPLETE'; end if;
  elsif actor.user_type in ('internal','administrator') then
    if not public.iq_rncp_faculty(r.organization_id,'gestionar_planes') or r.source_kind<>'native' or r.status not in ('submitted','in_progress')
       or new.created_by is distinct from auth.uid() or new.status not in ('pending','in_progress')
       or new.validated_at is not null or new.validated_by is not null or new.submitted_at is not null
       or length(trim(new.description))<10 or (tg_op='UPDATE' and (old.created_by is distinct from auth.uid() or old.report_id<>new.report_id or old.status not in ('pending','in_progress')))
    then raise insufficient_privilege using message='RNCP_PLAN_FORBIDDEN'; end if;
    new.valid_progress_at:=null;
  else
    if actor.user_type<>'supplier' or actor.external_party_id is distinct from r.supplier_id or new.created_by is distinct from auth.uid()
      or not public.iq_rncp_read_scope(r.id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if tg_op='UPDATE' and old.status='submitted' then raise exception 'RNCP_RESPONSE_LOCKED'; end if;
    if tg_op='UPDATE' and (new.report_id,new.created_by) is distinct from (old.report_id,old.created_by) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
    if length(trim(new.description))<10 then raise exception 'RNCP_VALID_PROGRESS_REQUIRED'; end if;
    if new.valid_progress_at is null and (length(trim(coalesce(new.root_cause,'')))>=10
      or length(trim(coalesce(new.action_plan,'')))>=10 or length(trim(coalesce(new.containment,'')))>=10
      or exists(select 1 from public.supplier_rncp_action_evidence e join public.file_objects f on f.id=e.file_id
        join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path
        where e.action_id=new.id and f.resource_id=new.id and f.external_organization_id=r.supplier_id
          and f.resource_type='supplier_rncp_action_evidence' and f.deleted_at is null and f.size_bytes>0 and f.sha256 ~ '^[a-f0-9]{64}$')) then
      new.valid_progress_at:=now();
    end if;
    if new.status='submitted' and (tg_op='INSERT' or old.status is distinct from 'submitted') then
      -- A saved partial advance is not a complete delivery. The explicit command
      -- checks structured fields and linked, private originals after persistence.
      if tg_op='INSERT' or cardinality(public.iq_rncp_missing_requirements(r.id,new.id))>0 then
        new.status:='in_progress'; new.submitted_at:=null;
      else new.submitted_at:=now(); end if;
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.iq_rncp_queue_notifications(p_organization_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.supplier_rncp_reports%rowtype; event text; occurrence timestamptz; recipient text;
declare target uuid; address text; confirmed timestamptz; candidates integer; inserted integer; total integer:=0;
begin
  if p_now is null or abs(extract(epoch from (p_now-now())))>300 then raise exception 'RNCP_CLOCK_INVALID'; end if;
  for r in select * from public.supplier_rncp_reports where organization_id=p_organization_id and source_kind='native'
    and notified_at is not null and closed_at is null and deleted_at is null loop
    foreach event in array array['unattended','overdue','validation'] loop
      occurrence:=null;
      if event='unattended' and r.first_valid_progress_at is null and p_now>r.notified_at+interval '24 hours' then occurrence:=r.notified_at; end if;
      if event='overdue' and p_now>=r.response_deadline and (r.complete_submitted_at is null or r.complete_submitted_at>r.response_deadline or r.validation_outcome='rejected') then occurrence:=r.response_deadline; end if;
      if event='validation' and r.validation_outcome='pending' and r.complete_submitted_at is not null then occurrence:=r.complete_submitted_at; end if;
      if occurrence is null then continue; end if;
      foreach recipient in array case when event='validation' then array['inspector'] else array['inspector','supplier'] end loop
        target:=null; address:=null; confirmed:=null;
        select count(*) into candidates from public.profiles p join auth.users u on u.id=p.id where p.status='active' and u.email_confirmed_at is not null
          and ((recipient='inspector' and p.organization_id=r.organization_id and p.user_type in ('administrator','internal') and integraq_private.rncp_grant(p.id,r.organization_id,'validar_acciones'))
            or (recipient='supplier' and p.user_type='supplier' and p.external_party_id=r.supplier_id));
        if candidates=1 then
          select p.id,u.email,u.email_confirmed_at into target,address,confirmed from public.profiles p join auth.users u on u.id=p.id where p.status='active' and u.email_confirmed_at is not null
          and ((recipient='inspector' and p.organization_id=r.organization_id and p.user_type in ('administrator','internal') and integraq_private.rncp_grant(p.id,r.organization_id,'validar_acciones'))
            or (recipient='supplier' and p.user_type='supplier' and p.external_party_id=r.supplier_id));
        end if;
        insert into public.supplier_rncp_notification_outbox(organization_id,report_id,event_type,occurrence,recipient_kind,
          recipient_id,recipient_email,recipient_verified_at,delivery_state,last_error_code)
          values(r.organization_id,r.id,event,occurrence,recipient,target,address,confirmed,
            case when confirmed is null then 'pending_recipient' else 'disabled' end,
            case when confirmed is null then 'VERIFIED_RECIPIENT_REQUIRED' else 'REAL_EMAIL_DISABLED' end)
          on conflict on constraint rncp_notification_event_unique do nothing;
        get diagnostics inserted=row_count; total:=total+inserted;
      end loop;
    end loop;
  end loop;
  return total;
end $function$;

CREATE OR REPLACE FUNCTION public.save_supplier_rncp(requested_report_id uuid, requested_action text, requested_payload jsonb DEFAULT '{}'::jsonb, requested_reason text DEFAULT NULL::text)
 RETURNS supplier_rncp_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<save_supplier_rncp>>
declare
  actor_id uuid := auth.uid();
  actor_org uuid := public.iq_rncp_actor_org(false);
  selected_classification text := nullif(requested_payload->>'classification','');
  actor_type public.app_user_type;
  current_report public.supplier_rncp_reports%rowtype;
  saved_report public.supplier_rncp_reports%rowtype;
  report_id uuid := coalesce(requested_report_id, gen_random_uuid());
  report_folio text;
  supplier_id uuid := nullif(requested_payload->>'supplierId', '')::uuid;
  site_id uuid := nullif(requested_payload->>'siteId', '')::uuid;
  report_date date := nullif(requested_payload->>'reportDate', '')::date;
  finding_type text := nullif(trim(requested_payload->>'findingType'), '');
  material_or_service text := nullif(trim(requested_payload->>'materialOrService'), '');
  description text := nullif(trim(requested_payload->>'description'), '');
  responsible_name text := nullif(trim(requested_payload->>'responsibleName'), '');
  response_due_date date := nullif(requested_payload->>'responseDueDate', '')::date;
  reason text := nullif(trim(coalesce(requested_reason, '')), '');
  next_status text;
  audit_action text;
begin
  select user_type into actor_type from public.profiles where id = actor_id and status = 'active';
  if actor_id is null or actor_type not in ('administrator', 'internal')
    or (requested_action <> 'reopen' and not public.has_module_permission('suppliers', 'update')) then
    raise exception using errcode = '42501', message = 'RNCP_WRITE_FORBIDDEN';
  end if;
  if requested_action='close' then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  if requested_action not in ('draft', 'submit', 'progress', 'close', 'reopen', 'correct') then
    raise exception using errcode = '22023', message = 'RNCP_ACTION_INVALID';
  end if;

  if requested_report_id is not null then
    select * into current_report from public.supplier_rncp_reports where id = requested_report_id and organization_id = actor_org for update;
    if current_report.id is null then
      raise exception using errcode = '22023', message = 'RNCP_NOT_FOUND';
    end if;
    if current_report.deleted_at is not null then
      raise exception using errcode = '22023', message = 'RNCP_DELETED';
    end if;
  end if;

  if requested_action in ('draft','submit','correct') then
    if not (requested_payload ? 'classification') then selected_classification := current_report.classification; end if;
    if current_report.source_kind='historical' and selected_classification is distinct from current_report.classification then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
    if current_report.id is null or current_report.source_kind='native' then
      if (selected_classification is null and requested_action <> 'draft') or selected_classification not in ('QAC','Hilo','Avíos') then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
    end if;
  end if;

  if requested_action in ('submit', 'correct') then
    if supplier_id is null or report_date is null or finding_type is null
      or material_or_service is null or description is null or responsible_name is null
      then
      raise exception using errcode = '23514', message = 'RNCP_REQUIRED_FIELDS_MISSING';
    end if;
    if exists (
      select 1 from public.external_company_sites site
      where site.company_id = supplier_id and site.active
    ) and site_id is null then
      raise exception using errcode = '23514', message = 'RNCP_SITE_REQUIRED';
    end if;
  end if;
  if supplier_id is not null and not exists (
    select 1 from public.organizations organization
    where organization.id = supplier_id and organization.kind = 'supplier' and organization.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SUPPLIER_INVALID';
  end if;
  if site_id is not null and not exists (
    select 1 from public.external_company_sites site
    where site.id = site_id and site.company_id = supplier_id and site.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SITE_INVALID';
  end if;

  if current_report.id is null then
    if requested_action not in ('draft', 'submit') then
      raise exception using errcode = '22023', message = 'RNCP_CREATE_ACTION_INVALID';
    end if;
    next_status := case when requested_action = 'submit' then 'submitted' else 'draft' end;
    report_folio := 'ASSIGNED_BY_TRIGGER';
    insert into public.supplier_rncp_reports(
      id, folio, classification, supplier_id, site_id, report_date, purchase_order,
      material_or_service, finding_type, rejected_quantity, description,
      immediate_disposition, response_due_date, responsible_name, status,
      submitted_at, portal_visible, created_by, updated_by
    ) values (
      report_id, report_folio, selected_classification, supplier_id, site_id, report_date,
      null, material_or_service,
      finding_type, nullif(requested_payload->>'rejectedQuantity', '')::numeric,
      description, nullif(trim(requested_payload->>'immediateDisposition'), ''),
      response_due_date, responsible_name, next_status,
      case when next_status = 'submitted' then now() else null end,
      coalesce((requested_payload->>'portalVisible')::boolean, true), actor_id, actor_id
    ) returning * into saved_report;
    report_folio := saved_report.folio;
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (actor_id, 'suppliers', 'rncp.created', 'supplier_rncp_report', report_id::text, report_folio,
      jsonb_build_object('status', next_status), jsonb_build_object('supplier_id', supplier_id, 'site_id', site_id));
    audit_action := case when next_status = 'submitted' then 'rncp.submitted' else 'rncp.draft_saved' end;
  else
    report_folio := current_report.folio;
    if requested_action = 'draft' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_DRAFT_LOCKED'; end if;
      next_status := 'draft'; audit_action := 'rncp.draft_saved';
    elsif requested_action = 'submit' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_ALREADY_SUBMITTED'; end if;
      next_status := 'submitted'; audit_action := 'rncp.submitted';
    elsif requested_action = 'progress' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := coalesce(responsible_name, current_report.responsible_name);
      response_due_date := coalesce(response_due_date, current_report.response_due_date);
      next_status := 'in_progress'; audit_action := 'rncp.assigned';
    elsif requested_action = 'close' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'closed'; audit_action := 'rncp.closed';
    elsif requested_action = 'reopen' then
      if not public.iq_rncp_faculty(current_report.organization_id,'reabrir_rncp') then raise insufficient_privilege using message='RNCP_REOPEN_FORBIDDEN'; end if;
      if reason is null then raise exception 'RNCP_REOPEN_REASON_REQUIRED'; end if;
      if current_report.status <> 'closed' then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'in_progress'; audit_action := 'rncp.reopened';
    else
      if actor_type <> 'administrator' or reason is null then raise exception using errcode = '42501', message = 'RNCP_ADMIN_REASON_REQUIRED'; end if;
      next_status := current_report.status; audit_action := 'rncp.corrected';
    end if;

    perform set_config('integraq.rncp.change_reason',coalesce(reason,''),true);
    update public.supplier_rncp_reports set
      supplier_id = save_supplier_rncp.supplier_id,
      site_id = save_supplier_rncp.site_id,
      report_date = save_supplier_rncp.report_date,
      purchase_order = current_report.purchase_order,
      classification = case when requested_action in ('draft','submit','correct') then selected_classification else current_report.classification end,
      material_or_service = save_supplier_rncp.material_or_service,
      finding_type = save_supplier_rncp.finding_type,
      rejected_quantity = case when requested_action in ('draft', 'submit', 'correct') then nullif(requested_payload->>'rejectedQuantity', '')::numeric else rejected_quantity end,
      description = save_supplier_rncp.description,
      immediate_disposition = case when requested_action in ('draft', 'submit', 'progress', 'correct') then coalesce(nullif(trim(requested_payload->>'immediateDisposition'), ''), immediate_disposition) else immediate_disposition end,
      response_due_date = save_supplier_rncp.response_due_date,
      responsible_name = save_supplier_rncp.responsible_name,
      status = next_status,
      submitted_at = case when requested_action = 'submit' then now() else submitted_at end,
      complete_submitted_at = case when requested_action='reopen' then null else complete_submitted_at end,
      validation_outcome = case when requested_action='reopen' then null else validation_outcome end,
      validated_at = case when requested_action='reopen' then null else validated_at end,
      validated_by = case when requested_action='reopen' then null else validated_by end,
      validation_note = case when requested_action='reopen' then null else validation_note end,
      closed_at = case when requested_action = 'close' then now() when requested_action = 'reopen' then null else closed_at end,
      updated_by = actor_id
    where id = current_report.id
    returning * into saved_report;
  end if;

  if requested_action <> 'reopen' then
  insert into public.audit_log(
    actor_id, module, action, resource_type, resource_id, entity_code_snapshot,
    previous_value, new_value, reason, metadata
  ) values (
    actor_id, 'suppliers', audit_action, 'supplier_rncp_report', saved_report.id::text,
    saved_report.folio,
    case when current_report.id is null then null else to_jsonb(current_report) end,
    to_jsonb(saved_report),
    reason, jsonb_build_object('supplier_id', saved_report.supplier_id, 'site_id', saved_report.site_id)
  );
  end if;
  return saved_report;
end;
$function$;
CREATE OR REPLACE FUNCTION public.iq_rncp_save_workspace(p_area text, p_payload jsonb, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid:=public.iq_rncp_actor_org(false); row public.workspace_data%rowtype; previous_payload jsonb;
begin
  if p_area='rncpFollowupSettings' and not public.iq_rncp_faculty(org,'configurar_modulo') or p_area='rncpAlertReviews' and not public.is_administrator() then raise insufficient_privilege; end if;
  if p_area='rncpFollowupSettings' and not public.is_administrator() and coalesce((p_payload->>'semanticAiApproved')::boolean,false) then raise insufficient_privilege; end if;
  if p_area not in ('rncpFollowupSettings','rncpAlertReviews') or jsonb_typeof(p_payload)<>'object' then raise exception 'RNCP_SETTINGS_INVALID'; end if;
  -- Real outbound activation is a separate, explicitly authorized phase.
  if p_area='rncpFollowupSettings' and coalesce((p_payload->>'emailEnabled')::boolean,false) then raise exception 'RNCP_REAL_EMAIL_NOT_AUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||p_area,0));
  select * into row from public.workspace_data where workspace_id=org and workspace_mode='production' and area=p_area and deleted_at is null for update;
  if p_expected_revision is null or coalesce(row.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='RNCP_SETTINGS_CHANGED'; end if;
  previous_payload:=row.payload;
  if row.id is null then
    insert into public.workspace_data(workspace_id,workspace_mode,area,payload,created_by,updated_by)
      values(org,'production',p_area,p_payload,auth.uid(),auth.uid()) returning * into row;
  else update public.workspace_data set payload=p_payload,revision=revision+1,updated_by=auth.uid() where id=row.id returning * into row;
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,metadata)
    values(auth.uid(),'suppliers','rncp.settings_reviewed','workspace_data',row.id::text,jsonb_build_object('area',p_area,'revision',row.revision,'previous',previous_payload,'current',p_payload));
  return jsonb_build_object('revision',row.revision);
end $function$;
commit;
