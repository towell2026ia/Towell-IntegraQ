-- Certification scope only. No backfill, historical updates, general guards or new tables.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.certifications
  add column if not exists workspace_id uuid references public.organizations(id) on delete restrict,
  add column if not exists external_organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists certification_type text,
  add column if not exists reference_number text,
  add column if not exists observations text,
  add column if not exists responsible_id uuid references public.profiles(id) on delete restrict,
  add column if not exists updated_by uuid references public.profiles(id) on delete restrict,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id) on delete restrict,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete restrict,
  add column if not exists deletion_reason text,
  add column if not exists revision integer not null default 1;
create index certifications_workspace_customer_idx on public.certifications(workspace_id,external_organization_id);
alter table public.certifications enable row level security;

-- Existing permissive policies are preserved; these AND guards constrain their OR union.
-- External callers use the server's minimal document projection, never internal notes or history.
create policy iq_certification_internal_select on public.certifications as restrictive for select to authenticated using (
  exists(select 1 from public.profiles p join public.organizations o on o.id=p.organization_id
    where p.id=auth.uid() and p.status='active' and p.workspace_mode='production'
      and p.user_type in ('administrator','internal') and p.organization_id=certifications.workspace_id
      and o.kind='internal' and o.active
      and (p.user_type='administrator' or (public.has_module_permission('customers','view')
        and public.has_permission('clientes.acceder',p.organization_id) and public.has_permission('clientes.ver',p.organization_id))))
);
create policy iq_certification_server_insert on public.certifications as restrictive for insert to authenticated with check(false);
create policy iq_certification_server_update on public.certifications as restrictive for update to authenticated using(false) with check(false);
create policy iq_certification_no_delete on public.certifications as restrictive for delete to authenticated using(false);
create policy iq_certification_file_select on public.file_objects as restrictive for select to authenticated using(resource_type<>'customer_certification_document');
create policy iq_certification_file_insert on public.file_objects as restrictive for insert to authenticated with check(resource_type<>'customer_certification_document');
create policy iq_certification_file_update on public.file_objects as restrictive for update to authenticated using(resource_type<>'customer_certification_document') with check(resource_type<>'customer_certification_document');
create policy iq_certification_file_delete on public.file_objects as restrictive for delete to authenticated using(resource_type<>'customer_certification_document');
create policy iq_certification_storage on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'integraq-private' or name not like 'customer-certifications/%')
  with check(bucket_id<>'integraq-private' or name not like 'customer-certifications/%');
create function public.iq_guard_certification_file() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user<>'service_role' and old.resource_type='customer_certification_document' then
    raise exception using errcode='42501',message='CERTIFICATION_SERVER_COMMAND_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function public.iq_guard_certification_file() from public,anon,authenticated;
create trigger iq_certification_file_guard before update on public.file_objects for each row execute function public.iq_guard_certification_file();

