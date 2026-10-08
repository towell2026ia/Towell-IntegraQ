-- IQ-PRD-HOME-02: referencias institucionales de Inicio a documentos controlados vigentes.

begin;

create table public.home_institutional_items (
  position text primary key check (position in ('POLICY_QUALITY', 'CODE_ETHICS', 'CONFIDENTIALITY')),
  title text not null,
  content_kind text not null default 'document' check (content_kind in ('document', 'text')),
  document_id uuid references public.controlled_documents(id) on delete restrict,
  short_text text,
  visible_to_internal boolean not null default true,
  visible_to_external boolean not null default false,
  active boolean not null default false,
  display_order smallint not null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (position = 'CONFIDENTIALITY' or content_kind = 'document'),
  check (
    not active
    or (content_kind = 'document' and document_id is not null and short_text is null)
    or (content_kind = 'text' and document_id is null and length(trim(coalesce(short_text, ''))) > 0)
  )
);

insert into public.home_institutional_items(position, title, content_kind, display_order)
values
  ('POLICY_QUALITY', 'Política de Calidad', 'document', 10),
  ('CODE_ETHICS', 'Código de Ética', 'document', 20),
  ('CONFIDENTIALITY', 'Confidencialidad', 'text', 30)
on conflict (position) do nothing;

create trigger home_institutional_items_set_updated_at
before update on public.home_institutional_items
for each row execute function public.set_updated_at();

alter table public.home_institutional_items enable row level security;
create policy home_institutional_items_select_scope on public.home_institutional_items
for select to authenticated using (
  public.is_administrator()
  or (active and visible_to_internal and public.is_internal_user())
  or (active and visible_to_external and public.current_user_type() in ('customer', 'supplier'))
);
create policy home_institutional_items_admin_write on public.home_institutional_items
for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
grant select, update on public.home_institutional_items to authenticated;

create or replace function public.audit_home_institutional_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log(
    actor_id, module, action, resource_type, resource_id,
    previous_value, new_value, metadata
  ) values (
    coalesce(new.updated_by, auth.uid()), 'home', 'home.institutional_mapping_updated',
    'home_institutional_item', new.position,
    jsonb_build_object(
      'content_kind', old.content_kind, 'document_id', old.document_id,
      'short_text', old.short_text, 'visible_to_internal', old.visible_to_internal,
      'visible_to_external', old.visible_to_external, 'active', old.active
    ),
    jsonb_build_object(
      'content_kind', new.content_kind, 'document_id', new.document_id,
      'short_text', new.short_text, 'visible_to_internal', new.visible_to_internal,
      'visible_to_external', new.visible_to_external, 'active', new.active
    ),
    jsonb_build_object('title', new.title)
  );
  return new;
end;
$$;
create trigger home_institutional_items_audit
after update on public.home_institutional_items
for each row execute function public.audit_home_institutional_item();

update public.home_sections
set label = 'Información institucional',
    description = 'Política de Calidad, Código de Ética y confidencialidad desde documentos controlados.'
where id = 'quality-policy';

comment on table public.home_institutional_items is
  'Mapeo administrativo; los archivos permanecen exclusivamente en Información Documentada y se resuelve siempre la versión current.';

commit;
