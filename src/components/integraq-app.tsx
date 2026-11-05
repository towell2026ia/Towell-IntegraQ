"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ContinuityProvider } from "@/components/workspace-continuity";
import { clearContinuity, confirmLeaving, continuityIdentity, sessionAccessKey, traceContinuity } from "@/lib/workspace-continuity";

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
  const [signedOut,setSignedOut]=useState(false);
  const [authIdentity,setAuthIdentity]=useState(initialSession?.authUserId??null);
  const verifiedIdentity=initialSession?.authUserId;
  const previousAccess=useRef<string|null>(null);
  useEffect(()=>{
    const access=initialSession?sessionAccessKey(initialSession):null;
    traceContinuity("server-session-snapshot",access===previousAccess.current?"same-access":"access-change");previousAccess.current=access;
  },[initialSession]);
  useEffect(()=>{
    const client=createClient();
    const {data}=client.auth.onAuthStateChange((event,authSession)=>{
      traceContinuity("auth-event",event);
      // SIGNED_IN may fire on focus. Token renewal must not reset the workspace.
      if(event==="SIGNED_OUT"){clearContinuity();setSignedOut(true);}
      if(event==="SIGNED_IN"&&authSession?.user.id){
        setAuthIdentity(authSession.user.id);
        if(verifiedIdentity&&authSession.user.id!==verifiedIdentity){clearContinuity();traceContinuity("router-refresh","identity-change");queueMicrotask(()=>router.refresh());}
      }
    });
    return ()=>data.subscription.unsubscribe();
  },[verifiedIdentity,router]);

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

    clearContinuity();setSignedOut(false);traceContinuity("router-refresh","explicit-sign-in");router.refresh();
    return true;
  };

  const signOut = async () => {
    if(!confirmLeaving())return;
    const supabase = createClient();
    const result=await supabase.auth.signOut({ scope: "local" });
    if(result.error){setError("No se pudo cerrar la sesión. Intenta de nuevo.");return;}
    clearContinuity();setSignedOut(true);
    setError(null);
    window.history.replaceState(null, "", window.location.pathname);
    traceContinuity("router-refresh","explicit-sign-out");router.refresh();
  };

  if (!initialSession||signedOut||authIdentity&&authIdentity!==initialSession.authUserId) return <LoginScreen error={error} onSignIn={signIn} />;
  const identity=continuityIdentity(initialSession);
  return <ContinuityProvider key={`${identity}:${sessionAccessKey(initialSession)}`} session={initialSession}>{error?<p role="alert">{error}</p>:null}<IntegraQWorkspace onSignOut={signOut} session={initialSession} /></ContinuityProvider>;
}
