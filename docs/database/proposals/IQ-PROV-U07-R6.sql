-- Install alongside the U07-R5 invitation contract.
begin;

create or replace function public.iq_supplier_portal_issue_selected(
  p_supplier uuid, p_site uuid, p_email text, p_digest text, p_link text, p_replace uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.iq_supplier_portal_admin(p_supplier);
  dest text := lower(trim(p_email));
  pending uuid;
begin
  -- Use the same per-email lock as the existing issuer. Recheck after waiting.
  perform pg_advisory_xact_lock(hashtextextended(dest, 0));
  select i.id into pending from public.supplier_portal_invitations i
    where i.organization_id = org and i.supplier_id = p_supplier and i.email = dest
      and i.withdrawn_at is null and i.accepted_at is null and i.blocked_at is null
      and i.expires_at > clock_timestamp()
    for update;
  if pending is distinct from p_replace then
    raise exception 'INVITATION_CHANGED';
  end if;
  if p_replace is null and exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = dest and p.external_party_id = p_supplier
      and p.user_type = 'supplier' and p.workspace_mode = 'production'
  ) then
    raise exception 'IDENTITY_CONFLICT';
  end if;
  return public.iq_supplier_portal_issue(p_supplier, p_site, dest, p_digest, p_link);
end $$;

revoke all on function public.iq_supplier_portal_issue_selected(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.iq_supplier_portal_issue_selected(uuid,uuid,text,text,text,uuid)
  to authenticated;
commit;
