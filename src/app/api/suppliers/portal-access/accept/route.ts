import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  if (
    !input ||
    typeof input.invite !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.invite) ||
    typeof input.name !== "string"
  )
    return Response.json({ error: "Invitación inválida." }, { status: 400 });
  const db = await createClient();
  const result = await db.rpc("iq_supplier_portal_accept", {
    p_digest: createHash("sha256").update(input.invite).digest("hex"),
    p_name: input.name,
    p_prepare: input.prepare === true,
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
        { accepted: input.prepare !== true },
        { headers: { "Cache-Control": "no-store" } },
      );
}
