import { createClient } from "@supabase/supabase-js";

/** Queue-only scheduler. No email transport, no historical replay, no automatic activation. */
export default async function handler(_request, context) {
  if (context?.deploy?.context !== "production" || process.env.RNCP_FOLLOWUP_ENABLED !== "true") {
    return Response.json({ state: "disabled", emailsSent: 0 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (url !== "https://yptrqowmviixlkrxjrqr.supabase.co" || !key) return Response.json({ state: "configuration_pending", emailsSent: 0 }, { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const settings = await client.from("workspace_data").select("workspace_id,payload").eq("area", "rncpFollowupSettings").eq("workspace_mode", "production").is("deleted_at", null);
  if (settings.error) return Response.json({ state: "settings_unavailable", emailsSent: 0 }, { status: 503 });
  let queued = 0;
  for (const setting of settings.data ?? []) {
    if (setting.payload?.followupEnabled !== true) continue;
    const result = await client.rpc("iq_rncp_queue_notifications", { p_organization_id: setting.workspace_id });
    if (result.error) return Response.json({ state: "queue_unavailable", emailsSent: 0 }, { status: 503 });
    queued += Number(result.data ?? 0);
  }
  return Response.json({ state: "queue_only_real_email_disabled", queued, emailsSent: 0 });
}

export const config = { schedule: "*/15 * * * *" };
