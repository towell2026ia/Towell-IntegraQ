import { NextResponse } from "next/server";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { certificationUuid } from "@/lib/customer-certifications";
import { linkHeaders, newPortalKey, portalKey, portalDigest } from "@/lib/customer-portal-link-server";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: linkHeaders });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Origen no autorizado." }, 403);
  const actor = await resolveCustomerPortalActor(await getAuthenticatedSession());
  if (!actor || actor.kind === "customer") return reply({ error: "Se requiere administración de clientes." }, 403);
  const body = await request.json().catch(() => null);
  if (!body || !certificationUuid.test(body.customerId ?? "") || !["status","obtain","issue","revoke"].includes(body.action))
    return reply({ error: "Solicitud inválida." }, 400);
  const permission = body.action === "status" ? "consultar" : body.action === "obtain" ? "reenviar" : body.action === "issue" ? "emitir" : "revocar";
  if (actor.kind !== "administrator" && !actor.invitations?.[permission]) return reply({ error: "Acción no autorizada." },403);
  if (body.id && !certificationUuid.test(body.id)) return reply({error:"Acceso inválido."},400);
  const proof = body.action === "issue" ? newPortalKey(body.customerId) : null;
  const db = await createClient();
  const result = await db.rpc("iq_customer_invitation_command",{
    p_customer:body.customerId, p_action:body.action, p_id:body.id ?? null,
    p_nonce:proof?.nonce ?? null, p_digest:proof?.key_digest ?? null,
  });
  if (result.error) {
    if (result.error.code === "42501") return reply({error:"Cliente o acción fuera de alcance."},403);
    return reply({error:"No se pudo confirmar la operación del portal."},result.error.message?.includes("CONFLICT") ? 409 : 503);
  }
  if (typeof result.data?.active !== "boolean") return reply({error:"No se pudo verificar el acceso."},503);
  if (!result.data.active) return reply({active:false});
  const { id, nonce, key_digest } = result.data;
  if (body.action === "status") return reply({active:true,id});
  const key = portalKey(body.customerId,nonce);
  if (portalDigest(key) !== key_digest) return reply({active:true,id,notice:"La llave requiere revocación y reemplazo."});
  return reply({active:true,id,key});
}
