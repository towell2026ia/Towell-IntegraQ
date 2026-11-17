import {beforeEach,describe,expect,it,vi} from "vitest";
import sharp from "sharp";
import {createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),adminRpc:vi.fn(),upload:vi.fn(),download:vi.fn(),report:{id:"11111111-1111-4111-a111-111111111111",organization_id:"org-a",source_kind:"native",status:"draft",deleted_at:null as string|null},files:[] as Array<{id:string;name:string;mime:string;sha256?:string}>,file:{bucket_id:"integraq-private",object_path:""},manifestError:null as {code:string;message:string}|null}));
vi.mock("./server",()=>({rncpContext:state.context,RncpError:class extends Error{constructor(m:string,public status=400){super(m);}}}));
import {inspectInitialPhoto,photoObjectIdentity,photoReport} from "./initial-photo-server";
import {validatePhotoDimensions,MAX_INITIAL_PHOTO_BYTES} from "./initial-photos";
import {GET,POST,PUT} from "@/app/api/suppliers/rncp/photos/route";
import {GET as downloadPhoto} from "@/app/api/suppliers/rncp/photos/[fileId]/route";
const id="11111111-1111-4111-a111-111111111111",fid="22222222-2222-4222-a222-222222222222";
beforeEach(()=>{
 vi.clearAllMocks();state.report={id,organization_id:"org-a",source_kind:"native",status:"draft",deleted_at:null};state.files=[];state.manifestError=null;
 const query={select:()=>query,eq:()=>query,is:()=>query,maybeSingle:async()=>({data:state.report,error:null})};
 const fileQuery={select:()=>fileQuery,eq:()=>fileQuery,is:()=>fileQuery,maybeSingle:async()=>({data:state.file,error:null})};
 state.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==="iq_rncp_initial_photo_reserve"?(args.p_report===null?{data:null,error:state.manifestError??{code:"42501",message:"PHOTO_FORBIDDEN"}}:{data:{...(args.p_file as object),verified:false},error:null}):name==="iq_rncp_initial_photo_manifest"?{data:{revision:0,files:state.files},error:state.manifestError}:name==="iq_rncp_initial_photo_stage"?{data:(args.p_file as {id:string}).id,error:null}:{data:{revision:1,files:[]},error:null});
 state.adminRpc.mockImplementation(async(_name:string,args:Record<string,unknown>)=>args.p_file_id===null?{data:null,error:{code:"P0001",message:"PHOTO_VERIFICATION_MISMATCH"}}:{data:null,error:null});
 state.upload.mockImplementation(async(_path:string,bytes:Uint8Array,options:{contentType:string})=>{state.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes).buffer],{type:options.contentType}),error:null});return {error:null};});state.download.mockResolvedValue({data:null,error:{message:"missing"}});
 state.file={bucket_id:"integraq-private",object_path:"rncp-initial/org-a/"+id+"/original.png"};
 state.context.mockResolvedValue({organizationId:"org-a",supabase:{from:()=>query,rpc:state.rpc},admin:{rpc:state.adminRpc,from:()=>fileQuery,storage:{from:()=>({upload:state.upload,download:state.download})}}});
});
async function image(format:"png"|"jpeg"|"webp"="png"){return sharp({create:{width:32,height:24,channels:3,background:"#ff0011"}})[format]().toBuffer();}
async function post(bytes:Uint8Array,name="defecto.png",type="image/png"){const form=new FormData();form.set("reportId",id);form.set("file",new File([new Uint8Array(bytes).buffer],name,{type}));return POST(new Request("https://local.test/api/suppliers/rncp/photos",{method:"POST",body:form}));}
describe("real initial photo decoding",()=>{
 it.each(["png","jpeg","webp"] as const)("decodes real %s pixels and hashes original bytes",async format=>{const r=await inspectInitialPhoto(await image(format),"photo."+format,format==="jpeg"?"image/jpeg":"image/"+format);expect(r).toMatchObject({width:32,height:24,mime:format==="jpeg"?"image/jpeg":"image/"+format});expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);});
 it("rejects signatures without complete image content",async()=>expect(inspectInitialPhoto(new Uint8Array([137,80,78,71,13,10,26,10]),"x.png","image/png")).rejects.toThrow());
 it("rejects mismatched extension and disguised text",async()=>{await expect(post(await image(),"photo.jpg")).resolves.toHaveProperty("status",400);expect(state.upload).not.toHaveBeenCalled();await expect(inspectInitialPhoto(new TextEncoder().encode("<svg/>"),"x.png","image/png")).rejects.toThrow();});
 it("rejects size, animation and decompression limits",async()=>{expect((await post(new Uint8Array(MAX_INITIAL_PHOTO_BYTES+1))).status).toBe(400);expect(()=>validatePhotoDimensions(6000,6000)).toThrow();expect(()=>validatePhotoDimensions(100,100,2)).toThrow();expect(state.upload).not.toHaveBeenCalled();});
});
describe("private draft-scoped photo API",()=>{
 it.each(["historical","legacy"])("rejects %s without writing storage",async source_kind=>{state.report.source_kind=source_kind;expect((await post(await image())).status).toBe(403);expect(state.upload).not.toHaveBeenCalled();});
 it("rejects foreign organization and foreign report before access",async()=>{state.report.organization_id="org-b";await expect(photoReport(id)).rejects.toMatchObject({status:403});state.report.organization_id="org-a";await expect(photoReport(fid)).rejects.toMatchObject({status:403});});
 it("denies inactive/unapproved sessions through existing context",async()=>{state.context.mockRejectedValue(new Error("Denied"));expect((await post(await image())).status).not.toBe(200);expect(state.upload).not.toHaveBeenCalled();});
 it("freezes initial photos once registered",async()=>{state.report.status="submitted";expect((await post(await image())).status).toBe(409);expect(state.upload).not.toHaveBeenCalled();});
 it("fails closed when the exact SQL is not activated",async()=>{state.manifestError={code:"PGRST202",message:"function absent"};expect((await GET(new Request("https://local.test/photos"))).status).toBe(503);expect(state.upload).not.toHaveBeenCalled();});
 it("stages verified content privately without action evidence or notifications",async()=>{expect((await post(await image())).status).toBe(200);expect(state.upload).toHaveBeenCalledWith(expect.stringMatching(/^rncp-initial\/org-a\//),expect.any(Uint8Array),expect.objectContaining({upsert:false}));expect(state.rpc.mock.calls.some(c=>String(c[0]).includes("notify"))).toBe(false);});
 it("recovers the same deterministic stored object after upload response loss",async()=>{const bytes=await image();state.upload.mockResolvedValue({error:{message:"already exists"}});state.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes).buffer]),error:null});const a=await (await post(bytes)).json(),b=await (await post(bytes)).json();expect(a.id).toBe(b.id);expect(state.download).toHaveBeenCalled();expect(photoObjectIdentity("org-a",id,"a".repeat(64),"image/png")).toEqual(photoObjectIdentity("org-a",id,"a".repeat(64),"image/png"));});
 it("keeps an upload failure unlinked",async()=>{state.upload.mockResolvedValue({error:{message:"offline"}});expect((await post(await image())).status).toBe(503);expect(state.rpc.mock.calls.some(c=>c[0]==="iq_rncp_initial_photo_stage")).toBe(false);});
 it("rejects duplicate manifest IDs before commit",async()=>{const r=await PUT(new Request("https://local.test/photos",{method:"PUT",body:JSON.stringify({reportId:id,fileIds:[fid,fid],revision:0,reason:"Prueba"})}));expect(r.status).toBe(400);});
 it("does not serve staged or action evidence objects absent from the current manifest",async()=>{const r=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id),{params:Promise.resolve({fileId:fid})});expect(r.status).toBe(403);expect(state.download).not.toHaveBeenCalled();});
 it("does not serve a private file stored under another organization path",async()=>{state.files=[{id:fid,name:"p.png",mime:"image/png"}];state.file.object_path="rncp-initial/org-b/"+id+"/x.png";expect((await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id),{params:Promise.resolve({fileId:fid})})).status).toBe(403);expect(state.download).not.toHaveBeenCalled();});
});

