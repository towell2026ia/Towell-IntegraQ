import { invitationDigest } from "@/lib/supplier-audits/invitation-proof";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const digest = invitationDigest(input?.invite, input?.code);
  if (!digest || typeof input?.name !== "string")
    return Response.json({ error: "Invitación inválida." }, { status: 400 });
  const db = await createClient();
  const result = await db.rpc("iq_supplier_portal_accept", {
    p_digest: digest,
    p_name: input.name,
  });
  return result.error
    ? Response.json(
        {
          error:
            "La invitación venció, fue utilizada o no corresponde a tu cuenta.",
        },
        { status: 403 },
      )
    : Response.json(
        { accepted: true },
        { headers: { "Cache-Control": "no-store" } },
      );
}
