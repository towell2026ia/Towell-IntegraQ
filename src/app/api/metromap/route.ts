import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const fileName = "metro-map-towel.drawio";
const filePath = join(process.cwd(), "data", "metromap", fileName);

export async function GET(request: Request) {
  try {
    const xml = await readFile(filePath, "utf8");
    const download = new URL(request.url).searchParams.get("download") === "1";

    return new NextResponse(xml, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/xml; charset=utf-8",
        ...(download
          ? { "Content-Disposition": `attachment; filename="${fileName}"` }
          : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "No fue posible cargar el archivo fuente del Metro Map." },
      { status: 404 },
    );
  }
}
