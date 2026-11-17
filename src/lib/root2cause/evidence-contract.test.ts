import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const sql=readFileSync('docs/database/proposals/IQ-ROOT2CAUSE-20-EVIDENCE.sql','utf8');
it('adds guards only without modifying historical rows or adding tables',()=>{expect(sql).not.toMatch(/\b(drop|truncate|create\s+table)\b/i);expect(sql).not.toMatch(/^\s*(update|delete from)\s/im);});
it('scopes evidence to authenticated active internal actors and organization',()=>{expect(sql).toContain("status='active'");expect(sql).toContain('w.workspace_id=actor.organization_id');expect(sql).toContain('p.organization_id=actor.organization_id');});
it('requires explicit action membership and preserves closed records',()=>{expect(sql).toContain("participantUserIds");expect(sql).toContain("item->>'status'='closed'");});
it('restricts only the Root2Cause namespace without changing other modules',()=>{expect(sql).toContain("resource_type<>'root2cause_evidence'");expect(sql).toContain("name not like '%/attachments/corrective-actions/root2cause_evidence/%'");expect(sql).not.toContain('supplier_rncp');});
it('prevents cross-record reassignment and physical deletion',()=>{expect(sql).toContain('Root2Cause evidence identity is immutable');expect(sql).toContain('as restrictive for delete');});
it('creates authentic before/after audit events and rejects client forgeries',()=>{expect(sql).toContain('previous_value,new_value');expect(sql).toContain("action not like 'root2cause.evidence.%'");expect(sql).toContain('to_jsonb(old)');});
it('exposes a contract only after guards, inside one transaction',()=>{expect(sql.indexOf('create function public.iq_root2cause_evidence_contract')).toBeGreaterThan(sql.indexOf('create policy root2cause_storage_delete_guard'));expect(sql).toMatch(/begin;[\s\S]*commit;/);});

it('checks the saved closed action before accepting a stale draft grant',()=>{expect(sql.indexOf("item->>'status'='closed'")).toBeLessThan(sql.indexOf("select payload->'draft' into draft"));});

it('requires the saved process to match file metadata and actor access',()=>{expect(sql).toContain("p_process<>case_process");expect(sql).toContain('public.has_process_access(case_process)');expect(sql).toContain('iq_root2cause_evidence_access(resource_key,process_id,false,uploaded_by)');expect(sql).toContain('iq_root2cause_evidence_access(resource_key,process_id,true,uploaded_by)');});
