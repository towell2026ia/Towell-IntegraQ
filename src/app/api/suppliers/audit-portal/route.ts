import { auditFailure } from "@/lib/supplier-audits/server";
import { manualHeaders, readSupplierAuditPortal } from "@/lib/supplier-audits/manual-server";
export async function GET() {
  try { return Response.json(await readSupplierAuditPortal(), { headers: manualHeaders }); } catch (error) { return auditFailure(error); }
}
