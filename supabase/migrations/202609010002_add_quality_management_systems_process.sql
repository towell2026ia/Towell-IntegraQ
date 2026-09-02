insert into public.processes (id, name, level, parent_id)
values ('P-35', 'Sistemas de Gestión de Calidad', 'process', null)
on conflict (id) do update
set name = excluded.name,
    level = excluded.level,
    parent_id = excluded.parent_id,
    active = true,
    updated_at = now();

insert into public.position_process_permissions (
  position_id,
  process_id,
  relationship,
  document_role
)
values
  ('PU-01', 'P-35', 'approver', 'authorizer'),
  ('PU-07', 'P-35', 'owner', 'modifier'),
  ('PU-16', 'P-35', 'participant', 'viewer')
on conflict (position_id, process_id) do update
set relationship = excluded.relationship,
    document_role = excluded.document_role;
