import { NextResponse } from "next/server";

import { latestReportForAsset } from "@/lib/metrology-report-data";
import { renderMetrologyReportSvg } from "@/lib/metrology-report-svg";
import { readMetrologyWorkspace } from "@/lib/metrology-workspace-server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const record = await readMetrologyWorkspace();
    const workspace = record?.values;
    const asset = workspace?.assets.find((item) => item.publicToken === token);
    if (!asset || !workspace) return NextResponse.json({ error: "Equipo no disponible." }, { status: 404 });
    const report = latestReportForAsset(workspace.reports, asset.id);
    if (!report) return NextResponse.json({ error: "El equipo aún no tiene informe." }, { status: 404 });
    return new NextResponse(renderMetrologyReportSvg(asset, report), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } });
  } catch (error) {
    console.error("No fue posible presentar el informe público de metrología.", error);
    return NextResponse.json({ error: "Informe no disponible." }, { status: 500 });
  }
}
