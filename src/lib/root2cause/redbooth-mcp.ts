import "server-only";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {mcpResource,ConnectionError} from "./redbooth-mcp-auth";

export async function discoverRedboothTools(access:string) {
  const client=new Client({name:"IntegraQ Root2Cause",version:"1.0"});
  const transport=new StreamableHTTPClientTransport(new URL(mcpResource),{
    requestInit:{headers:{Authorization:"Bearer "+access},cache:"no-store",redirect:"error"},
    fetch:(url,init)=>{
      if(String(url)!==mcpResource) throw new ConnectionError("Destino MCP no autorizado.",502);
      return fetch(url,{...init,redirect:"error",cache:"no-store"});
    },
  });
  const signal=AbortSignal.timeout(15000);
  try {
    await client.connect(transport,{signal});
    const tools=[];
    const seen=new Set<string>();
    let cursor:string|undefined;
    do {
      const page=await client.listTools(cursor?{cursor}:undefined,{signal});
      for(const tool of page.tools) tools.push({name:tool.name,inputSchema:tool.inputSchema,outputSchema:tool.outputSchema,annotations:tool.annotations});
      cursor=page.nextCursor;
      if(cursor && (seen.has(cursor)||seen.size>=50)) throw new ConnectionError("Catálogo MCP incompleto.",502);
      if(cursor) seen.add(cursor);
    } while(cursor);
    return tools;
  } finally {
    await client.close();
  }
}
