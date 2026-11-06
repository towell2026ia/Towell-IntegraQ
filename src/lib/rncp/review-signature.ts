import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
export function signAlertReview(organizationId: string, key: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Firma de revisiones no disponible.");
  return createHmac("sha256", secret).update(`rncp-alert-review-v1:${organizationId}:${key}`).digest("hex");
}
export function verifyAlertReview(organizationId: string, key: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(signAlertReview(organizationId, key), "hex"), Buffer.from(token, "hex"));
}
