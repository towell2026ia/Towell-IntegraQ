-- PRD 03: evolución aditiva del control de acceso, audit_log y aprobaciones.

create type public.permission_scope_type as enum ('global', 'organization', 'area', 'process', 'own_records', 'assigned_records', 'company');
create type public.permission_risk_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type public.role_assignment_status as enum ('active', 'inactive');
create type public.activity_origin as enum ('human', 'system', 'import', 'migration', 'integration', 'ai', 'admin_override');
create type public.approval_request_status as enum ('pending', 'approved', 'rejected', 'cancelled', 'expired');
create type public.approval_decision as enum ('approved', 'rejected');

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope_type public.permission_scope_type not null,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  module text not null,
  action text not null,
  description text not null,
  risk_level public.permission_risk_level not null,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  area_id uuid references public.areas(id) on delete restrict,
  process_id text references public.processes(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status public.role_assignment_status not null default 'active',
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index user_roles_active_scope_uidx on public.user_roles (
  user_id, role_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(process_id, '')
) where status = 'active';
create index user_roles_user_active_idx on public.user_roles(user_id, status, starts_at, ends_at);
create index role_permissions_permission_idx on public.role_permissions(permission_id, role_id) where allowed;

create table public.delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references public.profiles(id) on delete restrict,
  delegate_id uuid not null references public.profiles(id) on delete restrict,
  role_id uuid references public.roles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  area_id uuid references public.areas(id) on delete restrict,
  process_id text references public.processes(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  authorized_by uuid not null references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (delegator_id <> delegate_id and ends_at > starts_at)
);

insert into public.roles(code, name, description, scope_type) values
  ('ADMIN', 'Administrador', 'Administración global y trazada.', 'global'),
  ('PROCESS_OWNER', 'Dueño de proceso', 'Gobierno de registros del proceso.', 'process'),
  ('AUDIT_LEAD', 'Auditor líder', 'Planeación y aprobación de auditorías.', 'assigned_records'),
  ('AUDITOR', 'Auditor', 'Ejecución de auditorías asignadas.', 'assigned_records'),
  ('DOCUMENT_OWNER', 'Responsable documental', 'Edición y envío de documentos.', 'process'),
  ('METROLOGY_OWNER', 'Responsable de metrología', 'Gestión técnica de metrología.', 'process'),
  ('QUALITY_USER', 'Usuario de calidad', 'Gestión de calidad dentro de alcance.', 'process'),
  ('MANAGEMENT', 'Dirección', 'Preparación y aprobación de revisión por la Dirección.', 'organization'),
  ('EXTERNAL_CUSTOMER', 'Cliente externo', 'Acceso exclusivo a su empresa.', 'company'),
  ('EXTERNAL_SUPPLIER', 'Proveedor externo', 'Acceso exclusivo a su empresa.', 'company'),
  ('VIEWER', 'Visualizador', 'Consulta dentro del alcance asignado.', 'process');

insert into public.permissions(code, module, action, description, risk_level) values
  ('system.admin','system','admin','Administrar la plataforma','CRITICAL'),
  ('system.activity.read','system','read','Consultar trazabilidad','HIGH'),
  ('system.activity.export','system','export','Exportar trazabilidad','HIGH'),
  ('system.organization.administer','system','administer','Administrar organización','CRITICAL'),
  ('organization.position.create','organization','create','Crear puestos dentro del alcance','MEDIUM'),
  ('documents.file.read','documents','read','Consultar documentos','LOW'),
  ('documents.file.create','documents','create','Crear documentos','MEDIUM'),
  ('documents.file.edit','documents','edit','Editar documentos','MEDIUM'),
  ('documents.file.submit','documents','submit','Enviar documentos','MEDIUM'),
  ('documents.file.validate','documents','validate','Validar documentos','HIGH'),
  ('documents.file.approve','documents','approve','Aprobar documentos','HIGH'),
  ('documents.file.reject','documents','reject','Rechazar documentos','HIGH'),
  ('documents.file.publish','documents','publish','Publicar documentos','HIGH'),
  ('risks.read','risks','read','Consultar riesgos','LOW'),
  ('risks.create','risks','create','Crear riesgos','MEDIUM'),
  ('risks.edit','risks','edit','Editar riesgos','MEDIUM'),
  ('risks.evaluate','risks','evaluate','Evaluar riesgos','MEDIUM'),
  ('risks.approve','risks','approve','Aprobar riesgos','HIGH'),
  ('risks.close','risks','close','Cerrar riesgos','HIGH'),
  ('audits.program.create','audits','create','Crear programa','MEDIUM'),
  ('audits.program.approve','audits','approve','Aprobar programa','HIGH'),
  ('audits.plan.create','audits','create','Crear plan','MEDIUM'),
  ('audits.plan.approve','audits','approve','Aprobar plan','HIGH'),
  ('audits.auditor.assign','audits','assign','Asignar auditor','HIGH'),
  ('audits.execute','audits','execute','Ejecutar auditoría','MEDIUM'),
  ('audits.finding.create','audits','create','Crear hallazgo','MEDIUM'),
  ('audits.finding.validate','audits','validate','Validar hallazgo','HIGH'),
  ('audits.report.generate','audits','generate','Generar informe','MEDIUM'),
  ('audits.report.approve','audits','approve','Aprobar informe','HIGH'),
  ('audits.close','audits','close','Cerrar auditoría','HIGH'),
  ('corrective_actions.create','corrective_actions','create','Crear acción','MEDIUM'),
  ('corrective_actions.analyze','corrective_actions','analyze','Analizar causa','MEDIUM'),
  ('corrective_actions.action.assign','corrective_actions','assign','Asignar acción','MEDIUM'),
  ('corrective_actions.evidence.submit','corrective_actions','submit','Presentar evidencia','MEDIUM'),
  ('corrective_actions.effectiveness.validate','corrective_actions','validate','Validar eficacia','HIGH'),
  ('corrective_actions.close','corrective_actions','close','Cerrar acción','HIGH'),
  ('metrology.equipment.read','metrology','read','Consultar equipo','LOW'),
  ('metrology.equipment.edit','metrology','edit','Editar equipo','MEDIUM'),
  ('metrology.verification.execute','metrology','execute','Ejecutar verificación','MEDIUM'),
  ('metrology.calibration.record','metrology','record','Registrar calibración','MEDIUM'),
  ('metrology.report.create','metrology','create','Crear reporte','MEDIUM'),
  ('metrology.report.validate','metrology','validate','Validar reporte','HIGH'),
  ('metrology.equipment.status.change','metrology','change','Cambiar estado','HIGH'),
  ('improvement.create','improvement','create','Crear mejora','MEDIUM'),
  ('improvement.edit','improvement','edit','Editar mejora','MEDIUM'),
  ('improvement.prioritize','improvement','prioritize','Priorizar mejora','HIGH'),
  ('improvement.approve','improvement','approve','Aprobar mejora','HIGH'),
  ('improvement.close','improvement','close','Cerrar mejora','HIGH'),
  ('management_review.read','management_review','read','Consultar revisión','HIGH'),
  ('management_review.prepare','management_review','prepare','Preparar revisión','HIGH'),
  ('management_review.edit','management_review','edit','Editar revisión','HIGH'),
  ('management_review.submit','management_review','submit','Enviar revisión','HIGH'),
  ('management_review.approve','management_review','approve','Aprobar revisión','CRITICAL'),
  ('management_review.publish','management_review','publish','Publicar revisión','CRITICAL'),
  ('ai.read','ai','read','Consultar IA futura','LOW'),
  ('ai.suggest','ai','suggest','Solicitar sugerencias futuras','LOW'),
  ('ai.generate_draft','ai','generate_draft','Generar borrador futuro','MEDIUM'),
  ('ai.execute','ai','execute','Ejecutar IA futura','HIGH'),
  ('ai.approve','ai','approve','Aprobar IA futura','CRITICAL');

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission where role.code = 'ADMIN';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code in (
  'documents.file.read','documents.file.edit','documents.file.submit','documents.file.validate',
  'risks.read','risks.create','risks.edit','risks.evaluate','risks.approve','risks.close',
  'corrective_actions.create','corrective_actions.analyze','corrective_actions.action.assign',
  'improvement.create','improvement.edit','organization.position.create'
) where role.code = 'PROCESS_OWNER';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code in (
  'audits.program.create','audits.program.approve','audits.plan.create','audits.plan.approve','audits.auditor.assign',
  'audits.execute','audits.finding.create','audits.finding.validate','audits.report.generate','audits.report.approve','audits.close'
) where role.code = 'AUDIT_LEAD';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code in ('audits.execute','audits.finding.create','audits.report.generate') where role.code = 'AUDITOR';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code like 'documents.%' and permission.code not in ('documents.file.approve','documents.file.publish') where role.code = 'DOCUMENT_OWNER';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.module = 'metrology' where role.code = 'METROLOGY_OWNER';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.module in ('risks','corrective_actions','audits') where role.code = 'QUALITY_USER';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.module = 'management_review' or permission.code = 'system.activity.read' where role.code = 'MANAGEMENT';
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code in ('documents.file.read','corrective_actions.evidence.submit') where role.code in ('EXTERNAL_CUSTOMER','EXTERNAL_SUPPLIER');
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.action = 'read' where role.code = 'VIEWER';

insert into public.user_roles(user_id, role_id, organization_id)
select profile.id, role.id, profile.organization_id from public.profiles profile cross join public.roles role
where profile.user_type = 'administrator' and profile.status = 'active' and role.code = 'ADMIN' on conflict do nothing;
insert into public.user_roles(user_id, role_id, organization_id, area_id, process_id)
select distinct profile.id, role.id, profile.organization_id, profile.area_id, permission.process_id
from public.profiles profile join public.position_process_permissions permission on permission.position_id = profile.position_id
join public.roles role on role.code = case permission.relationship when 'owner' then 'PROCESS_OWNER' when 'approver' then 'DOCUMENT_OWNER' else 'VIEWER' end
where profile.user_type = 'internal' and profile.status = 'active' on conflict do nothing;
insert into public.user_roles(user_id, role_id, organization_id)
select profile.id, role.id, profile.external_party_id from public.profiles profile join public.roles role
on role.code = case profile.user_type when 'customer' then 'EXTERNAL_CUSTOMER' when 'supplier' then 'EXTERNAL_SUPPLIER' end
where profile.user_type in ('customer','supplier') and profile.status = 'active' and profile.external_party_id is not null on conflict do nothing;
insert into public.user_roles(user_id, role_id, organization_id, area_id)
select distinct participant.profile_id, role.id, profile.organization_id, profile.area_id
from public.audit_participants participant join public.profiles profile on profile.id = participant.profile_id
join public.roles role on role.code = case participant.role when 'lead' then 'AUDIT_LEAD' else 'AUDITOR' end
where profile.status = 'active' on conflict do nothing;
insert into public.user_roles(user_id, role_id, organization_id, area_id, process_id)
select distinct asset.owner_id, role.id, profile.organization_id, profile.area_id, asset.process_id
from public.measurement_assets asset join public.profiles profile on profile.id = asset.owner_id
cross join public.roles role where asset.owner_id is not null and role.code = 'METROLOGY_OWNER' on conflict do nothing;

alter table public.audit_log
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists user_name_snapshot text,
  add column if not exists module text,
  add column if not exists entity_code_snapshot text,
  add column if not exists previous_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists reason text,
  add column if not exists origin public.activity_origin not null default 'human',
  add column if not exists ip_address inet,
  add column if not exists user_agent text;
update public.audit_log log set user_name_snapshot = coalesce(log.user_name_snapshot, (select profile.full_name from public.profiles profile where profile.id = log.actor_id), 'Sistema'), module = coalesce(log.module, split_part(log.action, '.', 1));
create index audit_log_entity_timeline_idx on public.audit_log(resource_type, resource_id, created_at desc);
create index audit_log_module_created_idx on public.audit_log(module, created_at desc);
create index audit_log_organization_created_idx on public.audit_log(organization_id, created_at desc);
revoke update, delete on public.audit_log from authenticated;
create or replace function public.prepare_activity_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  if new.actor_id is not null then select * into actor from public.profiles where id = new.actor_id; end if;
  new.user_name_snapshot := coalesce(new.user_name_snapshot, actor.full_name, 'Sistema');
  new.organization_id := coalesce(new.organization_id, actor.organization_id, actor.external_party_id);
  new.module := coalesce(new.module, split_part(new.action, '.', 1));
  if new.origin = 'human' and actor.user_type = 'administrator' then new.origin := 'admin_override'; end if;
  return new;
end;
$$;
create trigger audit_log_prepare before insert on public.audit_log for each row execute function public.prepare_activity_log();
create trigger roles_set_updated_at before update on public.roles for each row execute function public.set_updated_at();
drop policy if exists audit_log_select_own_or_admin on public.audit_log;
create policy audit_log_select_authorized on public.audit_log for select to authenticated using (
  actor_id = auth.uid() or public.is_administrator() or (
    public.is_internal_user()
    and public.has_module_permission(module, 'view')
    and (metadata->>'process_id' is null or public.has_process_access(metadata->>'process_id'))
  )
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  module text not null,
  entity_type text not null,
  entity_id text not null,
  process_id text references public.processes(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  requested_at timestamptz not null default now(),
  approval_type text not null,
  required_permission text not null references public.permissions(code) on delete restrict,
  assigned_approver_id uuid references public.profiles(id) on delete restrict,
  assigned_role_id uuid references public.roles(id) on delete restrict,
  status public.approval_request_status not null default 'pending',
  decision_by uuid references public.profiles(id) on delete restrict,
  decision_at timestamptz,
  decision public.approval_decision,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (module in ('documents','risks','audits','corrective-actions','calibrations','continuous-improvement','management-review')),
  check ((status = 'pending' and decision is null and decision_by is null and decision_at is null) or (status in ('approved','rejected') and decision::text = status::text and decision_by is not null and decision_at is not null) or status in ('cancelled','expired')),
  check (status <> 'rejected' or length(trim(coalesce(comments, ''))) > 0)
);
create unique index approval_requests_one_pending_uidx on public.approval_requests(entity_type, entity_id, approval_type) where status = 'pending';
create index approval_requests_assignee_idx on public.approval_requests(assigned_approver_id, status, requested_at);
create index approval_requests_permission_idx on public.approval_requests(required_permission, status);
create trigger approval_requests_set_updated_at before update on public.approval_requests for each row execute function public.set_updated_at();

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  entity_type text not null,
  entity_id text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz
);
create index domain_events_pending_idx on public.domain_events(occurred_at) where processed_at is null;

create or replace function public.log_approval_request_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor_id, organization_id, module, action, resource_type, resource_id, new_value, metadata, origin)
  values (new.requested_by, new.organization_id, new.module, 'approval.requested', new.entity_type, new.entity_id, jsonb_build_object('status', new.status), jsonb_build_object('approvalRequestId', new.id, 'requiredPermission', new.required_permission, 'process_id', new.process_id), 'human');
  insert into public.domain_events(organization_id, event_name, entity_type, entity_id, actor_id, payload)
  values (new.organization_id, 'approval_request.created', new.entity_type, new.entity_id, new.requested_by, jsonb_build_object('approvalRequestId', new.id));
  if new.assigned_approver_id is not null then
    insert into public.notifications(recipient_id, title, message, module_id, resource_type, resource_id, action_url)
    values (new.assigned_approver_id, 'Nueva aprobación pendiente', new.entity_type || ' requiere ' || new.approval_type || '.', new.module, 'approval_request', new.id, '/#home');
  end if;
  return new;
