import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("./server",()=>({RncpError:class extends Error{constructor(message:string,public status=400){super(message);}}}));
import {requireRncpFlow} from "./flow-server";
import type {RncpContext} from "./server";
const context=(result:unknown)=>({supabase:{rpc:vi.fn().mockResolvedValue(result)}} as unknown as Pick<RncpContext,"supabase">);
describe("flow readiness",()=>{
 it("accepts exactly contract version 1",async()=>{await expect(requireRncpFlow(context({data:1,error:null}))).resolves.toBeUndefined();});
 it.each([null,2])("rejects missing or incompatible contract %s",async data=>{await expect(requireRncpFlow(context({data,error:null}))).rejects.toMatchObject({status:503});});
 it("preserves permission denial instead of treating it as missing configuration",async()=>{await expect(requireRncpFlow(context({data:null,error:{code:"42501"}}))).rejects.toMatchObject({status:403});});
});
