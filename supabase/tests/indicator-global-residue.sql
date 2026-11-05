-- Separate read-only cloud request after the fixture subtransaction has rolled back.
-- Only generated test UUIDs/process ID are parameters; no names or private values return.
select (
  (select count(*) from public.organizations o where o.id=any($1::uuid[]))+
  (select count(*) from public.profiles p where p.id=any($2::uuid[]))+
  (select count(*) from auth.users u where u.id=any($2::uuid[]))+
  (select count(*) from public.processes p where p.id=$3::text)+
  (select count(*) from public.indicator_definitions d where d.organization_id=any($1::uuid[]))+
  (select count(*) from public.indicator_capture_rules r where r.organization_id=any($1::uuid[]))+
  (select count(*) from public.indicator_capture_operations o where o.organization_id=any($1::uuid[]))+
  (select count(*) from public.audit_log a where a.organization_id=any($1::uuid[]))+
  (select count(*) from public.user_process_permissions p where p.user_id=any($2::uuid[]))+
  (select count(*) from public.user_module_permissions p where p.user_id=any($2::uuid[]))+
  (select count(*) from public.user_module_action_permissions p where p.user_id=any($2::uuid[]))
)::integer as residual_fixture_records;
