update public.processes
set name = 'Recursos Humanos'
where id = 'P-11';

insert into public.position_process_permissions (
  position_id,
  process_id,
  relationship,
  document_role
)
values ('PU-10', 'P-11', 'owner', 'modifier')
on conflict (position_id, process_id) do update
set relationship = excluded.relationship,
    document_role = excluded.document_role;
