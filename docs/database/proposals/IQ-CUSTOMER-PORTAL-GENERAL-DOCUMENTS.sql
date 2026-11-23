-- Complemento local para U01. La audiencia se declara en la publicación.
begin;
alter table public.customer_portal_document_publications
  add column publication_scope text not null default 'individual',
  alter column customer_id drop not null,
  add constraint customer_portal_explicit_audience check (
    (publication_scope='individual' and customer_id is not null) or
    (publication_scope='general' and customer_id is null));
create unique index customer_portal_general_current_version
  on public.customer_portal_document_publications(workspace_id,document_key)
  where publication_scope='general' and status='published';

-- La bitácora de gestión general no inventa una empresa destinataria.
-- En una consulta por enlace se sigue registrando la empresa que accedió.
alter table public.customer_portal_document_events alter column customer_id drop not null,
  add check (portal_link_id is null or customer_id is not null);

create or replace function public.iq_customer_portal_document_record_scoped(
 p_scope text,
 p_actor_id uuid,p_workspace_id uuid,p_customer_id uuid,p_object_path text,p_original_name text,
 p_display_name text,p_description text,p_size_bytes bigint,p_sha256 text,p_mime_type text,p_previous_publication_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare actor public.profiles%rowtype; publication public.customer_portal_document_publications%rowtype; parent public.customer_portal_document_publications%rowtype; file_audience public.file_objects.audience%type; v_file_id uuid; v_document_key uuid; v_version integer;
begin
 select * into actor from public.profiles where id=p_actor_id and status='active' and user_type='administrator' and organization_id=p_workspace_id;
 if not found then raise exception 'CUSTOMER_PORTAL_ADMIN_REQUIRED'; end if;
 if p_scope='individual' then
   perform 1 from public.organizations where id=p_customer_id and kind='customer' and active and owning_organization_id=p_workspace_id;
   if not found then raise exception 'CUSTOMER_PORTAL_CUSTOMER_SCOPE'; end if;
 elsif p_scope is distinct from 'general' or p_customer_id is not null then
   raise exception 'CUSTOMER_PORTAL_CUSTOMER_SCOPE';
 end if;
 if p_scope='general' then file_audience:='internal'; else file_audience:='customer'; end if;
 v_document_key:=gen_random_uuid(); v_version:=1;
 if p_previous_publication_id is not null then
   select * into parent from public.customer_portal_document_publications where id=p_previous_publication_id and workspace_id=p_workspace_id and publication_scope=p_scope and customer_id is not distinct from p_customer_id and status='published' for update;
   if not found then raise exception 'CUSTOMER_PORTAL_VERSION_PARENT_INVALID'; end if;
   v_document_key:=parent.document_key; v_version:=parent.version+1;
 end if;
 if p_object_path !~ ('^customer-portal/'||p_workspace_id::text||'/'||coalesce(p_customer_id::text,'general')||'/[0-9a-f-]+[.]pdf$')
    or p_mime_type<>'application/pdf' or p_size_bytes<=0 or p_size_bytes>26214400 or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CUSTOMER_PORTAL_FILE_INVALID'; end if;
 insert into public.customer_portal_document_publications(publication_scope,workspace_id,customer_id,document_key,previous_publication_id,display_name,description,version,created_by)
 values(p_scope,p_workspace_id,p_customer_id,v_document_key,p_previous_publication_id,p_display_name,p_description,v_version,p_actor_id) returning * into publication;
 insert into public.file_objects(bucket_id,object_path,original_name,mime_type,size_bytes,sha256,workspace_id,external_organization_id,audience,resource_type,resource_id,uploaded_by,display_name)
 values('integraq-private',p_object_path,p_original_name,p_mime_type,p_size_bytes,p_sha256,p_workspace_id,p_customer_id,file_audience,'customer_portal_document',publication.id,p_actor_id,p_display_name)
 returning id into v_file_id;
 update public.customer_portal_document_publications set file_id=v_file_id where id=publication.id returning * into publication;
 insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,after_value)
 values(publication.id,p_workspace_id,p_customer_id,p_actor_id,'draft_created',to_jsonb(publication));
 return to_jsonb(publication);
end $fn$;

