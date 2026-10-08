-- IQ-PRD-PROV-04: índices para filtros e histórico del dashboard vivo de proveedores.

begin;

create index if not exists supplier_rncp_dashboard_filter_idx
  on public.supplier_rncp_reports(supplier_id, site_id, status, report_date desc)
  where deleted_at is null;

create index if not exists supplier_rncp_dashboard_category_idx
  on public.supplier_quality_profiles(category, organization_id)
  where active;

create index if not exists supplier_audits_dashboard_idx
  on public.audits(external_organization_id, external_site_id, status, scheduled_date desc)
  where audit_type = 'supplier';

create index if not exists supplier_evaluations_dashboard_idx
  on public.supplier_quality_evaluations(supplier_id, site_id, period_end desc);

create index if not exists supplier_rncp_actions_dashboard_idx
  on public.supplier_rncp_actions(report_id, status, created_at desc);

commit;
