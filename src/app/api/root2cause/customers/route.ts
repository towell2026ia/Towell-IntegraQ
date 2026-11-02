import { NextResponse } from "next/server";

import { canPerformModuleAction } from "@/lib/module-permissions";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || session.workspaceMode === "demo" || !["Administrador", "Usuario interno"].includes(session.userType) ||
      !canPerformModuleAction(session, "corrective-actions", "create")) {
    return NextResponse.json({ error: "No tienes permiso para consultar el catálogo de clientes." }, { status: 403 });
  }
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("user_type,status,workspace_mode,organization_id").eq("id", session.authUserId).maybeSingle();
  if (profile.error || profile.data?.user_type !== (session.userType === "Administrador" ? "administrator" : "internal") ||
      profile.data?.status !== "active" || profile.data.workspace_mode === "demo" || !profile.data.organization_id) {
    return NextResponse.json({ error: "No tienes permiso para consultar el catálogo de clientes." }, { status: 403 });
  }
  const companies = await admin.from("organizations")
    .select("id,code,name").eq("kind", "customer").eq("active", true).order("name");
  if (companies.error) return NextResponse.json({ error: "No fue posible consultar los clientes." }, { status: 500 });
  const companyIds = (companies.data ?? []).map(company => company.id);
  if (!companyIds.length) return NextResponse.json({ customers: [], claims: [] });
  const claims = await admin.from("quality_cases")
    .select("id,folio,title,external_organization_id")
    .in("external_organization_id", companyIds).order("folio");
  if (claims.error) return NextResponse.json({ error: "No fue posible consultar las reclamaciones." }, { status: 500 });
  return NextResponse.json({ customers: companies.data, claims: claims.data ?? [] });
}
