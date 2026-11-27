-- RE-05. El expediente anual se identifica por organización y año.
-- El índice por período del modelo anterior es global. Se conservan todas sus filas.
begin;
create table public.review_report_allowances (
  organization_id uuid primary key references public.organizations(id),
  expires_at timestamptz not null,
  monthly_generations integer not null check(monthly_generations between 1 and 100),
  provider text not null check(provider='openai'),
  model text not null check(model='gpt-4.1-mini-2025-04-14')
);
-- Sin filas iniciales: presupuesto autorizado de cero.
create table public.review_report_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  year integer not null check(year between 2020 and 2200),
  actor uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  state text not null check(state in ('processing','completed','failed','uncertain')),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null, snapshot_hash text not null check(length(snapshot_hash)=64),
  provider text not null, model text not null, instructions text not null,
  report jsonb, revision integer, input_tokens integer check(input_tokens>=0),
  output_tokens integer check(output_tokens>=0), cost_usd numeric check(cost_usd>=0),
  unique(organization_id,year,revision),
  check((state='completed')=(report is not null and revision is not null))
);
create unique index review_report_one_running on public.review_report_runs(organization_id,year) where state in ('processing','uncertain');
create index review_report_usage on public.review_report_runs(organization_id,started_at);
create table public.review_report_events (
  id uuid primary key, run_id uuid not null references public.review_report_runs(id),
  sequence integer not null, actor uuid not null references public.profiles(id),
  position_name text, created_at timestamptz not null default now(),
  command text not null check(command in ('edit','submit','validate','authorize','return','proposal')),
  stage text not null check(stage in ('draft','validation','direction','authorized')),
  reason text not null check(length(trim(reason)) between 1 and 3000),
  conclusion text not null, content_hash text not null,
  proposal text, decision_id uuid references public.management_review_decisions(id),
  unique(run_id,sequence), unique(run_id,proposal)
);
alter table public.review_report_allowances enable row level security;
alter table public.review_report_runs enable row level security;
alter table public.review_report_events enable row level security;
revoke all on public.review_report_allowances,public.review_report_runs,public.review_report_events from public,anon,authenticated;
grant select on public.review_report_runs,public.review_report_events to authenticated;
create policy executive_report_read on public.review_report_runs for select to authenticated
 using(organization_id=public.iq_re04_org() and (public.is_administrator() or public.iq_re04_director()));
create policy executive_report_events_read on public.review_report_events for select to authenticated
 using(exists(select 1 from public.review_report_runs r where r.id=run_id));
create function public.iq_re05_years() returns setof integer language sql stable security invoker set search_path='' as $$
  select distinct r.year from public.review_report_runs r where r.state='completed' order by r.year desc;
$$;
revoke all on function public.iq_re05_years() from public,anon;
grant execute on function public.iq_re05_years() to authenticated;
create function public.iq_re05_available() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_administrator() and exists(select 1 from public.review_report_allowances a
 where a.organization_id=public.iq_re04_org() and a.expires_at>now() and a.monthly_generations>(
 select count(*) from public.review_report_runs r where r.organization_id=a.organization_id and
 date_trunc('month',r.started_at at time zone 'America/Mexico_City')=date_trunc('month',now() at time zone 'America/Mexico_City')));
