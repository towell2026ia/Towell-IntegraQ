import {createClient} from "@supabase/supabase-js";

export const config={schedule:"* * * * *"};

export function emailConfiguration(env) {
  return env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM && env.NEXT_PUBLIC_SITE_URL
    ? {provider:"resend",ready:true} : {provider:"EMAIL_PROVIDER_CONFIG_REQUIRED",ready:false};
}

export async function sendNotificationEmail(notification,delivery,env,send=fetch) {
  if(!emailConfiguration(env).ready) throw Error("EMAIL_PROVIDER_CONFIG_REQUIRED");
  const base=new URL(env.NEXT_PUBLIC_SITE_URL);
  if(base.protocol!=="https:" && base.hostname!=="localhost") throw Error("EMAIL_SITE_URL_INVALID");
  const target=new URL(notification.action_url??"/#risks",base);
  if(target.origin!==base.origin) throw Error("EMAIL_TARGET_URL_INVALID");
  const response=await send("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`integraq-${delivery.notification_id}`},body:JSON.stringify({from:env.NOTIFICATION_EMAIL_FROM,to:[delivery.recipient_address],subject:notification.title,text:`Evento: ${notification.event_type}\n${notification.message}\n\nAbrir IntegraQ: ${target.href}`}),signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error(`EMAIL_PROVIDER_HTTP_${response.status}`);
  const body=await response.json();
  if(typeof body.id!=="string")throw Error("EMAIL_PROVIDER_INVALID_RESPONSE");
  return body.id;
}

export async function runEmailWorker(env=process.env,clientFactory=createClient,send=fetch) {
  // Configuration is checked before claiming. In-app notifications remain intact on failure.
  const configuration=emailConfiguration(env);
  if(!configuration.ready)return {status:configuration.provider,sent:0};
  const db=clientFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(5000)})}});
  const claim=await db.rpc("claim_notification_emails",{p_limit:2});
  if(claim.error)throw Error("EMAIL_OUTBOX_CLAIM_FAILED");
  let sent=0;let failed=0;
  await Promise.all((claim.data??[]).map(async delivery=>{
    try {
      const found=await db.from("notifications").select("title,message,event_type,action_url,recipient_id,organization_id,workspace_mode").eq("id",delivery.notification_id).single();
      if(found.error)throw Error("EMAIL_NOTIFICATION_MISSING");
      // Revalidate active organization and Auth email at delivery time as well as enqueue time.
      const [profile,user,access]=await Promise.all([db.from("profiles").select("status,user_type,organization_id,workspace_mode").eq("id",found.data.recipient_id).single(),db.auth.admin.getUserById(found.data.recipient_id),db.rpc("risk_has_access",{p_user:found.data.recipient_id,p_action:"view"})]);
      if(profile.error||user.error||access.error||!access.data||profile.data.workspace_mode!=="production"||profile.data.status!=="active"||!["administrator","internal"].includes(profile.data.user_type)||profile.data.organization_id!==found.data.organization_id||(user.data.user.app_metadata.workspace_mode??"production")!=="production"||found.data.workspace_mode!=="production")throw Error("EMAIL_RECIPIENT_NO_LONGER_ELIGIBLE");
      const address=user.data.user.email;
      if(!address) {
        const blocked=await db.from("notification_deliveries").update({status:"blocked_missing_address",recipient_address:null,last_error:"blocked_missing_address",locked_at:null}).eq("id",delivery.id).eq("attempts",delivery.attempts);
        if(blocked.error)throw Error("EMAIL_OUTBOX_UPDATE_FAILED");
        return;
      }
      // Address is fixed once an attempt has started so provider idempotency payload stays stable.
      if(address!==delivery.recipient_address)throw Error("EMAIL_RECIPIENT_ADDRESS_CHANGED_REVIEW_REQUIRED");
      const providerId=await sendNotificationEmail(found.data,delivery,env,send);
      const updated=await db.from("notification_deliveries").update({status:"sent",provider_message_id:providerId,sent_at:new Date().toISOString(),last_error:null,locked_at:null}).eq("id",delivery.id).eq("attempts",delivery.attempts);
      if(updated.error)throw Error("EMAIL_OUTBOX_UPDATE_FAILED");
      sent++;
    }catch(error){
      const safeError=error instanceof Error&&/^EMAIL_[A-Z0-9_]+$/.test(error.message)?error.message:"EMAIL_SEND_FAILED";
      const updated=await db.from("notification_deliveries").update({status:"failed",last_error:safeError,locked_at:null,available_at:new Date(Date.now()+Math.min(60,2**delivery.attempts)*60000).toISOString()}).eq("id",delivery.id).eq("attempts",delivery.attempts);
      if(updated.error)throw Error("EMAIL_OUTBOX_UPDATE_FAILED");
      failed++;
    }
  }));
  return {status:"processed",sent,failed};
}

export default async function handler(){
  const result=await runEmailWorker();
  console.log(JSON.stringify(result));
  return new Response(JSON.stringify(result),{headers:{"Content-Type":"application/json"}});
}
