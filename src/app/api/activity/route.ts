import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { isAdministrator } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isAdministrator(session)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const supabase = await createClient();
  let builder = supabase.from("audit_log").select("id,actor_id,user_name_snapshot,module,action,resource_type,resource_id,entity_code_snapshot,reason,origin,created_at").order("created_at", { ascending: false }).limit(Math.min(Number(query.get("limit") ?? 500), 2000));
  if (query.get("module")) builder = builder.eq("module", query.get("module")!);
  if (query.get("action")) builder = builder.eq("action", query.get("action")!);
  if (query.get("userId")) builder = builder.eq("actor_id", query.get("userId")!);
  if (query.get("entityType")) builder = builder.eq("resource_type", query.get("entityType")!);
  let result = await builder;
  if (result.error && ["42703", "PGRST204"].includes(result.error.code)) {
    result = await supabase.from("audit_log").select("id,actor_id,action,resource_type,resource_id,metadata,created_at").order("created_at", { ascending: false }).limit(Math.min(Number(query.get("limit") ?? 500), 2000)) as typeof result;
  }
  if (result.error) return NextResponse.json({ error: "ACTIVITY_QUERY_FAILED" }, { status: 500 });
  const format = query.get("format");
  if (format === "csv") return csvResponse(result.data ?? []);
  if (format === "xlsx") return xlsxResponse(result.data ?? []);
  return NextResponse.json({ activity: result.data ?? [] });
}

function csvResponse(rows: Record<string, unknown>[]) {
  const columns = ["created_at", "user_name_snapshot", "module", "action", "resource_type", "resource_id", "entity_code_snapshot", "origin", "reason"];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n");
  return new NextResponse(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=integraq-activity.csv" } });
}

async function xlsxResponse(rows: Record<string, unknown>[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Trazabilidad");
  sheet.columns = [
    { header: "Fecha", key: "created_at", width: 24 }, { header: "Usuario", key: "user_name_snapshot", width: 30 },
    { header: "Módulo", key: "module", width: 22 }, { header: "Acción", key: "action", width: 30 },
    { header: "Entidad", key: "resource_type", width: 24 }, { header: "ID", key: "resource_id", width: 38 },
    { header: "Código", key: "entity_code_snapshot", width: 22 }, { header: "Origen", key: "origin", width: 18 },
    { header: "Motivo", key: "reason", width: 45 },
  ];
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = "A1:I1";
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=integraq-activity.xlsx" } });
}
