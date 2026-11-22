import { NextResponse } from "next/server";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { certificationUuid } from "@/lib/customer-certifications";
import { linkHeaders, newPortalKey, portalKey, portalDigest } from "@/lib/customer-portal-link-server";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: linkHeaders });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Origen no autorizado." }, 403);
  const actor = await resolveCustomerPortalActor(await getAuthenticatedSession());
  if (actor?.kind !== "administrator") return reply({ error: "Se requiere administración de clientes." }, 403);
  const body = await request.json().catch(() => null);
  if (!body || !certificationUuid.test(body.customerId ?? "") || !["obtain","issue","revoke"].includes(body.action))
    return reply({ error: "Solicitud inválida." }, 400);
  const db = createAdminClient();
  const company = await db.from("organizations").select("id").eq("id", body.customerId)
    .eq("owning_organization_id", actor.workspaceId).eq("active", true).eq("kind", "customer").maybeSingle();
  if (company.error || !company.data) return reply({ error: "Cliente no disponible." }, 404);
  const scope = { customer_id: company.data.id, workspace_id: actor.workspaceId };
  const table = () => db.from("customer_portal_links");
  if (body.action === "revoke") {
    if (!certificationUuid.test(body.id ?? "")) return reply({error: "Acceso inválido."}, 400);
    const changed = await table().update({ revoked_at: new Date().toISOString(), revoked_by: actor.userId })
      .match(scope).eq("id", body.id).is("revoked_at", null).select("id").maybeSingle();
    if (changed.error || !changed.data) return reply({ error: "No se pudo confirmar el retiro del acceso." }, 409);
    return reply({ active: false });
  }
  const result = body.action === "issue"
    ? await table().insert({ ...scope, ...newPortalKey(scope.customer_id), created_by: actor.userId }).select("id,nonce,key_digest").single()
    : await table().select("id,nonce,key_digest").match(scope).is("revoked_at", null).maybeSingle();
  if (result.error) return reply({ error: "No se pudo completar la operación. Consulta el acceso vigente." }, 409);
  if (!result.data) return reply({ active: false });
  const key = portalKey(scope.customer_id, result.data.nonce);
  if (portalDigest(key) !== result.data.key_digest)
    return reply({ active: true, id: result.data.id, notice: "La llave requiere revocación y reemplazo." });
  return reply({ active: true, id: result.data.id, key });
}
