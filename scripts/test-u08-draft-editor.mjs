// Exercise the actual editor in Edge; intercept all network requests in both sessions.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

const local=createRequire(import.meta.url);
const {chromium}=local("playwright");
const ts=local("typescript");
const dom=createRequire(local.resolve("react-dom/client"));
const modules={};
function cjs(pkg,file,resolver=local) {
  return readFileSync(path.join(path.dirname(resolver.resolve(pkg+"/package.json")),"cjs",file),"utf8");
}
modules.react=cjs("react","react.production.js");
modules["react/jsx-runtime"]=cjs("react","react-jsx-runtime.production.js");
modules["react-dom"]=cjs("react-dom","react-dom.production.js");
modules["react-dom/client"]=cjs("react-dom","react-dom-client.production.js");
modules["lucide-react"]=readFileSync(local.resolve("lucide-react"),"utf8");
modules.scheduler=cjs("scheduler","scheduler.production.js",dom);
for (const [name,ext] of Object.entries({
  "components/modules/a3-analysis-workbench":"tsx","components/workspace-continuity":"tsx",
  "lib/workspace-continuity":"ts","lib/root2cause/draft-cache":"ts","lib/root2cause/action-plan":"ts",
  "lib/root2cause/cause-links":"ts","lib/root2cause/assistant":"ts","lib/root-cause-draft-storage":"ts",
  "lib/root-cause-customers":"ts","components/modules/corrective-actions-module":"tsx",
  "lib/corrective-action-access":"ts","lib/corrective-action-list":"ts","lib/domain":"ts",
})) modules["@/"+name]=ts.transpileModule(readFileSync("src/"+name+"."+ext,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
let document;
let failSave=false;
let delaySave;
let saveStarted;
let aiCalls=0;
let waitForAi;
let aiStarted;
const errors=[];
const browser=await chromium.launch({channel:"msedge",headless:true});
async function openSession(initialClaim, actions) {
  const page=await browser.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    assert.equal(url.origin,"https://a3.test");
    if(url.pathname==="/") return route.fulfill({contentType:"text/html",body:'<main id="app"></main>'});
    if(url.pathname==="/api/root2cause/drafts"){
      if(req.method()==="GET") return route.fulfill({json:url.searchParams.has("id")?{draft:document}:{drafts:document?[document]:[]}});
      const body=req.postDataJSON();
      if(failSave)return route.fulfill({status:409,json:{error:"Conflicto de revisión del fixture."}});
      assert.equal(body.revision,document?.revision??0);
      saveStarted?.();
      if(delaySave) await delaySave;
      document={...body,title:body.payload.draft.title,source:"internal",processId:"PROC",revision:body.revision+1};
      return route.fulfill({json:{id:document.id,revision:document.revision}});
    }
    if(url.pathname==="/api/ai/root-cause/assist"){
      aiCalls++;
      aiStarted?.();
      if (waitForAi) await waitForAi;
      return route.fulfill({status:504,contentType:"text/html",body:"<HTML>Gateway Timeout</HTML>"});
    }
    if(url.pathname==="/api/root2cause/customers")return route.fulfill({json:{customers:[],claims:[]}});
    if(url.pathname==="/api/root2cause/responsible-users")return route.fulfill({json:{users:[]}});
    throw new Error("Unexpected fixture request: "+url.pathname);
  });
  await page.goto("https://a3.test/");
  await page.evaluate(({sources,claim,actions})=>{
    const cache=new Map();
    const noComponent=()=>null;
    const stubs={
      "./corrective-actions.css":{},
      "./a3-portal-publication":{},"./a3-plan-followup":{A3PlanFollowup:noComponent},
      "@/components/modules/a3-action-report":{A3ActionReport:({action})=>react.createElement("h3",null,action.title)},
      "@/components/modules/retired-corrective-actions":{RetiredCorrectiveActions:noComponent},
      "@/components/modules/ai-suggestion-result":{},"@/lib/ai-context":{},
      "@/lib/root2cause/hard-delete":{canHardDeleteCorrectiveAction:()=>false},
      "@/lib/root-cause-publication":{},
      "@/lib/configuration-data":{processCatalog:[{id:"PROC",name:"Proceso local"}]},
      "@/lib/session-data":{canAccessProcess:()=>true,isAdministrator:s=>s.userType==="Administrador"},
      "@/lib/module-permissions":{canPerformModuleAction:()=>true},
      "@/components/modules/a3-proposal-review":{A3ProposalReview:noComponent},
      "@/components/modules/customer-claims-panel":{ClaimEditor:noComponent},
      "@/components/modules/a3-step-evidence":{A3StepEvidence:({persisted})=>persisted?"Evidencia habilitada":"Evidencia pendiente"},
      "@/lib/customer-claims":{},
    };
    function load(key){
      if(key==="./action-plan")key="@/lib/root2cause/action-plan";
      if(key in stubs)return stubs[key];
      if(cache.has(key))return cache.get(key);
      if(!sources[key])throw new Error("Missing fixture module "+key);
      const mod={exports:{}};cache.set(key,mod.exports);
      new Function("module","exports","require","process",sources[key])(mod,mod.exports,load,{env:{NODE_ENV:"production"}});
      cache.set(key,mod.exports);return mod.exports;
    }
    const react=load("react");
    const session={userType:"Administrador",authUserId:"fixture",organizationId:"fixture-org",workspaceMode:"production"};
    const {ContinuityProvider}=load("@/components/workspace-continuity");
    const {A3AnalysisWorkbench}=load("@/components/modules/a3-analysis-workbench");
    const {CorrectiveActionsModule}=load("@/components/modules/corrective-actions-module");
    load("react-dom/client").createRoot(window.document.querySelector("#app")).render(
      react.createElement(ContinuityProvider,{session},actions ? react.createElement(CorrectiveActionsModule,{actions,session,onActionsChange:()=>{}}) : react.createElement(A3AnalysisWorkbench,{session,initialClaim:claim,onCancel:()=>{},onComplete:()=>{throw new Error("Unexpected finalization");}})));
  },{sources:modules,claim:initialClaim,actions});
  return page;
}
try{
  const page=await openSession();
  await page.getByLabel("Título",{exact:true}).fill("Expediente de prueba local");
  await page.getByLabel("Descripción del problema",{exact:true}).fill("Descripción sintética del problema para la prueba local.");
  await page.getByLabel("Proceso autorizado").selectOption("PROC");
  for(let i=1;i<=7;i++) await page.getByRole("button",{name:"Siguiente"}).click();
  for(let i=7;i>0;i--) await page.getByRole("button",{name:"Anterior"}).click();
  assert.equal(await page.getByLabel("Título",{exact:true}).inputValue(),"Expediente de prueba local");
  await page.getByRole("button",{name:"Ayuda IA",exact:true}).click();
  await page.getByText(/HTTP 504/).waitFor();
  assert.equal(aiCalls,1);
  failSave=true;
  await page.getByRole("button",{name:"Guardar borrador"}).click();
  await page.getByRole("alert").filter({hasText:"Conflicto de revisión"}).waitFor();
  await page.getByRole("button",{name:"Plan de acción"}).click();
  await page.getByRole("button",{name:"Anterior"}).click();
  await page.getByRole("button",{name:"Apertura"}).click();
  failSave=false;
  const started=new Promise(resolve=>{saveStarted=resolve;});
  let finish;
  delaySave=new Promise(resolve=>{finish=resolve;});
  await page.getByRole("button",{name:"Guardar borrador"}).click();
  await started;
  await page.getByLabel("Título",{exact:true}).fill("Edición durante el guardado");
  finish();
  await page.getByRole("button",{name:"Guardar borrador"}).waitFor();
  await page.getByText("Cambios pendientes de guardar",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Título",{exact:true}).inputValue(),"Edición durante el guardado");
  await page.getByRole("button",{name:"Guardar borrador"}).click();
  await page.getByText("Guardado confirmado en Supabase · revisión 2").waitFor();
  await page.getByText("Evidencia habilitada",{exact:false}).first().waitFor();
  const second=await openSession();
  await second.getByRole("button",{name:/Edición durante el guardado.*revisión 2/}).click();
  await second.getByText("Guardado confirmado en Supabase · revisión 2").waitFor();
  assert.equal(await second.getByLabel("Título",{exact:true}).inputValue(),document.payload.draft.title);
  assert.equal(await second.getByPlaceholder("Qué ocurrió, dónde, cuándo y con qué evidencia").inputValue(),document.payload.draft.problem);
  let endWait;
  waitForAi=new Promise(resolve=>{endWait=resolve;});
  const requested=new Promise(resolve=>{aiStarted=resolve;});
  await second.getByRole("button",{name:"Llenar A3 con IA"}).click();
  await requested;
  await second.getByLabel("Título",{exact:true}).fill("El editor sigue disponible");
  await second.getByRole("button",{name:"Cancelar espera"}).click();
  await second.getByText("Espera cancelada.").waitFor();
  endWait();
  assert.equal(aiCalls,2);
  const claim={id:"reclamo-local",external_organization_id:"cliente-local",selectedDraftId:document.id,linkedDraftIds:[document.id]};
  document={...document,source:"customer",payload:{...document.payload,draft:{...document.payload.draft,
    origin:"customer",qualityCaseId:claim.id,relatedPartyId:claim.external_organization_id}}};
  const linked=await openSession(claim);
  await linked.getByText("Guardado confirmado en Supabase · revisión 2").waitFor();
  assert.equal(await linked.getByLabel("Título",{exact:true}).inputValue(),document.payload.draft.title);
  const base={organizationId:"fixture-org",dueDate:"2099-01-01",owner:"Responsable",area:"Calidad",progress:25,title:"Expediente autorizado"};
  const cases=[
    ["internal","open"],["customer","implementation"],["customer","closed"],["sgc","closed"],["audit","analysis"],
    ["customer","closed",{deletedAt:"2026-01-01"}],["internal","open",{organizationId:"otra"}],["supplier","open"],
  ].map(([source,status,extra],i)=>({...base,source,status,...extra,id:"case-"+i,folio:"AC-"+i}));
  const registry=await openSession(undefined,cases);
  await registry.addStyleTag({content:readFileSync("src/app/globals.css","utf8")});
  await registry.addStyleTag({content:readFileSync("src/components/modules/corrective-actions.css","utf8")});
  const tabs=registry.getByRole("navigation",{name:"Vistas de Root2Cause"});
  const cards=registry.getByRole("group",{name:"Filtrar acciones por estado"});
  const origins=registry.getByRole("group",{name:"Filtrar acciones por origen"});
  assert.deepEqual(await tabs.getByRole("button").allTextContents(),["Acciones correctivas","Análisis A3","Seguimiento de acciones","Registros retirados"]);
  assert.equal(await tabs.locator('[aria-current="page"]').textContent(),"Acciones correctivas");
  assert.deepEqual(await cards.locator("strong").allTextContents(),["5","3","2"]);
  assert.equal(await registry.getByText(/Consultar metodología/).count(),0);
  for(const width of [1280,768,390,320]){
    await registry.setViewportSize({width,height:900});
    const layout=await registry.evaluate(()=>{
      const box=e=>e.getBoundingClientRect();
      const cardBoxes=[...document.querySelectorAll(".corrective-summary button")].map(box);
      const tabs=[...document.querySelectorAll(".rootcause-view-tabs button")].map(box);
      return {overflow:document.documentElement.scrollWidth>innerWidth,
        heights:cardBoxes.map(b=>b.height),widths:cardBoxes.map(b=>b.width),
        tabRows:new Set(tabs.map(b=>b.top)).size,tabMin:Math.min(...tabs.map(b=>b.width))};
    });
    assert.equal(layout.overflow,false,"overflow at "+width);
    assert.ok(Math.max(...layout.heights)-Math.min(...layout.heights)<1);
    assert.ok(Math.max(...layout.widths)-Math.min(...layout.widths)<1);
    assert.equal(layout.tabRows,width>760?1:2);
    assert.ok(layout.tabMin>70);
  }
  await cards.getByRole("button",{name:/Acciones cerradas/}).click();
  await origins.getByRole("button",{name:"Externas / Clientes"}).click();
  assert.deepEqual(await cards.locator("strong").allTextContents(),["2","1","1"]);
  assert.deepEqual(await registry.locator("tbody code").allTextContents(),["AC-2"]);
  await origins.getByRole("button",{name:"Internas"}).click();
  await registry.getByText("Sin acciones para esta consulta.").waitFor();
  await cards.getByRole("button",{name:/Acciones abiertas/}).click();
  await registry.getByRole("button",{name:"Abrir AC-0"}).click();
  await registry.getByText(base.title,{exact:true}).waitFor();
  await tabs.getByRole("button",{name:"Acciones correctivas"}).click();
  await registry.getByRole("button",{name:"Abrir AC-0"}).waitFor();
  await tabs.getByRole("button",{name:"Análisis A3"}).click();
  await registry.getByRole("button",{name:"Llenar A3 con IA"}).waitFor();
  assert.equal(await tabs.locator('[aria-current="page"]').textContent(),"Análisis A3");
  console.log("PASS Root2Cause: cuatro vistas, contadores autorizados, intersección estado/origen, expediente, vista vacía y anchos 1280/768/390/320.");
  assert.deepEqual(errors,[]);
  console.log("PASS Edge local: ocho etapas, error 409, edición durante guardado, revisión 2, segunda sesión, evidencia, 504, cancelación sin reintento y reapertura desde reclamo.");
} finally {await browser.close();}
