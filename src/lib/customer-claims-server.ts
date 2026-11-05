import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { uuidPattern } from "@/lib/customer-claims";

export class ClaimApiError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function claimActor(action: "view" | "create" | "update" | "manage" = "view") {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) throw new ClaimApiError("Sesión requerida.", 401);
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("id,user_type,status,workspace_mode,organization_id").eq("id", session.authUserId).maybeSingle();
  const p = profile.data;
  if (profile.error || !p || p.status !== "active" || p.workspace_mode === "demo" || session.workspaceMode === "demo" || !["administrator", "internal"].includes(p.user_type) || !p.organization_id || !["Administrador", "Usuario interno"].includes(session.userType)) throw new ClaimApiError("Acceso interno autorizado requerido.", 403);
  const owner = await admin.from("organizations").select("id").eq("id", p.organization_id).eq("kind", "internal").eq("active", true).maybeSingle();
  if (owner.error || !owner.data) throw new ClaimApiError("Organización interna no disponible.", 403);
  const administrator = p.user_type === "administrator";
  if (!administrator) {
    if (action === "manage") throw new ClaimApiError("Acción exclusiva para administrador.", 403);
    const db = await createClient();
    const permission = action === "view" ? "clientes.ver" : action === "create" ? "clientes.crear" : "clientes.editar";
    const results = await Promise.all([
      db.rpc("has_module_permission", { requested_module_id: "customers", requested_action: action }),
      db.rpc("has_permission", { requested_permission: permission, requested_organization_id: p.organization_id }),
      db.rpc("has_permission", { requested_permission: "clientes.administrar", requested_organization_id: p.organization_id }),
      db.rpc("has_permission", { requested_permission: "clientes.acceder", requested_organization_id: p.organization_id }),
    ]);
    if (results.some(r => r.error) || results[0].data !== true || results[3].data !== true || (results[1].data !== true && results[2].data !== true)) throw new ClaimApiError("No tienes permiso para esta operación de reclamos.", 403);
  }
  return { id: session.authUserId, organizationId: String(p.organization_id), administrator, admin };
}
export type ClaimActor = Awaited<ReturnType<typeof claimActor>>;
export async function authorizedClaimLink(actor: ClaimActor, actionId: string, customerId: string, claimId: string) {
  if (!actor.administrator || !uuidPattern.test(actionId)) throw new ClaimApiError("Sólo un administrador puede vincular un A3 real.",403);
  const action=await actor.admin.from("corrective_actions").select("id,quality_case_id")
    .eq("id",actionId).eq("organization_id",actor.organizationId).eq("external_organization_id",customerId).eq("source","customer").is("deleted_at",null).maybeSingle();
  if(action.error||!action.data)throw new ClaimApiError("El A3 no pertenece al cliente y organización del reclamo.",403);
  if(action.data.quality_case_id&&action.data.quality_case_id!==claimId)throw new ClaimApiError("El A3 ya está vinculado a otro reclamo. Se conservó el vínculo.",409);
}
export async function authorizedClaim(actor: ClaimActor, id: string) {
  if (!uuidPattern.test(id)) throw new ClaimApiError("Identificador inválido.");
  const claim = await actor.admin.from("quality_cases").select("*").eq("id", id).eq("kind", "claim").maybeSingle();
  if (claim.error) throw new ClaimApiError("No fue posible consultar el reclamo.", 500);
  if (!claim.data) throw new ClaimApiError("Reclamo no disponible.", 404);
  const customer = await actor.admin.from("organizations").select("id").eq("id", claim.data.external_organization_id).eq("kind", "customer").eq("owning_organization_id", actor.organizationId).maybeSingle();
  if (customer.error || !customer.data) throw new ClaimApiError("Reclamo fuera del alcance autorizado.", 403);
  return claim.data;
}
export function claimError(error: unknown) { return { error: error instanceof ClaimApiError ? error.message : "No fue posible completar la operación. No se confirmó ningún cambio." }; }
export function claimErrorStatus(error: unknown) { return error instanceof ClaimApiError ? error.status : 500; }
