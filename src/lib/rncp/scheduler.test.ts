import { afterEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({ client:vi.fn(), rpc:vi.fn(), settings:[{workspace_id:"org-a",payload:{followupEnabled:true}},{workspace_id:"org-b",payload:{followupEnabled:false}}] }));
vi.mock("@supabase/supabase-js",()=>({createClient:(...args:unknown[])=>{state.client(...args);const query={select:()=>query,eq:()=>query,is:async()=>({data:state.settings,error:null})};return{from:()=>query,rpc:state.rpc};}}));
import handler from "../../../netlify/functions/rncp-followup.mjs";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const request=new Request("https://example.test/.netlify/functions/rncp-followup");
describe("disabled-by-default queue-only scheduled follow-up",()=>{
  it("makes no database or email call without explicit activation",async()=>{vi.stubEnv("RNCP_FOLLOWUP_ENABLED","");const response=await handler(request,{deploy:{context:"production"}});expect(await response.json()).toEqual({state:"disabled",emailsSent:0});expect(state.client).not.toHaveBeenCalled();});
  it("never runs against a preview deployment",async()=>{vi.stubEnv("RNCP_FOLLOWUP_ENABLED","true");expect((await handler(request,{deploy:{context:"deploy-preview"}})).status).toBe(200);expect(state.client).not.toHaveBeenCalled();});
  it("requires the fixed configured project before any database call",async()=>{vi.stubEnv("RNCP_FOLLOWUP_ENABLED","true");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://other-project.supabase.co");vi.stubEnv("SUPABASE_SECRET_KEY","isolated-test-only");expect((await handler(request,{deploy:{context:"production"}})).status).toBe(503);expect(state.client).not.toHaveBeenCalled();});
  it("evaluates only explicitly enabled organization settings and never sends email",async()=>{vi.stubEnv("RNCP_FOLLOWUP_ENABLED","true");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://yptrqowmviixlkrxjrqr.supabase.co");vi.stubEnv("SUPABASE_SECRET_KEY","isolated-test-only");state.rpc.mockResolvedValue({data:4,error:null});const response=await handler(request,{deploy:{context:"production"}});expect(await response.json()).toEqual({state:"queue_only_real_email_disabled",queued:4,emailsSent:0});expect(state.rpc).toHaveBeenCalledExactlyOnceWith("iq_rncp_queue_notifications",{p_organization_id:"org-a"});});
});
