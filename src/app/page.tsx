import { IntegraQApp } from "@/components/integraq-app";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAuthenticatedSession();
  return <IntegraQApp initialSession={session} />;
}
