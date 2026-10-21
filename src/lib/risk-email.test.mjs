import {describe,expect,it,vi} from "vitest";
import {emailConfiguration,sendNotificationEmail,runEmailWorker} from "../../netlify/functions/risk-notification-email.mjs";
import {deadlineEvents} from "../../netlify/functions/risk-deadline-notifications.mjs";

describe("risk email delivery",()=>{
  const env={RESEND_API_KEY:"server-test-secret",NOTIFICATION_EMAIL_FROM:"IntegraQ <no-reply@example.invalid>",NEXT_PUBLIC_SITE_URL:"https://integraq.example.invalid"};
  const notification={title:"Riesgo creado",event_type:"risk.created",message:"Riesgo: RYO-TEST\nProceso: P-10\nResponsable: User\nAcción requerida: revisar\nFecha compromiso: 2026-10-20",action_url:"/?risk=RYO-TEST#risks"};
  const delivery={notification_id:"notification-1",recipient_address:"authorized@example.invalid"};
  it("reports missing configuration without claiming an outbox or losing inbox",async()=>{
    expect(emailConfiguration({}).ready).toBe(false);
    expect(await runEmailWorker({})).toMatchObject({status:"EMAIL_PROVIDER_CONFIG_REQUIRED",sent:0});
  });
  it("sends the event with a direct link and stable provider idempotency key",async()=>{
    const send=vi.fn(async()=>new Response(JSON.stringify({id:"provider-id"}),{status:200}));
    expect(await sendNotificationEmail(notification,delivery,env,send)).toBe("provider-id");
    expect(send.mock.calls[0][1].headers["Idempotency-Key"]).toBe("integraq-notification-1");
    const body=JSON.parse(send.mock.calls[0][1].body);
    expect(body.to).toEqual([delivery.recipient_address]);
    expect(body.text).toContain("https://integraq.example.invalid/?risk=RYO-TEST#risks");
    expect(body.text).not.toContain(env.RESEND_API_KEY);
  });
  it("records a sanitized failure and rejects links to other origins",async()=>{
    await expect(sendNotificationEmail(notification,delivery,env,async()=>new Response("sensitive provider details",{status:500}))).rejects.toThrow("EMAIL_PROVIDER_HTTP_500");
    await expect(sendNotificationEmail({...notification,action_url:"https://other.example.invalid"},delivery,env)).rejects.toThrow("EMAIL_TARGET_URL_INVALID");
  });
  it("runs deadline checks without a render and never alerts on deleted or closed risks",()=>{
    const risk={id:"R1",title:"Risk",processId:"P-10",kind:"risk"};
    const action={id:"A1",riskId:"R1",ownerId:"U1",owner:"User",title:"Action",dueDate:"2026-10-16",status:"open"};
    expect(deadlineEvents({risks:[risk],actions:[action]},new Date("2026-10-15"))[0].type).toBe("risk.action_due");
    expect(deadlineEvents({risks:[{...risk,deletedAt:"now"}],actions:[action]})).toEqual([]);
    expect(deadlineEvents({risks:[{...risk,status:"closed"}],actions:[action]})).toEqual([]);
  });
});


describe("risk email eligibility at delivery time",()=>{
  const env={RESEND_API_KEY:"server-test-secret",NOTIFICATION_EMAIL_FROM:"IntegraQ <no-reply@example.invalid>",NEXT_PUBLIC_SITE_URL:"https://integraq.example.invalid",NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",SUPABASE_SECRET_KEY:"server-test-db"};
  function fixture({canView=true,profileMode="production",email="test@example.invalid"}={}){
    const writes=[];
    const notification={id:"N1",recipient_id:"U1",organization_id:"O1",workspace_mode:"production",title:"Preview test",message:"Test",event_type:"risk.created",action_url:"/#risks"};
    const delivery={id:"D1",notification_id:"N1",recipient_address:email,attempts:1};
    const db={
      rpc:vi.fn(async(name)=>({data:name==="claim_notification_emails"?[delivery]:canView,error:null})),
      auth:{admin:{getUserById:async()=>({data:{user:{email,app_metadata:{workspace_mode:"production"}}},error:null})}},
      from:vi.fn((table)=>{
        const query={select:()=>query,eq:()=>query,single:async()=>({data:table==="notifications"?notification:{status:"active",user_type:"internal",organization_id:"O1",workspace_mode:profileMode},error:null}),update:(value)=>{writes.push({table,value});return query;},then:(resolve)=>resolve({error:null})};
        return query;
      }),
    };
    return {db,writes};
  }
  it.each([{canView:false},{profileMode:"demo"}])("does not send after risk view or workspace is revoked: %j",async(options)=>{
    const {db,writes}=fixture(options);const send=vi.fn();
    expect(await runEmailWorker(env,()=>db,send)).toEqual({status:"processed",sent:0,failed:1});
    expect(send).not.toHaveBeenCalled();
    expect(writes).toEqual([expect.objectContaining({table:"notification_deliveries",value:expect.objectContaining({status:"failed",last_error:"EMAIL_RECIPIENT_NO_LONGER_ELIGIBLE"})})]);
    expect(db.from.mock.calls.some(([table])=>table==="notifications")).toBe(true);
    expect(writes.some(w=>w.table==="notifications")).toBe(false);
  });
  it("records a missing address without sending or deleting the in-app notification",async()=>{
    const {db,writes}=fixture({email:null});const send=vi.fn();
    expect(await runEmailWorker(env,()=>db,send)).toEqual({status:"processed",sent:0,failed:0});
    expect(send).not.toHaveBeenCalled();
    expect(writes).toEqual([expect.objectContaining({table:"notification_deliveries",value:expect.objectContaining({status:"blocked_missing_address"})})]);
  });
  it("stores the provider message id for a currently eligible recipient",async()=>{
    const {db,writes}=fixture();const send=vi.fn(async()=>new Response(JSON.stringify({id:"resend-fixture-id"}),{status:200}));
    expect(await runEmailWorker(env,()=>db,send)).toEqual({status:"processed",sent:1,failed:0});
    expect(writes).toEqual([expect.objectContaining({table:"notification_deliveries",value:expect.objectContaining({status:"sent",provider_message_id:"resend-fixture-id"})})]);
  });
});
