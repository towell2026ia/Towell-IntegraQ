import {beforeEach,describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({config:vi.fn(),connected:vi.fn(),rpc:vi.fn(),attest:vi.fn(),download:vi.fn(),send:vi.fn(),acceptance:vi.fn(),read:vi.fn()}));
vi.mock("./server",()=>({RncpError:class extends Error{constructor(message:string,public status=400){super(message);}}}));
vi.mock("./mail-auth",()=>({mailConfiguration:m.config,connectedMailbox:m.connected}));
vi.mock("./mail-graph",()=>({graphMailTransport:()=>({send:m.send,acceptance:m.acceptance}),MailTransportError:class extends Error{constructor(public code:string,public uncertain:boolean){super("transport result");}}}));
import {dispatchInitialMail,reconcileInitialMail,type InitialMailJob} from "./mail-dispatch";
import {MailTransportError} from "./mail-graph";
import type {RncpContext} from "./server";
const bytes=new TextEncoder().encode("%PDF-1.7 exact bytes"),sha=createHash("sha256").update(bytes).digest("hex");
const packet={actorId:"actor",sender:"actor@example.test",recipient:"supplier@example.test",replyTo:"creator@example.test",fileId:"pdf",sha256:sha,size:bytes.length,version:2,name:"RNCP0227.pdf",path:"rncp-originals/org/actor/document.pdf",bucket:"integraq-private",snapshot:"a".repeat(64),folio:"RNCP0227",provider:"microsoft-graph" as const};
const job=():InitialMailJob=>({id:"job",organization_id:"org",report_id:"r",lease_id:"lease",initial_phase:"prepared",initial_payload:packet,initial_draft_id:null,provider_message_id:null,sent_at:null,attempts:0,last_error_code:null});
function context(){
 const q={select:()=>q,eq:()=>q,maybeSingle:m.read};
 return {organizationId:"org",profile:{id:"actor"},supabase:{rpc:m.rpc,from:()=>q},
   admin:{rpc:m.attest,storage:{from:()=>({download:m.download})}}
 } as unknown as RncpContext;
}
const input={expected:{fileId:"pdf"},reason:"Envío individual revisado"};
beforeEach(()=>{vi.resetAllMocks();m.config.mockReturnValue({});m.connected.mockResolvedValue({email:packet.sender});m.rpc.mockImplementation(async name=>({data:name==="iq_rncp_prepare_initial_mail"?job():name==="iq_rncp_claim_initial_mail"?{...job(),initial_phase:"dispatching"}:{state:"accepted",messageId:"immutable",acceptedAt:"2026-11-11T18:00:00Z"},error:null}));m.attest.mockResolvedValue({data:true,error:null});m.download.mockResolvedValue({data:new Blob([bytes]),error:null});m.send.mockImplementation(async(_id,_packet,_bytes,remember)=>{await remember("immutable");return {messageId:"immutable",acceptedAt:"2026-11-11T18:00:00Z"};});m.read.mockResolvedValue({data:{...job(),initial_phase:"unknown"},error:null});m.acceptance.mockResolvedValue(null);});
describe("initial RNCP mail orchestration (mocked integrations)",()=>{
 it("stays disabled without configuration and never calls DB or transport",async()=>{m.config.mockReturnValue(null);await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:503});expect(m.rpc).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();});
 it("requires a connected session mailbox",async()=>{m.connected.mockResolvedValue(null);await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.send).not.toHaveBeenCalled();});
 it("records acceptance only after sending the exact stored version",async()=>{const result=await dispatchInitialMail(context(),"r",input);expect(result.state).toBe("accepted");expect(m.send.mock.calls[0][1]).toEqual(packet);expect(m.send.mock.calls[0][2]).toEqual(bytes);expect(m.attest.mock.calls.map(c=>c[1].p_result.outcome)).toEqual(["draft","accepted"]);expect(m.rpc).toHaveBeenLastCalledWith("iq_rncp_complete_initial_mail",{p_id:"job"});});
 it("does not claim or send a corrupt stored PDF",async()=>{m.download.mockResolvedValue({data:new Blob(["bad"]),error:null});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.send).not.toHaveBeenCalled();expect(m.rpc.mock.calls).toHaveLength(1);});
 it("does not send when another request already owns the claim",async()=>{m.rpc.mockImplementation(async name=>name==="iq_rncp_prepare_initial_mail"?{data:job(),error:null}:{data:null,error:{message:"RNCP_MAIL_RECONCILE_REQUIRED"}});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.send).not.toHaveBeenCalled();});
 it.each(["dispatching","unknown"])("never resends phase %s",async phase=>{m.rpc.mockResolvedValue({data:{...job(),initial_phase:phase},error:null});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.send).not.toHaveBeenCalled();});
 it("records a confirmed rejection without completing notification",async()=>{m.send.mockRejectedValue(new MailTransportError("AUTHENTICATION",false));await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:502});expect(m.attest).toHaveBeenLastCalledWith("iq_rncp_attest_initial_mail",expect.objectContaining({p_result:{outcome:"rejected",code:"AUTHENTICATION"}}));expect(m.rpc.mock.calls.some(c=>c[0]==="iq_rncp_complete_initial_mail")).toBe(false);});
 it("records uncertain acceptance without automatic retry",async()=>{m.send.mockRejectedValue(new MailTransportError("CONNECTION",true));await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.attest.mock.calls.at(-1)?.[1].p_result.outcome).toBe("unknown");expect(m.send).toHaveBeenCalledTimes(1);});
 it("does not call transport again when acceptance persistence loses its response",async()=>{m.attest.mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:null,error:{message:"lost"}});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:409});expect(m.send).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls.some(c=>c[0]==="iq_rncp_complete_initial_mail")).toBe(false);});
 it("completes a durable accepted receipt without another send",async()=>{m.read.mockResolvedValue({data:{...job(),initial_phase:"accepted_pending_record"},error:null});expect((await reconcileInitialMail(context(),"r")).state).toBe("accepted");expect(m.send).not.toHaveBeenCalled();expect(m.acceptance).not.toHaveBeenCalled();});
 it("reconciles a sent Microsoft copy without sending",async()=>{m.acceptance.mockResolvedValue({messageId:"immutable",acceptedAt:"2026-11-11T18:00:00Z"});expect((await reconcileInitialMail(context(),"r")).state).toBe("accepted");expect(m.send).not.toHaveBeenCalled();expect(m.attest.mock.calls[0][1].p_result.outcome).toBe("accepted");});
 it("does not infer acceptance when Microsoft still shows a draft",async()=>{expect((await reconcileInitialMail(context(),"r")).state).toBe("pending_confirmation");expect(m.attest).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();});
 it("rejects a job belonging to another organization",async()=>{m.rpc.mockResolvedValue({data:{...job(),organization_id:"other"},error:null});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:403});expect(m.download).not.toHaveBeenCalled();});
 it("rejects a different login sender",async()=>{m.connected.mockResolvedValue({email:"other@example.test"});await expect(dispatchInitialMail(context(),"r",input)).rejects.toMatchObject({status:403});expect(m.send).not.toHaveBeenCalled();});
});
