import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRecoveryEnvironment,
  escapeIdentifier,
  loadBackup,
  manifestTotals,
  pipeToCommand,
  recoveryDbContainer,
  recoveryEnv,
  requireCommand,
  writeEvidence,
} from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
requireCommand("docker");
const backup = await loadBackup(env);
const tables = Object.keys(backup.manifest.tables).sort();
const tableList = tables.map((table) => `public.${escapeIdentifier(table)}`).join(", ");
const statements = [
  "\\set ON_ERROR_STOP on",
  "begin;",
  "set local session_replication_role = replica;",
  `truncate table ${tableList} restart identity cascade;`,
];

for (const table of tables) {
  const rows = JSON.parse(await readFile(join(backup.root, "database", `${table}.json`), "utf8"));
  if (!rows.length) continue;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const identifiers = columns.map(escapeIdentifier).join(", ");
  const tag = `$recovery_${table}$`;
  const json = JSON.stringify(rows);
  if (json.includes(tag)) throw new Error(`El contenido de ${table} colisiona con el delimitador SQL.`);
  statements.push(
    `insert into public.${escapeIdentifier(table)} (${identifiers}) overriding system value`,
    `select ${identifiers} from json_populate_recordset(null::public.${escapeIdentifier(table)}, ${tag}${json}${tag}::json);`,
  );
}
statements.push("set local session_replication_role = origin;", "commit;", "");

const startedAt = new Date();
await pipeToCommand("docker", [
  "exec", "-i", recoveryDbContainer(env), "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc",
], statements.join("\n"), { env });
const evidence = {
  result: "PASS",
  backupId: backup.id,
  strategy: "MIGRATIONS_THEN_JSON_DATA",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  ...manifestTotals(backup.manifest),
};
await writeEvidence("database-restore", evidence);
console.log(JSON.stringify(evidence, null, 2));
