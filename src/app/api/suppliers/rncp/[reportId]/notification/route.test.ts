import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({config:vi.fn(),context:vi.fn(),send:vi.fn(),reconcile:vi.fn()}));
vi.mock("@/lib/rncp/server",()=>({rncpContext:m.context,RncpError:class extends Error{constructor(message:string,public status=400){super(message);}}}));
vi.mock("@/lib/rncp/initial-photo-server",()=>({photoFailure:(e:Error & {status?:number})=>Response.json({error:e.message},{status:e.status??503})}));
vi.mock("@/lib/rncp/mail-auth",()=>({mailConfiguration:m.config,connectedMailbox:vi.fn(),loginMailbox:vi.fn()}));
vi.mock("@/lib/rncp/mail-dispatch",()=>({dispatchInitialMail:m.send,reconcileInitialMail:m.reconcile,initialMailJob:vi.fn()}));
vi.mock("@/lib/rncp/initial-notification",()=>({prepareInitialNotification:vi.fn()}));
import {POST} from "./route";
const id="11111111-1111-4111-a111-111111111111",params={params:Promise.resolve({reportId:id})};
function request(body:unknown,origin="https://preview.example.test"){return new Request("https://preview.example.test/api/suppliers/rncp/"+id+"/notification",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();m.config.mockReturnValue({redirect:"https://preview.example.test/api/suppliers/rncp/mail/callback"});m.context.mockResolvedValue({profile:{id:"actor"}});m.send.mockResolvedValue({state:"accepted"});m.reconcile.mockResolvedValue({state:"pending_confirmation"});});
describe("individual email endpoint (transport mocked)",()=>{
 it("blocks all sending when disabled",async()=>{m.config.mockReturnValue(null);expect((await POST(request({}),params)).status).toBe(503);expect(m.send).not.toHaveBeenCalled();expect(m.context).not.toHaveBeenCalled();});
 it("rejects cross-origin POST",async()=>{expect((await POST(request({command:"send"},"https://other.example.test"),params)).status).toBe(403);expect(m.context).not.toHaveBeenCalled();});
 it("requires a live authorized session",async()=>{m.context.mockRejectedValue(Object.assign(new Error("denied"),{status:403}));expect((await POST(request({command:"send"}),params)).status).toBe(403);expect(m.send).not.toHaveBeenCalled();});
 it.each([{command:"send"},{command:"send",confirmed:true,expected:{},reason:""},{command:"bulk",confirmed:true,expected:{},reason:"Valid reason"}])("requires individual confirmation and reason %j",async body=>{expect((await POST(request(body),params)).status).toBe(400);expect(m.send).not.toHaveBeenCalled();});
 it("passes only the explicit version confirmation to the guarded service",async()=>{const expected={fileId:"pdf",fingerprint:"hash",sender:"actor@example.test",recipient:"supplier@example.test",replyTo:"creator@example.test"};const response=await POST(request({command:"send",confirmed:true,expected,reason:"Revisión individual"}),params);expect(response.status).toBe(200);expect(m.send).toHaveBeenCalledWith(expect.anything(),id,{expected,reason:"Revisión individual"});expect(response.headers.get("Cache-Control")).toBe("private, no-store");});
 it("reconciliation cannot invoke sending",async()=>{expect((await POST(request({command:"reconcile"}),params)).status).toBe(200);expect(m.reconcile).toHaveBeenCalledTimes(1);expect(m.send).not.toHaveBeenCalled();});
});
