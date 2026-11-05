import { NextResponse } from "next/server";
import { claimActor, authorizedClaim, authorizedClaimLink, ClaimApiError, claimError, claimErrorStatus } from "@/lib/customer-claims-server";
import { validateClaimInput, type ClaimsCatalog } from "@/lib/customer-claims";

export const maxDuration = 30;
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const page = await query(from, from + 499);
    if (page.error) throw new ClaimApiError("Falló la consulta de reclamos. Reintenta.", 500);
    result.push(...(page.data ?? []) as T[]);
    if ((page.data?.length ?? 0) < 500) return result;
  }
}
export async function GET() {
  try {
    const actor = await claimActor();
    const customers = await pages<ClaimsCatalog["customers"][number]>((f,t) => actor.admin.from("organizations").select("id,code,name,active").eq("kind", "customer").eq("owning_organization_id", actor.organizationId).order("id").range(f,t));
    const ids = customers.map(c => c.id);
    const [claims, findings, processes] = await Promise.all([
      ids.length ? pages<ClaimsCatalog["claims"][number]>((f,t) => actor.admin.from("quality_cases").select("id,folio,external_organization_id,received_at,title,description,status,external_reference,process_id,updated_at,cancelled_at,cancellation_reason").eq("kind","claim").in("external_organization_id",ids).order("id").range(f,t)) : [],
      ids.length ? pages<{id: string}>((f,t) => actor.admin.from("quality_cases").select("id").eq("kind","finding").in("external_organization_id",ids).order("id").range(f,t)) : [],
      pages<ClaimsCatalog["processes"][number]>((f,t) => actor.admin.from("processes").select("id,name").eq("organization_id",actor.organizationId).eq("active",true).order("id").range(f,t)),
    ]);
    const evidence: ClaimsCatalog["evidence"] = [];
    const history: ClaimsCatalog["history"] = [];
    for (let start=0;start<claims.length;start+=100) {
      const chunk=claims.slice(start,start+100).map(c=>c.id);
      evidence.push(...await pages<ClaimsCatalog["evidence"][number]>((f,t) => actor.admin.from("file_objects").select("id,resource_id,original_name,size_bytes,mime_type,version,is_current,created_at,uploaded_by").eq("resource_type","customer_claim_evidence").eq("workspace_id",actor.organizationId).in("resource_id",chunk).is("deleted_at",null).order("id").range(f,t)));
      history.push(...await pages<ClaimsCatalog["history"][number]>((f,t)=>actor.admin.from("audit_log").select("id,resource_id,action,actor_id,created_at,reason").eq("resource_type","quality_case").eq("organization_id",actor.organizationId).in("resource_id",chunk).order("created_at",{ascending:false}).range(f,t)));
    }
    const actions = ids.length ? await pages<ClaimsCatalog["actions"][number]>((f,t) => actor.admin.from("corrective_actions").select("id,folio,title,external_organization_id,quality_case_id,status").eq("organization_id",actor.organizationId).eq("source","customer").in("external_organization_id",ids).is("deleted_at",null).order("id").range(f,t)) : [];
    return NextResponse.json({ customers, claims, findings: findings.length, history, evidence, actions, processes } satisfies ClaimsCatalog, { headers: { "Cache-Control":"private, no-store" } });
  } catch (e) { return NextResponse.json(claimError(e), { status: claimErrorStatus(e) }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const command = body.command;
    if (!["save","cancel","link"].includes(command)) throw new ClaimApiError("Operación inválida.");
    const actor = await claimActor(command === "save" ? (body.updatedAt ? "update" : "create") : "manage");
    if (command === "save") {
      try { validateClaimInput(body); } catch(e) { throw new ClaimApiError((e as Error).message); }
      if (body.updatedAt) await authorizedClaim(actor, String(body.id));
      let companyQuery=actor.admin.from("organizations").select("id").eq("id",body.customerId).eq("kind","customer").eq("owning_organization_id",actor.organizationId);
      if(!body.updatedAt)companyQuery=companyQuery.eq("active",true);
      const company=await companyQuery.maybeSingle();
      if(company.error||!company.data)throw new ClaimApiError("Cliente fuera del catálogo activo autorizado.",403);
      if(body.actionId)await authorizedClaimLink(actor,String(body.actionId),String(body.customerId),String(body.id));
    } else {
      const claim=await authorizedClaim(actor, String(body.id));
      if(command==="link")await authorizedClaimLink(actor,String(body.actionId),String(claim.external_organization_id),String(body.id));
      if (command === "cancel" && !String(body.reason ?? "").trim()) throw new ClaimApiError("Indica el motivo de anulación.");
    }
    const saved = await actor.admin.rpc("iq_customer_claim_command", { actor_id: actor.id, workspace_id: actor.organizationId, command, payload: body });
    if (saved.error) throw new ClaimApiError(saved.error.message.includes("CONCURRENT") ? "El reclamo cambió. Recarga antes de guardar." : "No se confirmó la operación. Verifica el cliente, el vínculo y el estado del reclamo.", saved.error.code === "42501" ? 403 : 409);
    return NextResponse.json(saved.data);
  } catch(e) { return NextResponse.json(claimError(e), { status: claimErrorStatus(e) }); }
}
