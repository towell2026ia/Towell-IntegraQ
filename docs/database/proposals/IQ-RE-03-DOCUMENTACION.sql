-- Propuesta RE-03. Las filas y objetos ya existentes no se modifican al instalar.
begin;

create function public.iq_review_can_read(p_workspace uuid, p_uploader uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_internal_user()
    and (public.is_administrator() or public.has_module_permission('management-review','view'))
    and exists(select 1 from public.profiles me where me.id=auth.uid()
      and me.organization_id=coalesce(p_workspace,
        (select owner.organization_id from public.profiles owner where owner.id=p_uploader)));
$$;
revoke all on function public.iq_review_can_read(uuid,uuid) from public,anon;
grant execute on function public.iq_review_can_read(uuid,uuid) to authenticated;


-- One immutable description per transfer; only an authenticated owner can discover it.
create table public.iq_review_uploads (
  id uuid primary key,
  actor uuid not null references public.profiles(id),
  organization_id uuid not null,
  resource_type text not null,
  resource_key text not null,
  previous_id uuid references public.file_objects(id),
  expected_at timestamptz,
  payload jsonb not null,
  object_path text not null unique,
  verified boolean not null default false,
  result_id uuid references public.file_objects(id),
  created_at timestamptz not null default now()
);
create index iq_review_uploads_pending on public.iq_review_uploads(actor,resource_type,resource_key) where result_id is null;
alter table public.iq_review_uploads enable row level security;
revoke all on public.iq_review_uploads from public, anon, authenticated;
grant select on public.iq_review_uploads to authenticated;
create policy review_upload_owner on public.iq_review_uploads for select to authenticated
using(actor=auth.uid() and public.is_administrator() and public.iq_review_can_read(organization_id,actor));

create function public.iq_review_reserve(p_id uuid, p_type text, p_key text, p_previous uuid, p_expected timestamptz, p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  org uuid;
  path text;
  saved public.iq_review_uploads%rowtype;
begin
  select organization_id into org from public.profiles where id=auth.uid() and status='active';
  if org is null or not public.is_administrator() then raise exception 'REVIEW_DENIED'; end if;
  if p_id is null or p_type is null or p_key is null or p_data is null or
     p_type not in ('management_review_minutes','management_review_document') or
     (p_type='management_review_minutes' and p_key !~ '^[0-9]{4}$') or
     (p_type='management_review_document' and p_key !~ '^[0-9]{4}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') or
     split_part(p_key,':',1)::int not between 1900 and extract(year from current_date) or
     coalesce(p_data->>'sha','') !~ '^[0-9a-f]{64}$' or coalesce((p_data->>'size')::bigint,0) not between 1 and 52428800 or
     nullif(trim(p_data->>'name'),'') is null or nullif(trim(p_data->>'mime'),'') is null or
     nullif(trim(p_data->>'title'),'') is null or nullif(trim(p_data->>'responsible'),'') is null or
     (p_data->>'date')::date is null then raise exception 'REVIEW_METADATA'; end if;
  if p_type='management_review_minutes' and (extract(year from (p_data->>'date')::date)<>p_key::int
       or coalesce(p_data->>'notes','') not in ('Finalizada','En revisión')
       or not ((lower(p_data->>'name') like '%.pdf' and p_data->>'mime'='application/pdf')
         or (lower(p_data->>'name') like '%.docx' and p_data->>'mime'='application/vnd.openxmlformats-officedocument.wordprocessingml.document')))
     then raise exception 'REVIEW_METADATA'; end if;
  if p_type='management_review_document' and (coalesce(p_data->>'category','') not in ('presentations','inputs','reports','support','improvements','other')
    or coalesce(p_data->>'section','') not in ('','manual','policy','risks','objectives','organization','processes','customers','suppliers','audits','actions','improvement','satisfaction','history','outputs','attachments'))
    then raise exception 'REVIEW_METADATA'; end if;
  path:=auth.uid()::text||'/attachments/management-review/'||p_type||'/r1-'||replace(p_key,':','-')||'/'||p_id::text||'/original';
  p_data:=p_data||jsonb_build_object('path',path,'id',p_id);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,3));
  select * into saved from public.iq_review_uploads where id=p_id;
  if found then
    if saved.actor=auth.uid() and saved.organization_id=org and saved.resource_type=p_type and saved.resource_key=p_key
      and saved.payload=p_data and saved.previous_id is not distinct from p_previous and saved.expected_at is not distinct from p_expected
      then return saved.id; end if;
    raise exception 'REVIEW_CHANGED';
  end if;
  if p_previous is not null and not exists(select 1 from public.file_objects f where f.id=p_previous and f.resource_type=p_type
    and f.resource_key=p_key and f.module_id='management-review' and f.is_current and f.deleted_at is null and f.updated_at=p_expected
    and public.iq_review_can_read(f.workspace_id,f.uploaded_by)) then raise exception 'REVIEW_CHANGED'; end if;
  if p_previous is null and exists(select 1 from public.file_objects f where f.resource_type=p_type and f.resource_key=p_key
    and f.module_id='management-review' and (p_type='management_review_document' or (f.is_current and f.deleted_at is null))
    and public.iq_review_can_read(f.workspace_id,f.uploaded_by)) then raise exception 'REVIEW_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||(p_data->>'sha'),1));
  select * into saved from public.iq_review_uploads r where r.organization_id=org and r.payload->>'sha'=p_data->>'sha' and r.result_id is null;
  if found then
    if saved.actor=auth.uid() and saved.resource_type=p_type and split_part(saved.resource_key,':',1)=split_part(p_key,':',1)
      and saved.previous_id is not distinct from p_previous and saved.expected_at is not distinct from p_expected
      and (saved.payload-'path'-'id')=(p_data-'path'-'id') then return saved.id; end if;
    raise exception 'REVIEW_PENDING';
  end if;
  if exists(select 1 from public.file_objects f where f.sha256=p_data->>'sha' and f.resource_type in ('management_review_minutes','management_review_document')
    and public.iq_review_can_read(f.workspace_id,f.uploaded_by)) then raise exception 'REVIEW_DUPLICATE'; end if;
  insert into public.iq_review_uploads(id,actor,organization_id,resource_type,resource_key,previous_id,expected_at,payload,object_path)
    values(p_id,auth.uid(),org,p_type,p_key,p_previous,p_expected,p_data,path);
  return p_id;
