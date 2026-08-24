"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type PasswordMode = "request" | "update";

interface PasswordAccessScreenProps {
  mode: PasswordMode;
}

function AuthFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="login-page">
      <section className="login-hero" aria-label="IntegraQ">
        <Image
          alt="IntegraQ, Towell by GuIA"
          className="login-hero-image"
          fill
          priority
          sizes="(max-width: 900px) 100vw, 58vw"
          src="/brand/integraq-login-hero.png"
        />
        <div className="login-hero-footer">
          <span>Sistema de gestión</span>
          <strong>Calidad conectada, decisiones claras.</strong>
        </div>
      </section>

      <section className="login-access">{children}</section>
    </main>
  );
}

function BrandHeader() {
  return (
    <header className="login-brand-row">
      <Image
        alt="Towell"
        className="login-towell-logo"
        height={48}
        priority
        src="/brand/towell-logo.jpg"
        width={168}
      />
      <Image
        alt=""
        aria-hidden="true"
        className="login-isotype"
        height={46}
        priority
        src="/brand/integraq-logo.png"
        width={46}
      />
    </header>
  );
}

function AccessFooter() {
  return (
    <footer className="login-access-footer">
      <span>IntegraQ</span>
      <span aria-hidden="true">·</span>
      <span>Towell by GuIA</span>
    </footer>
  );
}

function RecoveryRequest() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/update-password` },
    );

    if (resetError) {
      setError("No fue posible enviar el correo. Intenta nuevamente en unos minutos.");
      setSubmitting(false);
      return;
    }

    setSent(true);
    setSubmitting(false);
  };

  return (
    <div className="login-access-inner">
      <BrandHeader />
      <div className="login-heading">
        <span>Acceso seguro</span>
        <h1 id="password-title">Recuperar contraseña</h1>
        <p>Recibirás un enlace de un solo uso para crear una nueva contraseña.</p>
      </div>

      {sent ? (
        <div className="login-success" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>Revisa tu correo</strong>
            <p>Si existe una cuenta con ese correo, Supabase enviará el enlace de recuperación.</p>
          </div>
        </div>
      ) : (
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Correo electrónico</span>
            <span className="login-input">
              <Mail size={18} aria-hidden="true" />
              <input
                autoComplete="email"
                autoFocus
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre@empresa.com"
                required
                type="email"
                value={email}
              />
            </span>
          </label>

          {error ? <p className="login-error" role="alert">{error}</p> : null}

          <button className="login-submit" disabled={submitting} type="submit">
            <span>{submitting ? "Enviando" : "Enviar enlace"}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      )}

      <Link className="login-back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" />
        Volver al inicio de sesión
      </Link>
      <AccessFooter />
    </div>
  );
}

function PasswordUpdate() {
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const recoveryError = hash.get("error_description");

    if (recoveryError) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setError("El enlace expiró o ya fue utilizado. Solicita uno nuevo.");
        setChecking(false);
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      setChecking(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      setChecking(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError("No fue posible actualizar la contraseña. Solicita un enlace nuevo.");
      setSubmitting(false);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    window.history.replaceState(null, "", "/update-password");
    setUpdated(true);
    setSubmitting(false);
  };

  return (
    <div className="login-access-inner">
      <BrandHeader />
      <div className="login-heading">
        <span>Acceso seguro</span>
        <h1 id="password-title">Crear nueva contraseña</h1>
        <p>Define una contraseña exclusiva para tu cuenta de IntegraQ.</p>
      </div>

      {updated ? (
        <div className="login-success" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>Contraseña actualizada</strong>
            <p>Ya puedes iniciar sesión con tus nuevas credenciales.</p>
          </div>
        </div>
      ) : checking ? (
        <div className="login-status" role="status">
          <KeyRound size={19} aria-hidden="true" />
          Verificando enlace seguro…
        </div>
      ) : hasSession ? (
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Nueva contraseña</span>
            <span className="login-input">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                autoComplete="new-password"
                autoFocus
                minLength={12}
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                onClick={() => setShowPassword((visible) => !visible)}
                title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                type="button"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <label>
            <span>Confirmar contraseña</span>
            <span className="login-input">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                autoComplete="new-password"
                minLength={12}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={confirmation}
              />
            </span>
          </label>

          {error ? <p className="login-error" role="alert">{error}</p> : null}

          <button className="login-submit" disabled={submitting} type="submit">
            <span>{submitting ? "Actualizando" : "Guardar contraseña"}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <div className="login-error login-link-error" role="alert">
          {error ?? "Este enlace no es válido o ya expiró."}
          <Link href="/recover-password">Solicitar otro enlace</Link>
        </div>
      )}

      <Link className="login-back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" />
        Volver al inicio de sesión
      </Link>
      <AccessFooter />
    </div>
  );
}

export function PasswordAccessScreen({ mode }: PasswordAccessScreenProps) {
  return (
    <AuthFrame>
      {mode === "request" ? <RecoveryRequest /> : <PasswordUpdate />}
    </AuthFrame>
  );
}
