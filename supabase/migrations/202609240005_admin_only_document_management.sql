-- IntegraQ: administración documental transversal exclusiva para administradores.
-- La lectura conserva el alcance por módulo/proceso; toda mutación de binarios,
-- metadatos, versiones y eliminaciones se valida nuevamente en la base de datos.

begin;

-- Retira capacidades documentales mutables de roles no administrativos y de
-- excepciones históricas. is_administrator() conserva control total.
delete from public.role_permissions role_permission
using public.roles role, public.permissions permission
where role_permission.role_id = role.id
  and role_permission.permission_id = permission.id
  and role.code <> 'ADMIN'
  and permission.code in (
    'documents.file.create', 'documents.file.edit',
    'documents.edit', 'documents.version', 'documents.obsolete',
    'documents.delete', 'documents.restore',
    'organigrama.crear', 'organigrama.editar', 'organigrama.eliminar',
    'evidencias.agregar', 'evidencias.reemplazar', 'evidencias.eliminar',
    'evidencias.historial'
  );

delete from public.user_permission_overrides override
using public.permissions permission
where override.permission_id = permission.id
  and permission.code in (
    'documents.file.create', 'documents.file.edit',
    'documents.edit', 'documents.version', 'documents.obsolete',
    'documents.delete', 'documents.restore',
    'organigrama.crear', 'organigrama.editar', 'organigrama.eliminar',
    'evidencias.agregar', 'evidencias.reemplazar', 'evidencias.eliminar',
    'evidencias.historial'
  );

-- Los archivos privados solo pueden crearse o mutarse por administradores.
drop policy if exists file_objects_insert_scope on public.file_objects;
create policy file_objects_insert_admin on public.file_objects
for insert to authenticated
with check (uploaded_by = auth.uid() and public.is_administrator());

drop policy if exists file_objects_update_owner on public.file_objects;
create policy file_objects_update_admin on public.file_objects
for update to authenticated
using (public.is_administrator())
with check (public.is_administrator());

drop policy if exists file_objects_delete_admin on public.file_objects;
create policy file_objects_delete_admin on public.file_objects
for delete to authenticated using (public.is_administrator());

drop policy if exists integraq_storage_insert_own_folder on storage.objects;
create policy integraq_storage_insert_admin
on storage.objects for insert to authenticated
with check (
  bucket_id = 'integraq-private'
  and public.is_administrator()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists integraq_storage_update_owner on storage.objects;
create policy integraq_storage_update_admin
on storage.objects for update to authenticated
using (bucket_id = 'integraq-private' and public.is_administrator())
with check (bucket_id = 'integraq-private' and public.is_administrator());

drop policy if exists integraq_storage_delete_admin on storage.objects;
create policy integraq_storage_delete_admin
on storage.objects for delete to authenticated
using (bucket_id = 'integraq-private' and public.is_administrator());

-- Altas y cambios del expediente controlado también quedan cerrados por RLS.
drop policy if exists controlled_documents_insert_modifier on public.controlled_documents;
create policy controlled_documents_insert_admin on public.controlled_documents
for insert to authenticated
with check (created_by = auth.uid() and public.is_administrator());

drop policy if exists controlled_documents_update_modifier on public.controlled_documents;
create policy controlled_documents_update_admin on public.controlled_documents
for update to authenticated
using (public.is_administrator())
with check (public.is_administrator());

drop policy if exists document_versions_insert_modifier on public.controlled_document_versions;
create policy document_versions_insert_admin on public.controlled_document_versions
for insert to authenticated
with check (uploaded_by = auth.uid() and public.is_administrator());

drop policy if exists document_versions_update_scope on public.controlled_document_versions;
create policy document_versions_update_admin on public.controlled_document_versions
for update to authenticated
using (public.is_administrator())
with check (public.is_administrator());

-- Las funciones security definer del ciclo documental pasan por esta aserción.
-- Consultar historial sigue respetando permisos; editar/versionar/retirar exige admin.
create or replace function public.assert_document_permission(
  requested_permission text,
  requested_document_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare selected_process_id text;
declare administrator_only boolean;
begin
  select process_id into selected_process_id
  from public.controlled_documents
  where id = requested_document_id;
  if selected_process_id is null then
    raise exception using errcode = 'P0002', message = 'DOCUMENT_NOT_FOUND';
  end if;

  administrator_only := requested_permission in (
    'documents.edit', 'documents.version', 'documents.obsolete',
    'documents.delete', 'documents.restore',
    'documents.file.create', 'documents.file.edit'
  );

  if administrator_only and not public.is_administrator() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if not administrator_only and not (
    public.is_administrator()
    or public.has_permission(requested_permission, null, null, selected_process_id, null, false, null)
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return selected_process_id;
end;
$$;

commit;
