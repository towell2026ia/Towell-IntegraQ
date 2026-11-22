import "server-only";
import type { CustomerPortalActor } from "@/lib/customer-portal-server";

export type PortalReader = CustomerPortalActor | Awaited<ReturnType<typeof resolvePortalLink>>;
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const portalDigest = (value: string) => createHash("sha256").update(value).digest("hex");

export function portalKey(customer: string, nonce: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Acceso del portal no disponible.");
  return createHmac("sha256", secret).update(`integraq/customer-portal/v1/${customer}/${nonce}`).digest("base64url");
}

export function newPortalKey(customer: string) {
  const nonce = randomBytes(32).toString("hex");
  const key = portalKey(customer, nonce);
  return { nonce, key_digest: portalDigest(key) };
}

export const linkHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export async function resolvePortalLink(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1];
  const address = request.headers.get("x-nf-client-connection-ip") || "shared";
  const bucket = parseInt(portalDigest(address).slice(0, 4), 16);
  const lookup = await createAdminClient().rpc("iq_customer_portal_access", {
    p_digest: token ? portalDigest(token) : null, p_bucket: bucket,
  }).maybeSingle();
  const row = lookup.data as { grant_id: string; workspace_id: string; customer_id: string; company_name: string } | null;
  if (lookup.error || !token || !row?.grant_id || !row.workspace_id || !row.customer_id) return null;
  return { kind: "customer" as const, userId: null, linkId: row.grant_id, workspaceId: row.workspace_id,
    companyId: row.customer_id, companyName: row.company_name };
}
