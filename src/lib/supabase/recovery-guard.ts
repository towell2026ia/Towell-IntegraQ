const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertRecoverySupabaseUrl(
  url: string,
  environment = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV,
) {
  if (environment !== "recovery-local") return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("RECOVERY_ABORT_INVALID_SUPABASE_URL");
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`RECOVERY_ABORT_NON_LOCAL_SUPABASE:${parsed.hostname}`);
  }
}
