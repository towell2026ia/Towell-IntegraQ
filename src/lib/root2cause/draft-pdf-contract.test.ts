import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("docs/database/proposals/IQ-ROOT2CAUSE-20-DRAFT-PDF.sql", "utf8");

describe("Root2Cause persisted draft and PDF contract", () => {
  it("uses revision locking and safe replay for a lost initial-save response", () => {
    expect(sql).toContain("revision<>p_expected_revision");
    expect(sql).toContain("on conflict (id) do nothing returning id into inserted_id");
    expect(sql).toContain("current_draft.payload=p_payload");
    expect(sql).toContain("ROOT2CAUSE_DRAFT_REVISION_CONFLICT");
  });

  it("scopes draft access to active internal users, organization, process and module permission", () => {
    expect(sql).toContain("public.has_module_permission('corrective-actions','view')");
    expect(sql).toContain("public.has_process_access(process_id)");
    expect(sql).toContain("organization_id=(select p.organization_id");
    expect(sql).toContain("p.status='active'");
  });

  it("keeps finalized evidence readable while preventing draft-only mutation after closure", () => {
    expect(sql).toContain("d.status in ('draft','finalized')");
    expect(sql).toContain("ca.status<>'closed'");
    expect(sql).toContain("public.iq_root2cause_register_official_pdf");
    expect(sql).toContain("root2cause-official-pdf/");
  });

  it("checks process scope before returning an idempotent finalized result", () => {
    const start = sql.indexOf("function public.iq_root2cause_finalize_draft");
    const end = sql.indexOf("create or replace function public.iq_root2cause_draft_audit", start);
    const body = sql.slice(start, end);
    expect(body.indexOf("public.has_process_access(d.process_id)")).toBeGreaterThan(-1);
    expect(body.indexOf("public.has_process_access(d.process_id)")).toBeLessThan(body.indexOf("if d.status='finalized'"));
  });

  it("makes PDF registration backend-only and binds metadata to the stored PDF", () => {
    expect(sql).toContain("register_official_pdf(p_actor_id uuid,p_action_id uuid,p_file jsonb)");
    expect(sql).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(sql).toContain("stored_object.metadata->>'mimetype'");
    expect(sql).toContain("stored_object.metadata->>'size'");
    expect(sql).toContain("lower(p_file->>'sha256')||'.pdf'");
    expect(sql).toContain("from public,anon,authenticated");
    expect(sql).toContain("to service_role");
  });

  it("preserves old drafts and documents without destructive data statements", () => {
    expect(sql).not.toMatch(/^\s*(drop|truncate|delete\s+from)\b/im);
    expect(sql).not.toMatch(/^\s*update\s+public\.(corrective_actions|corrective_action_a3|corrective_action_plans)\b/im);
    expect(sql).toMatch(/begin;[\s\S]*commit;/i);
  });
});
