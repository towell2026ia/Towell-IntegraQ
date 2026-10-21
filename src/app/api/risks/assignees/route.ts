import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export const dynamic="force-dynamic";
export async function GET() {
  const client=await createClient();const {data:auth}=await client.auth.getUser();
  if(!auth.user)return NextResponse.json({error:"Acceso requerido"},{status:401});
  const admin=createAdminClient();
  const actor=await admin.from("profiles").select("organization_id,status,user_type").eq("id",auth.user.id).single();
  if(actor.error||actor.data.status!=="active"||!["internal","administrator"].includes(actor.data.user_type)||!actor.data.organization_id)return NextResponse.json({error:"Acceso denegado"},{status:403});
  const access=await admin.rpc("risk_has_access",{p_user:auth.user.id,p_action:"view"});
  if(access.error)return NextResponse.json({error:"Permisos no disponibles"},{status:500});
  if(!access.data)return NextResponse.json({error:"Acceso denegado"},{status:403});
  const profiles=await admin.from("profiles").select("id,full_name,user_type").eq("organization_id",actor.data.organization_id).eq("status","active").in("user_type",["internal","administrator"]);
  const processGrants=await admin.from("user_process_permissions").select("user_id,process_id");
  if(profiles.error||processGrants.error)return NextResponse.json({error:"Directorio no disponible"},{status:500});
  const mode=auth.user.app_metadata.workspace_mode??"production";
  const ids=new Set<string>();
  for(let page=1;;page++){
    const users=await admin.auth.admin.listUsers({page,perPage:1000});
    if(users.error)return NextResponse.json({error:"Directorio no disponible"},{status:500});
    for(const user of users.data.users)if((user.app_metadata.workspace_mode??"production")===mode)ids.add(user.id);
    if(users.data.users.length<1000)break;
  }
  const results=await Promise.all(profiles.data.filter(p=>ids.has(p.id)).map(async p=>{
    const allowed=await admin.rpc("risk_has_access",{p_user:p.id,p_action:"view"});
    if(allowed.error)throw Error("Assignee permission lookup failed");
    return allowed.data?{id:p.id,name:p.full_name,administrator:p.user_type==="administrator",processIds:processGrants.data.filter(g=>g.user_id===p.id).map(g=>g.process_id)}:null;
  }));
  return NextResponse.json({users:results.filter(Boolean)});
}