describe("orientation and private byte integrity",()=>{
 it("honors mobile EXIF orientation without changing original-byte identity",async()=>{const bytes=await sharp({create:{width:32,height:24,channels:3,background:"red"}}).jpeg().withMetadata({orientation:6}).toBuffer();const p=await inspectInitialPhoto(bytes,"mobile.JPG","image/jpeg");expect(p).toMatchObject({width:24,height:32});expect(p.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));});
 it("rejects actual animated WEBP content",async()=>{const b=Buffer.from("UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAGQAAAJWUDggMgAAADABAJ0BKgIAAgABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkYAAAAAAAAAAAABAAABAABkAAAAVlA4IC4AAAA0AQCdASoCAAIAAAAmJaAAA3AA/vtV4///S4P/+lwf/9Lg/9Lg//rV5Vesq6AA","base64");await expect(inspectInitialPhoto(b,"moving.webp","image/webp")).rejects.toThrow();});
 it("serves only the verified bytes with private no-store headers",async()=>{const bytes=await image(),sha256=createHash("sha256").update(bytes).digest("hex");state.files=[{id:fid,name:"p.png",mime:"image/png",sha256}];state.file.object_path=photoObjectIdentity("org-a",id,sha256,"image/png").path;state.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes).buffer]),error:null});const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id),{params:Promise.resolve({fileId:fid})});expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");});
 it("refuses a changed private storage object instead of displaying it as the original photo",async()=>{const bytes=await image(),sha256=createHash("sha256").update(bytes).digest("hex");state.files=[{id:fid,name:"p.png",mime:"image/png",sha256}];state.file.object_path=photoObjectIdentity("org-a",id,sha256,"image/png").path;state.download.mockResolvedValue({data:new Blob(["different bytes"]),error:null});const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id),{params:Promise.resolve({fileId:fid})});expect(response.status).toBe(409);});
});

