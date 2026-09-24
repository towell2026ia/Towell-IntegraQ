-- Un organigrama vigente por proceso. Las categorías de interpretación no son slots.
with ranked as (
  select id,
    row_number() over (
      partition by resource_key
      order by created_at, id
    ) as calculated_version,
    row_number() over (
      partition by resource_key
      order by created_at desc, id desc
    ) as current_rank
  from public.file_objects
  where resource_type = 'process_organization_chart'
    and deleted_at is null
)
update public.file_objects file
set version = ranked.calculated_version,
    is_current = ranked.current_rank = 1
from ranked
where ranked.id = file.id;

create unique index if not exists file_objects_one_current_organization_chart_uidx
  on public.file_objects(resource_key)
  where resource_type = 'process_organization_chart'
    and is_current
    and deleted_at is null;