end;
$$;
create trigger approval_request_created after insert on public.approval_requests for each row execute function public.log_approval_request_created();

create or replace function public.has_permission(
  requested_permission text,
  requested_organization_id uuid default null,
  requested_area_id uuid default null,
  requested_process_id text default null,
  record_owner_id uuid default null,
  is_assigned boolean default false,
  requested_company_id uuid default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_administrator() or exists (
    select 1 from public.user_roles assignment
    join public.roles role on role.id = assignment.role_id and role.status = 'active'
    join public.role_permissions role_permission on role_permission.role_id = role.id and role_permission.allowed
    join public.permissions permission on permission.id = role_permission.permission_id and permission.status = 'active'
    join public.profiles profile on profile.id = assignment.user_id and profile.status = 'active'
    where assignment.user_id = auth.uid() and assignment.status = 'active'
      and assignment.starts_at <= now() and (assignment.ends_at is null or assignment.ends_at >= now())
      and permission.code = requested_permission
      and case role.scope_type
        when 'global' then true
        when 'organization' then assignment.organization_id = requested_organization_id
        when 'area' then assignment.area_id = requested_area_id
        when 'process' then assignment.process_id = requested_process_id
        when 'own_records' then record_owner_id = auth.uid()
        when 'assigned_records' then is_assigned
        when 'company' then profile.external_party_id = requested_company_id and assignment.organization_id = requested_company_id
        else false end
  );
$$;

create or replace function public.decide_approval(request_id uuid, requested_decision public.approval_decision, decision_comments text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.approval_requests%rowtype;
declare activity_id uuid;
begin
  select * into selected from public.approval_requests where id = request_id for update;
  if selected.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if selected.status <> 'pending' then raise exception using errcode = 'P0001', message = 'INVALID_STATE_TRANSITION'; end if;
  if selected.requested_by = auth.uid() then raise exception using errcode = 'P0001', message = 'CONFLICT_OF_INTEREST'; end if;
  if selected.assigned_approver_id is not null and selected.assigned_approver_id <> auth.uid() then raise exception using errcode = '42501', message = 'OUTSIDE_SCOPE'; end if;
  if requested_decision = 'rejected' and length(trim(coalesce(decision_comments, ''))) = 0 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if not public.has_permission(selected.required_permission, selected.organization_id, null, selected.process_id, null, selected.assigned_approver_id = auth.uid(), null) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  update public.approval_requests set status = requested_decision::text::public.approval_request_status, decision = requested_decision, decision_by = auth.uid(), decision_at = now(), comments = nullif(trim(decision_comments), ''), updated_at = now() where id = request_id returning * into selected;
  insert into public.audit_log(actor_id, organization_id, user_name_snapshot, module, action, resource_type, resource_id, new_value, reason, origin)
  select auth.uid(), selected.organization_id, profile.full_name, selected.module, 'approval.' || requested_decision::text, selected.entity_type, selected.entity_id, jsonb_build_object('approvalRequestId', selected.id, 'decision', requested_decision), selected.comments, case when public.is_administrator() then 'admin_override' else 'human' end
  from public.profiles profile where profile.id = auth.uid() returning id into activity_id;
  insert into public.domain_events(organization_id, event_name, entity_type, entity_id, actor_id, payload) values (selected.organization_id, selected.entity_type || '.' || requested_decision::text, selected.entity_type, selected.entity_id, auth.uid(), jsonb_build_object('approvalRequestId', selected.id));
  return jsonb_build_object('approval', to_jsonb(selected), 'activityLogId', activity_id);
end;
$$;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.delegations enable row level security;
alter table public.approval_requests enable row level security;
alter table public.domain_events enable row level security;
create policy roles_read on public.roles for select to authenticated using (public.is_internal_user());
create policy permissions_read on public.permissions for select to authenticated using (public.is_internal_user());
create policy roles_admin on public.roles for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy permissions_admin on public.permissions for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy role_permissions_read on public.role_permissions for select to authenticated using (public.is_internal_user());
create policy role_permissions_admin on public.role_permissions for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy user_roles_read on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_administrator());
create policy user_roles_admin on public.user_roles for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy delegations_read on public.delegations for select to authenticated using (delegator_id = auth.uid() or delegate_id = auth.uid() or public.is_administrator());
create policy delegations_admin on public.delegations for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy approval_requests_read on public.approval_requests for select to authenticated using (requested_by = auth.uid() or assigned_approver_id = auth.uid() or public.is_administrator() or public.has_permission(required_permission, organization_id, null, process_id, null, false, null));
create policy approval_requests_create on public.approval_requests for insert to authenticated with check (requested_by = auth.uid() and public.is_internal_user());
create policy domain_events_admin_read on public.domain_events for select to authenticated using (public.is_administrator());
create policy domain_events_system_insert on public.domain_events for insert to authenticated with check (actor_id = auth.uid());

grant select on public.roles, public.permissions, public.role_permissions, public.user_roles, public.delegations to authenticated;
grant select, insert on public.approval_requests to authenticated;
grant execute on function public.has_permission(text, uuid, uuid, text, uuid, boolean, uuid) to authenticated;
grant execute on function public.decide_approval(uuid, public.approval_decision, text) to authenticated;
grant insert on public.domain_events to authenticated;

alter table public.controlled_documents add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null, add column if not exists deletion_reason text;
alter table public.risk_items add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null, add column if not exists deletion_reason text;
alter table public.audits add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null, add column if not exists deletion_reason text;
alter table public.corrective_actions add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null, add column if not exists deletion_reason text;
alter table public.improvement_projects add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null, add column if not exists deletion_reason text;
alter table public.controlled_documents add constraint controlled_documents_soft_delete_reason check (deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)) not valid;
alter table public.risk_items add constraint risk_items_soft_delete_reason check (deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)) not valid;
alter table public.audits add constraint audits_soft_delete_reason check (deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)) not valid;
alter table public.corrective_actions add constraint corrective_actions_soft_delete_reason check (deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)) not valid;
alter table public.improvement_projects add constraint improvement_projects_soft_delete_reason check (deleted_at is null or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0)) not valid;
