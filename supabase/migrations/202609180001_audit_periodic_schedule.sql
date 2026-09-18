-- Replaces the overlapping range choice with period-based audit recurrence.
-- Legacy range records remain valid and readable; new records use periodic.

alter table public.audits
  add column if not exists periodic_frequency text,
  add column if not exists periodic_interval_months integer,
  add column if not exists periodic_start_month date,
  add column if not exists periodic_end_mode text,
  add column if not exists periodic_until_month date,
  add column if not exists periodic_occurrence_count integer;

alter table public.audits
  drop constraint if exists audits_schedule_type_check,
  drop constraint if exists audits_schedule_values_check;

alter table public.audits
  add constraint audits_schedule_type_check check (schedule_type in ('exact', 'range', 'periodic', 'window', 'pending')) not valid,
  add constraint audits_schedule_values_check check (
    occurrence_status = 'draft'
    or (schedule_type = 'pending' and scheduled_date is null)
    or (schedule_type = 'exact' and start_date is not null)
    or (schedule_type = 'range' and start_date is not null and end_date is not null and start_date <= end_date)
    or (schedule_type = 'window' and window_start is not null and window_end is not null and window_start <= window_end)
    or (
      schedule_type = 'periodic'
      and periodic_frequency in ('monthly', 'bimonthly', 'quarterly', 'four_monthly', 'semiannual', 'annual', 'custom')
      and periodic_interval_months between 1 and 60
      and periodic_start_month is not null
      and extract(day from periodic_start_month) = 1
      and periodic_end_mode in ('none', 'until', 'count')
      and (periodic_end_mode <> 'until' or (periodic_until_month is not null and periodic_until_month >= periodic_start_month))
      and (periodic_end_mode <> 'count' or periodic_occurrence_count between 2 and 120)
    )
  ) not valid;

comment on column public.audits.periodic_frequency is 'Periodicidad por meses: mensual, bimestral, trimestral, cuatrimestral, semestral, anual o personalizada.';
comment on column public.audits.periodic_start_month is 'Primer periodo de la serie, normalizado al primer día del mes.';
comment on column public.audits.periodic_end_mode is 'Finalización de la serie: sin fecha, en un periodo o después de N periodos.';
