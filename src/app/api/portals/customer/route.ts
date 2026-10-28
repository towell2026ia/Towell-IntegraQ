import { NextResponse } from "next/server";
import { canUseLivePortal } from "@/lib/portal-security";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import type { CorrectiveAction } from "@/lib/types";
export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  if (!canUseLivePortal(session, "customer")) return NextResponse.json({ error: "Portal no autorizado." }, { status: 403 });
  const companyId = session.externalParty!.companyId;
  const db = await createClient();
  const [actions, audits, certifications] = await Promise.all([
    db.from("corrective_actions").select("id,folio,title,problem,source,severity,area,owner_name,created_at,due_date,status,progress,root_cause,external_organization_id").eq("external_organization_id", companyId).eq("source", "customer").eq("portal_visible", true),
    db.from("audits").select("id,code,scheduled_date,status,external_organization_id").eq("external_organization_id", companyId).eq("portal_visible", true),
    db.from("certifications").select("id,code,name,valid_until,certificate_file_id").eq("customer_visible", true).eq("active", true),
  ]);
  if (actions.error || audits.error || certifications.error) return NextResponse.json({ error: "No fue posible consultar el portal." }, { status: 500 });
  // Explicit scope supplements RLS, including certificate-file visibility.
  const certificateRows = certifications.data ?? [];
  const ids = certificateRows.flatMap((r) => r.certificate_file_id ? [r.certificate_file_id] : []);
  const shared = ids.length ? await db.from("file_objects").select("id").in("id", ids).eq("external_organization_id", companyId).is("deleted_at", null) : { data: [], error: null };
  if (shared.error) return NextResponse.json({ error: "No fue posible autorizar certificados." }, { status: 500 });
  const sharedIds = new Set((shared.data ?? []).map((r) => r.id));
  return NextResponse.json({
    actions: (actions.data ?? []).filter((r) => r.external_organization_id === companyId).map((r) => ({
      id: r.id, folio: r.folio, title: r.title, problem: r.problem, source: "customer",
      severity: r.severity, area: r.area ?? "", owner: r.owner_name ?? "", createdAt: r.created_at,
      dueDate: r.due_date, status: r.status, progress: r.progress, evidenceCount: 0,
      rootCause: r.root_cause ?? undefined, relatedPartyId: companyId,
    } as CorrectiveAction)),
    audits: (audits.data ?? []).filter((r) => r.external_organization_id === companyId).map((r) => ({ id: r.code, date: r.scheduled_date, scope: session.externalParty!.companyName, status: r.status, companyId })),
    certifications: certificateRows.filter((r) => sharedIds.has(r.certificate_file_id)).map((r) => ({ name: r.name, certificate: r.code, validUntil: r.valid_until, fileId: r.certificate_file_id })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
