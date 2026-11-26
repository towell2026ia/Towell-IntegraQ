import { invitationDigest, invitationLocator } from "@/lib/supplier-audits/invitation-proof";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "no-store" };
const unavailable = () => Response.json(
  { error: "Tu invitación ya no está disponible. Solicita una nueva al responsable de proveedores." },
  { status: 403, headers },
);

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const locator = invitationLocator(input?.invite);
  if (!locator || typeof input?.name !== "string") return unavailable();

  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user?.email) return unavailable();

  // This RPC commits even if redemption or the HTTP request later fails.
  const verification = await createAdminClient().rpc("iq_supplier_portal_enrollment", {
    p_link: locator,
    p_digest: invitationDigest(input.invite, input.code),
    p_email: user.email,
    p_actor: user.id,
  }).maybeSingle();
  if (verification.error) return Response.json(
    { error: "No se pudo completar el registro. Vuelve a intentarlo." }, { status: 503, headers },
  );
  if (!verification.data) return unavailable();
  const result = await db.rpc("iq_supplier_portal_accept", {
    p_link: locator,
    p_name: input.name,
  });
  return result.error ? unavailable() : Response.json({ accepted: true }, { headers });
}
