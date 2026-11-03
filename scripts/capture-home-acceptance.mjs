// Isolated visual comparison: no application server, credentials or production requests.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")));
const base = process.argv[2] || "91430b6";
const chrome = process.argv[3] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const temporary = mkdtempSync(path.join(tmpdir(), "integraq-home-visual-"));
const baseline = path.join(temporary, "baseline"); mkdirSync(baseline);
const output = path.join(root, "artifacts/home-acceptance"); mkdirSync(output, { recursive: true });
writeFileSync(path.join(output,"capture.json"), JSON.stringify({status:"PENDING",productionData:false}));
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", base, "src/components/modules"], { encoding: "utf8" }).trim().split("\n").filter(p => /\/home[^/]*\.(tsx|css)$/.test(p) && !p.includes(".test."));
for (const file of files) writeFileSync(path.join(baseline, path.basename(file)), execFileSync("git", ["show", `${base}:${file}`]));
const fixtureImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" fill="#e3f3ee"/><text x="360" y="200" text-anchor="middle" fill="#1768ad" font-size="28">IMAGEN DE PRUEBA · NO PRODUCTIVA</text></svg>');
writeFileSync(path.join(temporary, "storage.ts"), `export async function getControlledDocumentDownloadUrl(){ return ${JSON.stringify(fixtureImage)}; }`);
writeFileSync(path.join(temporary, "index.html"), '<html lang="es"><head><meta charset="utf-8"/></head><body><div id="root"></div><script>window.addEventListener("error",e=>{document.body.dataset.captureError=e.message});window.addEventListener("unhandledrejection",e=>{document.body.dataset.captureError=String(e.reason)});</script><script type="module" src="/entry.tsx"></script></body></html>');
writeFileSync(path.join(temporary, "entry.tsx"), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeModule as Original } from './baseline/home-module';
import { HomeModule as Proposed } from ${JSON.stringify(path.join(root, "src/components/modules/home-module.tsx").replaceAll("\\", "/"))};
import '@/app/globals.css';
import { activeSession } from '@/lib/session-data';
import { buildHomeDashboard } from '@/lib/home-dashboard';
import { defaultHomeSectionConfigurations } from '@/lib/home-visibility';
const NativeDate = Date;
const frozen = '2026-11-03T16:00:00.000Z';
globalThis.Date = class extends NativeDate { constructor(...args){super(...(args.length ? args : [frozen]));} static now(){return NativeDate.parse(frozen);} };
const session = {...activeSession, authUserId:'visual-fixture', userType:'Administrador', workspaceMode:'production'};
const titles = ['Política de Calidad','Política Ambiental','Política de Seguridad e Higiene','Objetivos de Calidad'];
const documents = titles.map((name,i)=>({id:'fixture-'+i,processId:'P-08',documentTypeId:'policy',code:'VIS-'+i,name,owner:'Perfil de prueba',versions:[{id:'version-'+i,revision:1,status:'current',fileName:name+'.png',uploadedBy:'Perfil de prueba',validator:'Perfil de prueba',modifiedAt:frozen,changeReason:'Fixture visual'}]}));
const sources = {session,documents,actions:[],assets:[],indicators:[],indicatorResults:{},supplierAudits:[],externalAudits:[]};
const dashboard = buildHomeDashboard(sources,undefined,new Date(frozen));
globalThis.fetch = async (input)=>{
 const url=String(input);
 if(url.startsWith('/api/home/process-dashboard?image='))return Response.json({signedUrl:${JSON.stringify(fixtureImage)}});
 if(url.startsWith('/api/home/process-dashboard'))return Response.json({dashboard,imageDocuments:documents});
 if(url.startsWith('/api/home/config'))return Response.json({configurations:defaultHomeSectionConfigurations});
 if(url.startsWith('/api/home/institutional'))return Response.json({items:[]});
 throw new Error('NETWORK_NOT_ALLOWED: '+url);
};
const Component = location.search.includes('main') ? Original : Proposed;
createRoot(document.getElementById('root')).render(<main style={{width:1200,margin:'0 auto',padding:24}}><Component sources={sources} onNavigate={()=>{}}/></main>);
`);
const server = await createServer({ configFile: false, root: temporary, logLevel: "warn", define: { "process.env": "{}" }, resolve: { alias: [
  { find: "@/lib/document-storage", replacement: path.join(temporary,"storage.ts") },
  { find: "@", replacement: path.join(root,"src") },
  ...["react/jsx-dev-runtime", "react/jsx-runtime", "react-dom/client", "react", "lucide-react"].map(name => ({ find: name, replacement: require.resolve(name) })),
] }, oxc: { jsx: { runtime: "automatic" } }, server: { watch: null, host: "127.0.0.1", port: 4178, strictPort: true, fs: { allow: [root, temporary, path.dirname(require.resolve("react"))] } } });
await server.listen();
try {
 for (const variant of ["main", "pr21"]) {
  const capture = await promisify(execFile)(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "--disable-background-networking", `--user-data-dir=${path.join(temporary,variant)}`, "--window-size=1440,3200", "--virtual-time-budget=12000", "--dump-dom", `--screenshot=${path.join(output,variant+".png")}`, `http://127.0.0.1:4178/?${variant}`], { timeout: 60000, maxBuffer: 1024*1024 });
  writeFileSync(path.join(temporary,variant+".html"),capture.stdout);
  if (capture.stdout.includes("data-capture-error=") || !capture.stdout.includes("Objetivos de Calidad") || !capture.stdout.includes("Actividad reciente")) throw new Error("Capture did not render HomeModule. Inspect isolated DOM in temporary directory: " + variant + ".html");
 }
 const hashes = Object.fromEntries(["main","pr21"].map(v=>[v,createHash("sha256").update(readFileSync(path.join(output,v+".png"))).digest("hex")]));
 writeFileSync(path.join(output,"capture.json"),JSON.stringify({status:"RENDERED",base,head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),viewport:[1440,3200],containerWidth:1200,profile:"Administrator fixture, identical input",productionData:false,network:"loopback only; application fetch mocked",images:"synthetic, not institutional originals",scope:"HomeModule only; common legacy dashboard payload; no authenticated application shell or live API",hashes,identicalPng:hashes.main===hashes.pr21},null,2));
 console.log(JSON.stringify({output,temporary,hashes}));
} finally { await server.close(); }
