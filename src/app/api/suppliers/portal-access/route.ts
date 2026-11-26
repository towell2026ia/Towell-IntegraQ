import {
  invitationLocator,
  newInvitationProof,
} from "@/lib/supplier-audits/invitation-proof";
import {
  auditEvidenceCounts,
  loadMatrixReports,
  portalActionSummaries,
  rncpContext,
  RncpError,
} from "@/lib/rncp/server";
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
      error: status === 409
        ? "La cuenta, el contacto o la invitación cambiaron. Actualiza el expediente."
        : status === 403
        ? "Acceso no autorizado."
        : "No se pudo completar la consulta. Vuelve a intentarlo.",
    },
    status,
  );
}
async function previousOwnProfile(ctx: Awaited<ReturnType<typeof rncpContext>>, email?: string) {
  if (!ctx.profile.external_party_id) throw new RncpError("Alcance", 403);
  let siteQuery = ctx.admin.from("external_company_sites").select("name")
    .eq("company_id", ctx.profile.external_party_id).eq("active", true);
  if (ctx.profile.external_site_id) {
    siteQuery = siteQuery.eq("id", ctx.profile.external_site_id);
  }
  const [company, sites] = await Promise.all([
    ctx.admin.from("organizations").select(
      "name,code,category,contact_email,metadata",
    ).eq("id", ctx.profile.external_party_id).eq("kind", "supplier").eq(
      "active",
      true,
    ).single(),
    siteQuery,
  ]);
  if (!company.data || company.error || sites.error) {
    throw new RncpError("Consulta", 503);
  }
  const metadata = company.data.metadata?.supplierQualityContacts ?? {};
  // During the code-first transition the verified account keeps its existing self-contact view.
  const contacts = visibleSupplierContacts({
    ...metadata,
    email: metadata.email || company.data.contact_email || "",
  })
    .filter((c) =>
      !c.retired && c.email &&
      c.email.trim().toLowerCase() === email?.trim().toLowerCase()
    )
    .map((c) => ({
      name: c.name,
      email: c.email,
      purpose: c.purpose || c.position,
      phone: c.phone,
    }));
  return reply({
    name: company.data.name,
    code: company.data.code,
    category: company.data.category,
    sites: sites.data.map((s) => s.name),
    contacts,
  });
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.has("self")) {
      const ctx = await rncpContext("view", true);
      if (!ctx.supplier || !ctx.profile.external_party_id) {
        throw new RncpError("Alcance", 403);
      }
      const sessionUser = await ctx.supabase.auth.getUser();
      const identity = sessionUser.data.user;
      if (
        sessionUser.error || !identity?.email_confirmed_at ||
        identity.id !== ctx.session.authUserId
      ) {
        throw new RncpError("Identidad", 403);
      }
      const profile = await ctx.supabase.rpc("iq_supplier_portal_own_profile");
      if (["PGRST202", "42883"].includes(profile.error?.code ?? "")) return await previousOwnProfile(ctx, identity.email);
      if (profile.error || !profile.data) {
        throw new RncpError("Expediente", profile.error?.code === "42501" ? 403 : 503);
      }
      return reply(profile.data);
    }
    const ctx = await rncpContext("admin");
    const contactSupplier = new URL(request.url).searchParams.get("contactSettings");
    if (contactSupplier !== null) {
      const settings = await ctx.supabase.rpc("iq_supplier_contact_publication_settings", { p_supplier: contactSupplier });
      if (["PGRST202", "42883"].includes(settings.error?.code ?? "")) return reply({ available: false });
      if (settings.error || !settings.data) {
        throw new RncpError("Contactos", settings.error?.code === "42501" ? 403 : 503);
      }
      return reply(settings.data);
    }
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
    if (allowed.error || allowed.data !== ctx.organizationId) {
      throw new RncpError(
        "Alcance",
        allowed.error && allowed.error.code !== "42501" ? 503 : 403,
      );
    }
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
          .select(
            "id,email,created_at,expires_at,withdrawn_at,accepted_at,blocked_at",
          )
          .eq("supplier_id", id)
          .eq("organization_id", ctx.organizationId)
          .order("created_at", { ascending: false }),
        ctx.admin
          .from("external_company_sites")
          .select("id,name")
          .eq("company_id", id)
          .eq("active", true),
        loadMatrixReports(ctx, undefined, true, undefined, id),
        ctx.admin
          .from("supplier_audit_events")
          .select(
            "id,planned_date,actual_date,state,withdrawn_at,manual_record",
          )
          .eq("organization_id", ctx.organizationId)
          .eq("supplier_id", id),
        ctx.admin
          .from("supplier_assessments")
          .select(
            "id,assessment_date,score,classification,portal_visible,source_file_id",
          )
          .eq("supplier_id", id)
          .is("audit_event_id", null),
      ]);
    if (
      [company, profiles, sites, audits, assessments].some(
        (x) => x.error,
      )
    ) {
      throw new RncpError("Consulta", 503);
    }
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
    const counts = await auditEvidenceCounts(
      ctx,
      (audits.data ?? []).filter((a) =>
        a.manual_record?.record?.actions?.length
      ).map((a) => a.id),
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
        .map((c) => ({
          email: c.email,
          name: c.name,
          phone: c.phone,
          purpose: c.purpose || c.position,
        })),
      sites: sites.data,
      reports,
      actions: await portalActionSummaries(ctx, reports.map((r) => r.id)),
      audits: (audits.data ?? []).map((a) => ({
        id: a.id,
        date: a.actual_date ?? a.planned_date,
        state: a.withdrawn_at ? "withdrawn" : a.state,
        score: a.manual_record?.record?.score?.value ?? null,
        method: a.manual_record?.record?.methodology ?? null,
        kind: ({
          manufacturer: "Fabricante",
          distributor: "Distribuidor",
          service: "Servicio",
        } as Record<string, string>)[
          a.manual_record?.record?.classification
        ] ?? null,
        actions: (a.manual_record?.record?.actions ?? []).map(
          (
            x: import("@/lib/supplier-audits/manual").AuditCorrectiveAction,
          ) => ({
            id: x.id,
            description: x.description,
            state: x.status,
            owner: x.responsibleName,
            due: x.commitmentDate,
            completed: x.completedDate,
            files: new Set([
              ...(x.evidenceFileIds ?? []),
              ...(counts.get(a.id + ":" + x.id) ?? []),
            ]).size,
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
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
    if (action !== "invite") {
      const result = await ctx.supabase.rpc("iq_supplier_portal_access", {
        p_supplier: supplier,
        p_id: id,
        p_action: action,
      });
      if (result.error) {
        throw new RncpError(
          "Operación",
          result.error.code === "42501" ? 403 : 409,
        );
      }
      return reply({ saved: true });
    }
    const { invite, code, digest } = newInvitationProof();
    const reservation = await ctx.supabase.rpc("iq_supplier_portal_issue", {
      p_supplier: supplier,
      p_site: site || null,
      p_email: email,
      p_digest: digest,
      p_link: invitationLocator(invite),
    });
    if (reservation.error?.message === "REISSUE_LIMIT") {
      return reply({
        error:
          "Se alcanzó el límite de tres emisiones para este correo en 24 horas.",
      }, 429);
    }
    if (reservation.error) {
      throw new RncpError(
        "Invitación",
        reservation.error.code === "42501" ? 403 : 409,
      );
    }
    const fragment = new URLSearchParams({ invite });
    if (reservation.data.enroll) fragment.set("enroll", "1");
    return reply({
      path: "/portal/proveedor/registro#" + fragment.toString(),
      verificationCode: code,
      email,
    });
  } catch (e) {
    return failed(e);
  }
}
