import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeTextSizes, isHomeTextSize, readHomeTextSize } from "./home-appearance";
describe("Home appearance contract", () => {
  it("supports exactly the four requested scales", () => { expect(homeTextSizes.map(option => option.value)).toEqual([100, 110, 120, 130]); for (const option of homeTextSizes) expect(readHomeTextSize({ textSize: option.value })).toBe(option.value); });
  it("does not accept arbitrary CSS or numeric strings", () => { expect(isHomeTextSize("130")).toBe(false); expect(readHomeTextSize({ textSize: "url(test)" })).toBe(100); });
  it("prepares only additive restrictive policies for the reserved key", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/202610290001_home_appearance_admin_scope.sql"), "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(drop|truncate|alter|create\s+table|insert\s+into|delete\s+from|update\s+public)\b/i);
    expect(sql.match(/create policy/g)).toHaveLength(3);
    expect(sql.match(/as restrictive/g)).toHaveLength(3);
    expect(sql.match(/area <> 'homeAppearance' or public\.is_administrator\(\)/g)).toHaveLength(4);
    expect(sql).toContain("for update to authenticated");
    expect(sql).toContain("for insert to authenticated");
  });
});