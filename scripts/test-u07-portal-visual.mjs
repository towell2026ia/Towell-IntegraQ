// Local browser regression. All application requests are intercepted before reaching a network.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const root = process.cwd(), base = "91068cb97833f07686011b9af9a5427e70ef2284";
const year = String(new Date().getFullYear()),
  previous = String(Number(year) - 1);
const company = {
  id: "qa-a",
  name: "Textiles del Centro",
  code: "PR-01",
  category: "Fabricante",
};
const empty = {
  id: "qa-b",
  name: "Hilatura Norte",
  code: "PR-02",
  category: "Distribuidor",
};
const event = {
  id: "audit-1",
  date: year + "-03-15",
  state: "performed",
  method: "V2",
  score: 92,
  actions: [{
    id: "action-1",
    state: "pending",
    description: "Verificar el lote de recepción",
    owner: "Responsable de calidad",
    due: year + "-12-04",
    files: 0,
  }],
};
const nextEvent = {
  ...event,
  id: "audit-2",
  date: year + "-12-20",
  state: "scheduled",
  score: null,
  actions: [],
};
const reports = ["Cerrado", "Tarde", "En Proceso", "Cerrado"].map((
  state,
  i,
) => ({
  id: "r" + i,
  folio: "RNCP" + String(120 + i).padStart(4, "0"),
  origin: "historical",
  historicalStatus: state,
  legacyStatus: state === "Cerrado" ? "closed" : "in_progress",
  supplierId: company.id,
  supplierName: company.name,
  reportDate: (i === 3 ? previous : year) + "-04-14",
  material: "Hilo",
  defect: [
    "Diferencia de tono",
    "Variación de calibre",
    "Revisión de embalaje",
    "Inspección de entrega",
  ][i],
  originalFiles: [],
  missingRequirements: [],
  requirementsComplete: false,
}));
const profile = {
  name: company.name,
  code: company.code,
  category: company.category,
  sites: ["Planta Centro"],
  contacts: [{
    name: "Contacto de calidad",
    email: "calidad@example.invalid",
    phone: "Ext. 120",
    purpose: "Aseguramiento de calidad",
  }],
};
const assessments = [{
  id: "assessment-1",
  assessment_date: year + "-03-15",
  classification: "A",
  score: 94,
}];
const clientReports = reports.map((r) => ({
  ...r,
  status: r.legacyStatus,
  portalVisible: true,
  description: r.defect,
  classification: r.material,
  actions: [],
  history: [],
  portalActions: [],
  late: r.historicalStatus === "Tarde",
}));
const publishedAudits = [{
  eventId: event.id,
  supplierId: company.id,
  auditDate: event.date,
  methodology: "V2",
  score: 92,
  classification: "manufacturer",
  actions: event.actions.map((a) => ({
    ...a,
    status: a.state,
    commitmentDate: a.due,
    responsibleName: a.owner,
    evidenceFileIds: [],
  })),
  files: [],
}, {
  eventId: nextEvent.id,
  supplierId: company.id,
  auditDate: null,
  plannedDate: nextEvent.date,
  state: "scheduled",
  methodology: "V2",
  classification: "manufacturer",
  score: null,
  files: [],
  actions: [],
}];
const doc = new (require("jspdf").jsPDF)();
doc.text("Documento para prueba local de visualización", 18, 25);
const pdf = Buffer.from(doc.output("arraybuffer"));
const original = {
  id: "qa-original",
  fileName: "RNCP0120.pdf",
  sizeBytes: pdf.length,
  sha256: createHash("sha256").update(pdf).digest("hex"),
  uploadedAt: year + "-04-14T12:00:00Z",
  version: 1,
};
const entry = (before) => `
import React from "react";import {createRoot} from "react-dom/client";import {StakeholderPortalModule} from "@/components/modules/stakeholder-portal-module";import {activeSession} from "@/lib/session-data";import "@/app/globals.css";
${
  before
    ? ""
    : 'import {ExternalPortalShell} from "@/components/modules/supplier-portal-view";'
}
const external=location.pathname==="/external";
const session={...activeSession,workspaceMode:"production",userType:external?"Proveedor":"Administrador",authUserId:"qa-view",specificPermissions:{"portal_proveedores.acceder":true},externalParty:external?{kind:"supplier",companyId:"qa-a",companyName:"Textiles del Centro"}:undefined};
const portal=<StakeholderPortalModule session={session} actions={[]} kind="supplier"/>;
createRoot(document.getElementById("app")).render(${
  before
    ? ""
    : 'external?<ExternalPortalShell name="Usuario proveedor" signOut={()=>{}}>{portal}</ExternalPortalShell>:'
}<main style={{maxWidth:1180,margin:"auto",padding:"16px"}}><header className="module-heading"><strong>IntegraQ</strong><span>{external?"Usuario proveedor":"Consulta de Calidad"}</span></header><StakeholderPortalModule session={session} actions={[]} kind="supplier"/></main>);`;
const beforeFiles = new Set([
  "supplier-portal-admin.tsx",
  "stakeholder-portal-module.tsx",
  "supplier-audit-portal.tsx",
  "supplier-action-evidence.tsx",
]);
async function bundle(before) {
  const mocks = new Map([
    [
      "@/hooks/use-rncp-reports",
      `export const useRncpReports=()=>({reports:${
        JSON.stringify(clientReports)
      },loading:false,error:"",refresh:()=>{}})`,
    ],
    [
      "@/hooks/use-supplier-assessments",
      `export const useSupplierAssessments=()=>({assessments:[{id:"assessment-1",supplierId:"qa-a",portalVisible:true,assessmentDate:"${year}-03-15",score:94,classification:"A"}],loading:false,error:"",refresh:()=>{}})`,
    ],
  ]);
  const out = await build({
    configFile: false,
    envFile: false,
    logLevel: "error",
    resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{
      name: "local-portal-fixture",
      enforce: "pre",
      resolveId(id) {
        if (path.basename(id) === "portal-entry") {
          return path.join(root, "qa-portal-entry.tsx");
        }
        if (mocks.has(id)) {
          return "\0" + id;
        }
        for (const k of mocks.keys()) {
          if (
            id.replaceAll("\\", "/") ===
              path.join(root, "src", k.slice(2)).replaceAll("\\", "/")
          ) return "\0" + k;
        }
      },
      load(id) {
        if (path.basename(id) === "qa-portal-entry.tsx") return entry(before);
        if (id.startsWith("\0") && mocks.has(id.slice(1))) {
          return mocks.get(id.slice(1));
        }
        if (before && beforeFiles.has(path.basename(id))) {
          return execFileSync("git", [
            "show",
            base + ":" + path.relative(root, id).split(path.sep).join("/"),
          ], { encoding: "utf8" });
        }
      },
    }],
    build: {
      write: false,
      cssCodeSplit: false,
      minify: false,
      lib: { entry: "portal-entry", formats: ["es"], fileName: "ui" },
      rolldownOptions: { output: { codeSplitting: false } },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env": "{}",
    },
  });
  return (Array.isArray(out) ? out[0] : out).output;
}
const output = process.env.U07_VISUAL_DIR;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const before of [true, false]) {
    const assets = await bundle(before);
    for (const mobile of [false, true]) {
      const page = await browser.newPage({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 960 },
        deviceScaleFactor: 1,
      });
      const errors = [];
      page.on("pageerror", (e) => {
        errors.push(String(e));
        console.error(e.message);
      });
      const image = async (name) => {
        if (output) {
          await page.screenshot({
            path: path.join(
              output,
              `U07-R52-${before ? "antes" : "candidato"}-${
                mobile ? "movil" : "escritorio"
              }-${name}.png`,
            ),
            fullPage: true,
          });
        }
      };
      await page.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        if (u.origin !== "https://integraq.test") return route.abort();
        if (route.request().method() !== "GET") throw Error("Unexpected write");
        if (u.pathname === "/" || u.pathname === "/external") {
          return route.fulfill({
            contentType: "text/html",
            body:
              '<html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="app"></div><script type="module" src="/ui.js"></script></html>',
          });
        }
        if (u.pathname === "/ui.css") {
          return route.fulfill({
            contentType: "text/css",
            body: assets.find((a) => a.fileName.endsWith(".css")).source,
          });
        }
        if (u.pathname === "/ui.js") {
          return route.fulfill({
            contentType: "text/javascript",
            body: assets.find((a) => a.type === "chunk" && a.isEntry).code,
          });
        }
        if (u.pathname.endsWith("/portal-access")) {
          if (u.searchParams.has("self")) {
            return route.fulfill({ json: profile });
          }
          if (!u.searchParams.has("supplier")) {
            return route.fulfill({ json: { suppliers: [company, empty] } });
          }
          const yes = u.searchParams.get("supplier") === company.id;
          return route.fulfill({
            json: {
              users: [],
              invitations: [],
              accessReady: true,
              contacts: yes ? profile.contacts : [],
              sites: [],
              reports: !yes ? [] : before
                ? reports.map((r) => ({
                  ...r,
                  status: r.legacyStatus,
                  report_date: r.reportDate,
                }))
                : reports,
              actions: [],
              audits: yes ? [event, nextEvent] : [],
              assessments: yes ? assessments : [],
            },
          });
        }
        if (u.pathname === "/api/suppliers/rncp/matrix") {
          return route.fulfill({
            json: { report: { ...reports[0], originalFiles: [original] } },
          });
        }
        if (u.pathname === "/api/suppliers/rncp/originals/qa-original") {
          return route.fulfill({
            json: { url: "https://integraq.test/original.pdf" },
          });
        }
        if (u.pathname === "/original.pdf") {
          return route.fulfill({ contentType: "application/pdf", body: pdf });
        }
        if (u.pathname === "/pdf.worker.min.mjs") {
          return route.fulfill({
            contentType: "text/javascript",
            body: readFileSync(path.join(root, "public/pdf.worker.min.mjs")),
          });
        }
        if (u.pathname.endsWith("/audit-portal")) {
          return route.fulfill({
            json: {
              audits: before ? publishedAudits.slice(0, 1) : publishedAudits,
              scheduleAvailable: true,
            },
          });
        }
        if (u.pathname.endsWith("/portal-evidence")) {
          return route.fulfill({ json: { items: [], evidence: [] } });
        }
        return route.abort();
      });
      page.setDefaultTimeout(10000);
      await page.goto("https://integraq.test/");
      if (before) {
        await page.getByRole("combobox", { name: "Proveedor", exact: true })
          .selectOption(company.id);
        await page.getByText("Usuarios con acceso", { exact: true }).waitFor();
        await image("administracion");
      } else {
        const nav = (name) =>
          page.getByRole("navigation", { name: "Navegación del portal" })
            .getByRole("button", { name, exact: true });
        const start = performance.now();
        await page.getByRole("button", {
          name: "Seleccionar proveedor",
          exact: true,
        }).click();
        await page.getByRole("button", { name: /Textiles del Centro/ }).click();
        await page.getByRole("heading", { name: "Efectividad RNCP" }).waitFor();
        assert.equal(
          await page.getByLabel("Año", { exact: true }).inputValue(),
          year,
        );
        const ms = performance.now() - start;
        await image("inicio");
        await nav("Mis RNCP").click();
        await image("rncp");
        const ft = performance.now();
        await page.getByLabel("Año", { exact: true }).selectOption(previous);
        assert.equal(
          await page.getByRole("button", { name: "Ver reporte" }).count(),
          1,
        );
        const filterMs = performance.now() - ft;
        await page.getByLabel("Año", { exact: true }).selectOption(year);
        const t = performance.now();
        await page.getByRole("button", { name: "Ver reporte" }).first().click();
        await page.getByRole("dialog").getByText("Descripción de la no calidad")
          .waitFor();
        const open = performance.now() - t;
        await page.getByRole("button", {
          name: "Consultar archivos y seguimiento",
        }).click();
        const pdfOpen = page.getByRole("button", { name: "Ver PDF original" });
        await pdfOpen.waitFor();
        const pt = performance.now();
        await pdfOpen.click();
        await page.getByRole("img", { name: "Página 1 del PDF" }).waitFor();
        const pdfMs = performance.now() - pt;
        const rt = performance.now();
        await page.getByRole("button", { name: "Cerrar", exact: true }).click();
        await page.getByRole("heading", { name: "Reportes de no calidad" })
          .waitFor();
        const back = performance.now() - rt;
        await nav("Mis auditorías").click();
        await image("auditorias");
        await nav("Planes de acción y evidencias").click();
        await image("planes");
        await nav("Mi expediente").click();
        await image("expediente");
        await nav("Usuarios con acceso").click();
        await image("accesos");
        await page.getByRole("button", { name: "Invitar usuario", exact: true })
          .click();
        await image("invitacion");
        await page.getByRole("button", { name: "Cerrar", exact: true }).click();
        await page.getByRole("button", { name: /PR-01 · Textiles/ }).click();
        await image("selector");
        await page.getByRole("button", { name: /Hilatura Norte/ }).click();
        await page.getByRole("heading", { name: "Hilatura Norte" }).waitFor();
        await page.getByText("Sin actividades pendientes en este período.")
          .waitFor();
        await image("sin-registros");
        console.log(
          JSON.stringify({
            mobile,
            local: true,
            selectorToDashboardMs: ms,
            openMs: open,
            filterMs,
            pdfMs,
            backMs: back,
          }),
        );
      }
      await page.goto("https://integraq.test/external");
      if (before) {
        await page.getByText("RNCP0120", { exact: true }).waitFor();
        await image("externo-rncp");
        await page.getByRole("button", {
          name: "Mis auditorías y calificaciones",
        }).click();
        await image("externo-auditorias");
        await page.getByRole("button", { name: "Mis evidencias" }).click();
        await image("externo-planes");
      } else {
        await page.getByRole("heading", { name: "Efectividad RNCP" }).waitFor();
        assert.equal(
          await page.getByRole("navigation", { name: "Navegación del portal" })
            .getByRole("button").count(),
          5,
        );
        assert.equal(
          await page.getByRole("button", { name: "Seleccionar proveedor" })
            .count(),
          0,
        );
        await image("externo-inicio");
        for (
          const [section, name] of [
            ["Mis RNCP", "rncp"],
            ["Mis auditorías", "auditorias"],
            ["Planes de acción y evidencias", "planes"],
            ["Mi expediente", "expediente"],
          ]
        ) {
          await page.getByRole("button", { name: section, exact: true })
            .click();
          if (name === "expediente") {
            await page.getByText("calidad@example.invalid", { exact: true })
              .waitFor();
          }
          await image("externo-" + name);
          assert.ok(
            await page.evaluate(() =>
              document.documentElement.scrollWidth <= innerWidth + 1
            ),
            "overflow " + section,
          );
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
