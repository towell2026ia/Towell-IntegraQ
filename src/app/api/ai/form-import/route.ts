import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import {
  interpretExcelGrid,
  normalizeFormImportDraft,
  type FormImportDraft,
} from "@/lib/form-import-data";

const maxFileSize = 15 * 1024 * 1024;
const excelExtensions = [".xlsx", ".xlsm"];
const imageTypes = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const body = await request.formData().catch(() => null);
  const file = body?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Selecciona un archivo para interpretar." }, { status: 400 });
  }
  if (file.size === 0 || file.size > maxFileSize) {
    return NextResponse.json({ error: "El archivo debe pesar entre 1 byte y 15 MB." }, { status: 400 });
  }

  const extension = `.${file.name.split(".").pop()?.toLocaleLowerCase("es-MX") ?? ""}`;
  try {
    if (excelExtensions.includes(extension)) {
      return NextResponse.json({ draft: await interpretExcelFile(file) });
    }
    if (imageTypes.includes(file.type)) {
      return NextResponse.json({ draft: await interpretImageFile(file) });
    }
    return NextResponse.json(
      { error: "Formato no compatible. Usa XLSX, XLSM, JPG, PNG o WEBP." },
      { status: 415 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible interpretar el archivo.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function interpretExcelFile(file: File) {
  const workbook = new ExcelJS.Workbook();
  const binary = Buffer.from(await file.arrayBuffer()) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(binary);
  const sheets = workbook.worksheets
    .map((worksheet) => ({
      worksheet,
      score: worksheet.actualRowCount * Math.max(worksheet.actualColumnCount, 1),
    }))
    .sort((left, right) => right.score - left.score);
  const worksheet = sheets[0]?.worksheet;
  if (!worksheet) throw new Error("El libro no contiene hojas legibles.");

  const rowLimit = Math.min(Math.max(worksheet.actualRowCount, 1), 150);
  const columnLimit = Math.min(Math.max(worksheet.actualColumnCount, 1), 40);
  const grid = Array.from({ length: rowLimit }, (_, rowIndex) =>
    Array.from({ length: columnLimit }, (_, columnIndex) =>
      worksheet.getCell(rowIndex + 1, columnIndex + 1).text.trim(),
    ),
  );
  return interpretExcelGrid({ sourceName: file.name, sheetName: worksheet.name, grid });
}

async function interpretImageFile(file: File): Promise<FormImportDraft> {
  const externalEndpoint = process.env.INTEGRAQ_FORM_IMPORT_AI_ENDPOINT;
  if (externalEndpoint) {
    const externalBody = new FormData();
    externalBody.set("task", "form_import");
    externalBody.set("file", file, file.name);
    const response = await fetch(externalEndpoint, {
      method: "POST",
      headers: process.env.INTEGRAQ_AI_API_KEY
        ? { Authorization: `Bearer ${process.env.INTEGRAQ_AI_API_KEY}` }
        : undefined,
      body: externalBody,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`El agente visual respondió ${response.status}.`);
    const payload: unknown = await response.json();
    const draft = normalizeFormImportDraft(
      unwrapDraft(payload),
      file.name,
      "image",
    );
    if (!draft) throw new Error("El agente visual no devolvió una estructura válida.");
    return draft;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "La lectura de fotografías requiere configurar INTEGRAQ_FORM_IMPORT_AI_ENDPOINT u OPENAI_API_KEY.",
    );
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_FORM_IMPORT_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Interpreta esta fotografía como un formulario del sistema de gestión de calidad. Extrae solamente información visible: número de registro, nombre y campos. Conserva el orden visual. Infiere cada tipo entre text, number, date, select y textarea. No inventes opciones; cuando una lista no sea legible usa una lista vacía. Devuelve JSON conforme al esquema.",
            },
            {
              type: "input_image",
              image_url: `data:${file.type};base64,${base64}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "integraq_form_import",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["registrationNumber", "name", "fields", "confidence", "warnings"],
            properties: {
              registrationNumber: { type: "string" },
              name: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              warnings: { type: "array", items: { type: "string" } },
              fields: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "type", "required", "options", "unit"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    type: { type: "string", enum: ["text", "number", "date", "select", "textarea"] },
                    required: { type: "boolean" },
                    options: { type: "array", items: { type: "string" } },
                    unit: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`El servicio visual respondió ${response.status}.`);
  const payload = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const outputText = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("El servicio visual no devolvió contenido estructurado.");
  const draft = normalizeFormImportDraft(JSON.parse(outputText), file.name, "image");
  if (!draft) throw new Error("La fotografía no produjo una estructura válida.");
  return draft;
}

function unwrapDraft(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { draft?: unknown };
  return candidate.draft ?? value;
}