end $$;
revoke all on function public.iq_review_reserve(uuid,text,text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.iq_review_reserve(uuid,text,text,uuid,timestamptz,jsonb) to authenticated;

-- Read through the caller's session. PostgREST exposes this set-returning function with pagination.
create function public.iq_review_transfers() returns table(id uuid,resource_type text,resource_key text,previous_id uuid,
  expected_at timestamptz,payload jsonb,object_path text,result_id uuid,uploaded boolean)
language sql stable security invoker set search_path='' as $$
  select r.id,r.resource_type,r.resource_key,r.previous_id,r.expected_at,r.payload,r.object_path,r.result_id,
    exists(select 1 from storage.objects o where o.bucket_id='integraq-private' and o.name=r.object_path)
  from public.iq_review_uploads r;
$$;
revoke all on function public.iq_review_transfers() from public,anon;
grant execute on function public.iq_review_transfers() to authenticated;

-- The existing server hashes the bytes read with the caller's Storage access. Clients cannot attest.
create function public.iq_review_attest(p_id uuid,p_actor uuid,p_sha text,p_size bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.iq_review_uploads r set verified=true where r.id=p_id and r.actor=p_actor
    and r.payload->>'sha'=p_sha and (r.payload->>'size')::bigint=p_size
    and exists(select 1 from storage.objects o where o.bucket_id='integraq-private' and o.name=r.object_path and o.owner_id=p_actor::text);
  if not found then raise exception 'REVIEW_OBJECT'; end if;
end $$;
revoke all on function public.iq_review_attest(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.iq_review_attest(uuid,uuid,text,bigint) to service_role;

-- RE-02 marks the predecessor inactive in a separate request. Acknowledge that preparatory
-- request without changing the row. Switch versions only inside the successor INSERT.
create function public.iq_review_legacy_minutes() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  org uuid;
  prior public.file_objects%rowtype;
  action_name text;
begin
  select organization_id into org from public.profiles where id=actor and status='active';
  if org is null or not public.is_administrator() or new.resource_type is distinct from 'management_review_minutes'
    or new.module_id is distinct from 'management-review' or new.resource_key !~ '^[0-9]{4}$'
    then raise exception 'REVIEW_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||new.resource_type||new.resource_key,0));
  if tg_op='UPDATE' then
    if old.resource_type is distinct from new.resource_type or not public.iq_review_can_read(old.workspace_id,old.uploaded_by)
      or (to_jsonb(new)-array['is_current','updated_at','deleted_at','deleted_by','deletion_reason']) is distinct from
         (to_jsonb(old)-array['is_current','updated_at','deleted_at','deleted_by','deletion_reason'])
      or old.deleted_at is not null then raise exception 'REVIEW_DENIED'; end if;
    if new.deleted_at is null then
      if new.deleted_by is distinct from old.deleted_by or new.deletion_reason is distinct from old.deletion_reason then raise exception 'REVIEW_DENIED'; end if;
      -- An open RE-02 client may have deactivated the last version before installation.
      -- Its compensating update can restore only that unsuperseded, non-retired version.
      if new.is_current and not old.is_current and not exists(select 1 from public.file_objects f
        where f.id<>old.id and f.resource_type=old.resource_type and f.resource_key=old.resource_key
          and public.iq_review_can_read(f.workspace_id,f.uploaded_by)
          and (f.replaces_file_id=old.id or (f.is_current and f.deleted_at is null)
            or (f.category=old.category and f.version>=old.version))) then
        new.updated_by:=actor;
        insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
          values(actor,org,'management-review','REVIEW_RESTORE_CURRENT',old.resource_type,old.id::text,jsonb_build_object('client','RE-02'));
        return new;
      end if;
      return null;
    end if;
    if new.is_current or new.deleted_by is distinct from actor or nullif(trim(new.deletion_reason),'') is null then raise exception 'REVIEW_REASON'; end if;
    new.deleted_at:=now();
    action_name:='REVIEW_RETIRE';
  else
    if new.resource_key is null or new.resource_key::integer not between 1900 and extract(year from current_date)
      or new.uploaded_by is distinct from actor or new.bucket_id is distinct from 'integraq-private'
      or (to_jsonb(new)->>'external_organization_id') is not null or (to_jsonb(new)->>'external_site_id') is not null
      or (to_jsonb(new)->>'process_id') is not null or (to_jsonb(new)->>'resource_id') is not null
      or new.audience::text is distinct from 'internal' or new.deleted_at is not null or new.preview_path is not null
      or new.is_current is distinct from true or new.workspace_id is not null or new.updated_by is distinct from actor and new.updated_by is not null
      or new.object_path is null or split_part(new.object_path,'/',1)<>actor::text
      or split_part(new.object_path,'/',2)<>'attachments' or split_part(new.object_path,'/',3)<>'management-review'
      or split_part(new.object_path,'/',4)<>new.resource_type or split_part(new.object_path,'/',5)<>new.resource_key
      or split_part(new.object_path,'/',6)<>new.id::text or array_length(string_to_array(new.object_path,'/'),1)<>7
      or coalesce(new.original_name,'') !~* '\.(pdf|docx)$' or coalesce(new.mime_type,'') not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream')
      or nullif(trim(new.display_name),'') is null or new.valid_from is null or extract(year from new.valid_from)<>new.resource_key::int
      or coalesce(new.description,'') not in ('En revisión','Finalizada') or coalesce(new.sha256,'') !~ '^[0-9a-f]{64}$'
      or not exists(select 1 from storage.objects o where o.bucket_id=new.bucket_id and o.name=new.object_path and o.owner_id=actor::text
        and (o.metadata->>'size')::bigint=new.size_bytes and new.size_bytes between 1 and 52428800 and o.metadata->>'mimetype'=new.mime_type)
      then raise exception 'REVIEW_OBJECT'; end if;
    if exists(select 1 from public.iq_review_uploads r where r.id=new.id) then raise exception 'REVIEW_RESERVATION'; end if;
    perform pg_advisory_xact_lock(hashtextextended(org::text||new.sha256,1));
    if exists(select 1 from public.file_objects f where f.sha256=new.sha256 and f.resource_type in ('management_review_document','management_review_minutes')
      and public.iq_review_can_read(f.workspace_id,f.uploaded_by)) or exists(select 1 from public.iq_review_uploads r
        where r.organization_id=org and r.payload->>'sha'=new.sha256 and r.result_id is null) then raise exception 'REVIEW_DUPLICATE'; end if;
    select * into prior from public.file_objects f where f.module_id='management-review' and f.resource_type=new.resource_type
      and f.resource_key=new.resource_key and f.is_current and f.deleted_at is null and public.iq_review_can_read(f.workspace_id,f.uploaded_by) for update;
    if prior.id is null and new.replaces_file_id is not null then
      select * into prior from public.file_objects f where f.id=new.replaces_file_id and f.module_id=new.module_id
        and f.resource_type=new.resource_type and f.resource_key=new.resource_key and f.deleted_at is null
        and public.iq_review_can_read(f.workspace_id,f.uploaded_by)
        and not exists(select 1 from public.file_objects successor where successor.replaces_file_id=f.id or
          (successor.id<>f.id and successor.resource_type=f.resource_type and successor.resource_key=f.resource_key
            and successor.category=f.category and successor.version>=f.version and public.iq_review_can_read(successor.workspace_id,successor.uploaded_by)))
        for update;
    end if;
    if prior.id is distinct from new.replaces_file_id or new.version is distinct from coalesce(prior.version,0)+1
      then raise exception 'REVIEW_CHANGED'; end if;
    if prior.id is not null then
      new.category:=prior.category;
      update public.file_objects set is_current=false,updated_by=actor,updated_at=clock_timestamp() where id=prior.id;
    end if;
    new.workspace_id:=org;
    action_name:=case when prior.id is null then 'REVIEW_ADD' else 'REVIEW_REPLACE' end;
  end if;
  new.updated_by:=actor;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata,reason)
    values(actor,org,'management-review',action_name,new.resource_type,new.id::text,jsonb_build_object('client','RE-02','previous',new.replaces_file_id),new.deletion_reason);
  return new;
end $$;
revoke all on function public.iq_review_legacy_minutes() from public,anon,authenticated;
create trigger iq_review_legacy_insert before insert on public.file_objects for each row
 when (current_user='authenticated' and new.resource_type='management_review_minutes') execute function public.iq_review_legacy_minutes();
create trigger iq_review_legacy_update before update on public.file_objects for each row
 when (current_user='authenticated' and (old.resource_type='management_review_minutes' or new.resource_type='management_review_minutes')) execute function public.iq_review_legacy_minutes();

-- Restricciones adicionales, exclusivamente para ambos recursos de la revisión.
create policy iq_review_file_read on public.file_objects as restrictive for select to authenticated
using (resource_type is null or resource_type not in ('management_review_minutes','management_review_document') or
  (module_id='management-review' and public.iq_review_can_read(workspace_id,uploaded_by)
   and (deleted_at is null or public.is_administrator())));
create policy iq_review_file_insert on public.file_objects as restrictive for insert to authenticated
with check (resource_type is distinct from 'management_review_document' and (resource_type is distinct from 'management_review_minutes' or (public.is_administrator() and public.iq_review_can_read(workspace_id,uploaded_by))));
create policy iq_review_file_update on public.file_objects as restrictive for update to authenticated
using (resource_type is distinct from 'management_review_document' and (resource_type is distinct from 'management_review_minutes' or (public.is_administrator() and public.iq_review_can_read(workspace_id,uploaded_by))))
with check (resource_type is distinct from 'management_review_document' and (resource_type is distinct from 'management_review_minutes' or (public.is_administrator() and public.iq_review_can_read(workspace_id,uploaded_by))));
create policy iq_review_file_delete on public.file_objects as restrictive for delete to authenticated
using (resource_type is null or resource_type not in ('management_review_minutes','management_review_document'));

-- RE-02 may clean up its own failed legacy upload. Check references across organizations
-- even if the original uploader has since moved to another organization.
create function public.iq_review_unused_legacy_path(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_administrator() and split_part(p_path,'/',1)=auth.uid()::text
    and split_part(p_path,'/',2)='attachments' and split_part(p_path,'/',3)='management-review'
    and split_part(p_path,'/',4)='management_review_minutes' and split_part(p_path,'/',5) ~ '^[0-9]{4}$'
    and not exists(select 1 from public.file_objects f where f.bucket_id='integraq-private' and (f.object_path=p_path or f.preview_path=p_path));
$$;
revoke all on function public.iq_review_unused_legacy_path(text) from public,anon;
grant execute on function public.iq_review_unused_legacy_path(text) to authenticated;

create policy iq_review_original_read on storage.objects as restrictive for select to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document')
  or (owner_id=auth.uid()::text and public.iq_review_unused_legacy_path(name))
  or exists(select 1 from public.iq_review_uploads r where r.object_path=objects.name and r.result_id is null)
  or exists(select 1 from public.file_objects f where f.bucket_id=objects.bucket_id and (f.object_path=objects.name or f.preview_path=objects.name)
     and f.resource_type in ('management_review_minutes','management_review_document')));
create policy iq_review_original_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document')
  or (public.is_administrator() and split_part(name,'/',1)=auth.uid()::text and
    ((split_part(name,'/',4)='management_review_minutes' and split_part(name,'/',5) ~ '^[0-9]{4}$') or
      exists(select 1 from public.iq_review_uploads r where r.object_path=objects.name and r.result_id is null))));
create policy iq_review_original_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document')
  or (owner_id=auth.uid()::text and public.iq_review_unused_legacy_path(name)));
