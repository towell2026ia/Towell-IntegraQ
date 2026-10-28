-- FIX-03A: PENDING isolated execution. Adds a read gate only; no data changes.
-- Documentary folders are UI groupings, never inherited database grants.
begin;
create policy fix03a_document_file_process_read on public.file_objects
as restrictive for select to authenticated
using (
  not (coalesce(module_id = 'documents' and process_id is not null, false)
    or coalesce(resource_type in ('controlled_document', 'process_organization_chart'), false))
  or (
    public.has_module_permission('documents', 'view')
    and (public.is_administrator() or (
      public.is_internal_user() and process_id is not null
      and public.has_process_access(process_id)
    ))
  )
);
-- FIX-03 storage read gate resolves file_objects under RLS, including this gate.
commit;
