import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { qualityPolicyDocumentId, qualityPolicyQuery } from "./quality-policy";
import { activeSession } from "./session-data";

// Run against the existing Data API with its public key and no signed-in user.
// RLS must withhold the document, but PostgREST still resolves the actual joins.
it.runIf(process.env.RUN_QUALITY_POLICY_POSTGREST === "1")(
  "resuelve el proceso propietario sin ambigüedad y mantiene privada la Política",
  async () => {
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!key?.startsWith("sb_publishable_")) throw new Error("Se requiere la clave pública.");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const ambiguous = await db.from("controlled_documents")
      .select("id,process:processes!inner(organization_id)").eq("id", qualityPolicyDocumentId);
    expect(ambiguous.status).toBe(300);
    expect(ambiguous.error?.code).toBe("PGRST201");
    const resolved = await qualityPolicyQuery(db, {
      ...activeSession, workspaceMode: "production", userType: "Administrador",
      authUserId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
    }, "id,versions:controlled_document_versions!controlled_document_versions_document_id_fkey(id,status)");
    expect(resolved.error).toBeNull();
    expect(resolved.status).toBe(200);
    expect(resolved.data).toBeNull();
  },
  30_000,
);
