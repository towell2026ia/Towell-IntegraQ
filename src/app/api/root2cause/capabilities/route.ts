import {NextResponse} from "next/server";
import {getAuthenticatedSession} from "@/lib/supabase/auth-session";
import {createClient} from "@/lib/supabase/server";
import {isAdministrator,isExternalUser} from "@/lib/session-data";
import {canPerformModuleAction} from "@/lib/module-permissions";
export async function GET(){
 const s=await getAuthenticatedSession();if(!s?.authUserId||isExternalUser(s)||!canPerformModuleAction(s,'corrective-actions','view'))return NextResponse.json({enabled:false,write:false},{status:403,headers:{'Cache-Control':'no-store'}});
 try{
  const db=await createClient();const r=await db.rpc('iq_root2cause_evidence_contract');const enabled=!r.error&&r.data===1;
  return NextResponse.json({enabled,write:enabled&&isAdministrator(s)},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({enabled:false,write:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
