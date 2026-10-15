import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET() {
  const db = await createClient();
  const {data:auth}=await db.auth.getUser();
  if(!auth.user) return NextResponse.json({error:"Acceso requerido"},{status:401});
  const [items,unread]=await Promise.all([
    db.from("notifications").select("id,title,message,action_url,created_at,read_at").eq("recipient_id",auth.user.id).order("created_at",{ascending:false}).limit(30),
    db.from("notifications").select("id",{count:"exact",head:true}).eq("recipient_id",auth.user.id).is("read_at",null),
  ]);
  if(items.error || unread.error) return NextResponse.json({error:"Inbox no disponible"},{status:500});
  return NextResponse.json({items:items.data,unread:unread.count??0});
}
export async function PATCH(request:Request) {
  const db=await createClient();
  const {data:auth}=await db.auth.getUser();
  if(!auth.user) return NextResponse.json({error:"Acceso requerido"},{status:401});
  const {id}=await request.json() as {id?:string};
  if(!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:"Id inválido"},{status:400});
  const result=await db.from("notifications").update({read_at:new Date().toISOString(),status:"read"}).eq("id",id).eq("recipient_id",auth.user.id).is("read_at",null).select("id");
  if(result.error) return NextResponse.json({error:"No fue posible marcar leída"},{status:500});
  return NextResponse.json({ok:true});
}
