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
  const record = await supabase.from("file_objects").select("original_name,mime_type,bucket_id,object_path,resource_id,external_organization_id,external_site_id").eq("id", fileId).eq("resource_type", "supplier_rncp_action_evidence").is("deleted_at", null).maybeSingle();
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
  if (session.userType !== "Proveedor") {
    if (!["Administrador","Usuario interno"].includes(session.userType) || session.specificPermissions?.["rncp.consultar_expedientes"] === false || session.specificPermissions?.["rncp.consultar_rncp"] === false) return NextResponse.json({error:"Archivo no autorizado."},{status:403});
    const link=await supabase.from("supplier_rncp_actions").select("report_id").eq("id",record.data.resource_id).maybeSingle();
    if (!link.data || link.error) return NextResponse.json({error:"Expediente no disponible."},{status:403});
    const allowed=await supabase.rpc("iq_rncp_read_scope",{p_report_id:link.data.report_id});
    if (allowed.error || allowed.data !== true) return NextResponse.json({error:"Acceso al expediente denegado."},{status:403});
  }
  const url = new URL(request.url);
  if (url.searchParams.get("content") !== "1") {
    url.searchParams.set("content","1");
    return NextResponse.json({signedUrl:url.pathname + url.search,expiresIn:0},{headers:{"Cache-Control":"private, no-store"}});
  }
  const storage=createAdminClient().storage.from("integraq-private");
  const file=await storage.download(record.data.object_path);
  if (file.error || !file.data) return NextResponse.json({error:"No se pudo abrir la evidencia."},{status:503});
  const mime = record.data.mime_type ?? "application/octet-stream";
  const disposition = url.searchParams.get("download") === "1" || !["image/jpeg","image/png","image/webp","application/pdf"].includes(mime) ? "attachment" : "inline";
  const name = encodeURIComponent(record.data.original_name).replaceAll("'","%27");
  return new Response(file.data, {headers:{
    "Cache-Control":"private, no-store","Content-Type":mime,
    "X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox",
    "Content-Disposition":disposition+"; filename*=UTF-8''"+name,
  }});
}
