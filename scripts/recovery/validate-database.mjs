import { createClient } from "@supabase/supabase-js";

import {
  assertRecoveryEnvironment,
  loadBackup,
  pipeToCommand,
  recoveryDbContainer,
  recoveryEnv,
  requireCommand,
  writeEvidence,
} from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY local.");
requireCommand("docker");
const backup = await loadBackup(env);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const comparisons = [];
for (const [table, expected] of Object.entries(backup.manifest.tables)) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  comparisons.push({ table, expected, actual: count, result: !error && count === expected ? "PASS" : "FAIL", error: error?.message });
}

const fkValidationSql = String.raw`\set ON_ERROR_STOP on
do $$
declare
  item record;
  join_expression text;
  present_expression text;
  broken bigint;
begin
  for item in
    select constraint_row.oid, constraint_row.conname,
           constraint_row.conrelid::regclass::text as child_table,
           constraint_row.confrelid::regclass::text as parent_table,
           constraint_row.conkey, constraint_row.confkey
    from pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.connamespace = 'public'::regnamespace
  loop
    select string_agg(format('child.%I = parent.%I', child_attribute.attname, parent_attribute.attname), ' and ' order by key_pair.position),
           string_agg(format('child.%I is not null', child_attribute.attname), ' and ' order by key_pair.position)
      into join_expression, present_expression
    from unnest(item.conkey, item.confkey) with ordinality as key_pair(child_number, parent_number, position)
    join pg_attribute child_attribute on child_attribute.attrelid = (select conrelid from pg_constraint where oid = item.oid) and child_attribute.attnum = key_pair.child_number
    join pg_attribute parent_attribute on parent_attribute.attrelid = (select confrelid from pg_constraint where oid = item.oid) and parent_attribute.attnum = key_pair.parent_number;
    execute format('select count(*) from %s child where %s and not exists (select 1 from %s parent where %s)', item.child_table, present_expression, item.parent_table, join_expression) into broken;
    if broken > 0 then
      raise exception 'FK rota: % en % (% registros)', item.conname, item.child_table, broken;
    end if;
  end loop;
end $$;
`;
let foreignKeys = "PASS";
try {
  await pipeToCommand("docker", ["exec", "-i", recoveryDbContainer(env), "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc"], fkValidationSql, { env });
} catch (error) {
  foreignKeys = `FAIL: ${error.message}`;
}

const failed = comparisons.filter((item) => item.result === "FAIL");
const evidence = {
  result: failed.length === 0 && foreignKeys === "PASS" ? "PASS" : "FAIL",
  tables: { expected: comparisons.length, passed: comparisons.length - failed.length, failed: failed.length },
  rows: {
    expected: comparisons.reduce((sum, item) => sum + Number(item.expected), 0),
    actual: comparisons.reduce((sum, item) => sum + Number(item.actual ?? 0), 0),
  },
  foreignKeys,
  comparisons,
};
await writeEvidence("database-validation", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
