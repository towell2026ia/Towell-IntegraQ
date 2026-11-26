"use client";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function SupplierRegistration() {
  const [ticket, setTicket] = useState<URLSearchParams | null>(null),
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
      code = String(fields.get("code") ?? ""),
      invite = ticket.get("invite");
    setBusy(true);
    setError("");
    try {
      const submit = (step: "register" | "accept", payload: object) =>
        fetch("/api/suppliers/portal-access/" + step, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invite, code, ...payload }),
        });
      const registration = await submit("register", { email, password });
      if (!registration.ok) {
        const message = await registration.json().catch(() => null);
        throw new Error(message?.error || "No se pudo comprobar la invitación.");
      }
      const login = await db.auth.signInWithPassword({ email, password });
      if (login.error) throw new Error("Comprueba la contraseña de tu cuenta.");
      const acceptance = await submit("accept", { name: fields.get("name") });
      if (!acceptance.ok) {
        await db.auth.signOut({ scope: "local" });
        throw new Error("Esta invitación ya no está disponible para tu cuenta.");
      }
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
            <label>
              Código recibido en tu correo
              <input
                name="code"
                autoComplete="one-time-code"
                spellCheck={false}
                required
              />
            </label>
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
