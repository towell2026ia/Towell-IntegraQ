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

-- Restricciones adicionales, exclusivamente para ambos recursos de la revisión.
create policy iq_review_file_read on public.file_objects as restrictive for select to authenticated
using (resource_type is null or resource_type not in ('management_review_minutes','management_review_document') or
  (module_id='management-review' and public.iq_review_can_read(workspace_id,uploaded_by)
   and (deleted_at is null or public.is_administrator())));
create policy iq_review_file_insert on public.file_objects as restrictive for insert to authenticated
with check (resource_type is null or resource_type not in ('management_review_minutes','management_review_document'));
create policy iq_review_file_update on public.file_objects as restrictive for update to authenticated
using (resource_type is null or resource_type not in ('management_review_minutes','management_review_document'))
with check (resource_type is null or resource_type not in ('management_review_minutes','management_review_document'));
create policy iq_review_file_delete on public.file_objects as restrictive for delete to authenticated
using (resource_type is null or resource_type not in ('management_review_minutes','management_review_document'));

create policy iq_review_original_read on storage.objects as restrictive for select to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document')
  or exists(select 1 from public.file_objects f where f.bucket_id=objects.bucket_id and (f.object_path=objects.name or f.preview_path=objects.name)
     and f.resource_type in ('management_review_minutes','management_review_document')));
create policy iq_review_original_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document')
  or (public.is_administrator() and split_part(name,'/',1)=auth.uid()::text));
create policy iq_review_original_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document'));
create policy iq_review_original_update on storage.objects as restrictive for update to authenticated
using (bucket_id<>'integraq-private' or split_part(name,'/',2)<>'attachments' or split_part(name,'/',3)<>'management-review'
  or split_part(name,'/',4) not in ('management_review_minutes','management_review_document'));

create function public.iq_review_periods() returns setof integer
language sql stable security invoker set search_path='' as $$
  select distinct split_part(resource_key,':',1)::integer from public.file_objects
  where module_id='management-review' and resource_type in ('management_review_minutes','management_review_document')
    and split_part(resource_key,':',1) ~ '^[0-9]{4}$';
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
  if p_action in ('add','replace') and exists(select 1 from public.file_objects f
      where f.id=(p_data->>'id')::uuid and f.resource_type=p_type and f.resource_key=p_key
      and f.workspace_id=org and f.uploaded_by=actor and f.object_path=p_data->>'path' and f.sha256=p_data->>'sha'
      and f.replaces_file_id is not distinct from p_previous and f.deleted_at is null
      and f.display_name=title and f.observations=responsible and f.valid_from=(p_data->>'date')::date
      and f.description=note and (p_type='management_review_minutes' or (f.category=category_name and f.reference_type is not distinct from section_name))) then
    return (p_data->>'id')::uuid;
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
        split_part(obj,'/',5)<>replace(p_key,':','-') or split_part(obj,'/',6)<>target::text or
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
  return target;
end $$;
revoke all on function public.iq_review_write(text,text,text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.iq_review_write(text,text,text,uuid,timestamptz,jsonb) to authenticated;
commit;
