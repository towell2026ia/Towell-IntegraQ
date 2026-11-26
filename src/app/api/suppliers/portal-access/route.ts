import { createHash, randomBytes } from "node:crypto";
import { rncpContext, RncpError } from "@/lib/rncp/server";
import { auditContext, auditSuppliers } from "@/lib/supplier-audits/server";
import { visibleSupplierContacts } from "@/lib/supplier-audits/contacts";
import type { SupplierContacts } from "@/lib/supplier-audits/model";

const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function failed(error: unknown) {
  const status = error instanceof RncpError ? error.status : 503;
  return reply(
    {
      error:
        status === 409
          ? "La cuenta, el contacto o la invitación cambiaron. Actualiza el expediente."
          : status === 403
            ? "Acceso no autorizado."
            : "No se pudo completar la consulta. Vuelve a intentarlo.",
    },
    status,
  );
}
export async function GET(request: Request) {
  try {
    const ctx = await rncpContext("admin");
    const id = new URL(request.url).searchParams.get("supplier");
    if (!id) {
      const rows = await auditSuppliers(await auditContext("admin"));
      return reply({
        suppliers: rows
          .filter((s) => s.active)
          .map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
            category: String(s.category ?? ""),
          })),
      });
    }
    const allowed = await ctx.supabase.rpc("iq_supplier_portal_admin", {
      p_supplier: id,
    });
    if (allowed.error || allowed.data !== ctx.organizationId)
      throw new RncpError(
        "Alcance",
        allowed.error && allowed.error.code !== "42501" ? 503 : 403,
      );
    const [company, profiles, invites, sites, reports, audits, assessments] =
      await Promise.all([
        ctx.admin
          .from("organizations")
          .select("id,contact_email,metadata")
          .eq("id", id)
          .eq("kind", "supplier")
          .eq("active", true)
          .single(),
        ctx.admin
          .from("profiles")
          .select("id,full_name,status,created_at")
          .eq("external_party_id", id)
          .eq("user_type", "supplier")
          .eq("workspace_mode", "production"),
        ctx.admin
          .from("supplier_portal_invitations")
          .select("id,email,created_at,expires_at,withdrawn_at,accepted_at")
          .eq("supplier_id", id)
          .eq("organization_id", ctx.organizationId)
          .order("created_at", { ascending: false }),
        ctx.admin
          .from("external_company_sites")
          .select("id,name")
          .eq("company_id", id)
          .eq("active", true),
        ctx.supabase
          .from("supplier_rncp_reports")
          .select("id,folio,report_date,status,portal_visible")
          .eq("organization_id", ctx.organizationId)
          .eq("supplier_id", id)
          .is("deleted_at", null)
          .order("report_date", { ascending: false }),
        ctx.admin
          .from("supplier_audit_events")
          .select("id,planned_date,actual_date,state,manual_record")
          .eq("organization_id", ctx.organizationId)
          .eq("supplier_id", id),
        ctx.admin
          .from("supplier_assessments")
          .select("id,assessment_date,score,classification,portal_visible")
          .eq("supplier_id", id),
      ]);
    if (
      [company, profiles, sites, reports, audits, assessments].some(
        (x) => x.error,
      )
    )
      throw new RncpError("Consulta", 503);
    const users = await Promise.all(
      (profiles.data ?? []).map(async (p) => {
        const identity = await ctx.admin.auth.admin.getUserById(p.id);
        if (identity.error) throw new RncpError("Identidad", 503);
        return {
          ...p,
          email: identity.data.user.email,
          lastAccess: identity.data.user.last_sign_in_at,
        };
      }),
    );
    const contacts = (company.data?.metadata?.supplierQualityContacts ??
      {}) as Partial<SupplierContacts>;
    return reply({
      users,
      invitations: invites.data ?? [],
      accessReady: !invites.error,
      contacts: visibleSupplierContacts({
        ...contacts,
        email: contacts.email || company.data?.contact_email || "",
      })
        .filter((c) => !c.retired && c.email)
        .map((c) => ({ email: c.email, name: c.name })),
      sites: sites.data,
      reports: reports.data,
      audits: (audits.data ?? []).map((a) => ({
        id: a.id,
        date: a.actual_date ?? a.planned_date,
        state: a.state,
        actions: (a.manual_record?.record?.actions ?? []).map(
          (x: { id: string; description: string }) => ({
            id: x.id,
            description: x.description,
          }),
        ),
      })),
      assessments: assessments.data,
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await rncpContext("admin");
    const body = await request.json();
    const { supplier, site, action, id } = body;
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (action !== "invite") {
      const result = await ctx.supabase.rpc("iq_supplier_portal_access", {
        p_supplier: supplier,
        p_id: id,
        p_action: action,
      });
      if (result.error)
        throw new RncpError(
          "Operación",
          result.error.code === "42501" ? 403 : 409,
        );
      return reply({ saved: true });
    }
    const secret = randomBytes(32).toString("hex");
    const digest = createHash("sha256").update(secret).digest("hex");
    const reservation = await ctx.supabase.rpc("iq_supplier_portal_issue", {
      p_supplier: supplier,
      p_site: site || null,
      p_email: email,
      p_digest: digest,
    });
    if (reservation.error)
      throw new RncpError(
        "Invitación",
        reservation.error.code === "42501" ? 403 : 409,
      );
    const ticket = reservation.data;
    try {
      const fragment = new URLSearchParams({ invite: secret });
      let verificationCode: string | undefined;
      if (ticket.enroll) {
        let uid = ticket.userId;
        if (!uid) {
          const created = await ctx.admin.auth.admin.createUser({
            email,
            email_confirm: false,
            app_metadata: {
              user_type: "supplier",
              supplier_enrollment: supplier,
            },
          });
          if (created.error) throw new RncpError("Cuenta", 409);
          uid = created.data.user.id;
        }
        const identity = await ctx.admin.auth.admin.getUserById(uid);
        if (
          identity.error ||
          identity.data.user.app_metadata.supplier_enrollment !== supplier
        )
          throw new RncpError("Identidad", 409);
        const proof = await ctx.admin.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        if (proof.error || proof.data.user.id !== uid)
          throw new RncpError("Confirmación", 409);
        verificationCode = proof.data.properties.email_otp;
        if (!verificationCode)
          throw new RncpError("Confirmación no disponible", 409);
        fragment.set("enroll", "1");
      }
      return reply({
        path: "/portal/proveedor/registro#" + fragment.toString(),
        verificationCode,
        email,
      });
    } catch (e) {
      await ctx.supabase.rpc("iq_supplier_portal_access", {
        p_supplier: supplier,
        p_id: ticket.id,
        p_action: "withdraw",
      });
      throw e;
    }
  } catch (e) {
    return failed(e);
  }
}