create or replace function public.iq_customer_portal_document_transition_scoped(
 p_scope text,p_actor_id uuid,p_workspace_id uuid,p_publication_id uuid,p_action text,p_reason text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare actor public.profiles%rowtype; item public.customer_portal_document_publications%rowtype; old_item public.customer_portal_document_publications%rowtype; before_value jsonb; old_before jsonb;
begin
 select * into actor from public.profiles where id=p_actor_id and status='active' and user_type='administrator' and organization_id=p_workspace_id;
 if not found then raise exception 'CUSTOMER_PORTAL_ADMIN_REQUIRED'; end if;
 select * into item from public.customer_portal_document_publications where id=p_publication_id and workspace_id=p_workspace_id and publication_scope=p_scope for update;
 if not found then raise exception 'CUSTOMER_PORTAL_PUBLICATION_NOT_FOUND'; end if;
 if item.revision is distinct from p_expected_revision then raise exception 'CUSTOMER_PORTAL_REVISION_CONFLICT'; end if;
 if p_action='publish' and item.status='draft' then
   if item.publication_scope='individual' and not exists(select 1 from public.organizations where id=item.customer_id and kind='customer' and active and owning_organization_id=item.workspace_id) then raise exception 'CUSTOMER_PORTAL_CUSTOMER_SCOPE'; end if;
   for old_item in select * from public.customer_portal_document_publications where workspace_id=item.workspace_id and publication_scope=item.publication_scope and customer_id is not distinct from item.customer_id and document_key=item.document_key and status='published' and id<>item.id for update loop
     old_before:=to_jsonb(old_item);
     update public.customer_portal_document_publications set status='superseded',revision=revision+1 where id=old_item.id returning * into old_item;
     insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,reason,before_value,after_value)
       values(old_item.id,p_workspace_id,old_item.customer_id,p_actor_id,'superseded','Sustituido por una versión posterior',old_before,to_jsonb(old_item));
   end loop;
   before_value:=to_jsonb(item); update public.customer_portal_document_publications set status='published',published_by=p_actor_id,published_at=now(),revision=revision+1 where id=item.id returning * into item;
 elsif p_action='withdraw' and item.status='published' and length(trim(coalesce(p_reason,'')))>0 then
   before_value:=to_jsonb(item); update public.customer_portal_document_publications set status='withdrawn',withdrawn_by=p_actor_id,withdrawn_at=now(),withdrawal_reason=trim(p_reason),revision=revision+1 where id=item.id returning * into item;
 else raise exception 'CUSTOMER_PORTAL_TRANSITION_INVALID'; end if;
 insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,reason,before_value,after_value)
 values(item.id,p_workspace_id,item.customer_id,p_actor_id,item.status,p_reason,before_value,to_jsonb(item));
 return to_jsonb(item);
end $fn$;

create or replace function public.iq_customer_portal_document_record(
 p_actor_id uuid,p_workspace_id uuid,p_customer_id uuid,p_object_path text,p_original_name text,
 p_display_name text,p_description text,p_size_bytes bigint,p_sha256 text,p_mime_type text,p_previous_publication_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select public.iq_customer_portal_document_record_scoped('individual',p_actor_id,p_workspace_id,p_customer_id,p_object_path,p_original_name,p_display_name,p_description,p_size_bytes,p_sha256,p_mime_type,p_previous_publication_id);
$$;

create or replace function public.iq_customer_portal_document_transition(
 p_actor_id uuid,p_workspace_id uuid,p_publication_id uuid,p_action text,p_reason text,p_expected_revision integer
) returns jsonb language sql security invoker set search_path='' as $$
 select public.iq_customer_portal_document_transition_scoped('individual',p_actor_id,p_workspace_id,p_publication_id,p_action,p_reason,p_expected_revision);
$$;
revoke all on function public.iq_customer_portal_document_record_scoped(text,uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid) from public,anon,authenticated;
revoke all on function public.iq_customer_portal_document_transition_scoped(text,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.iq_customer_portal_document_record_scoped(text,uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid) to service_role;
grant execute on function public.iq_customer_portal_document_transition_scoped(text,uuid,uuid,uuid,text,text,integer) to service_role;

commit;
