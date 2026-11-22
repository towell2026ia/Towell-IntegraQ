import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const local = createRequire(path.join(root,"package.json"));
const {chromium} = local("playwright");
const ts = local("typescript");
const modFile=(pkg,filename)=>fs.readFileSync(path.join(path.dirname(local.resolve(pkg+"/package.json")), "cjs",filename),"utf8");
const domLocal = createRequire(local.resolve("react-dom/client"));
const scheduler=fs.readFileSync(path.join(path.dirname(domLocal.resolve("scheduler/package.json")),"cjs/scheduler.production.js"),"utf8");
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
const modules = {"react":modFile("react","react.production.js"),"react/jsx-runtime":modFile("react","react-jsx-runtime.production.js"),
 "react-dom":modFile("react-dom","react-dom.production.js"), "react-dom/client":modFile("react-dom","react-dom-client.production.js"),scheduler,stakeholder:compile("src/components/modules/stakeholder-portal-module.tsx"),
 cert:compile("src/components/modules/customer-certifications-panel.tsx"),
 "@/lib/customer-certifications":compile("src/lib/customer-certifications.ts")};
(async()=>{
 const browser=await chromium.launch({channel:"msedge",headless:true});
 try {
 const page=await browser.newPage();
 page.setDefaultTimeout(6000);const errors=[]; page.on("pageerror",e=>{errors.push(e.message);console.error(e.stack)});
 let saved={id:"cert",code:"C-01",name:"Certificación demo",issuer:"QA",certification_type:"Sistema",responsible_id:"responsable",valid_from:"2000-01-01",valid_until:"2099-12-31",active:true,customer_visible:false,external_organization_id:null,revision:1};
 const commands=[];
 let installed=false;
 const publication={id:"manual",file_id:"original",customer_id:"cliente",display_name:"Manual QA",status:"draft",revision:1,version:1,created_at:"2026-01-01",original_name:"manual.pdf"};
 const documentActions=[];
 let data={documents:[{id:"cert",name:"Certificación autorizada",originalName:"cert.pdf",version:1,sizeBytes:12,fileHref:"/cert"}],sectionErrors:{documents:"Documentos: contrato no disponible",certifications:null}};
 await page.route("**/*",r=>{
   if(r.request().url()==="https://integraq.test/api/customers/certifications"){
     if(r.request().method()==="GET") return r.fulfill({json:{certifications:[saved],customers:[{id:"cliente",code:"A",name:"Empresa A",active:true}],responsibleUsers:[{id:"responsable",full_name:"Responsable"}],administrator:true,assignmentAvailable:true,files:[{id:"original",resource_id:"cert",original_name:"cert.pdf",version:1,is_current:true,size_bytes:12}],history:[]}});
     const body=r.request().postDataJSON(); commands.push(body);
     if(body.id!=="cert" || body.revision!==saved.revision) return r.fulfill({status:409,json:{error:"Revisión obsoleta"}});
     if(body.command==="save") saved={...saved,external_organization_id:body.customerId};
     if(body.command==="publish" || body.command==="unpublish") saved={...saved,customer_visible:body.command==="publish"};
     saved.revision++;
     return r.fulfill({json:{certification:saved}});
   }
   if(r.request().url().startsWith("https://integraq.test/api/customer-portal/admin/documents")){
     if(!installed)return r.fulfill({status:503,json:{error:"Publicación individual temporalmente no disponible"}});
     if(r.request().method()==="PATCH"){
       const change=r.request().postDataJSON();
       if(change.id!==publication.id || change.revision!==publication.revision)return r.fulfill({status:409,json:{error:"Conflicto"}});
       documentActions.push(change.action);
       publication.status=change.action==="publish"?"published":"withdrawn"; publication.revision++;
       return r.fulfill({json:{publication}});
     }
     return r.fulfill({json:{available:true,customers:[{id:"cliente",code:"A",name:"Empresa A"}],publications:r.request().url().endsWith("?customerId=cliente")?[publication]:[]}});
   }
 if(r.request().url()==="https://integraq.test/") return r.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
   if(r.request().url()==="https://integraq.test/api/customer-portal/documents") return r.fulfill({json:data});
   return r.abort();
 });
 await page.goto("https://integraq.test/");
 const mount=()=>page.evaluate(modules=>{
  const cache={},company={companyId:"cliente",companyName:"Empresa de prueba"};
  window.a3Loads=0;
  const resolve=name=>{
    if(name==="@/components/workspace-continuity")return {useContinuityState:(_key,value)=>resolve("react").useState(value),useFormDraft:()=>({clear:()=>{}})};
    if(cache[name])return cache[name].exports;
    if(name==="@/lib/portal-access")return {resolvePortalCompany:()=>company};
    if(name==="@/lib/root-cause-publication")return {loadPublishedCorrectiveActions:async()=>{window.a3Loads++;return [{id:"a3",folio:"A3-LOCAL",title:"A3 autorizado",status:"Activo",progress:20,dueDate:"2026-12-01"}]}};
    if(name==="lucide-react")return new Proxy({},{get:()=>()=>null});
    if(name.endsWith(".module.css"))return {default:{documentLinks:"links"}}; if(!modules[name])return {};
    const mod={exports:{}}; cache[name]=mod;
    new Function("module","exports","require","process",modules[name])(mod,mod.exports,resolve,{env:{NODE_ENV:"production"}});
    return mod.exports;
  };
  const React=resolve("react"),Dom=resolve("react-dom/client");
  if(location.hash==="#cert") {
    Dom.createRoot(document.querySelector("#root")).render(React.createElement(resolve("cert").CustomerCertificationsPanel));
    return;
  }
  Dom.createRoot(document.querySelector("#root")).render(React.createElement(resolve("stakeholder").StakeholderPortalModule,{kind:"customer",actions:[],session:{workspaceMode:"production",userType:location.hash==="#admin"?"Administrador":"Cliente",authUserId:"local",externalParty:{kind:"customer",companyId:"cliente",companyName:"Empresa de prueba"}}}));
 },modules);
 await mount();
 await page.getByText("Certificación autorizada",{exact:true}).waitFor().catch(async e=>{console.log(await page.locator("body").innerText(), await page.evaluate(()=>window.a3Loads));throw e});
 assert.match(await page.getByRole("alert").innerText(),/contrato no disponible/);
 await page.getByRole("button",{name:"Mis análisis A3"}).click();
 await page.getByText("A3 autorizado",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Documentos",exact:true}).click();
 data={documents:[],sectionErrors:{documents:"Documentos: sigue bloqueado",certifications:null}};
 await page.getByRole("button",{name:"Reintentar"}).click();
 await page.getByText("Documentos: sigue bloqueado",{exact:false}).waitFor();
 await page.getByRole("button",{name:"Mis análisis A3"}).click();
 await page.getByText("A3 autorizado",{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.a3Loads),1);
 console.log("PASS U01-TRANS-06: la certificación y A3 permanecen disponibles tras el error y el reintento documental.");
 await page.goto("https://integraq.test/#cert");
 await page.reload(); await mount();
 await page.getByText("Selecciona un cliente destinatario antes de publicar",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:/^Publicar/}).count(),0);
 assert.equal(commands.length,0);
 console.log("PASS U01-TRANS-01: borrador sin destinatario, aviso visible, cero botones y órdenes de publicación.");
 await page.getByRole("button",{name:"Editar certificación"}).click();
 await page.locator('select[name="customerId"]').selectOption("cliente");
 assert.equal(await page.getByRole("button",{name:/^Publicar/}).count(),0);
 await page.getByRole("button",{name:"Guardar como privada"}).click();
 await page.getByRole("button",{name:"Publicar para Empresa A",exact:true}).waitFor();
 assert.equal(saved.external_organization_id,"cliente"); assert.equal(saved.customer_visible,false);
 page.on("dialog",dialog=>dialog.accept(dialog.type()==="prompt"?"Retiro QA":undefined));
 await page.getByRole("button",{name:"Publicar para Empresa A",exact:true}).click();
 await page.getByText("Publicada para Empresa A",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Retirar publicación",exact:true}).click();
 await page.getByText("Privada / no vigente",{exact:true}).waitFor();
 assert.equal(saved.external_organization_id,"cliente");
 assert.deepEqual(commands.map(c=>c.command),["save","publish","unpublish"]);
 console.log("PASS U01-TRANS-02: selector → guardado privado → Publicar para Empresa A → Publicada para Empresa A → retirada.");
 await page.goto("https://integraq.test/#admin"); await page.reload(); await mount();
 await page.getByText("Publicación individual temporalmente no disponible",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:/Cargar privado|Publicar para/}).count(),0);
 console.log("PASS U01-TRANS-03: administrador sin contrato ve el aviso y carece de controles de carga y publicación.");
 installed=true;
 await page.getByRole("button",{name:"Reintentar consulta"}).click();
 await page.getByText("Selecciona un cliente destinatario antes de publicar",{exact:true}).waitFor();
 await page.getByLabel("Cliente destinatario").selectOption("cliente");
 await page.getByRole("button",{name:"Publicar para Empresa A",exact:true}).click();
 await page.getByText(/Versión 1 · Publicado para Empresa A/).waitFor();
 await page.getByRole("button",{name:"Retirar publicación",exact:true}).click();
 await page.getByText(/Versión 1 · Retirado/).waitFor();
 assert.deepEqual(documentActions,["publish","withdraw"]); assert.equal(publication.file_id,"original");
 console.log("PASS U01-TRANS-04: documento confirmado para Empresa A, retiro y referencia al original conservada.");
 assert.deepEqual(errors,[]);
 console.log("PASS UI: certification retained with document error; authorized A3 survives document-only retry; one A3 request; no page errors");
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
