begin;

-- Historical action participants have no grant of their own. The current plan
-- is both the assignment and its authorization, committed in the same update.
create or replace function public.sync_corrective_action_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'corrective_actions' then
    if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id
      and old.owner_id is not null then
      delete from public.corrective_action_participants
      where corrective_action_id = new.id
        and profile_id = old.owner_id
        and participant_role = 'owner';
    end if;
    if new.owner_id is not null then
      insert into public.corrective_action_participants (
        corrective_action_id, profile_id, participant_role, assigned_by
      ) values (
        new.id, new.owner_id, 'owner', coalesce(auth.uid(), new.created_by)
      ) on conflict do nothing;
    end if;
  elsif new.owner_id is not null and exists (
    select 1 from public.corrective_actions a
    where a.id = new.corrective_action_id and a.source = 'supplier'
  ) then
    insert into public.corrective_action_participants (
      corrective_action_id, profile_id, participant_role, assigned_by
    ) values (
      new.corrective_action_id,
      new.owner_id,
      'action',
      coalesce(auth.uid(), new.owner_id)
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.can_access_corrective_action(requested_action_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.corrective_actions action
    where action.id = requested_action_id
      and (action.source = 'supplier' or not public.is_internal_user() or exists (
        select 1 from public.profiles u where u.id=auth.uid() and u.status='active'
          and u.workspace_mode='production' and u.organization_id=action.organization_id
      ))
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('corrective-actions', 'view')
          and (
            action.owner_id = auth.uid()
            or action.created_by = auth.uid()
            or exists (
              select 1 from public.corrective_action_participants participant
              where participant.corrective_action_id = action.id
                and participant.profile_id = auth.uid()
                and (action.source = 'supplier' or participant.participant_role in ('analysis','effectiveness','viewer'))
            )
          )
        )
        or (
          action.source = 'customer'
          and action.portal_visible
          and public.has_external_organization_scope('customer', action.external_organization_id)
          and public.has_permission('portal_clientes.acceder', null, null, null, null, false, action.external_organization_id)
        )
      )
  );
$$;

-- SELECT-only scope. Process visibility must never become a general write grant.
create function public.iq_u08_read_case(p_action uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.corrective_actions a join public.profiles u on u.organization_id=a.organization_id
    where a.id=p_action and a.source<>'supplier' and a.deleted_at is null and u.id=auth.uid()
      and u.status='active' and u.workspace_mode='production' and u.user_type in ('internal','administrator')
      and (u.user_type='administrator' or (public.has_module_permission('corrective-actions','view') and
        (a.process_id is null or public.has_process_access(a.process_id) or public.can_access_corrective_action(a.id))))
  )
$$;
revoke all on function public.iq_u08_read_case(uuid) from public,anon;
grant execute on function public.iq_u08_read_case(uuid) to authenticated;

-- PostgREST computed filter: the list requires the same live check as the PDF.
create function public.iq_u08_case_visible(public.corrective_actions) returns boolean
language sql stable security invoker set search_path='' as $$
  select public.iq_u08_read_case($1.id)
$$;
revoke all on function public.iq_u08_case_visible(public.corrective_actions) from public,anon;
grant execute on function public.iq_u08_case_visible(public.corrective_actions) to authenticated;

create policy iq_u08_case_read on public.corrective_actions for select to authenticated
using (public.iq_u08_read_case(id));
create policy iq_u08_analysis_read on public.corrective_action_a3 for select to authenticated
using (public.iq_u08_read_case(corrective_action_id));
create policy iq_u08_plans_read on public.corrective_action_plans for select to authenticated
using (public.iq_u08_read_case(corrective_action_id));

-- A permissive ALL policy also participates in SELECT. Bound every such
-- path, while leaving supplier and independently authorized external reads alone.
create function public.iq_u08_case_read_bound(p_action uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.corrective_actions a where a.id=p_action and
      (a.source='supplier' or public.iq_u08_read_case(a.id) or
        (not exists (select 1 from public.profiles u where u.id=auth.uid() and u.user_type in ('administrator','internal'))
         and public.can_access_corrective_action(a.id)))
  )
$$;
revoke all on function public.iq_u08_case_read_bound(uuid) from public,anon;
grant execute on function public.iq_u08_case_read_bound(uuid) to authenticated;
create policy iq_u08_case_bound on public.corrective_actions as restrictive for select to authenticated
using (public.iq_u08_case_read_bound(id));
create policy iq_u08_analysis_bound on public.corrective_action_a3 as restrictive for select to authenticated
using (public.iq_u08_case_read_bound(corrective_action_id));
create policy iq_u08_plans_bound on public.corrective_action_plans as restrictive for select to authenticated
using (public.iq_u08_case_read_bound(corrective_action_id));

