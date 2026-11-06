-- Incremental repair only: disambiguate the loop identifier from supplier_rncp_actions.id.
-- The previously applied migration remains unchanged. No records or policies change.
create or replace function public.iq_rncp_requirements_summary(p_report_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare requested_report_id uuid; selected_action_id uuid; summary_result jsonb:='{}';
begin
  if cardinality(p_report_ids)>500 then raise exception 'RNCP_BATCH_TOO_LARGE'; end if;
  foreach requested_report_id in array p_report_ids loop
    if not public.iq_rncp_read_scope(requested_report_id) then
      raise exception using errcode='42501',message='RNCP_FORBIDDEN';
    end if;
    select a.id into selected_action_id from public.supplier_rncp_actions a
      where a.report_id=requested_report_id
      order by (a.status in ('submitted','accepted')) desc,a.updated_at desc limit 1;
    summary_result:=summary_result||jsonb_build_object(requested_report_id::text,
      to_jsonb(public.iq_rncp_missing_requirements(requested_report_id,selected_action_id)));
  end loop;
  return summary_result;
end $$;
revoke all on function public.iq_rncp_requirements_summary(uuid[]) from public,anon;
grant execute on function public.iq_rncp_requirements_summary(uuid[]) to authenticated;
notify pgrst,'reload schema';
