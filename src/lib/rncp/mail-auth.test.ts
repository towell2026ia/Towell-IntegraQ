import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({get:vi.fn(),set:vi.fn(),remove:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:m.get,set:m.set,delete:m.remove})}));
vi.mock("./server",()=>({RncpError:class extends Error{constructor(message:string,public status=400){super(message);}}}));
import {sealMailCookie,openMailCookie,mailConfiguration,connectedMailbox,beginMailboxConnection,completeMailboxConnection} from "./mail-auth";
import type {RncpContext} from "./server";
const key="11".repeat(32);
const context={profile:{id:"actor"},organizationId:"org",admin:{auth:{admin:{getUserById:async()=>({data:{user:{email:"actor@example.test",email_confirmed_at:"2026-11-11"}},error:null})}}}} as unknown as RncpContext;
function config(){vi.stubEnv("RNCP_MAIL_ENABLED","true");vi.stubEnv("RNCP_GRAPH_TENANT_ID","11111111-1111-4111-a111-111111111111");vi.stubEnv("RNCP_GRAPH_CLIENT_ID","22222222-2222-4222-a222-222222222222");vi.stubEnv("RNCP_GRAPH_CLIENT_SECRET","TEST_ONLY");vi.stubEnv("RNCP_GRAPH_REDIRECT_URI","https://preview.example.test/api/suppliers/rncp/mail/callback");vi.stubEnv("RNCP_MAIL_COOKIE_KEY",key);}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("RNCP_MAIL_ENABLED","");vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("network forbidden in test")));});afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("delegated mailbox security",()=>{
 it("encrypts credentials and authenticates tampering",()=>{const data={accessToken:"TOKEN_TEST_ONLY",actorId:"actor"};const encoded=sealMailCookie(data,key);expect(encoded).not.toContain(data.accessToken);expect(openMailCookie(encoded,key)).toEqual(data);const tampered=Buffer.from(encoded,"base64url");tampered[14]^=1;expect(()=>openMailCookie(tampered.toString("base64url"),key)).toThrow();});
 it("is disabled by default",()=>expect(mailConfiguration()).toBeNull());
 it("requires secure configured callback",()=>{config();vi.stubEnv("RNCP_GRAPH_REDIRECT_URI","http://example.test/api/suppliers/rncp/mail/callback");expect(mailConfiguration()).toBeNull();});
 it("binds the token to the logged-in user and organization",async()=>{config();m.get.mockReturnValue({value:sealMailCookie({actorId:"other",organizationId:"org",email:"actor@example.test",accessToken:"TEST_ONLY",expires:Date.now()+60000},key)});expect(await connectedMailbox(context)).toBeNull();expect(fetch).not.toHaveBeenCalled();});
 it("rejects expired mailbox sessions",async()=>{config();m.get.mockReturnValue({value:sealMailCookie({actorId:"actor",organizationId:"org",email:"actor@example.test",accessToken:"TEST_ONLY",expires:Date.now()-1},key)});expect(await connectedMailbox(context)).toBeNull();});
 it("uses PKCE, a short encrypted state cookie and delegated permissions only",async()=>{config();const url=await beginMailboxConnection(context,"report");expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.searchParams.get("scope")).toBe("User.Read Mail.ReadWrite Mail.Send");expect(url.searchParams.get("scope")).not.toContain("offline_access");expect(m.set.mock.calls[0][2]).toMatchObject({httpOnly:true,secure:true,sameSite:"lax",maxAge:600});expect(fetch).not.toHaveBeenCalled();});
 it("rejects callback state mismatch before exchanging any token",async()=>{config();m.get.mockReturnValue({value:sealMailCookie({actorId:"actor",organizationId:"org",state:"a".repeat(48),verifier:"x",reportId:"report",expires:Date.now()+60000},key)});await expect(completeMailboxConnection(context,new URL("https://preview.example.test/api/suppliers/rncp/mail/callback?code=test&state="+"b".repeat(48)))).rejects.toMatchObject({status:403});expect(fetch).not.toHaveBeenCalled();});
});
