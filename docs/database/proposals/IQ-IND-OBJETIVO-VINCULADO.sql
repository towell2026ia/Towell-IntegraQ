-- Propuesta local: no ejecutar sin autorización. Sólo actualiza quality_objective.
begin;
create function public.iq_indicator_set_quality_objective(p_code text, p_expected_updated_at timestamptz, p_objective text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; target public.indicator_definitions%rowtype; next_objective text;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active'
    and user_type in ('administrator','internal') and workspace_mode = 'production';
  if actor.id is null or not public.has_module_permission('indicators','update') then
    raise exception using errcode = '42501', message = 'INDICATOR_OBJECTIVE_DENIED';
  end if;
  next_objective := nullif(trim(coalesce(p_objective,'')), '');
  if next_objective is not null and next_objective <> all(array[
    'Mantener y mejorar continuamente nuestro Sistema de Gestión de la Calidad.',
    'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.',
    'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.',
    'Capacitar y desarrollar a nuestro equipo para que alcance su máximo potencial.',
    'Implementar prácticas sostenibles que protejan el medio ambiente.'
  ]) then raise exception using errcode = '22023', message = 'INDICATOR_OBJECTIVE_INVALID'; end if;
  select * into target from public.indicator_definitions
    where code = p_code and organization_id = actor.organization_id and workspace_mode = 'production'
      and active and (actor.user_type = 'administrator' or public.has_process_document_role(process_id,'modifier'));
  if target.id is null then raise exception using errcode = '42501', message = 'INDICATOR_OBJECTIVE_DENIED'; end if;
  select * into target from public.indicator_definitions where id = target.id for update;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception 'INDICATOR_OBJECTIVE_CONFLICT';
  end if;
  if target.quality_objective is not distinct from next_objective then return target.updated_at; end if;
  update public.indicator_definitions set quality_objective = next_objective
    where id = target.id returning updated_at into target.updated_at;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,
    previous_value,new_value,reason,user_name_snapshot)
  values(actor.id,actor.organization_id,'indicators','indicator.objective.changed','indicator_definition',target.id::text,
    jsonb_build_object('qualityObjective',target.quality_objective),jsonb_build_object('qualityObjective',next_objective),
    'Cambio manual de vínculo',actor.full_name);
  return target.updated_at;
end $$;
revoke all on function public.iq_indicator_set_quality_objective(text,timestamptz,text) from public,anon;
grant execute on function public.iq_indicator_set_quality_objective(text,timestamptz,text) to authenticated;
commit;
