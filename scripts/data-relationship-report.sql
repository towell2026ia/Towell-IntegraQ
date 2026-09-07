select
  migration_id,
  entity_type,
  total_records,
  related_records,
  unrelated_records,
  ambiguous_records,
  duplicate_candidates,
  errors
from public.migration_report
where migration_id = 'PRD02-20260907'
order by entity_type;

select
  entity_type,
  record_id,
  field_name,
  raw_value,
  reason,
  candidates,
  status
from public.migration_conflicts
where migration_id = 'PRD02-20260907'
order by status, entity_type, record_id;

