"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";

interface LoginScreenProps {
  error: string | null;
  onSignIn: (email: string, password: string) => Promise<boolean>;
}

export function LoginScreen({ error, onSignIn }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    try {
      await onSignIn(email.trim(), password);
    } finally {
      setSubmitting(false);
    }
  };

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

      <section className="login-access" aria-labelledby="login-title">
        <div className="login-access-inner">
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

          <div className="login-heading">
            <span>Bienvenido</span>
            <h1 id="login-title">Iniciar sesión</h1>
            <p>Accede a tu espacio de trabajo en IntegraQ.</p>
          </div>

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

            <label>
              <span>Contraseña</span>
              <span className="login-input">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  autoComplete="current-password"
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

            <div className="login-form-options">
              <span />
              <Link className="login-help-link" href="/recover-password">
                Olvidé mi contraseña
              </Link>
            </div>

            {error ? <p className="login-error" role="alert">{error}</p> : null}

            <button className="login-submit" disabled={submitting} type="submit">
              <span>{submitting ? "Validando" : "Entrar a IntegraQ"}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>

          <footer className="login-access-footer">
            <span>IntegraQ</span>
            <span aria-hidden="true">·</span>
            <span>Towell by GuIA</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
