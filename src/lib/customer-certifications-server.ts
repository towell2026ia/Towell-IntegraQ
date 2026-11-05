import "server-only";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { certificationUuid, type Certification } from "@/lib/customer-certifications";

export class CertificationError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function certificationActor(write = false) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new CertificationError("Sesión requerida.", 401);
  const admin = createAdminClient();
  const result = await admin.from("profiles").select("id,user_type,status,workspace_mode,organization_id").eq("id", session.authUserId).maybeSingle();
  const p = result.data;
  if (result.error || !p || p.status !== "active" || p.workspace_mode !== "production" || session.workspaceMode !== "production" || !["administrator", "internal"].includes(p.user_type) || !["Administrador", "Usuario interno"].includes(session.userType) || !p.organization_id) throw new CertificationError("Acceso interno no autorizado.", 403);
  const owner = await admin.from("organizations").select("id").eq("id", p.organization_id).eq("kind", "internal").eq("active", true).maybeSingle();
  if (owner.error || !owner.data) throw new CertificationError("Organización no autorizada.", 403);
  const administrator = p.user_type === "administrator";
  if (write && !administrator) throw new CertificationError("Operación exclusiva para administradores activos.", 403);
  if (!administrator) {
    const db = await createClient();
    const checks = await Promise.all([
      db.rpc("has_module_permission", { requested_module_id: "customers", requested_action: "view" }),
      db.rpc("has_permission", { requested_permission: "clientes.acceder", requested_organization_id: p.organization_id }),
      db.rpc("has_permission", { requested_permission: "clientes.ver", requested_organization_id: p.organization_id }),
    ]);
    if (checks.some(r => r.error || r.data !== true)) throw new CertificationError("Sin permiso de consulta de Clientes.", 403);
  }
  return { admin, id: session.authUserId, workspaceId: String(p.organization_id), administrator };
}
export async function authorizedCertification(actor: Awaited<ReturnType<typeof certificationActor>>, id: string) {
  if (!certificationUuid.test(id)) throw new CertificationError("Identificador inválido.");
  const result = await actor.admin.from("certifications").select("*").eq("id", id).eq("workspace_id", actor.workspaceId).maybeSingle();
  if (result.error) throw new CertificationError("No fue posible consultar la certificación.", 500);
  if (!result.data) throw new CertificationError("Certificación no disponible.", 404);
  return result.data as Certification;
}
export async function certificationPages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const page = await query(from, from + 499);
    if (page.error) throw new CertificationError("No fue posible consultar Certificaciones. Reintenta.", 500);
    rows.push(...(page.data ?? []) as T[]);
    if ((page.data?.length ?? 0) < 500) return rows;
  }
}
export function certificationFailure(error: unknown) {
  return Response.json({ error: error instanceof CertificationError ? error.message : "No se confirmó la operación de Certificaciones." }, { status: error instanceof CertificationError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
}
