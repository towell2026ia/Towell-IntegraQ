"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LoginScreen } from "@/components/auth/login-screen";
import { IntegraQWorkspace } from "@/components/integraq-workspace";
import type { ActiveSession } from "@/lib/session-data";
import { createClient } from "@/lib/supabase/client";

interface IntegraQAppProps {
  initialSession: ActiveSession | null;
}

function getLoginError(message: string) {
  if (message.toLocaleLowerCase("en").includes("invalid login credentials")) {
    return "El correo o la contraseña no son correctos.";
  }
  if (message.toLocaleLowerCase("en").includes("email not confirmed")) {
    return "Confirma tu correo antes de iniciar sesión.";
  }
  return "No fue posible iniciar sesión. Intenta de nuevo.";
}

export function IntegraQApp({ initialSession }: IntegraQAppProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const signIn = async (email: string, password: string) => {
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(getLoginError(signInError.message));
      return false;
    }

    router.refresh();
    return true;
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    setError(null);
    window.history.replaceState(null, "", window.location.pathname);
    router.refresh();
  };

  if (!initialSession) return <LoginScreen error={error} onSignIn={signIn} />;
  return <IntegraQWorkspace onSignOut={signOut} session={initialSession} />;
}