-- Participation and effectiveness histories are also directly queryable.
create policy iq_u08_participants_bound on public.corrective_action_participants as restrictive for select to authenticated
using (public.iq_u08_case_read_bound(corrective_action_id));
create policy iq_u08_effectiveness_bound on public.corrective_action_effectiveness_reviews as restrictive for select to authenticated
using (public.iq_u08_case_read_bound(corrective_action_id));

-- Cross-process assignees use the projection in iq_u08_plan_queue. For files
-- they may read just the evidence of their own current, non-cancelled plan.
create or replace function public.iq_root2cause_evidence_access(p_key text,p_process text default null,p_write boolean default false,p_uploader uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; item jsonb; scope_id text; section_kind text; section_id text; case_process text; matched_ids uuid[]; target public.corrective_actions%rowtype;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active' and workspace_mode='production' and user_type in ('administrator','internal');
 if actor.id is null or actor.organization_id is null or not public.has_module_permission('corrective-actions','view') then return false; end if;
 if p_write and (actor.user_type<>'administrator' or not public.has_module_permission('corrective-actions','create')) then return false; end if;
 if p_uploader is not null and not exists(select 1 from public.profiles p where p.id=p_uploader and p.organization_id=actor.organization_id) then return false; end if;
 if p_key !~ '^[a-f0-9-]{36}_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$' then return false; end if;
 scope_id:=split_part(p_key,'_',1); section_kind:=split_part(p_key,'_',2); section_id:=split_part(p_key,'_',3);
 -- Resolve finalized cases first. A finalized draft or a cached workspace entry
 -- cannot revive access to a retired case or a former assignment.
 select array_agg(a.id) into matched_ids
 from public.corrective_actions a join public.corrective_action_a3 d on d.corrective_action_id=a.id
 where a.organization_id=actor.organization_id and
   (a.id::text=scope_id or d.workflow_metadata->>'evidenceId'=scope_id);
 if matched_ids is not null then
   if cardinality(matched_ids)<>1 then return false; end if;
   select * into strict target from public.corrective_actions where id=matched_ids[1];
   if target.deleted_at is not null or target.source='supplier' or target.process_id is null
      or (p_process is not null and p_process<>target.process_id)
      or (p_write and target.status='closed') then return false; end if;
   if section_kind='step' then return public.iq_u08_read_case(target.id); end if;
   return exists (
     select 1 from public.corrective_action_plans plan where plan.corrective_action_id=target.id and plan.id::text=section_id
       and (public.iq_u08_read_case(target.id) or
         (not p_write and target.status<>'closed' and plan.status<>'cancelled' and plan.owner_id=actor.id))
   );
 end if;
 if exists(select 1 from public.root2cause_drafts d where d.id=scope_id::uuid and d.organization_id=actor.organization_id and d.status='draft'
   and d.source<>'supplier' and d.process_id is not null and d.process_id=p_process and public.has_process_access(d.process_id)
   and (actor.user_type='administrator' or d.created_by=actor.id or public.has_process_access(d.process_id))
   and (not p_write or (actor.user_type='administrator' and public.has_module_permission('corrective-actions','create')
     and (d.status='draft' or exists(select 1 from public.corrective_actions ca where ca.id=d.id and ca.organization_id=actor.organization_id and ca.deleted_at is null and ca.status<>'closed'))))
   and (section_kind='step' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload#>'{draft,plans}')='array' then d.payload#>'{draft,plans}' else '[]'::jsonb end) x where x->>'id'=section_id))) then return true; end if;
 for item in select v from public.workspace_data w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload)='array' then w.payload else '[]'::jsonb end) v
   where w.workspace_id=actor.organization_id and w.workspace_mode=public.current_workspace_mode() and w.area='correctiveActions' and w.deleted_at is null loop
  if item#>>'{a3,evidenceId}'=scope_id and item->>'source'<>'supplier' then
   case_process:=item->>'processId'; if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
   if p_write and item->>'status'='closed' then return false; end if;
   if actor.user_type<>'administrator' and coalesce(item->>'ownerId','')<>actor.id::text and not (coalesce(item->'participantUserIds','[]'::jsonb) ? actor.id::text) then return false; end if;
   if section_kind='step' then return true; end if;
   return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item#>'{a3,plans}')='array' then item#>'{a3,plans}' else '[]'::jsonb end) v where v->>'id'=section_id);
  end if;
 end loop;
 select payload->'draft' into item from public.workspace_data where workspace_id=actor.organization_id and workspace_mode=public.current_workspace_mode() and area='a3Draft' and deleted_at is null;
 if actor.user_type='administrator' and item->>'evidenceId'=scope_id then
  case_process:=item->>'processId'; if case_process is null or (p_process is not null and p_process<>case_process) or not public.has_process_access(case_process) then return false; end if;
  if section_kind='step' then return true; end if;
  return exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item->'plans')='array' then item->'plans' else '[]'::jsonb end) v where v->>'id'=section_id);
 end if;
 return false;
end $$;
revoke all on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) from public,anon;
grant execute on function public.iq_root2cause_evidence_access(text,text,boolean,uuid) to authenticated;

