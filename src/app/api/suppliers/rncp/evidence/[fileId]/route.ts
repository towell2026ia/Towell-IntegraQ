import { canAccessModule } from "@/lib/access-policy";
import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { fileId } = await params;
  const supabase = await createClient();
  const record = await supabase.from("file_objects").select("original_name,bucket_id,object_path,resource_id,external_organization_id,external_site_id").eq("id", fileId).eq("resource_type", "supplier_rncp_action_evidence").is("deleted_at", null).maybeSingle();
  if (record.error || !record.data) return NextResponse.json({ error: "La evidencia no está disponible para esta cuenta." }, { status: 404 });
  if(record.data.bucket_id!=="integraq-private")return NextResponse.json({error:"Archivo no autorizado."},{status:403});
  if(session.userType==="Proveedor"){
    const party=session.externalParty;
    if(!party||!canAccessModule(session,"supplier-portal")||record.data.external_organization_id!==party.companyId||(party.siteId&&party.siteId!==record.data.external_site_id))return NextResponse.json({error:"Archivo no autorizado."},{status:403});
    const linked=await supabase.from("supplier_rncp_action_evidence").select("action:supplier_rncp_actions!inner(id,report_id)").eq("file_id",fileId).eq("action_id",record.data.resource_id).maybeSingle();
    const action=Array.isArray(linked.data?.action)?linked.data.action[0]:linked.data?.action;
    if(linked.error||!action)return NextResponse.json({error:"Evidencia sin vínculo autorizado."},{status:403});
    const allowed=await supabase.rpc("iq_supplier_portal_report",{p_report:action.report_id});
    if(allowed.error||!allowed.data)return NextResponse.json({error:"Expediente no autorizado."},{status:403});
  }
  const storage=createAdminClient().storage.from("integraq-private");
  const signed = new URL(request.url).searchParams.get("download")==="1"
    ? await storage.createSignedUrl(record.data.object_path, 120, {download:record.data.original_name})
    : await storage.createSignedUrl(record.data.object_path, 120);
  if (signed.error || !signed.data) return NextResponse.json({ error: "No fue posible abrir la evidencia." }, { status: 500 });
  return NextResponse.json({ signedUrl: signed.data.signedUrl, expiresIn: 120 },{headers:{"Cache-Control":"private, no-store"}});
}
