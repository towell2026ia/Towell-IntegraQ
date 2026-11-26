import { createAdminClient } from "@/lib/supabase/admin";
import { invitationDigest, invitationLocator } from "@/lib/supplier-audits/invitation-proof";

type Enrollment = { email: string; supplier_id: string; needs_account: boolean };

function failure(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

const invalidInvitation = () =>
  failure("Verifica tu enlace y código de invitación.", 403);

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const digest = invitationDigest(input?.invite, input?.code);
  const locator = invitationLocator(input?.invite);
  if (
    !locator ||
    typeof input.email !== "string" ||
    input.email.length > 320 ||
    typeof input.password !== "string" ||
    !input.password ||
    input.password.length > 1024
  ) return invalidInvitation();

  try {
    const admin = createAdminClient();
    const email = input.email.trim().toLowerCase();
    const { data: ticket, error } = await admin
      .rpc("iq_supplier_portal_enrollment", { p_link: locator, p_digest: digest, p_email: email })
      .maybeSingle<Enrollment>();
    if (error) throw error;
    if (!ticket || ticket.email !== email || !ticket.supplier_id ||
        typeof ticket.needs_account !== "boolean") return invalidInvitation();
    if (ticket.needs_account) {
      if (input.password.length < 10)
        return failure("Utiliza una contraseña de al menos diez caracteres.", 400);
      const created = await admin.auth.admin.createUser({
        email: ticket.email,
        password: input.password,
        email_confirm: true,
        app_metadata: {
          user_type: "supplier",
          supplier_enrollment: ticket.supplier_id,
        },
      });
      // Concurrent registrations still require ordinary sign-in with the existing password.
      if (created.error &&
          !["email_exists", "user_already_exists"].includes(created.error.code ?? "")) {
        if (created.error.code === "weak_password")
          return failure("Elige una contraseña más segura.", 400);
        throw created.error;
      }
    }
    return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure("No se pudo completar el registro. Vuelve a intentarlo.", 503);
  }
}