-- The same predicates apply to metadata, originals and previews. Use an
-- organization match even for legacy duplicate evidence keys across tenants.
create function public.iq_u08_read_file(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.file_objects f join public.profiles u on u.organization_id=f.workspace_id
    where f.id=p_id and u.id=auth.uid() and u.status='active' and u.workspace_mode='production'
      and u.user_type in ('administrator','internal') and f.deleted_at is null
      and f.bucket_id='integraq-private' and f.audience='internal' and f.module_id='corrective-actions'
      and case f.resource_type
        when 'root2cause_official_pdf' then public.iq_u08_read_case(f.resource_id)
        when 'root2cause_evidence' then f.process_id is not null and
          public.iq_root2cause_evidence_access(f.resource_key,f.process_id,false,f.uploaded_by)
        else false end
  )
$$;
revoke all on function public.iq_u08_read_file(uuid) from public,anon;
grant execute on function public.iq_u08_read_file(uuid) to authenticated;

create policy iq_u08_files_read on public.file_objects for select to authenticated
using (resource_type in ('root2cause_evidence','root2cause_official_pdf') and public.iq_u08_read_file(id));
create policy iq_u08_files_bound on public.file_objects as restrictive for select to authenticated
using (resource_type not in ('root2cause_evidence','root2cause_official_pdf') or resource_type is null or public.iq_u08_read_file(id));

-- Return NULL for unrelated objects so existing Storage policies retain control.
create function public.iq_u08_read_object(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_bucket='integraq-private' then coalesce((
    select case when bool_or(f.resource_type in ('root2cause_evidence','root2cause_official_pdf')) then
      bool_and(public.iq_u08_read_file(f.id) and
        (p_path not like 'root2cause-official-pdf/%' or f.resource_type='root2cause_official_pdf') and
        (p_path not like '%/attachments/corrective-actions/root2cause_evidence/%' or f.resource_type='root2cause_evidence'))
      end from public.file_objects f
    where f.bucket_id=p_bucket and (f.object_path=p_path or f.preview_path=p_path)
  ),case when p_path like 'root2cause-official-pdf/%' or
     p_path like '%/attachments/corrective-actions/root2cause_evidence/%' then false end) end
$$;
revoke all on function public.iq_u08_read_object(text,text) from public,anon;
grant execute on function public.iq_u08_read_object(text,text) to authenticated;
create policy iq_u08_storage_bound on storage.objects as restrictive for select to authenticated
using (public.iq_u08_read_object(bucket_id,name) is distinct from false);
create policy iq_u08_storage_read on storage.objects for select to authenticated
using (public.iq_u08_read_object(bucket_id,name) is true);
-- Some deployments also carry the older restrictive tenant filters. Keep
-- their existing predicate for every row and admit the same narrowly scoped
-- reads as the new restrictive policies. Never alter unrelated policies.
do $policies$
declare item record; previous_predicate text;
begin
  for item in select * from (values
    ('public.corrective_actions'::regclass,'iq_root2cause_actions_tenant_select','public.iq_u08_read_case(id)'),
    ('public.corrective_action_a3'::regclass,'iq_root2cause_a3_tenant_select','public.iq_u08_read_case(corrective_action_id)'),
    ('public.corrective_action_plans'::regclass,'iq_root2cause_plans_tenant_select','public.iq_u08_read_case(corrective_action_id)'),
    ('public.corrective_action_participants'::regclass,'iq_root2cause_participants_tenant_select','public.iq_u08_read_case(corrective_action_id)'),
    ('public.corrective_action_effectiveness_reviews'::regclass,'iq_root2cause_effectiveness_tenant_select','public.iq_u08_read_case(corrective_action_id)'),
    ('public.file_objects'::regclass,'iq_root2cause_files_tenant_select','public.iq_u08_read_file(id)'),
    ('storage.objects'::regclass,'iq_root2cause_storage_tenant_select','public.iq_u08_read_object(bucket_id,name) is true'),
    ('storage.objects'::regclass,'root2cause_storage_read_guard','public.iq_u08_read_object(bucket_id,name) is true')
  ) as guards(relation,policy_name,live_predicate) loop
    select pg_get_expr(polqual,polrelid) into previous_predicate from pg_catalog.pg_policy
      where polrelid=item.relation and polname=item.policy_name and not polpermissive and polcmd='r';
    if found then
      execute format('alter policy %I on %s using ((%s) or (%s))',
        item.policy_name,item.relation,previous_predicate,item.live_predicate);
    end if;
  end loop;
end
$policies$;

-- Superseded PDF SELECT guards used the legacy multi-purpose write predicate.
-- The stricter object and metadata guards above now include independent read grants.
drop policy if exists root2cause_official_pdf_select_guard on public.file_objects;
drop policy if exists root2cause_official_pdf_storage_read_guard on storage.objects;
commit;
