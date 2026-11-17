import {inflateSync} from "node:zlib";
import {afterEach,describe,expect,it,vi} from "vitest";
import {commitInitialPhotos,stageInitialPhoto} from "./initial-photo-client";
import {fitInitialPhoto,buildRncpPdf} from "./generated-pdf";
afterEach(()=>vi.unstubAllGlobals());
describe("safe retry and PDF",()=>{
 it("requires explicit reconciliation after response loss even when remote order matches",async()=>{const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:"lost"}),{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({revision:2,files:[{id:"a"},{id:"b"}]})));vi.stubGlobal("fetch",fetch);await expect(commitInitialPhotos("r",["a","b"],1,"Prueba")).rejects.toMatchObject({current:{revision:2},name:"Error"});expect(fetch).toHaveBeenCalledTimes(2);});
 it("preserves conflicts instead of replacing a different remote order",async()=>{const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:"conflict"}),{status:409})).mockResolvedValueOnce(new Response(JSON.stringify({revision:2,files:[{id:"b"},{id:"a"}]})));vi.stubGlobal("fetch",fetch);await expect(commitInitialPhotos("r",["a","b"],1,"Prueba")).rejects.toThrow("conflict");expect(fetch).toHaveBeenCalledTimes(2);});
 it("fits portrait and panoramic images without cropping",()=>{expect(fitInitialPhoto(100,200,180,180)).toEqual({width:90,height:180});expect(fitInitialPhoto(400,100,180,180)).toEqual({width:180,height:45});});
 it("paginates long official-form text rather than truncating it",async()=>{const r=await buildRncpPdf({values:{description:"Descripción extensa del defecto. ".repeat(1000)},status:"draft",photos:[]});expect(r.pages).toBeGreaterThan(3);expect(r.bytes.length).toBeGreaterThan(1000);});
});

describe("upload progress without protocol changes",()=>{
 function xhr(status:number,response:unknown,fail=false){const instance={upload:{onprogress:null as null|((e:unknown)=>void)},open:vi.fn(),send:vi.fn(),responseType:"",timeout:0,status,response,onload:null as null|(()=>void),onerror:null as null|(()=>void),ontimeout:null as null|(()=>void),onabort:null as null|(()=>void)};instance.send.mockImplementation(()=>{instance.upload.onprogress?.({lengthComputable:true,loaded:5,total:10});if(fail)instance.onerror?.();else instance.onload?.();});vi.stubGlobal("XMLHttpRequest",class{constructor(){return instance;}});return instance;}
 it("sends the exact prepared file and reports measured transfer progress",async()=>{const mock=xhr(200,{id:"file-id"}),progress=vi.fn(),file=new File(["prepared bytes"],"defect.webp",{type:"image/webp"});expect(await stageInitialPhoto("report",file,progress)).toBe("file-id");expect(mock.open).toHaveBeenCalledWith("POST","/api/suppliers/rncp/photos");expect(progress).toHaveBeenCalledWith(50);const form=mock.send.mock.calls[0][0] as FormData;expect([...form.keys()]).toEqual(["reportId","file"]);expect(form.get("file")).toBe(file);});
 it("preserves quota errors without an automatic retry",async()=>{const mock=xhr(409,{error:"Se agotó la cuota"});await expect(stageInitialPhoto("r",new File(["x"],"x.png"),()=>{})).rejects.toThrow("cuota");expect(mock.send).toHaveBeenCalledTimes(1);});
 it("does not claim success when the transfer response is lost",async()=>{xhr(0,null,true);await expect(stageInitialPhoto("r",new File(["x"],"x.png"),()=>{})).rejects.toThrow("interrumpió");});
});


describe("F-CA-25 retired purchase order",()=>{
 it("omits the legacy label and value, retaining the responsible and other sections",async()=>{
  const values={purchaseOrder:"OC-260618",responsibleName:"No registrado"};
  const result=await buildRncpPdf({values,status:"draft",photos:[]});
  const raw=Buffer.from(result.bytes).toString("latin1");
  const text=[...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m=>inflateSync(Buffer.from(m[1],"latin1")).toString("latin1")).join("\n");
  expect(text).not.toContain("Orden de compra");expect(text).not.toContain("OC-260618");
  expect(text).toContain("Responsable de seguimiento");expect(text).toContain("F-CA-25");
  expect(text).toContain("Acciones inmediatas para contener");expect(text).toContain("Evidencias y descripci");
  expect(values.purchaseOrder).toBe("OC-260618");
 });
});
