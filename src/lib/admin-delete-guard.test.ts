import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildEmptyRiskWorkspace, buildInitialRiskWorkspace, softDeleteRiskInWorkspace, softDeleteRiskWorkspaceItem, validateRiskWorkspaceEdit } from "@/lib/risk-opportunity-data";

const sql = readFileSync("supabase/migrations/20261102170852_admin_delete_guard.sql", "utf8").replace(/\r\n/g, "\n").toLowerCase();

describe("proposed administrative deletion guard", () => {
  it("adds restrictive physical DELETE guards that compose with permissive ALL policies", () => {
    for (const table of ["corrective_actions", "risk_items", "form_records", "form_definitions", "management_reviews",
      "quality_cases", "organizations", "audits", "audit_programs", "audit_findings", "supplier_quality_evaluations",
      "supplier_assessments", "improvement_projects", "measurement_assets", "workspace_data", "controlled_documents"]) {
      expect(sql).toContain(`on public.${table}\n  as restrictive for delete to authenticated using (false)`);
    }
    expect(sql).toContain("on public.file_objects\n  as restrictive for delete to authenticated using (false)");
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from|disable row level security)\b/);
  });

  it("guards soft-delete metadata and JSON workspace removals without changing read policies", () => {
    expect(sql).toContain("create function public.iq_guard_admin_soft_delete()");
    expect(sql).toContain("public.is_administrator()");
    expect(sql).toContain("current_organization_ids()");
    expect(sql).toContain("delete_reason_actor_required");
    expect(sql).toContain("create trigger iq_admin_delete_guard_shared_workspace");
    expect(sql).toContain("workspace_history_must_remain");
    expect(sql).toContain("workspace_delete_route_required");
    expect(sql).toContain("create policy iq_root2cause_retirements_insert");
    expect(sql).toContain("create policy iq_root2cause_retirements_update");
    expect(sql).toContain("root2cause_retire_history_immutable");
    expect(sql).toContain("root2cause_retire_scope_immutable");
    expect(sql).toContain("before insert or update on public.workspace_data");
    expect(sql).not.toMatch(/\b(create policy|alter policy)\b[^;]*\bfor select\b/);
  });

  it("guards file retirement metadata without restricting normal file updates", () => {
    expect(sql).toContain("create trigger iq_admin_delete_guard_file_objects before update on public.file_objects");
    expect(sql).toContain("elsif tg_table_name = 'file_objects' then");
    expect(sql).toContain("before_row->>'workspace_id'");
    expect(sql).toContain("before_row->>'process_id'");
    expect(sql).toContain("before_row->>'external_organization_id'");
    expect(sql).toContain("public.is_administrator()");
    expect(sql).toContain("delete_reason_actor_required");
    expect(sql).not.toMatch(/create policy[^;]*on public\.file_objects[\s\S]{0,120}for update/i);
  });
});

describe("risk deletion state", () => {
  const base = () => ({ ...buildEmptyRiskWorkspace(), risks: buildInitialRiskWorkspace().risks.slice(0, 1),
    actions: buildInitialRiskWorkspace().actions.slice(0, 1) });

  it("keeps the risk, its action and reason in history while removing it from the operational list", () => {
    const current = base();
    const next = softDeleteRiskInWorkspace(current, current.risks[0].id, "admin-id", "  Duplicado  ", "2026-11-02T00:00:00Z");
    expect(next.risks).toHaveLength(1);
    expect(next.actions).toEqual(current.actions);
    expect(next.risks[0]).toMatchObject({ deletedBy: "admin-id", deletionReason: "Duplicado" });
    expect(next.risks.filter((risk) => !risk.deletedAt)).toHaveLength(0);
    expect(current.risks[0].deletedAt).toBeUndefined();
  });

  it("rejects a normal PUT that omits a risk or forges deletion metadata", () => {
    const current = base();
    expect(validateRiskWorkspaceEdit(current, { ...current, risks: [] })).toMatch(/historial/);
    expect(validateRiskWorkspaceEdit(current, { ...current, actions: [] })).toMatch(/historial/);
    const forged = softDeleteRiskInWorkspace(current, current.risks[0].id, "other", "Motivo", "2026-11-02T00:00:00Z");
    expect(validateRiskWorkspaceEdit(current, forged)).toMatch(/operación administrativa/);
    expect(validateRiskWorkspaceEdit(current, { ...current, cycle: 2027 })).toBeNull();
  });

  it("retires a direction candidate without dropping its original and blocks axes with historical references", () => {
    const current = buildInitialRiskWorkspace();
    const candidate = current.directionCandidates[0];
    const retired = softDeleteRiskWorkspaceItem(current, "directionCandidate", candidate.id, "admin-id", "Obsoleto", "2026-11-02T00:00:00Z");
    expect(retired.directionCandidates).toHaveLength(current.directionCandidates.length);
    expect(retired.directionCandidates[0]).toMatchObject({ id: candidate.id, deletionReason: "Obsoleto" });
    expect(validateRiskWorkspaceEdit(current, retired)).toMatch(/operación administrativa/);
    expect(() => softDeleteRiskWorkspaceItem(current, "axis", "EJE-10", "admin-id", "Duplicado", "2026-11-02T00:00:00Z"))
      .toThrow(/relaciones históricas/);
  });
});
