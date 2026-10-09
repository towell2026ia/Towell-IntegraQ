-- IQ-HOTFIX-IND-MASTER-01B: make explicit evaluation expressions authoritative.
-- This migration changes no indicator master data and creates no results.

begin;

create or replace function public.indicator_rule_expression_matches(
  measured_value numeric,
  rule_expression text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_expression text;
  alternative text;
  condition text;
  condition_match text[];
  comparison_operator text;
  target numeric;
  alternative_matches boolean;
begin
  if measured_value is null or length(pg_catalog.btrim(coalesce(rule_expression, ''))) = 0 then
    return false;
  end if;

  normalized_expression := pg_catalog.replace(
    pg_catalog.replace(rule_expression, '≥', '>='),
    '≤',
    '<='
  );

  foreach alternative in array pg_catalog.regexp_split_to_array(normalized_expression, '\s*;\s*') loop
    if length(pg_catalog.btrim(alternative)) = 0 then
      continue;
    end if;

    alternative_matches := true;
    foreach condition in array pg_catalog.regexp_split_to_array(alternative, '\s*,\s*') loop
      condition_match := pg_catalog.regexp_match(
        pg_catalog.btrim(condition),
        '^(>=|<=|>|<|=)\s*(-?[0-9]+([.][0-9]+)?)\s*$'
      );

      if condition_match is null then
        alternative_matches := false;
        exit;
      end if;

      comparison_operator := condition_match[1];
      target := condition_match[2]::numeric;
      alternative_matches := case comparison_operator
        when '>=' then measured_value >= target
        when '<=' then measured_value <= target
        when '>' then measured_value > target
        when '<' then measured_value < target
        when '=' then measured_value = target
        else false
      end;

      if not alternative_matches then
        exit;
      end if;
    end loop;

    if alternative_matches then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

do $$
begin
  if public.indicator_rule_expression_matches(5999, '>6000,<14000')
    or public.indicator_rule_expression_matches(6000, '>6000,<14000')
    or not public.indicator_rule_expression_matches(6001, '>6000,<14000')
    or not public.indicator_rule_expression_matches(13999, '>6000,<14000')
    or public.indicator_rule_expression_matches(14000, '>6000,<14000')
    or public.indicator_rule_expression_matches(14001, '>6000,<14000') then
    raise exception 'Strict indicator evaluation contract failed.';
  end if;
end;
$$;

create or replace function public.evaluate_indicator_value(
  requested_indicator_id uuid,
  measured_value numeric
)
returns public.indicator_result_status
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rule public.indicator_evaluation_rules%rowtype;
begin
  select *
  into rule
  from public.indicator_evaluation_rules
  where indicator_id = requested_indicator_id;

  if not found then
    raise exception 'El indicador no tiene reglas de evaluación.';
  end if;

  if public.indicator_rule_expression_matches(measured_value, rule.compliant_rule) then
    return 'compliant';
  end if;

  if public.indicator_rule_expression_matches(measured_value, rule.marginal_rule) then
    return 'marginal';
  end if;

  if public.indicator_rule_expression_matches(measured_value, rule.noncompliant_rule) then
    return 'noncompliant';
  end if;

  -- Fail closed when an administrative rule set is incomplete or malformed.
  return 'noncompliant';
end;
$$;

comment on function public.indicator_rule_expression_matches(numeric, text) is
  'Evaluates explicit indicator expressions with OR alternatives separated by semicolons and AND conditions separated by commas.';

comment on function public.evaluate_indicator_value(uuid, numeric) is
  'Evaluates indicator values from compliant_rule, marginal_rule and noncompliant_rule without inferring inclusive boundaries from rule_type.';

commit;
