-- Additive contract for accountless customer access. No grants or publications are seeded.
begin;

create table public.customer_portal_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.organizations(id),
  customer_id uuid not null references public.organizations(id),
  nonce text not null,
  key_digest text not null unique check (key_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  check ((revoked_at is null) = (revoked_by is null)),
  unique (id, workspace_id, customer_id)
);
create unique index customer_portal_one_active_link on public.customer_portal_links(customer_id) where revoked_at is null;
alter table public.customer_portal_links enable row level security;
revoke all on public.customer_portal_links from public, anon, authenticated, service_role;
grant select, insert on public.customer_portal_links to service_role;
grant update (revoked_at, revoked_by) on public.customer_portal_links to service_role;

alter table public.customer_portal_document_events
  alter column actor_id drop not null,
  add column portal_link_id uuid,
  add foreign key (portal_link_id, workspace_id, customer_id)
    references public.customer_portal_links(id, workspace_id, customer_id),
  add check ((actor_id is not null and portal_link_id is null) or
             (actor_id is null and portal_link_id is not null and action = 'accessed'));

-- Fixed-size buckets shared by all server instances. Serialize failed attempts per bucket.
create table public.customer_portal_attempts (
  bucket integer primary key check (bucket between 0 and 65535),
  window_start timestamptz not null,
  failures integer not null default 0
);
alter table public.customer_portal_attempts enable row level security;
revoke all on public.customer_portal_attempts from public, anon, authenticated, service_role;
grant select, insert, update on public.customer_portal_attempts to service_role;

create function public.iq_customer_portal_access(p_digest text, p_bucket integer)
returns table (grant_id uuid, workspace_id uuid, customer_id uuid, company_name text)
language plpgsql security invoker set search_path = '' as $$
declare
  counter public.customer_portal_attempts%rowtype;
  current_timepoint timestamptz;
begin
  insert into public.customer_portal_attempts(bucket, window_start)
    values (p_bucket, clock_timestamp()) on conflict do nothing;
  select * into strict counter from public.customer_portal_attempts where bucket = p_bucket for update;
  current_timepoint := clock_timestamp();
  if counter.window_start <= current_timepoint - interval '1 minute' then
    update public.customer_portal_attempts set window_start = current_timepoint, failures = 0 where bucket = p_bucket;
  elsif counter.failures >= 20 then
    return;
  end if;
  return query select l.id, l.workspace_id, l.customer_id, o.name::text
    from public.customer_portal_links l join public.organizations o on o.id = l.customer_id
    where l.key_digest = p_digest and l.revoked_at is null and o.active and o.kind = 'customer'
      and o.owning_organization_id = l.workspace_id;
  if not found then
    update public.customer_portal_attempts set failures = failures + 1 where bucket = p_bucket;
  end if;
end;
$$;
revoke all on function public.iq_customer_portal_access(text, integer) from public, anon, authenticated;
grant execute on function public.iq_customer_portal_access(text, integer) to service_role;
commit;