describe("authorized derived thumbnails",()=>{
 it("serves a small WEBP thumbnail only after parent, manifest, path and SHA checks",async()=>{
  const bytes=await sharp({create:{width:2400,height:1600,channels:3,background:"#201f6f"}}).png().toBuffer(),sha256=createHash("sha256").update(bytes).digest("hex");
  state.files=[{id:fid,name:"p.png",mime:"image/png",sha256}];state.file.object_path=photoObjectIdentity("org-a",id,sha256,"image/png").path;state.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null});
  const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id+"&variant=thumbnail"),{params:Promise.resolve({fileId:fid})});
  expect(response.status).toBe(200);expect(response.headers.get("Content-Type")).toBe("image/webp");expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const thumbnail=new Uint8Array(await response.arrayBuffer()),m=await sharp(thumbnail).metadata();expect(m.width).toBe(384);expect(m.height).toBe(256);expect(state.upload).not.toHaveBeenCalled();expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
 });
 it("cannot use the thumbnail variant to expose another organization",async()=>{state.report.organization_id="org-b";const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id+"&variant=thumbnail"),{params:Promise.resolve({fileId:fid})});expect(response.status).toBe(403);expect(state.download).not.toHaveBeenCalled();});
 it("rejects retired/unlinked thumbnails before Storage",async()=>{const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id+"&variant=thumbnail"),{params:Promise.resolve({fileId:fid})});expect(response.status).toBe(403);expect(state.download).not.toHaveBeenCalled();});
 it("rejects arbitrary variants without calling Storage",async()=>{const response=await downloadPhoto(new Request("https://local.test/photos/"+fid+"?reportId="+id+"&variant=../../original"),{params:Promise.resolve({fileId:fid})});expect(response.status).toBe(400);expect(state.download).not.toHaveBeenCalled();});
});
