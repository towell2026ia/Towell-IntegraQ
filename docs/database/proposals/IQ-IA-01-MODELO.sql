-- Propuesta IA-01. No otorga presupuesto ni autorización de tratamiento.
begin;

alter table public.review_report_allowances
  drop constraint review_report_allowances_model_check,
  add constraint review_report_allowances_model_check
    check (model in ('gpt-4.1-mini-2025-04-14', 'gpt-6-luna')),
  add column luna_processing_authorized_at timestamptz;

-- Una autorización por generación adicional y período, registrada por la autoridad
-- que administra el presupuesto. La aplicación carece de permisos para emitirla.
create table public.review_report_extra_approvals (
  organization_id uuid not null references public.organizations(id),
  year integer not null check (year between 2020 and 2200),
  generation_number integer not null check (generation_number >= 2),
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) between 1 and 3000),
  primary key (organization_id, year, generation_number)
);
alter table public.review_report_extra_approvals enable row level security;
revoke all on public.review_report_extra_approvals from public, anon, authenticated, service_role;

create function public.iq_ia01_annual_slot(p_org uuid, p_year integer)
returns boolean language sql stable security invoker set search_path='' as $$
  with period as (
    select count(*) as used from public.review_report_runs
    where organization_id=p_org and year=p_year
  )
  select used=0 or exists (
    select from public.review_report_extra_approvals
    where organization_id=p_org and year=p_year and generation_number=used+1
  ) from period;
$$;
revoke all on function public.iq_ia01_annual_slot(uuid,integer) from public,anon,authenticated,service_role;

create function public.iq_ia01_available(p_year integer, p_model text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.iq_re05_available() and exists (
    select from public.review_report_allowances a where a.organization_id=public.iq_re04_org()
    and a.model=p_model and a.luna_processing_authorized_at<=now()
  ) and public.iq_ia01_annual_slot(public.iq_re04_org(),p_year);
$$;
revoke all on function public.iq_ia01_available(integer,text) from public,anon;
grant execute on function public.iq_ia01_available(integer,text) to authenticated;

-- El contrato RE-05 ya serializa las reservas con FOR UPDATE sobre el
-- presupuesto y recupera la operación idempotente antes del INSERT.
create function public.iq_ia01_check_reservation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select from public.review_report_allowances a
    where a.organization_id=new.organization_id and a.model=new.model
      and a.luna_processing_authorized_at<=now() for update
  ) then raise exception 'IA01_PROCESSING_NOT_AUTHORIZED'; end if;
  if not public.iq_ia01_annual_slot(new.organization_id,new.year) then
    raise exception 'IA01_ANNUAL_LIMIT';
  end if;
  return new;
end $$;
revoke all on function public.iq_ia01_check_reservation() from public,anon,authenticated,service_role;
create trigger review_report_luna_reservation before insert on public.review_report_runs
for each row when (new.model='gpt-6-luna') execute function public.iq_ia01_check_reservation();

-- Una autorización extraordinaria permite una nueva operación incluso con la
-- misma fotografía. Un reintento del mismo identificador siempre se recupera.
create or replace function public.iq_re05_reserve(p_id uuid,p_snapshot jsonb,p_model text,p_instructions text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=(p_snapshot->>'organization')::uuid; actor_id uuid:=(p_snapshot->>'actor')::uuid;
 yr int:=(p_snapshot->>'year')::int; fp text:=p_snapshot->>'fingerprint'; a public.review_report_allowances; r public.review_report_runs;
begin
 if not exists(select 1 from public.profiles where id=actor_id and organization_id=org and user_type='administrator' and status='active' and workspace_mode='production')
 or yr>extract(year from now() at time zone 'America/Mexico_City') then raise exception 'RE05_DENIED'; end if;
 select * into a from public.review_report_allowances where organization_id=org for update;
 if not found or a.expires_at<=now() or a.model<>p_model then raise exception 'RE05_UNAVAILABLE'; end if;
 select * into r from public.review_report_runs where id=p_id;
 if found then
   if r.organization_id<>org or r.year<>yr or r.fingerprint<>fp or r.actor<>actor_id then raise exception 'RE05_CONFLICT'; end if;
   return jsonb_build_object('id',r.id,'dispatch',false,'state',r.state);
 end if;
 select * into r from public.review_report_runs where organization_id=org and year=yr and
 (state in ('processing','uncertain') or (state='completed' and fingerprint=fp and model=p_model and instructions=p_instructions
     and (p_model<>'gpt-6-luna' or not public.iq_ia01_annual_slot(org,yr))))
 order by started_at desc limit 1;
 if found then return jsonb_build_object('id',r.id,'dispatch',false,'state',r.state); end if;
 if a.monthly_generations<=(select count(*) from public.review_report_runs where organization_id=org
 and date_trunc('month',started_at at time zone 'America/Mexico_City')=date_trunc('month',now() at time zone 'America/Mexico_City')) then raise exception 'RE05_BUDGET'; end if;
 insert into public.review_report_runs(id,organization_id,year,actor,state,fingerprint,snapshot,snapshot_hash,provider,model,instructions)
 values(p_id,org,yr,actor_id,'processing',fp,p_snapshot,encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex'),a.provider,a.model,p_instructions);
 return jsonb_build_object('id',p_id,'dispatch',true,'state','processing');
end $$;

-- Se conservan usos y costos históricos. Los tokens de Luna quedan registrados
-- y su importe queda pendiente de conciliación con la facturación real.
create or replace function public.iq_re05_finish(p_id uuid,p_state text,p_report jsonb,p_input int,p_output int)
returns void language plpgsql security definer set search_path='' as $$
declare r public.review_report_runs; next_revision int;
begin
 select * into strict r from public.review_report_runs where id=p_id for update;
 if r.state='completed' then return; end if;
 if r.state<>'processing' or p_state not in ('completed','uncertain','failed') or
 ((p_state='completed') is distinct from (p_report is not null)) then raise exception 'RE05_STATE'; end if;
 if p_state='completed' then
 select coalesce(max(revision),0)+1 into next_revision from public.review_report_runs where organization_id=r.organization_id and year=r.year;
 end if;
 update public.review_report_runs set state=p_state,finished_at=now(),report=p_report,revision=next_revision,
 input_tokens=p_input,output_tokens=p_output,cost_usd=case when r.model='gpt-4.1-mini-2025-04-14' then (p_input*0.40+p_output*1.60)/1000000 end where id=p_id;
end $$;
commit;
