"use client";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function SupplierRegistration() {
  const [ticket, setTicket] = useState<URLSearchParams | null>(null),
    [verifiedEmail, setVerifiedEmail] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const data = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);
    if (data.has("invite")) queueMicrotask(() => setTicket(data));
  }, []);
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || busy) return;
    const fields = new FormData(event.currentTarget),
      db = createClient(),
      email = String(fields.get("email")).trim().toLowerCase(),
      password = String(fields.get("password")),
      enroll = ticket.get("enroll") === "1";
    setBusy(true);
    setError("");
    try {
      if (enroll && verifiedEmail !== email) {
        const check = await db.auth.verifyOtp({
          email,
          token: String(fields.get("code") ?? "").trim(),
          type: "email",
        });
        if (check.error || check.data.user?.email?.toLowerCase() !== email)
          throw new Error(
            "Comprueba el correo y la vigencia de la invitación.",
          );
        setVerifiedEmail(email);
      } else if (!enroll) {
        const login = await db.auth.signInWithPassword({ email, password });
        if (login.error) throw new Error("Comprueba tus credenciales.");
      }
      async function accept(prepare: boolean) {
        const response = await fetch("/api/suppliers/portal-access/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invite: ticket?.get("invite"),
            prepare,
            name: fields.get("name"),
          }),
        });
        if (!response.ok)
          throw new Error("Esta invitación no está disponible para tu cuenta.");
      }
      if (enroll) {
        await accept(true);
        const saved = await db.auth.updateUser({ password });
        if (saved.error)
          throw new Error(
            "No se confirmó la contraseña. Revisa sus requisitos y vuelve a intentarlo.",
          );
      }
      await accept(false);
      window.location.replace("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar el registro.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="portal-action-form">
      <h1>Portal de proveedores</h1>
      {ticket?.get("invite") ? (
        <form onSubmit={register}>
          <h2>Confirmar invitación</h2>
          <div className="rncp-form-grid">
            <label>
              Nombre
              <input name="name" required minLength={2} maxLength={160} />
            </label>
            <label>
              Correo invitado
              <input name="email" type="email" autoComplete="email" required />
            </label>
            {ticket.get("enroll") === "1" && (
              <label>
                Código recibido en tu correo
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </label>
            )}
            <label>
              {ticket.get("enroll") === "1"
                ? "Crear contraseña"
                : "Contraseña de tu cuenta"}
              <input
                name="password"
                type="password"
                autoComplete={
                  ticket.get("enroll") === "1"
                    ? "new-password"
                    : "current-password"
                }
                minLength={ticket.get("enroll") === "1" ? 10 : 1}
                required
              />
            </label>
          </div>
          <button className="button button-primary" disabled={busy}>
            Acceder al portal
          </button>
        </form>
      ) : (
        <p>Abre el enlace de invitación que recibiste.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
