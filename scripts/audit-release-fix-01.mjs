import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assessCompatibility(snapshot, migrationFiles, pendingSql) {
  const knownVersions = new Set(migrationFiles.map(name => name.split('_', 1)[0]));
  const missingAppliedSources = snapshot.appliedMigrations.filter(m => !knownVersions.has(m.version));
  const liveTables = new Set(snapshot.tables);
  const requiredTables = [...new Set(pendingSql.flatMap(sql => [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(public\.[a-z_]+)/gi)].map(match => match[1])))];
  const prohibitedNewTables = requiredTables.filter(name => !liveTables.has(name));
  const hasColumn = (table, column) => snapshot.contracts.find(t => t.name === table)?.columns.some(c => c.name === column) === true;
  const missingPeriodColumns = ['capture_rule_source', 'capture_exception_reason'].filter(c => !hasColumn('public.indicator_periods', c));
  const missingWorkspaceColumns = ['controlled_documents', 'file_objects', 'document_folders', 'document_upload_batches'].filter(t => !hasColumn(`public.${t}`, 'workspace_mode'));
  const blockers = [];
  if (missingAppliedSources.length) blockers.push('APPLIED_MIGRATION_SOURCE_MISSING');
  if (prohibitedNewTables.length) blockers.push('PENDING_SQL_CREATES_FORBIDDEN_TABLES');
  if (missingPeriodColumns.length) blockers.push('STB01_EXCEPTION_SCHEMA_EXTENSION_REQUIRED');
  if (missingWorkspaceColumns.length) blockers.push('DOCUMENT_WORKSPACE_SCHEMA_EXTENSION_REQUIRED');
  return { status: blockers.length ? 'BLOCKED' : 'METADATA_ONLY_PENDING_RUNTIME_ACCEPTANCE', blockers, missingAppliedSources, prohibitedNewTables, missingPeriodColumns, missingWorkspaceColumns, databaseWritesExecuted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const snapshot = readJson('docs/releases/RELEASE-FIX-01-schema.json');
  const manifest = readJson('scripts/integration-migrations.json');
  const report = assessCompatibility(snapshot, readdirSync('supabase/migrations'), manifest.pending.map(item => readFileSync(item.path, 'utf8')));
  console.log(JSON.stringify(report, null, 2));
  // An audit can succeed while release readiness is BLOCKED. Never calls SQL or a network API.
  if (process.argv.includes('--require-ready') && report.status !== 'METADATA_ONLY_PENDING_RUNTIME_ACCEPTANCE') process.exitCode = 1;
}
