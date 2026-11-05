-- IQ-CLIENTES-02: validate the existing A3 -> claim FK, without changing any row.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create function public.iq_guard_a3_customer_claim_link() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  claim public.quality_cases;
  new_link boolean;
begin
  if tg_op='UPDATE' then
    if old.quality_case_id is not null and new.quality_case_id is distinct from old.quality_case_id then
      raise exception using errcode='23514',message='A3_EXISTING_CLAIM_LINK_IMMUTABLE';
    end if;
    new_link := new.quality_case_id is distinct from old.quality_case_id;
  else
    new_link := new.quality_case_id is not null;
  end if;
  if new.quality_case_id is null then return new; end if;
  if new_link and current_user<>'service_role' and (
    not public.is_administrator() or not exists (
      select 1 from public.current_organization_ids() as membership(organization_id)
      where membership.organization_id=new.organization_id
    )
  ) then raise exception using errcode='42501',message='ACTIVE_ADMIN_CLAIM_LINK_REQUIRED'; end if;
  select * into claim from public.quality_cases where id=new.quality_case_id for share;
  if not found or claim.kind<>'claim' or new.source<>'customer'
    or new.external_organization_id is distinct from claim.external_organization_id
    or not exists(select 1 from public.organizations o where o.id=claim.external_organization_id
      and o.kind='customer' and o.owning_organization_id=new.organization_id)
    or (new_link and claim.cancelled_at is not null) then
    raise exception using errcode='23514',message='A3_CLAIM_CUSTOMER_SCOPE_DENIED';
  end if;
  return new;
end;
$$;
revoke all on function public.iq_guard_a3_customer_claim_link() from public,anon,authenticated;
create trigger iq_a3_customer_claim_link_guard
  before insert or update of quality_case_id,external_organization_id,organization_id,source
  on public.corrective_actions for each row execute function public.iq_guard_a3_customer_claim_link();
