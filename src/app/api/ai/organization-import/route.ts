import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import {
  interpretOrganizationGrid,
  normalizeOrganizationChartDraft,
  type OrganizationChartDraft,
} from "@/lib/organization-chart-data";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const maxFileSize = 15 * 1024 * 1024;
const excelExtensions = [".xlsx", ".xlsm"];
const imageTypes = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Inicia sesión para interpretar el organigrama." }, { status: 401 });

  const body = await request.formData().catch(() => null);
  const file = body?.get("file");
  const processName = String(body?.get("processName") ?? "Proceso").trim() || "Proceso";
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecciona un organigrama." }, { status: 400 });
  if (file.size === 0 || file.size > maxFileSize) return NextResponse.json({ error: "El archivo debe pesar entre 1 byte y 15 MB." }, { status: 400 });

  const extension = `.${file.name.split(".").pop()?.toLocaleLowerCase("es-MX") ?? ""}`;
  try {
    if (excelExtensions.includes(extension)) return NextResponse.json({ draft: await interpretExcelFile(file, processName) });
    if (imageTypes.includes(file.type)) return NextResponse.json({ draft: await interpretImageFile(file, processName) });
    return NextResponse.json({ error: "Formato no compatible. Usa XLSX, XLSM, JPG, PNG o WEBP." }, { status: 415 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible interpretar el organigrama.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function interpretExcelFile(file: File, processName: string) {
  const workbook = new ExcelJS.Workbook();
  const binary = Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(binary);
  const worksheet = workbook.worksheets
    .map((item) => ({ item, score: item.actualRowCount * Math.max(item.actualColumnCount, 1) }))
    .sort((left, right) => right.score - left.score)[0]?.item;
  if (!worksheet) throw new Error("El libro no contiene hojas legibles.");
  const rowLimit = Math.min(Math.max(worksheet.actualRowCount, 1), 250);
  const columnLimit = Math.min(Math.max(worksheet.actualColumnCount, 1), 50);
  const grid = Array.from({ length: rowLimit }, (_, rowIndex) =>
    Array.from({ length: columnLimit }, (_, columnIndex) => worksheet.getCell(rowIndex + 1, columnIndex + 1).text.trim()),
  );
  return interpretOrganizationGrid({ sourceName: file.name, processName, grid });
}

async function interpretImageFile(file: File, processName: string): Promise<OrganizationChartDraft> {
  const externalEndpoint = process.env.INTEGRAQ_ORGANIZATION_AI_ENDPOINT || process.env.INTEGRAQ_FORM_IMPORT_AI_ENDPOINT;
  if (externalEndpoint) {
    const externalBody = new FormData();
    externalBody.set("task", "organization_chart_import");
    externalBody.set("processName", processName);
    externalBody.set("file", file, file.name);
    const response = await fetch(externalEndpoint, {
      method: "POST",
      headers: process.env.INTEGRAQ_AI_API_KEY ? { Authorization: `Bearer ${process.env.INTEGRAQ_AI_API_KEY}` } : undefined,
      body: externalBody,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`El intérprete visual respondió ${response.status}.`);
    const payload: unknown = await response.json();
    const draft = normalizeOrganizationChartDraft(unwrapDraft(payload), file.name, processName);
    if (!draft) throw new Error("El intérprete visual no devolvió una jerarquía válida.");
    return draft;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("La lectura automática de imágenes no está configurada. Usa un archivo XLSX o captura los puestos manualmente.");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_ORGANIZATION_IMPORT_MODEL ?? "gpt-4.1-mini",
      input: [{ role: "user", content: [
        { type: "input_text", text: `Interpreta únicamente el organigrama visible del proceso ${processName}. Extrae cada puesto, su nivel jerárquico, área y el nombre exacto del puesto al que reporta. Conserva puestos debajo del nivel 4 (niveles 5 en adelante). No inventes personas ni puestos ilegibles. Devuelve JSON conforme al esquema.` },
        { type: "input_image", image_url: `data:${file.type};base64,${base64}` },
      ] }],
      text: { format: { type: "json_schema", name: "integraq_organization_chart", strict: true, schema: {
        type: "object", additionalProperties: false,
        required: ["positions", "confidence", "warnings"],
        properties: {
          confidence: { type: "number", minimum: 0, maximum: 1 },
          warnings: { type: "array", items: { type: "string" } },
          positions: { type: "array", maxItems: 100, items: {
            type: "object", additionalProperties: false,
            required: ["clientId", "name", "level", "branch", "parentName"],
            properties: {
              clientId: { type: "string" }, name: { type: "string" },
              level: { type: "integer", minimum: 1, maximum: 12 },
              branch: { type: "string" }, parentName: { type: "string" },
            },
          } },
        },
      } } },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`El servicio visual respondió ${response.status}.`);
  const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("El servicio visual no devolvió contenido estructurado.");
  const draft = normalizeOrganizationChartDraft(JSON.parse(outputText), file.name, processName);
  if (!draft) throw new Error("La imagen no produjo una jerarquía válida.");
  return draft;
}

function unwrapDraft(value: unknown) {
  if (!value || typeof value !== "object") return value;
  return (value as { draft?: unknown }).draft ?? value;
}
