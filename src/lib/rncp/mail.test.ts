import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
const auth=vi.hoisted(()=>({identity:vi.fn()}));
vi.mock("./mail-auth",()=>({graphIdentity:auth.identity}));
import {graphMailTransport,type InitialMailPacket} from "./mail-graph";
const id="11111111-1111-4111-a111-111111111111";
const bytes=new TextEncoder().encode("%PDF-1.7 exact stored version"),hash=createHash("sha256").update(bytes).digest("hex");
const packet:InitialMailPacket={actorId:"actor",sender:"actor@example.test",recipient:"supplier@example.test",replyTo:"creator@example.test",fileId:"pdf",sha256:hash,size:bytes.length,version:3,name:"RNCP0227-F-CA-25.pdf",path:"rncp-originals/org/file.pdf",bucket:"integraq-private",snapshot:"a".repeat(64),folio:"RNCP0227",provider:"microsoft-graph"};
const session={actorId:"actor",organizationId:"org",email:packet.sender,accessToken:"TEST_ONLY",expires:Date.now()+60000};
function harness(p=packet,b=bytes){
 let exists=false,attached=false,sent=false;let stored=new Uint8Array(b);let failSend:number|null=null;let loseSend=false;let edited=false;let otherSender=false;
 const draft=()=>({from:{emailAddress:{address:otherSender?"other@example.test":p.sender}},sender:{emailAddress:{address:p.sender}},id:"immutable-id",isDraft:!sent,sentDateTime:sent?"2026-11-11T18:00:00Z":undefined,toRecipients:[{emailAddress:{address:edited?"other@example.test":p.recipient}}],replyTo:[{emailAddress:{address:p.replyTo}}],ccRecipients:[],bccRecipients:[],subject:`RNCP ${p.folio} · F-CA-25`});
 const request=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const u=String(input),method=init?.method??"GET";
  if(u.includes("/me/messages?")&&method==="GET")return Response.json({value:exists?[draft()]:[]});
  if(u.endsWith("/me/messages")&&method==="POST"){exists=true;return Response.json(draft(),{status:201});}
  if(u.endsWith("/attachments")&&method==="POST"){attached=true;stored=new Uint8Array(Buffer.from(JSON.parse(String(init?.body)).contentBytes,"base64"));return Response.json({id:"attachment"},{status:201});}
  if(u.endsWith("/attachments/createUploadSession"))return Response.json({uploadUrl:"https://outlook.office.com/upload"},{status:201});
  if(u==="https://outlook.office.com/upload"){attached=true;return Response.json({},{status:201});}
  if(u.includes("/attachments?"))return Response.json({value:attached?[{id:"attachment",name:p.name,contentType:"application/pdf",size:b.length,isInline:false}]:[]});
  if(u.endsWith("/$value"))return new Response(new Uint8Array(stored).buffer);
  if(u.includes("/immutable-id?"))return Response.json(draft());
  if(u.endsWith("/send")){if(loseSend){sent=true;throw new Error("lost response");}if(failSend)return Response.json({error:"redacted"},{status:failSend});sent=true;return new Response(null,{status:202});}
  throw new Error("unexpected mock URL");
 });
 return {request,transport:graphMailTransport(session,request),remember:vi.fn().mockResolvedValue(undefined),setExisting:()=>{exists=true;attached=true;},setSent:()=>{exists=true;attached=true;sent=true;},setFailed:(code:number)=>{failSend=code;},lose:()=>{loseSend=true;},edit:()=>{edited=true;},editSender:()=>{otherSender=true;},corrupt:()=>{stored=new Uint8Array([1]);},calls:(part:string)=>request.mock.calls.filter(c=>String(c[0]).includes(part))};
}
beforeEach(()=>auth.identity.mockResolvedValue(packet.sender));afterEach(()=>vi.clearAllMocks());
describe("Microsoft Graph delegated adapter; all HTTP mocked",()=>{
 it("sends one exact stored PDF, supplier recipient and creator Reply-To",async()=>{const h=harness();const result=await h.transport.send(id,packet,bytes,h.remember);expect(result.messageId).toBe("immutable-id");const create=h.request.mock.calls.find(c=>String(c[0]).endsWith("/me/messages"));const body=JSON.parse(String(create?.[1]?.body));expect(body.toRecipients[0].emailAddress.address).toBe(packet.recipient);expect(body.replyTo[0].emailAddress.address).toBe(packet.replyTo);expect(body).not.toHaveProperty("from");const upload=h.request.mock.calls.find(c=>String(c[0]).endsWith("/attachments"));expect(Buffer.from(JSON.parse(String(upload?.[1]?.body)).contentBytes,"base64")).toEqual(Buffer.from(bytes));expect(h.remember).toHaveBeenCalledWith("immutable-id");expect(h.calls("/send")).toHaveLength(1);});
 it("uses immutable ids on Graph requests",async()=>{const h=harness();await h.transport.send(id,packet,bytes,h.remember);expect(h.request.mock.calls.every(c=>(c[1]?.headers as Record<string,string>).Prefer==='IdType="ImmutableId"')).toBe(true);});
 it("rejects a different connected mailbox",async()=>{const h=harness();await expect(h.transport.send(id,{...packet,sender:"other@example.test"},bytes,h.remember)).rejects.toMatchObject({code:"AUTHENTICATION",uncertain:false});expect(h.request).not.toHaveBeenCalled();});
 it("rejects changed bytes before creating a draft",async()=>{const h=harness();await expect(h.transport.send(id,packet,new Uint8Array([1]),h.remember)).rejects.toMatchObject({code:"DOCUMENT_MISMATCH"});expect(h.request).not.toHaveBeenCalled();});
 it("reuses a prior draft without another PDF attachment",async()=>{const h=harness();h.setExisting();await h.transport.send(id,packet,bytes,h.remember);expect(h.request.mock.calls.filter(c=>c[1]?.method==="POST").map(c=>String(c[0]))).toEqual(["https://graph.microsoft.com/v1.0/me/messages/immutable-id/send"]);});
 it("recognizes an already sent copy without sending again",async()=>{const h=harness();h.setSent();expect(await h.transport.send(id,packet,bytes,h.remember)).toMatchObject({messageId:"immutable-id"});expect(h.calls("/send")).toHaveLength(0);});
 it("refuses a draft edited in Outlook",async()=>{const h=harness();h.setExisting();h.edit();await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({code:"DOCUMENT_MISMATCH",uncertain:true});expect(h.calls("/send")).toHaveLength(0);});
 it("refuses a draft whose From was changed in Outlook",async()=>{const h=harness();h.setExisting();h.editSender();await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({code:"DOCUMENT_MISMATCH"});expect(h.calls("/send")).toHaveLength(0);});
 it("refuses a changed attachment in Outlook",async()=>{const h=harness();h.setExisting();h.corrupt();await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({code:"DOCUMENT_MISMATCH"});expect(h.calls("/send")).toHaveLength(0);});
 it("does not send if durable draft registration fails",async()=>{const h=harness();h.remember.mockRejectedValue(new Error("database offline"));await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toThrow("database offline");expect(h.calls("/send")).toHaveLength(0);});
 it.each([400,401,403,429])("treats confirmed HTTP %s rejection as not accepted",async status=>{const h=harness();h.setFailed(status);await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({uncertain:false});});
 it.each([408,500,503])("blocks blind retry after HTTP %s",async status=>{const h=harness();h.setFailed(status);await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({uncertain:true});});
 it("queries a lost acceptance without re-sending",async()=>{const h=harness();h.lose();await expect(h.transport.send(id,packet,bytes,h.remember)).rejects.toMatchObject({uncertain:true});expect(await h.transport.acceptance(id,packet)).toMatchObject({messageId:"immutable-id"});expect(h.calls("/send")).toHaveLength(1);});
 it("does not interpret a draft as provider acceptance",async()=>{const h=harness();h.setExisting();expect(await h.transport.acceptance(id,packet)).toBeNull();expect(h.calls("/send")).toHaveLength(0);});
 it("supports a 4 MiB stored PDF through an upload session",async()=>{const b=new Uint8Array(4*1024*1024);b.set(bytes);const p={...packet,size:b.length,sha256:createHash("sha256").update(b).digest("hex")};const h=harness(p,b);await h.transport.send(id,p,b,h.remember);expect(h.calls("createUploadSession")).toHaveLength(1);expect(h.calls("outlook.office.com/upload")).toHaveLength(13);expect(h.calls("outlook.office.com/upload").every(c=>!(c[1]?.headers as Record<string,string>).Authorization)).toBe(true);});
});
