import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("docs/database/proposals/IQ-ROOT2CAUSE-20-FLOW.sql", "utf8");

it("proposes a global, non-yearly AC sequence without renumbering records", () => {
  expect(sql).toContain("create sequence if not exists public.root2cause_ac_seq");
  expect(sql).toContain("nextval('public.root2cause_ac_seq')");
  expect(sql).toContain("^AC-(?:[0-9]{4}-)?([0-9]+)$");
  expect(sql).not.toMatch(/^\s*(update|delete from|truncate)\s+public\.corrective_actions/im);
});

it("limits create RPC by authenticated actor, module permission, organization and process", () => {
  expect(sql).toContain("auth.uid() is null");
  expect(sql).toContain("public.has_module_permission('corrective-actions','create')");
  expect(sql).toContain("public.has_process_access(process_value)");
  expect(sql).toContain("o.owning_organization_id = actor.organization_id");
});

it("makes repeated create requests idempotent and conflicts on a changed payload", () => {
  expect(sql).toContain("create_request_fingerprint");
  expect(sql).toContain("existing.create_request_fingerprint is distinct from fingerprint");
  expect(sql).toContain("return jsonb_build_object('id', existing.id, 'folio', existing.folio");
});

it("stores additive cause, plan and reference metadata with an audit event in the same transaction", () => {
  expect(sql).toContain("add column if not exists external_reference text");
  expect(sql).toContain("add column if not exists workflow_metadata jsonb");
  expect(sql).toContain("add column if not exists cause_reference_id uuid");
  expect(sql).toContain("previous_value, new_value, reason, metadata");
  expect(sql).toMatch(/begin;[\s\S]*commit;/);
});

it("grants only the create RPC to authenticated callers and never invokes it during migration", () => {
  expect(sql).toContain("revoke all on function public.iq_root2cause_create_action(jsonb) from public, anon");
  expect(sql).toContain("grant execute on function public.iq_root2cause_create_action(jsonb) to authenticated");
  expect(sql).not.toMatch(/^\s*select\s+public\.iq_root2cause_create_action/im);
});
