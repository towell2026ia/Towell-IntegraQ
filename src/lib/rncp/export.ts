import { NextResponse } from "next/server";
import type { MatrixDashboard } from "./model";
import { deriveLifecycle } from "./analytics";
export async function exportMatrix(data: MatrixDashboard, format: "csv" | "xlsx") {
  const headers = ["Folio RNCP", "Fecha", "Materia prima", "Proveedor", "Número proveedor", "Descripción del defecto", "Acción", "Estatus original", "Estado operativo", "Origen", "Notificación real", "Fecha límite", "Cumplimiento"];
  const rows = data.reports.map(report => { const life = deriveLifecycle(report, data.now); return [report.folio, report.reportDate ?? "", report.material, report.supplierName, report.supplierCode, report.defect, report.actionType, report.historicalStatus ?? "", life.chartStatus, report.origin, report.notifiedAt ?? "", life.deadline ?? "", life.timeliness]; });
  const responseHeaders = { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="RNCP-filtradas.${format}"` };
  if (format === "csv") {
    const escape = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    return new NextResponse("\uFEFF" + [headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n"), { headers: { ...responseHeaders, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("MATRIZ filtrada");
  sheet.addRow(headers); sheet.addRows(rows); sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, i) => { column.width = i === 5 ? 65 : 24; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return new NextResponse(new Uint8Array(await workbook.xlsx.writeBuffer()), { headers: { ...responseHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
}
