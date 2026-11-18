import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildEmptyRiskWorkspace, normalizeRiskWorkspace } from "@/lib/risk-opportunity-data";
import { isWorkspaceDataArea, workspaceDataAreas } from "@/lib/workspace-data";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

describe("workspace data hardening", () => {
  it("recognizes only supported repository areas", () => {
    expect(isWorkspaceDataArea("correctiveActions")).toBe(true);
    expect(isWorkspaceDataArea("metromap")).toBe(true);
    expect(isWorkspaceDataArea("indicatorDefinitions")).toBe(false);
    expect(isWorkspaceDataArea("indicatorResults")).toBe(false);
    expect(isWorkspaceDataArea("unknownArea")).toBe(false);
    expect(new Set(workspaceDataAreas).size).toBe(workspaceDataAreas.length);
  });

  it("does not persist workspace repository data in browser storage", () => {
    const offenders = sourceFiles(join(process.cwd(), "src", "lib", "repositories")).filter((path) => {
      const source = readFileSync(path, "utf8");
      return /(?:local|session)Storage\.(?:getItem|setItem|removeItem)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("preserves an intentionally empty digital risk matrix", () => {
    const empty = buildEmptyRiskWorkspace();
    expect(normalizeRiskWorkspace(empty)).toEqual(empty);
  });

  it("defines database mode, RLS, soft delete and immutable audit", () => {
    const isolation = readFileSync(join(process.cwd(), "supabase/migrations/202609240006_demo_workspace_isolation.sql"), "utf8");
    const hardening = readFileSync(join(process.cwd(), "supabase/migrations/202609250001_production_hardening.sql"), "utf8");
    const assignment = readFileSync(join(process.cwd(), "supabase/migrations/202609250002_profile_workspace_assignment.sql"), "utf8");
    const guard = readFileSync(join(process.cwd(), "supabase/migrations/202609250003_workspace_soft_delete_guard.sql"), "utf8");
    expect(isolation).toContain("workspace_mode text not null default 'production'");
    expect(isolation).toContain("new.raw_app_meta_data ->> 'workspace_mode'");
    expect(hardening).toContain("create table if not exists public.workspace_data");
    expect(hardening).toContain("alter table public.workspace_data enable row level security");
    expect(hardening).toContain("workspace_mode = public.current_workspace_mode()");
    expect(hardening).toContain("workspace_id in (select public.current_organization_ids())");
    expect(hardening).toContain("workspace_data_soft_delete_reason");
    expect(hardening).toContain("create trigger workspace_data_audit");
    expect(hardening).toContain("revoke delete on public.workspace_data from authenticated");
    expect(assignment).toContain("profile.organization_id is null");
    expect(assignment).toContain("resolved_organization_id");
    expect(guard).toContain("ADMIN_REQUIRED_FOR_SOFT_DELETE");
    expect(guard).toContain("WORKSPACE_IDENTITY_IMMUTABLE");
  });
});
