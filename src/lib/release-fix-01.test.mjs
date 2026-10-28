import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { assessCompatibility } from '../../scripts/audit-release-fix-01.mjs';
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const snapshot = readJson('docs/releases/RELEASE-FIX-01-schema.json');
const manifest = readJson('scripts/integration-migrations.json');
const sql = manifest.pending.map(item => readFileSync(item.path, 'utf8'));
const files = readdirSync('supabase/migrations');
describe('RELEASE-FIX-01 existing schema compatibility', () => {
  it('does not mistake generic audit/files/settings tables for the four proposed specialized tables', () => {
    expect(assessCompatibility(snapshot, files, sql).prohibitedNewTables.sort()).toEqual(['public.document_retention_events', 'public.home_image_versions', 'public.indicator_capture_operations', 'public.indicator_capture_rules']);
  });
  it('detects the applied migration missing from Git without inventing its SQL', () => {
    expect(assessCompatibility(snapshot, files, sql).missingAppliedSources).toEqual([{ version: '202610120001', name: 'indicator_evidence_storage_permissions' }]);
  });
  it('requires exception metadata and stable workspace isolation without changing existing rows', () => {
    const report = assessCompatibility(snapshot, files, sql);
    expect(report.missingPeriodColumns).toEqual(['capture_rule_source', 'capture_exception_reason']);
    expect(report.missingWorkspaceColumns).toEqual(['controlled_documents', 'file_objects', 'document_folders', 'document_upload_batches']);
    expect(report.status).toBe('BLOCKED'); expect(report.databaseWritesExecuted).toBe(false);
  });
  it('does not declare runtime or publication acceptance from compatible metadata alone', () => {
    const simulated = structuredClone(snapshot);
    for (const t of simulated.contracts) {
      if (t.name === 'public.indicator_periods') t.columns.push({name:'capture_rule_source'}, {name:'capture_exception_reason'});
      if (['public.controlled_documents','public.file_objects','public.document_folders','public.document_upload_batches'].includes(t.name)) t.columns.push({name:'workspace_mode'});
    }
    expect(assessCompatibility(simulated, [...files, '202610120001_original.sql'], []).status).toBe('METADATA_ONLY_PENDING_RUNTIME_ACCEPTANCE');
  });
});
