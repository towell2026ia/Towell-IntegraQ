-- IQ-PRD-PROV-05: resultados estructurados de auditorías y evaluaciones con archivo fuente privado.

begin;

insert into public.file_upload_policies(resource_type, max_size_bytes, allowed_mime_types)
values (
  'supplier_assessment_source',
  20971520,
  array[
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (resource_type) do update set
  max_size_bytes = excluded.max_size_bytes,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

create table public.supplier_assessments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.organizations(id) on delete restrict,
  site_id uuid references public.external_company_sites(id) on delete restrict,
  assessment_type text not null check (assessment_type in (
    'supplier_audit', 'semiannual_evaluation', 'annual_evaluation', 'quality_evaluation', 'other'
  )),
  assessment_date date not null,
  evaluator_name text,
  score numeric check (score is null or score between 0 and 100),
  classification text,
  observations text,
  source_file_id uuid unique references public.file_objects(id) on delete restrict,
  portal_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_assessments_history_idx
  on public.supplier_assessments(supplier_id, site_id, assessment_date desc);
create index supplier_assessments_type_idx
  on public.supplier_assessments(assessment_type, assessment_date desc);

create trigger supplier_assessments_set_updated_at
before update on public.supplier_assessments
for each row execute function public.set_updated_at();
create trigger supplier_assessments_validate_site
before insert or update of supplier_id, site_id on public.supplier_assessments
for each row execute function public.validate_external_company_site();

create or replace function public.can_access_supplier_assessment(requested_assessment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.supplier_assessments assessment
    where assessment.id = requested_assessment_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('suppliers', 'view')
          and public.has_permission('proveedores.acceder')
          and public.has_permission('proveedores.ver')
        )
        or (
          assessment.portal_visible
          and public.has_external_organization_scope('supplier', assessment.supplier_id)
          and public.has_external_site_scope(assessment.site_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, assessment.supplier_id)
        )
      )
  );
$$;

alter table public.supplier_assessments enable row level security;
create policy supplier_assessments_select_scope on public.supplier_assessments
for select to authenticated using (public.can_access_supplier_assessment(id));
create policy supplier_assessments_internal_insert on public.supplier_assessments
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.organizations organization
    where organization.id = supplier_id and organization.kind = 'supplier' and organization.active
  )
  and (
    public.is_administrator()
    or (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
  )
);

create or replace function public.guard_supplier_assessment_file_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_assessment public.supplier_assessments%rowtype;
begin
  if tg_op = 'UPDATE' and (
    old.resource_type = 'supplier_assessment_source'
    or new.resource_type = 'supplier_assessment_source'
  ) and not public.is_administrator() then
    raise exception using errcode = '42501', message = 'SUPPLIER_ASSESSMENT_FILE_IMMUTABLE';
  end if;
  if new.resource_type <> 'supplier_assessment_source' then return new; end if;
  if auth.uid() is null then return new; end if;
  if not (
    public.is_administrator()
    or (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_ASSESSMENT_FILE_FORBIDDEN';
  end if;
  select * into selected_assessment from public.supplier_assessments where id = new.resource_id;
  if selected_assessment.id is null
    or new.module_id <> 'suppliers'
    or new.external_organization_id is distinct from selected_assessment.supplier_id
    or new.external_site_id is distinct from selected_assessment.site_id
    or not exists (
      select 1 from public.file_upload_policies policy
      where policy.resource_type = 'supplier_assessment_source'
        and new.size_bytes between 1 and policy.max_size_bytes
        and new.mime_type = any(policy.allowed_mime_types)
    ) then
    raise exception using errcode = '23514', message = 'SUPPLIER_ASSESSMENT_FILE_SCOPE_INVALID';
  end if;
  return new;
end;
$$;
create trigger file_objects_guard_supplier_assessment_scope
before insert or update on public.file_objects
for each row execute function public.guard_supplier_assessment_file_scope();

create or replace function public.guard_supplier_assessment_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_file_id is not null and not exists (
    select 1 from public.file_objects file
    where file.id = new.source_file_id
      and file.resource_type = 'supplier_assessment_source'
      and file.resource_id = new.id
      and file.external_organization_id = new.supplier_id
      and file.external_site_id is not distinct from new.site_id
      and file.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'SUPPLIER_ASSESSMENT_SOURCE_INVALID';
  end if;
  return new;
end;
$$;
create trigger supplier_assessments_guard_source
before insert or update of source_file_id, supplier_id, site_id on public.supplier_assessments
for each row execute function public.guard_supplier_assessment_source();
create policy supplier_assessments_internal_update on public.supplier_assessments
for update to authenticated using (
  public.is_administrator()
  or (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
)
with check (
  public.is_administrator()
  or (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
);

create or replace function public.audit_supplier_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_code text;
begin
  select organization.code into supplier_code
  from public.organizations organization where organization.id = new.supplier_id;
  insert into public.audit_log(
    actor_id, module, action, resource_type, resource_id, entity_code_snapshot,
    previous_value, new_value, metadata
  ) values (
    coalesce(new.updated_by, new.created_by), 'suppliers',
    case when tg_op = 'INSERT' then 'supplier.assessment.created' else 'supplier.assessment.updated' end,
    'supplier_assessment', new.id::text, supplier_code,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'assessment_type', old.assessment_type, 'assessment_date', old.assessment_date,
      'score', old.score, 'classification', old.classification, 'portal_visible', old.portal_visible
    ) else null end,
    jsonb_build_object(
      'assessment_type', new.assessment_type, 'assessment_date', new.assessment_date,
      'score', new.score, 'classification', new.classification, 'portal_visible', new.portal_visible,
      'source_file_id', new.source_file_id
    ),
    jsonb_build_object('supplier_id', new.supplier_id, 'site_id', new.site_id)
  );
  return new;
end;
$$;
create trigger supplier_assessments_audit
after insert or update on public.supplier_assessments
for each row execute function public.audit_supplier_assessment();

drop policy if exists file_objects_select_scope on public.file_objects;
create policy file_objects_select_scope on public.file_objects
for select to authenticated using (
  (
    resource_type = 'general_information_document'
    and public.can_access_general_information_workspace(workspace_id)
    and (deleted_at is null or public.is_administrator())
  )
  or (
    resource_type = 'supplier_rncp_action_evidence'
    and deleted_at is null
    and public.can_access_supplier_action(resource_id)
  )
  or (
    resource_type = 'supplier_assessment_source'
    and deleted_at is null
    and public.can_access_supplier_assessment(resource_id)
  )
  or (
    resource_type not in ('general_information_document', 'supplier_rncp_action_evidence', 'supplier_assessment_source')
    and (
      public.is_administrator()
      or (
        deleted_at is null and (
          uploaded_by = auth.uid()
          or (
            public.is_internal_user() and (
              (process_id is not null and public.has_process_access(process_id))
              or (module_id is not null and public.has_module_permission(module_id, 'view'))
            )
          )
          or (
            external_organization_id in (select public.current_organization_ids())
            and (
              audience = 'shared'
              or (audience = 'customer' and public.current_user_type() = 'customer')
              or (audience = 'supplier' and public.current_user_type() = 'supplier')
            )
          )
        )
      )
    )
  )
);

grant select, insert, update on public.supplier_assessments to authenticated;
grant execute on function public.can_access_supplier_assessment(uuid) to authenticated;

comment on table public.supplier_assessments is
  'Resultado estructurado de auditoría o evaluación de proveedor; el archivo fuente privado es evidencia, no la fuente maestra del resultado.';

commit;
