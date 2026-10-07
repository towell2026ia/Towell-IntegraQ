import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("indicator capture window migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/202610070003_indicator_capture_windows.sql"),
    "utf8",
  );

  it("defines the general rule and business timezone", () => {
    expect(migration).toContain("capture_days_after_close integer not null default 15");
    expect(migration).toContain("America/Mexico_City");
    expect(migration).not.toContain("-06:00");
  });

  it("preserves historical results while creating future periods", () => {
    expect(migration).toContain("not exists (\n    select 1 from public.indicator_results");
    expect(migration).toContain("on conflict (indicator_id, year, quarter) do nothing");
    expect(migration).not.toContain("delete from public.indicator_results");
  });

  it("audits period changes, result changes and administrative overrides", () => {
    expect(migration).toContain("indicator_period.updated");
    expect(migration).toContain("indicator_result.created");
    expect(migration).toContain("indicator_result.updated");
    expect(migration).toContain("indicator_result.admin_override");
    expect(migration).toContain("INDICATOR_ADMIN_OVERRIDE_REASON_REQUIRED");
  });
});