create policy iq_review_original_update on storage.objects as restrictive for update to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document'));

create function public.iq_review_periods() returns setof integer
language sql stable security invoker set search_path='' as $$
  select distinct split_part(resource_key,':',1)::integer from public.file_objects
  where module_id='management-review' and resource_type in ('management_review_minutes','management_review_document')
    and split_part(resource_key,':',1) ~ '^[0-9]{4}$'
  union select split_part(resource_key,':',1)::integer from public.iq_review_uploads where result_id is null;
$$;
revoke all on function public.iq_review_periods() from public,anon;
grant execute on function public.iq_review_periods() to authenticated;

-- El identificador de la revisión anterior y su marca de actualización protegen las ediciones concurrentes.
create function public.iq_review_write(p_action text, p_type text, p_key text, p_previous uuid, p_expected timestamptz, p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  org uuid;
  prev public.file_objects%rowtype;
  reservation public.iq_review_uploads%rowtype;
  target uuid;
  obj text;
  object_meta jsonb;
  category_name text := p_data->>'category';
  title text := nullif(trim(p_data->>'title'),'');
  responsible text := nullif(trim(p_data->>'responsible'),'');
  section_name text := nullif(p_data->>'section','');
  note text := coalesce(p_data->>'notes','');
  reason text := nullif(trim(p_data->>'reason'),'');
begin
  select organization_id into org from public.profiles where id=actor and status='active';
  if not public.is_administrator() or org is null then raise exception 'REVIEW_DENIED'; end if;
  if p_action is null or p_action not in ('add','replace','edit','retire')
     or p_type is null or p_type not in ('management_review_minutes','management_review_document')
     or p_key is null or (p_type='management_review_minutes' and p_key !~ '^[0-9]{4}$')
     or (p_type='management_review_document' and p_key !~ '^[0-9]{4}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     then raise exception 'REVIEW_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||p_type||p_key,0));
  if split_part(p_key,':',1)::integer not between 1900 and extract(year from current_date) then raise exception 'REVIEW_INVALID'; end if;
  if p_action in ('add','replace') then
    select * into reservation from public.iq_review_uploads as r where r.id=(p_data->>'id')::uuid and r.actor=auth.uid() and r.organization_id=org for update;
    if not found or not reservation.verified or reservation.payload is distinct from p_data or reservation.resource_type<>p_type
      or reservation.resource_key<>p_key or reservation.previous_id is distinct from p_previous
      or reservation.expected_at is distinct from p_expected or (p_action='add')<>(p_previous is null)
      then raise exception 'REVIEW_RESERVATION'; end if;
    if reservation.result_id is not null then return reservation.result_id; end if;
  end if;
  if p_action='add' then
    if p_previous is not null or exists(select 1 from public.file_objects f where f.module_id='management-review'
      and f.resource_type=p_type and f.resource_key=p_key and public.iq_review_can_read(f.workspace_id,f.uploaded_by)
      and (p_type='management_review_document' or (f.is_current and f.deleted_at is null))) then raise exception 'REVIEW_CHANGED'; end if;
  else
    select * into prev from public.file_objects f where f.id=p_previous and f.module_id='management-review'
      and f.resource_type=p_type and f.resource_key=p_key and f.deleted_at is null and f.is_current
      and public.iq_review_can_read(f.workspace_id,f.uploaded_by) for update;
    if not found or prev.updated_at is distinct from p_expected then raise exception 'REVIEW_CHANGED'; end if;
  end if;
  if p_action='retire' then
    if reason is null then raise exception 'REVIEW_REASON'; end if;
    update public.file_objects f set deleted_at=now(),deleted_by=actor,deletion_reason=reason,is_current=false,updated_by=actor,updated_at=clock_timestamp()
      where f.module_id='management-review' and f.resource_type=p_type and f.resource_key=p_key
      and f.deleted_at is null and public.iq_review_can_read(f.workspace_id,f.uploaded_by)
      and (p_type='management_review_document' or f.id=p_previous);
    target:=p_previous;
  else
    if title is null or responsible is null or nullif(p_data->>'date','') is null then raise exception 'REVIEW_METADATA'; end if;
    if p_type='management_review_document' then
      if category_name is null or category_name not in ('presentations','inputs','reports','support','improvements','other')
        or (section_name is not null and section_name not in ('manual','policy','risks','objectives','organization','processes','customers','suppliers','audits','actions','improvement','satisfaction','history','outputs','attachments'))
        then raise exception 'REVIEW_METADATA'; end if;
    else
      if extract(year from (p_data->>'date')::date) <> p_key::integer then raise exception 'REVIEW_METADATA'; end if;
      if p_action in ('add','replace') and not (
        (lower(p_data->>'name') like '%.pdf' and p_data->>'mime'='application/pdf') or
        (lower(p_data->>'name') like '%.docx' and p_data->>'mime'='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ) then raise exception 'REVIEW_OBJECT'; end if;
      category_name:=coalesce(prev.category,'evidence:'||gen_random_uuid()::text);
      if note not in ('Finalizada','En revisión') then raise exception 'REVIEW_METADATA'; end if;
    end if;
    if p_action='edit' then
      update public.file_objects set display_name=title,valid_from=(p_data->>'date')::date,description=note,
        observations=responsible,reference_type=section_name,category=category_name,updated_by=actor,updated_at=clock_timestamp() where id=p_previous;
      target:=p_previous;
    else
      target:=(p_data->>'id')::uuid;
      obj:=p_data->>'path';
      if target is null or obj is null or array_length(string_to_array(obj,'/'),1)<>7 or
        split_part(obj,'/',1)<>actor::text or split_part(obj,'/',2)<>'attachments' or
        split_part(obj,'/',3)<>'management-review' or split_part(obj,'/',4)<>p_type or
        split_part(obj,'/',5)<>('r1-'||replace(p_key,':','-')) or split_part(obj,'/',6)<>target::text or
        nullif(p_data->>'name','') is null or coalesce(p_data->>'sha','') !~ '^[0-9a-f]{64}$' then raise exception 'REVIEW_OBJECT'; end if;
      select metadata into object_meta from storage.objects where bucket_id='integraq-private' and name=obj and owner_id=actor::text;
      if not found or coalesce((object_meta->>'size')::bigint,0) not between 1 and 52428800
        or (object_meta->>'size')::bigint is distinct from (p_data->>'size')::bigint
        or (object_meta->>'mimetype') is distinct from (p_data->>'mime') then raise exception 'REVIEW_OBJECT'; end if;
      perform pg_advisory_xact_lock(hashtextextended(org::text||(p_data->>'sha'),1));
      if exists(select 1 from public.file_objects f where f.sha256=p_data->>'sha'
        and f.resource_type in ('management_review_minutes','management_review_document')
        and public.iq_review_can_read(f.workspace_id,f.uploaded_by)) then raise exception 'REVIEW_DUPLICATE'; end if;
      if p_action='replace' then
        update public.file_objects set is_current=false,updated_by=actor,updated_at=clock_timestamp() where id=p_previous;
      end if;
      insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,
        workspace_id,audience,resource_type,resource_key,category,version,is_current,replaces_file_id,preview_status,
        uploaded_by,updated_by,display_name,valid_from,description,observations,reference_type)
      values(target,'integraq-private',obj,p_data->>'name',p_data->>'mime',(p_data->>'size')::bigint,p_data->>'sha',
        'management-review',org,'internal',p_type,p_key,category_name,coalesce(prev.version,0)+1,true,p_previous,
        case when p_data->>'mime'='application/pdf' or p_data->>'mime' like 'image/%' then 'not_required' else 'pending' end,
        actor,actor,title,(p_data->>'date')::date,note,responsible,section_name);
    end if;
  end if;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata,reason)
    values(actor,org,'management-review','REVIEW_'||upper(p_action),p_type,target::text,
      jsonb_build_object('key',p_key,'previous',p_previous,'title',title,'category',category_name),reason);
  if reservation.id is not null then
    update public.iq_review_uploads set result_id=target where id=reservation.id;
  end if;
  return target;
end $$;
revoke all on function public.iq_review_write(text,text,text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.iq_review_write(text,text,text,uuid,timestamptz,jsonb) to authenticated;
commit;
