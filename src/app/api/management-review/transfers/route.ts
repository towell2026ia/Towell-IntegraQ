import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { ReviewTransfer } from "@/lib/review-document-storage";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const failure = (status: number) => Response.json({ error: "No se pudo confirmar la carga documental." }, { status });

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return failure(403);
    const { id } = await request.json();
    if (typeof id !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return failure(400);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return failure(401);
    const result = await client.rpc("iq_review_transfers").eq("id", id).maybeSingle<ReviewTransfer & { previous_id: string | null; expected_at: string | null; resource_type: string }>();
    if (result.error) return failure(503);
    const transfer = result.data;
    if (!transfer) return failure(403);
    if (transfer.result_id) return Response.json({ id: transfer.result_id });
    if (!transfer.uploaded) return failure(409);

    // Read the immutable private object as its owner. Only the resulting digest is attested.
    const { data: bytes, error } = await client.storage.from("integraq-private").download(transfer.object_path);
    if (error || !bytes) return failure(503);
    if (bytes.size !== transfer.payload.size || bytes.size > 52428800) return failure(409);
    const sha = createHash("sha256").update(new Uint8Array(await bytes.arrayBuffer())).digest("hex");
    if (sha !== transfer.payload.sha) return failure(409);
    const attestation = await createAdminClient().rpc("iq_review_attest", {
      p_id: id, p_actor: user.id, p_sha: sha, p_size: bytes.size,
    });
    if (attestation.error) return failure(503);
    const saved = await client.rpc("iq_review_write", {
      p_action: transfer.previous_id ? "replace" : "add", p_type: transfer.resource_type,
      p_key: transfer.resource_key, p_previous: transfer.previous_id,
      p_expected: transfer.expected_at, p_data: transfer.payload,
    });
    if (saved.error || saved.data !== id) return failure(409);
    return Response.json({ id });
  } catch {
    return failure(503);
  }
}
