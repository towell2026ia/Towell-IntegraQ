import { auditFailure } from "@/lib/supplier-audits/server";
import { manualHeaders, supplierAuditPortalFile } from "@/lib/supplier-audits/manual-server";
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string; fileId: string }> }) {
  try { const { eventId, fileId } = await params; return Response.json(await supplierAuditPortalFile(eventId, fileId, new URL(request.url).searchParams.get("download") === "true"), { headers: manualHeaders }); } catch (error) { return auditFailure(error); }
}
