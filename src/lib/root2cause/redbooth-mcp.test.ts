import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
const {jar}=vi.hoisted(()=>({jar:new Map<string,string>()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:async()=>({
  set:(entry:{name:string;value:string})=>jar.set(entry.name,entry.value),
  get:(name:string)=>jar.has(name)?{value:jar.get(name)}:undefined,
})}));
vi.mock("@/lib/supabase/auth-session",()=>({getAuthenticatedSession:vi.fn()}));
import {beginConsent,finishConsent,accessForDiscovery,connectionOrigin,mcpResource,callbackPath} from "./redbooth-mcp-auth";
import {discoverRedboothTools} from "./redbooth-mcp";
const origin="https://towell-integraq.netlify.app";
beforeEach(()=>{jar.clear();vi.stubEnv("ROOT2CAUSE_REDBOOTH_MCP_CLIENT_ID","public-client");vi.stubEnv("ROOT2CAUSE_REDBOOTH_MCP_SESSION_KEY","01".repeat(32));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("Redbooth oficial",()=>{
  it("limita el retorno a los dos orígenes aprobados",()=>{
    expect(()=>connectionOrigin(new Request("https://otro.example/"))).toThrow();
    expect(connectionOrigin(new Request(origin))).toBe(origin);
  });
  it("vincula PKCE al actor, comprueba el estado y conserva la renovación rotada",async()=>{
    const exchanges:URLSearchParams[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toBe("https://redbooth.com/oauth2/token");
      exchanges.push(init.body as URLSearchParams);
      return Response.json({access_token:"access-"+exchanges.length,refresh_token:"secret-refresh-"+exchanges.length,expires_in:1,token_type:"Bearer"});
    }));
    const auth=await beginConsent(origin,"org:admin");
    const callback=new URL(callbackPath,origin);
    callback.search=new URLSearchParams({state:auth.searchParams.get("state")!,code:"test-code"}).toString();
    await expect(finishConsent(callback,"org:otro")).rejects.toThrow();
    const wrong=new URL(callback);wrong.searchParams.set("state","diferente");
    await expect(finishConsent(wrong,"org:admin")).rejects.toThrow();
    await finishConsent(callback,"org:admin");
    expect(createHash("sha256").update(exchanges[0].get("code_verifier")!).digest("base64url")).toBe(auth.searchParams.get("code_challenge"));
    expect(exchanges[0].get("resource")).toBe(mcpResource);
    await expect(finishConsent(callback,"org:admin")).rejects.toThrow();
    await expect(accessForDiscovery(origin,"otra:admin")).rejects.toThrow();
    expect(await accessForDiscovery(origin,"org:admin")).toBe("access-2");
    expect(await accessForDiscovery(origin,"org:admin")).toBe("access-3");
    expect(exchanges[2].get("refresh_token")).toBe("secret-refresh-2");
    expect([...jar.values()].join("")).not.toMatch(/access-3|secret-refresh/);
  });
  it("negocia MCP y devuelve todas las páginas de esquemas sin ejecutar herramientas",async()=>{
    const methods:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:URL,init:RequestInit)=>{
      expect(String(url)).toBe(mcpResource);
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer unit-access");
      const msg=JSON.parse(String(init.body));
      methods.push(msg.method);
      if(msg.method==="notifications/initialized")return new Response(null,{status:202});
      const result=msg.method==="initialize"?{protocolVersion:msg.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}}:
        msg.params?.cursor?{tools:[]}:{tools:[{name:"fixture_only",inputSchema:{type:"object"}}],nextCursor:"second"};
      return Response.json({jsonrpc:"2.0",id:msg.id,result});
    }));
    const tools=await discoverRedboothTools("unit-access");
    expect(tools.map(tool=>tool.name)).toEqual(["fixture_only"]);
    expect(methods).toEqual(["initialize","notifications/initialized","tools/list","tools/list"]);
  });
});

it("mantiene el inicio de OAuth, el descubrimiento y el retorno cerrados sin acceso externo", async () => {
  const outbound = vi.fn();
  vi.stubGlobal("fetch", outbound);
  const {POST} = await import("@/app/api/root2cause/redbooth-mcp/route");
  const {GET} = await import("@/app/api/root2cause/redbooth-mcp/callback/route");
  for (const operation of ["connect", "discover"]) {
    const response = await POST(new Request(origin + "/api/root2cause/redbooth-mcp?operation=" + operation, {method:"POST", headers:{origin}}));
    expect(response.status).toBe(404);
    expect(response.headers.has("location")).toBe(false);
  }
  expect(await GET(new Request(origin + callbackPath))).toHaveProperty("status", 404);
  expect(outbound).not.toHaveBeenCalled();
  expect(jar.size).toBe(0);
});
