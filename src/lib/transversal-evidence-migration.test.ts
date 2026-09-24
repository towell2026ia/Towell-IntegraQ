import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202609240002_transversal_evidence_permissions.sql"),
  "utf8",
);

describe("transversal evidence and permission migration", () => {
  it("extends the existing file registry instead of creating attachments", () => {
    expect(migration).toContain("alter table public.file_objects");
    expect(migration).not.toMatch(/create table(?: if not exists)? public\.attachments/i);
    expect(migration).toContain("preview_status");
    expect(migration).toContain("deleted_at");
    expect(migration).toContain("replaces_file_id");
  });

  it("keeps private storage and authorizes preview paths through RLS", () => {
    expect(migration).toContain("file.preview_path = storage.objects.name");
    expect(migration).toContain("bucket_id = 'integraq-private'");
    expect(migration).toContain("file_objects_select_scope");
  });

  it("adds the requested permission families and auditable user overrides", () => {
    for (const permission of [
      "usuarios.administrar_permisos",
      "clientes.acceder",
      "clientes.administrar",
      "proveedores.acceder",
      "proveedores.administrar",
      "portal_clientes.acceder",
      "portal_proveedores.acceder",
      "organigrama.eliminar",
      "evidencias.historial",
    ]) expect(migration).toContain(permission);
    expect(migration).toContain("public.user_permission_overrides");
    expect(migration).toContain("user.permission_changed");
  });
});
