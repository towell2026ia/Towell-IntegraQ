import {createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {beforeEach,describe,expect,it,vi} from "vitest";import type{RncpReport}from "@/lib/rncp-data";
beforeEach(()=>vi.stubEnv("NEXT_PUBLIC_RNCP_FLOW_ENABLED","true"));
vi.mock("./document-preview-viewer",()=>({DocumentPreviewViewer:()=>null}));
import{RncpForm}from "./suppliers-module";
const report=(origin:"native"|"historical",status:"submitted"|"closed"):RncpReport=>({id:"11111111-1111-4111-a111-111111111111",folio:"TEST-1",origin,status,late:false,portalVisible:false,history:[],actions:[],createdAt:"2026-11-09",updatedAt:"2026-11-09"});
describe("initial-photo form boundaries",()=>{
 it("does not label registration as a sent notification and freezes initial photos",()=>{const html=renderToStaticMarkup(createElement(RncpForm,{administrator:true,companies:[],demo:false,report:report("native","submitted"),onSaved:async()=>{}}));expect(html).toContain("Pendiente de notificación");expect(html).not.toContain(">Enviada<");expect(html).not.toContain('type="file"');expect(html).toContain("se conservan sin cambios");});
 it("keeps historical originals outside the upload and generated-report flow",()=>{const html=renderToStaticMarkup(createElement(RncpForm,{administrator:false,companies:[],demo:false,report:report("historical","closed"),onSaved:async()=>{}}));expect(html).not.toContain('type="file"');expect(html).toContain("Los RNCP históricos conservan sus originales");expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?Vista PDF/);});
});


describe("RNCP without purchase order",()=>{
 it("omits the input on creation",()=>{
  const html=renderToStaticMarkup(createElement(RncpForm,{administrator:true,companies:[],demo:false,onSaved:async()=>{}}));
  expect(html).not.toContain("Orden de compra");expect(html).not.toContain("purchaseOrder");
  expect(html).toContain("Producto, material o servicio");expect(html).toContain("Responsable");
 });
 it.each([true,false])("does not render an old value for administrator=%s",(administrator)=>{
  const legacy={...report("historical","closed"),purchaseOrder:"OC-260618"};
  const html=renderToStaticMarkup(createElement(RncpForm,{administrator,companies:[],demo:false,report:legacy,onSaved:async()=>{}}));
  expect(html).not.toContain("Orden de compra");expect(html).not.toContain("OC-260618");
  expect(legacy.purchaseOrder).toBe("OC-260618");
 });
});