$$;
-- Se invoca sólo desde el servidor después de recopilar las fuentes con la sesión RLS.
create function public.iq_re05_reserve(p_id uuid,p_snapshot jsonb,p_model text,p_instructions text)
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
 (state in ('processing','uncertain') or (state='completed' and fingerprint=fp and model=p_model and instructions=p_instructions))
 order by started_at desc limit 1;
 if found then return jsonb_build_object('id',r.id,'dispatch',false,'state',r.state); end if;
 if a.monthly_generations<=(select count(*) from public.review_report_runs where organization_id=org
 and date_trunc('month',started_at at time zone 'America/Mexico_City')=date_trunc('month',now() at time zone 'America/Mexico_City')) then raise exception 'RE05_BUDGET'; end if;
 insert into public.review_report_runs(id,organization_id,year,actor,state,fingerprint,snapshot,snapshot_hash,provider,model,instructions)
 values(p_id,org,yr,actor_id,'processing',fp,p_snapshot,encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex'),a.provider,a.model,p_instructions);
 return jsonb_build_object('id',p_id,'dispatch',true,'state','processing');
end $$;
create function public.iq_re05_finish(p_id uuid,p_state text,p_report jsonb,p_input int,p_output int)
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
 input_tokens=p_input,output_tokens=p_output,cost_usd=(p_input*0.40+p_output*1.60)/1000000 where id=p_id;
end $$;
create function public.iq_re05_review(p_id uuid,p_run uuid,p_expected int,p_command text,p_reason text,p_text text default null,p_proposal text default null)
returns int language plpgsql security definer set search_path='' as $$
declare r public.review_report_runs; prior public.review_report_events; existing public.review_report_events;
 s text; n int; note text; position_label text; proposal_data jsonb; decision uuid;
begin
 select * into r from public.review_report_runs where id=p_run and organization_id=public.iq_re04_org() and state='completed' for update;
 if not found or not(public.is_administrator() or public.iq_re04_director()) then raise exception 'RE05_DENIED'; end if;
 if (p_command='proposal') is distinct from (p_proposal is not null) then raise exception 'RE05_COMMAND'; end if;
 select * into existing from public.review_report_events where id=p_id;
 if found then
 if existing.run_id<>r.id or existing.actor<>auth.uid() or existing.command<>p_command or existing.reason<>p_reason or existing.proposal is distinct from p_proposal
 or (p_command='edit' and existing.conclusion is distinct from p_text) then raise exception 'RE05_CONFLICT'; end if;
 return existing.sequence;
 end if;
 select * into prior from public.review_report_events where run_id=p_run order by sequence desc limit 1;
 s:=coalesce(prior.stage,'draft');n:=coalesce(prior.sequence,0);note:=coalesce(prior.conclusion,'');
 if n is distinct from p_expected then raise exception 'RE05_CHANGED'; end if;
 if p_command='authorize' and s='direction' and public.iq_re04_director() and auth.uid() is distinct from
 (select v.actor from public.review_report_events v where v.run_id=r.id and v.command='validate' order by v.sequence desc limit 1) then s:='authorized';
 elsif p_command='return' and ((s='direction' and public.iq_re04_director()) or (s='validation' and public.is_administrator())) then s:='draft';
 elsif p_command='validate' and s='validation' and public.is_administrator() then s:='direction';
 elsif p_command='submit' and s='draft' and public.is_administrator() then s:='validation';
 elsif p_command='edit' and s='draft' and public.is_administrator() and length(trim(p_text)) between 1 and 12000 then note:=p_text;
 elsif p_command='proposal' and public.is_administrator() then
   select value into strict proposal_data from jsonb_array_elements(r.report->'proposals') where value->>'id'=p_proposal;
   decision:=gen_random_uuid();
   perform public.iq_re04_send(p_id,decision,null,'create',0,jsonb_build_object('year',extract(year from now() at time zone 'America/Mexico_City')::int,'date',(now() at time zone 'America/Mexico_City')::date,
      'classification','improvement','section','outputs','title',proposal_data->>'title','description',proposal_data->>'description',
      'priority','medium','actionable',false,'justification',p_reason));
 else raise exception 'RE05_DENIED'; end if;
 select position_name into position_label from public.profiles where id=auth.uid();
 insert into public.review_report_events(id,run_id,sequence,actor,position_name,command,stage,reason,conclusion,content_hash,proposal,decision_id)
 values(p_id,p_run,n+1,auth.uid(),position_label,p_command,s,p_reason,note,encode(sha256(convert_to(jsonb_build_array(r.report,r.snapshot,note)::text,'UTF8')),'hex'),p_proposal,decision);
 return n+1;
end $$;
revoke all on function public.iq_re05_available(),public.iq_re05_review(uuid,uuid,int,text,text,text,text),
 public.iq_re05_reserve(uuid,jsonb,text,text),public.iq_re05_finish(uuid,text,jsonb,int,int) from public,anon,authenticated;
grant execute on function public.iq_re05_available(),public.iq_re05_review(uuid,uuid,int,text,text,text,text) to authenticated;
grant execute on function public.iq_re05_reserve(uuid,jsonb,text,text),public.iq_re05_finish(uuid,text,jsonb,int,int) to service_role;
commit;
