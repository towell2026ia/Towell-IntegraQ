"use client";

import { ExternalPortalShell } from "./modules/supplier-portal-view";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ContinuityProvider } from "@/components/workspace-continuity";
import { clearContinuity, listenForBackgroundRefresh, confirmLeaving, continuityIdentity, sessionAccessKey, traceContinuity } from "@/lib/workspace-continuity";

import { StakeholderPortalModule } from "@/components/modules/stakeholder-portal-module";
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
    if (!initialSession?.authUserId || initialSession.workspaceMode !== "production") return;
    const current = sessionAccessKey(initialSession);
    let mounted = true;
    async function verify() {
      const result = await fetch("/api/session/access",{cache:"no-store",signal:AbortSignal.timeout(12000)});
      if (result.status !== 401 && !result.ok) return;
      const changed = result.status === 401 || (await result.json()).access !== current;
      if (mounted && changed) {
        clearContinuity("permission-change");
        router.refresh();
      }
    }
    const stop=listenForBackgroundRefresh("permissions",verify,1500);
    return ()=>{mounted=false;stop();};
  },[initialSession,router]);
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
  if(initialSession.userType==="Proveedor")return <ExternalPortalShell name={initialSession.name} signOut={()=>void signOut()}> {error&&<p role="alert">{error}</p>}<StakeholderPortalModule kind="supplier" session={initialSession} actions={[]}/></ExternalPortalShell>;
  const identity=continuityIdentity(initialSession);
  return <ContinuityProvider key={`${identity}:${sessionAccessKey(initialSession)}`} session={initialSession}>{error?<p role="alert">{error}</p>:null}<IntegraQWorkspace onSignOut={signOut} session={initialSession} /></ContinuityProvider>;
}
