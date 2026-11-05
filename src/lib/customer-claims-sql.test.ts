import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {describe,it,expect} from "vitest";
const versioned=readdirSync(join(process.cwd(),"supabase/migrations")).find(f=>f.endsWith("_customer_claims_stage1.sql"));
const sql=readFileSync(join(process.cwd(),versioned?`supabase/migrations/${versioned}`:"supabase/operations/customer-claims-stage1.sql"),"utf8").toLowerCase();
describe("claim migration scope and transaction security contract",()=>{
 it("also guards A3 foreign keys for direct requests, preserving existing links",()=>{
  const name=readdirSync(join(process.cwd(),"supabase/migrations")).find(f=>f.endsWith("_customer_claim_link_guard.sql"));
  const guard=readFileSync(join(process.cwd(),name?`supabase/migrations/${name}`:"supabase/operations/customer-claim-link-guard.sql"),"utf8");
  expect(guard).toContain("new.external_organization_id is distinct from claim.external_organization_id");
  expect(guard).toContain("o.owning_organization_id=new.organization_id");
  expect(guard).toContain("A3_EXISTING_CLAIM_LINK_IMMUTABLE");
  expect(guard).toContain("new_link and claim.cancelled_at is not null");
  expect(guard).toContain("for share");
  expect(guard).not.toMatch(/\b(update\s+public\.|delete\s+from|insert\s+into|security definer)\b/i);
 });
 it("adds cancellation metadata without deleting historical rows or changing existing policies",()=>{
  expect(sql).not.toMatch(/\b(drop\s+(?:table|policy)|truncate|delete\s+from|create\s+table)\b/);
  expect(sql).not.toMatch(/alter table public\.(?!(quality_cases|corrective_actions)\b)/);
  expect(sql).toContain("alter table public.corrective_actions drop constraint corrective_actions_quality_case_id_key");
  expect(sql).toContain("create index corrective_actions_quality_case_claim_idx");
  for(const field of ["cancelled_at","cancelled_by","cancellation_reason"])expect(sql).toContain(`add column if not exists ${field}`);
 });
 it("restricts direct claim and evidence writes despite permissive OR policies",()=>{
  for(const table of ["quality_cases","file_objects"])for(const action of ["insert","update","delete"])expect(sql).toMatch(new RegExp(`on public\\.${table} as restrictive for ${action} to authenticated`));
  expect(sql).toContain("create policy iq_claim_storage_server_only on storage.objects as restrictive for all");
  expect(sql).toContain("before update on public.file_objects");
  expect(sql).toContain("before update on public.quality_cases");
 });
 it("exposes the atomic command to service_role only and validates actor, tenant, and client linkage again",()=>{
  expect(sql).toContain("revoke all on function public.iq_customer_claim_command(uuid,uuid,text,jsonb) from public,anon,authenticated");
  expect(sql).toContain("grant execute on function public.iq_customer_claim_command(uuid,uuid,text,jsonb) to service_role");
  expect(sql).not.toContain("security definer");
  expect(sql).toContain("p.organization_id=workspace_id");
  expect(sql).toContain("external_organization_id=company.id");
  expect(sql).toContain("a3_already_linked");expect(sql).toContain("claim_concurrent_edit");
  expect(sql).toContain("portal_visible=false");expect(sql).toContain("insert into public.audit_log");
  expect(sql).not.toContain("quality_cases.organization_id");
 });
});
