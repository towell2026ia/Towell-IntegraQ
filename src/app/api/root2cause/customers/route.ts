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
  const organizationId = profile.data?.organization_id;
  if (profile.error || profile.data?.user_type !== (session.userType === "Administrador" ? "administrator" : "internal") ||
      profile.data?.status !== "active" || profile.data.workspace_mode === "demo" || !organizationId) {
    return NextResponse.json({ error: "No tienes permiso para consultar el catálogo de clientes." }, { status: 403 });
  }
  const companies = await admin.from("organizations")
    .select("id,code,name,owning_organization_id").eq("kind", "customer").eq("active", true)
    .eq("owning_organization_id", organizationId).order("name");
  if (companies.error) return NextResponse.json({ error: "No fue posible verificar la titularidad de los clientes." }, { status: 409 });
  if ((companies.data ?? []).some(company => company.owning_organization_id !== organizationId)) {
    return NextResponse.json({ error: "El catálogo contiene clientes sin titularidad verificable." }, { status: 409 });
  }
  const companyIds = (companies.data ?? []).map(company => company.id);
  if (!companyIds.length) return NextResponse.json({ customers: [], claims: [] });
  const claims = await admin.from("quality_cases")
    .select("id,folio,title,external_organization_id")
    .in("external_organization_id", companyIds).eq("kind","claim").is("cancelled_at",null).order("folio");
  if (claims.error) return NextResponse.json({ error: "No fue posible verificar la titularidad de las reclamaciones." }, { status: 409 });
  const ownedIds = new Set(companyIds);
  if ((claims.data ?? []).some(claim => !ownedIds.has(claim.external_organization_id))) {
    return NextResponse.json({ error: "Las reclamaciones incluyen una empresa ajena." }, { status: 409 });
  }
  return NextResponse.json({ customers: (companies.data ?? []).map(({ id, code, name }) => ({ id, code, name })),
    claims: (claims.data ?? []).map(({ id, folio, title, external_organization_id }) => ({ id, folio, title, external_organization_id })) });
}
