import { IntegraQApp } from "@/components/integraq-app";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAuthenticatedSession(process.env.INTEGRAQ_HOME_TIMINGS === "1"
    ? (phase, ms) => console.info("HOME_TIMING", phase, Math.round(ms))
    : undefined);
  return <IntegraQApp initialSession={session} />;
}
