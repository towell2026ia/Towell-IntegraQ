"use client";

import { createBrowserClient } from "@supabase/ssr";

import { assertRecoverySupabaseUrl } from "./recovery-guard";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Falta configurar Supabase en .env.local.");
  }
  assertRecoverySupabaseUrl(url, process.env.NEXT_PUBLIC_APP_ENV);

  return createBrowserClient(url, publishableKey);
}
