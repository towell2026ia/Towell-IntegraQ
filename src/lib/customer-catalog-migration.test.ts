import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const seed = readFileSync(join(root, "supabase/migrations/20261105180006_av_pl_01_customer_catalog.sql"), "utf8").toLocaleLowerCase();
const deleteGuard = readFileSync(join(root, "supabase/migrations/20261102170852_admin_delete_guard.sql"), "utf8").toLocaleLowerCase();
const customerUi = readFileSync(join(root, "src/components/modules/customers-module.tsx"), "utf8");

describe("AV-PL-01 customer catalog migration", () => {
  it("keeps automatic migration execution disabled", () => {
    const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
    expect(config.split("[db.migrations]")[1].split("[db.seed]")[0]).toMatch(/enabled\s*=\s*false/);
  });
  it("contains exactly the 33 official unique name-abbreviation pairs", () => {
    const rows = seed.split("with official(code, name) as (values").slice(1).flatMap((block) => {
      const ends = [block.indexOf("\n    )"), block.indexOf("\n)")].filter((index) => index >= 0);
      const values = block.slice(0, Math.min(...ends));
      return [...values.matchAll(/\('([a-z0-9]+)',\s*'((?:[^']|'')*)'\)/g)]
        .map((match) => match[1] + ":" + match[2].replace(/''/g, "'"));
    });
    expect(new Set(rows).size).toBe(33);
    expect(new Set(rows.map((row) => row.split(":")[0])).size).toBe(33);
    expect(rows).toContain("cc:colchas mexico sa de cv (concord)");
    expect(rows).toContain("ws:waldo's dolar");
    expect(rows).toContain("wm:walmart – bodega, super center, prichos");
  });

  it("preflights duplicates and requires the active internal Towell owner without rewriting rows", () => {
    expect(seed).toContain("lock table public.organizations in share row exclusive mode");
    expect(seed).toContain("where code = 'towell' and kind = 'internal' and active");
    expect(seed).toContain("av-pl-01 seed stopped");
    expect(seed).toContain("on conflict (code) do nothing");
    expect(seed).not.toMatch(/\bupdate\s+public\.organizations|\bdelete\s+from\s+public\.organizations|\btruncate\b/);
    expect(seed).not.toContain("insert into public.profiles");
    expect(seed).not.toContain("portal_visible");
    expect(seed).not.toContain("grant ");
    expect(seed).not.toMatch(/\b(create|alter|drop)\s+policy\b|\bdrop\s+trigger\b|create\s+or\s+replace\s+function/);
  });

  it("adds only the missing organization ownership and retirement fields needed by customer management", () => {
    for (const field of ["owning_organization_id uuid", "legal_name text", "tax_id text", "address text", "deleted_at timestamptz", "deleted_by uuid", "deletion_reason text"]) {
      expect(seed).toContain(`add column if not exists ${field}`);
    }
    expect(seed.match(/alter table public\.organizations\s+add column/g)).toHaveLength(1);
    expect(seed).not.toMatch(/alter table public\.(?!organizations\b)/);
  });

  it("leaves historical null ownership untouched and requires ownership for new external companies", () => {
    expect(deleteGuard).toContain("if old.owning_organization_id is null then return new; end if;");
    expect(deleteGuard).toContain("if tg_op = 'insert' then");
    expect(deleteGuard).toContain("foreign key (owning_organization_id) references public.organizations(id) on delete restrict");
    expect(deleteGuard).not.toContain("update public.organizations set owning_organization_id");
  });

  it("offers later editing without filling absent customer facts with examples", () => {
    expect(customerUi).toContain("Editar cliente");
    expect(customerUi).toContain("Razón social (opcional)");
    expect(customerUi).toContain("RFC (opcional)");
    expect(customerUi).toContain("Domicilio (opcional)");
    expect(customerUi).toContain("contactName: company.contactName");
  });
});
