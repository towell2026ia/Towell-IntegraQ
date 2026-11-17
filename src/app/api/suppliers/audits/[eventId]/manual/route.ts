import { auditFailure } from "@/lib/supplier-audits/server";
import { manualHeaders, readManual, saveManual } from "@/lib/supplier-audits/manual-server";
export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try { return Response.json(await readManual((await params).eventId), { headers: manualHeaders }); } catch (error) { return auditFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try { return Response.json(await saveManual((await params).eventId, await request.json().catch(() => null)), { headers: manualHeaders }); } catch (error) { return auditFailure(error); }
}
