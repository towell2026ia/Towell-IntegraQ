// Reuse the isolated Vite/Playwright harness. All requests are intercepted locally.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const vite = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(vite.resolve("vite")).href);
const entry = path.resolve("re05-visual-entry.tsx");
const assets = await build({
  configFile: false,
  envFile: false,
  logLevel: "error",
  resolve: { alias: { "@": path.resolve("src") } },
  plugins: [{
    name: "isolated-report",
    resolveId(id) {
      if (path.basename(id) === "re05-entry") return entry;
    },
    load(id) {
      if (id === entry) {
        return `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {AnnualReviewReport} from './src/components/modules/review-annual-report';
    import './src/app/globals.css';
    createRoot(document.getElementById('root')).render(<main className="work-panel" style={{maxWidth:1050,margin:'1rem auto',padding:'1rem'}}><small>IntegraQ · Prueba local</small><h2>Revisión por la Dirección</h2><AnnualReviewReport year={2026} administrator={true}/></main>);
  `;
      }
    },
  }],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
  },
  build: {
    write: false,
    cssCodeSplit: false,
    lib: { entry: "re05-entry", formats: ["es"], fileName: "ui" },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const files = (Array.isArray(assets) ? assets[0] : assets).output;
const script = files.find((f) => f.type === "chunk").code,
  css = files.find((f) => f.fileName.endsWith(".css")).source;
const sources = [
  "Información Documentada",
  "Manual de Calidad",
  "Política de Calidad",
  "Organización y puestos",
  "Procesos",
  "Riesgos y oportunidades",
  "Objetivos e indicadores",
  "Calidad de clientes",
  "Calidad de proveedores",
  "Auditorías",
  "Root2Cause",
  "Calibraciones",
  "Mejora continua",
  "Revisiones anteriores",
  "Salidas de revisión",
  "Documentación complementaria",
  "Satisfacción del cliente",
  "Disponibilidad de recursos",
].map((label, i) => ({
  id: "source" + i,
  label,
  status: i >= 16 ? "pending" : i === 14 ? "empty" : "available",
  period: "2026",
  metrics: [],
  records: [],
  note: "",
}));
const sections = [
  "Portada",
  "Resumen ejecutivo",
  "Seguimiento de revisiones anteriores",
  "Cambios en cuestiones internas y externas",
  "Desempeño y eficacia del SGC",
  "Calidad y satisfacción de clientes",
  "Calidad de proveedores",
  "Auditorías",
  "Acciones correctivas",
  "Recursos y calibraciones",
  "Riesgos y oportunidades",
  "Mejora continua",
  "Salidas de Revisión por la Dirección",
  "Conclusiones",
  "Anexos y referencias",
];
const report = {
  sections: sections.map((title) => ({
    title,
    text: "Contenido de prueba local.",
    references: ["source0"],
  })),
  findings: [],
  risks: [],
  recommendations: [],
  proposals: [],
  limitations: [],
  warnings: [],
};
const example = {
  id: "local-report",
  state: "completed",
  started_at: "2026-11-27T11:00:00Z",
  revision: 1,
};
const snapshot = {
  organizationName: "Prueba local",
  year: 2026,
  cutoff: "2026-11-27T12:00:00Z",
  sources,
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (
    const [width, height, name] of [[1280, 900, "escritorio"], [
      390,
      844,
      "telefono",
    ]]
  ) {
    let includeReport = false;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      assert.equal(u.hostname, "integraq.test");
      assert.equal(route.request().method(), "GET");
      if (u.pathname === "/") {
        return route.fulfill({
          contentType: "text/html",
          body:
            '<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script>',
        });
      }
      if (u.pathname === "/ui.css") {
        return route.fulfill({ contentType: "text/css", body: css });
      }
      if (u.pathname === "/ui.js") {
        return route.fulfill({ contentType: "text/javascript", body: script });
      }
      if (u.pathname === "/api/ai/management-review") {
        return route.fulfill({
          json: u.searchParams.has("view")
            ? snapshot
            : u.searchParams.has("id")
            ? {
              ...example,
              year: 2026,
              snapshot,
              report,
              review_report_events: [],
            }
            : {
              runs: includeReport ? [example] : [],
              admin: true,
              director: false,
              enabled: false,
            },
        });
      }
      return route.abort();
    });
    await page.goto("https://integraq.test/");
    await page.getByRole("button", { name: "Consultar expediente anual" })
      .click();
    await page.getByText("Sin informes centrales para este período.").waitFor();
    assert.equal(
      await page.getByRole("button", {
        name: "Generar Revisión por la Dirección",
      }).isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
      ),
      true,
    );
    if (process.env.RE05_EVIDENCE_DIR) {
      await page.screenshot({
        path: path.join(process.env.RE05_EVIDENCE_DIR, "RE05-" + name + ".png"),
        fullPage: true,
      });
    }
    includeReport = true;
    await page.getByRole("button", { name: "Ocultar expediente anual" })
      .click();
    await page.getByRole("button", { name: "Consultar expediente anual" })
      .click();
    await page.getByRole("button", { name: /Versión 1/ }).click();
    await page.getByRole("button", { name: "Conclusiones", exact: true })
      .click();
    assert.equal(
      await page.locator("article section[id^=review-section-]").count(),
      15,
    );
    assert.match(await page.locator("article header").innerText(), /Borrador/);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 10000);
    console.log("PASS", name, width, height, "PDF local", pdf.length, "bytes");
    await page.close();
  }
} finally {
  await browser.close();
}
