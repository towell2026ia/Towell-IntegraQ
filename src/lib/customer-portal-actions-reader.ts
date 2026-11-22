import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortalReader } from "@/lib/customer-portal-link-server";

export async function publishedActions(actor: PortalReader) {
  if (actor?.kind !== "customer" || !actor.companyId) return Response.json({error:"Acceso de cliente no autorizado."},{status:403});
  const admin = createAdminClient();
  const result = await admin.from("corrective_actions")
    .select("id,folio,title,source,status,progress,due_date,external_organization_id,portal_visible,deleted_at")
    .eq("source", "customer")
    .eq("organization_id", actor.workspaceId)
    .eq("external_organization_id", actor.companyId)
    .eq("portal_visible", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "No fue posible consultar las acciones autorizadas." }, { status: 500 });
  return NextResponse.json({ actions: (result.data ?? [])
    .filter(row => row.source === "customer" && row.portal_visible === true && !row.deleted_at &&
      row.external_organization_id === actor.companyId)
    .map(row => ({
    id: row.id, folio: row.folio, title: row.title,
    status: row.status, progress: row.progress, dueDate: row.due_date,
  })) }, {headers: {"Cache-Control":"private, no-store"}});
}
