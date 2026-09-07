create table public.ai_activity_log (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  user_id uuid references public.profiles(id) on delete set null,
  module text not null references public.workspace_modules(id) on delete restrict,
  record_type text,
  record_id text,
  capability text not null,
  input_fingerprint text not null check (length(input_fingerprint) = 64),
  context_fingerprint text not null check (length(context_fingerprint) = 64),
  status text not null check (status in ('pending', 'processing', 'success', 'failed', 'disabled', 'awaiting_approval', 'approved', 'rejected')),
  response_type text check (response_type is null or response_type in ('suggestion', 'draft', 'validation', 'error')),
  model text,
  provider text,
  requires_approval boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_activity_log_user_created_idx on public.ai_activity_log(user_id, created_at desc);
create index ai_activity_log_capability_created_idx on public.ai_activity_log(capability, created_at desc);
create index ai_activity_log_record_idx on public.ai_activity_log(record_type, record_id);

alter table public.ai_activity_log enable row level security;

create policy ai_activity_log_select_scope on public.ai_activity_log
for select to authenticated
using (public.is_administrator() or user_id = auth.uid());

grant select on public.ai_activity_log to authenticated;

