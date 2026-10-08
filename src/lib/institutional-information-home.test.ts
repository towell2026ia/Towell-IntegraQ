import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080007_home_institutional_information.sql"), "utf8").toLocaleLowerCase();
const api = readFileSync(join(process.cwd(), "src/app/api/home/institutional/route.ts"), "utf8");
const fileApi = readFileSync(join(process.cwd(), "src/app/api/home/institutional/[position]/file/route.ts"), "utf8");
const home = readFileSync(join(process.cwd(), "src/components/modules/home-module.tsx"), "utf8");
const settings = readFileSync(join(process.cwd(), "src/components/modules/home-settings-module.tsx"), "utf8");

describe("home institutional information contract", () => {
  it("maps the three institutional positions without duplicating documents", () => {
    for (const position of ["policy_quality", "code_ethics", "confidentiality"]) expect(migration).toContain(position);
    expect(migration).toContain("document_id uuid references public.controlled_documents(id)");
    expect(migration).not.toContain("file_id uuid");
    expect(home).not.toContain("/home/politica-calidad.png");
    expect(existsSync(join(process.cwd(), "public/home/politica-calidad.png"))).toBe(false);
  });

  it("resolves only active current document versions", () => {
    expect(api).toContain('.eq("status", "current")');
    expect(api).toContain('.eq("active", true).is("deleted_at", null)');
    expect(api).toContain("lifecycleAvailable");
    expect(fileApi).toContain('.eq("status", "current")');
    expect(fileApi).not.toContain('status", "draft"');
    expect(fileApi).not.toContain('status", "rejected"');
  });

  it("supports short confidentiality text and controlled documents", () => {
    expect(migration).toContain("content_kind in ('document', 'text')");
    expect(migration).toContain("position = 'confidentiality' or content_kind = 'document'");
    expect(settings).toContain("Texto configurable");
    expect(settings).toContain("Documento controlado");
  });

  it("keeps administration and visibility under RLS and audit", () => {
    expect(migration).toContain("home_institutional_items_select_scope");
    expect(migration).toContain("visible_to_internal");
    expect(migration).toContain("visible_to_external");
    expect(migration).toContain("public.is_administrator()");
    expect(migration).toContain("home.institutional_mapping_updated");
  });

  it("opens the current private file using a short-lived signed URL", () => {
    expect(fileApi).toContain("createSignedUrl(file.data.object_path, 120)");
    expect(fileApi).not.toContain("getPublicUrl");
    expect(fileApi).toContain('event_type: "DOCUMENT_VIEWED"');
  });

  it("renders the new institutional section and administrator mappings", () => {
    expect(home).toContain("Información institucional");
    expect(home).toContain("getInstitutionalDocumentUrl");
    expect(settings).toContain("no se copian archivos en Inicio");
    expect(settings).toContain("Usuarios externos");
  });
});