-- Atomic mutation and audit; executable only by server role, with explicit live admin/tenant checks.
create function public.iq_certification_command(actor_id uuid,workspace_id uuid,command text,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  before_row public.certifications;
  saved public.certifications;
  replaced public.file_objects;
  cert_id uuid := (payload->>'id')::uuid;
  customer_id uuid := nullif(payload->>'customerId','')::uuid;
  file_id uuid;
  reason text := nullif(btrim(payload->>'reason'),'');
  today date := (now() at time zone 'America/Mexico_City')::date;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_COMMAND_ONLY'; end if;
  if not exists(select 1 from public.profiles p join public.organizations o on o.id=p.organization_id
    where p.id=actor_id and p.status='active' and p.user_type='administrator' and p.workspace_mode='production'
      and p.organization_id=iq_certification_command.workspace_id and o.kind='internal' and o.active) then
    raise exception using errcode='42501',message='ACTIVE_WORKSPACE_ADMIN_REQUIRED';
  end if;
  -- Serialize creates and updates for the same id, including concurrent initial saves.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(cert_id::text,0));
  select * into before_row from public.certifications where id=cert_id for update;
  if before_row.id is not null and before_row.workspace_id is distinct from iq_certification_command.workspace_id then
    raise exception using errcode='42501',message='CERTIFICATION_SCOPE_DENIED';
  end if;
  if before_row.id is not null and (payload->>'revision')::integer is distinct from before_row.revision then raise exception 'CERTIFICATION_CONCURRENT_EDIT'; end if;
  if before_row.id is not null and not before_row.active then raise exception 'CERTIFICATION_RETIRED'; end if;
  if command='save' then
    if customer_id is not null and not exists(select 1 from public.organizations where id=customer_id and kind='customer'
      and owning_organization_id=iq_certification_command.workspace_id and (active or id=before_row.external_organization_id)) then
      raise exception using errcode='42501',message='CUSTOMER_SCOPE_DENIED';
    end if;
    if before_row.id is not null and before_row.external_organization_id is distinct from customer_id then raise exception 'CERTIFICATION_CUSTOMER_IMMUTABLE'; end if;
    if not exists(select 1 from public.profiles p where p.id=(payload->>'responsibleId')::uuid and p.organization_id=iq_certification_command.workspace_id
      and p.user_type in ('administrator','internal') and p.status='active' and p.workspace_mode='production') then raise exception 'RESPONSIBLE_SCOPE_DENIED'; end if;
    if nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'type'),'') is null or nullif(btrim(payload->>'issuer'),'') is null
      or nullif(payload->>'validFrom','') is null or nullif(payload->>'validUntil','') is null
      or (payload->>'validFrom')::date>(payload->>'validUntil')::date then raise exception 'CERTIFICATION_FIELDS_REQUIRED'; end if;
    if before_row.id is null then
      insert into public.certifications(id,code,name,issuer,scope,valid_from,valid_until,workspace_id,external_organization_id,certification_type,
        reference_number,observations,responsible_id,created_by,updated_by,customer_visible)
      values(cert_id,'CERT-'||cert_id::text,btrim(payload->>'name'),btrim(payload->>'issuer'),nullif(btrim(payload->>'scope'),''),
        (payload->>'validFrom')::date,(payload->>'validUntil')::date,iq_certification_command.workspace_id,customer_id,btrim(payload->>'type'),nullif(btrim(payload->>'reference'),''),
        nullif(btrim(payload->>'observations'),''),(payload->>'responsibleId')::uuid,actor_id,actor_id,false);
    else
      update public.certifications set name=btrim(payload->>'name'),issuer=btrim(payload->>'issuer'),scope=nullif(btrim(payload->>'scope'),''),
        valid_from=(payload->>'validFrom')::date,valid_until=(payload->>'validUntil')::date,certification_type=btrim(payload->>'type'),
        reference_number=nullif(btrim(payload->>'reference'),''),observations=nullif(btrim(payload->>'observations'),''),
        responsible_id=(payload->>'responsibleId')::uuid,updated_by=actor_id,customer_visible=false,published_at=null,published_by=null,revision=revision+1 where id=cert_id;
    end if;
  elsif command in ('publish','unpublish','retire','file') then
    if before_row.id is null then raise exception 'CERTIFICATION_NOT_FOUND'; end if;
    if command='publish' then
      if before_row.valid_from>today or before_row.valid_until<today or before_row.valid_from is null or before_row.valid_until is null then raise exception 'CERTIFICATION_NOT_CURRENT'; end if;
      if before_row.external_organization_id is not null and not exists(select 1 from public.organizations o where o.id=before_row.external_organization_id
        and o.kind='customer' and o.active and o.owning_organization_id=iq_certification_command.workspace_id) then raise exception 'CUSTOMER_SCOPE_DENIED'; end if;
      if not exists(select 1 from public.file_objects f where f.resource_id=cert_id and f.resource_type='customer_certification_document'
        and f.workspace_id=iq_certification_command.workspace_id and f.is_current and f.deleted_at is null) then raise exception 'CURRENT_FILE_REQUIRED'; end if;
      update public.certifications set customer_visible=true,published_at=now(),published_by=actor_id,updated_by=actor_id,revision=revision+1 where id=cert_id;
    elsif command='unpublish' then
      update public.certifications set customer_visible=false,published_at=null,published_by=null,updated_by=actor_id,revision=revision+1 where id=cert_id;
    elsif command='retire' then
      if reason is null then raise exception 'RETIREMENT_REASON_REQUIRED'; end if;
      update public.certifications set active=false,deleted_at=now(),deleted_by=actor_id,deletion_reason=reason,customer_visible=false,
        published_at=null,published_by=null,updated_by=actor_id,revision=revision+1 where id=cert_id;
    else
      file_id := (payload->>'fileId')::uuid;
      if payload->>'objectPath' not like 'customer-certifications/'||iq_certification_command.workspace_id::text||'/'||cert_id::text||'/'||file_id::text||'/%'
        or (payload->>'size')::bigint not between 1 and 4194304 then raise exception 'CERTIFICATION_FILE_INVALID'; end if;
      if nullif(payload->>'replaceId','') is not null then
        select * into replaced from public.file_objects f where f.id=(payload->>'replaceId')::uuid and f.resource_id=cert_id
          and f.workspace_id=iq_certification_command.workspace_id and f.resource_type='customer_certification_document' and f.is_current and f.deleted_at is null for update;
        if not found then raise exception 'REPLACEMENT_SCOPE_DENIED'; end if;
        update public.file_objects set is_current=false,updated_by=actor_id where id=replaced.id;
      end if;
      insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,workspace_id,module_id,external_organization_id,
        audience,resource_type,resource_id,uploaded_by,updated_by,version,is_current,replaces_file_id,preview_status)
      values(file_id,'integraq-private',payload->>'objectPath',payload->>'filename',payload->>'mime',(payload->>'size')::bigint,payload->>'sha256',
        iq_certification_command.workspace_id,'customers',before_row.external_organization_id,'internal','customer_certification_document',cert_id,actor_id,actor_id,
        coalesce(replaced.version,0)+1,true,replaced.id,'not_required');
      update public.certifications set customer_visible=false,published_at=null,published_by=null,updated_by=actor_id,revision=revision+1 where id=cert_id;
    end if;
  else raise exception 'CERTIFICATION_COMMAND_INVALID'; end if;
  select * into saved from public.certifications where id=cert_id;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
    values(actor_id,iq_certification_command.workspace_id,'customers','certification.'||command,'customer_certification',cert_id,to_jsonb(before_row),to_jsonb(saved),reason,jsonb_build_object('file_id',file_id));
  return jsonb_build_object('certification',to_jsonb(saved),'fileId',file_id);
end;
$$;
revoke all on function public.iq_certification_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.iq_certification_command(uuid,uuid,text,jsonb) to service_role;
