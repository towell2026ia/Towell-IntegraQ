"use client";
import type { InvitationPermissions } from "@/lib/portal-staff-permissions";
import QRCode from "qrcode";
import { useRef, useState } from "react";

type Access = { active: boolean; id?: string; key?: string; notice?: string };
export function CustomerAccessPanel({ customerId, name, permissions = { consultar:true, emitir:true, reenviar:true, revocar:true } }: {customerId: string; name: string; permissions?: InvitationPermissions}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  function link(key: string) { return new URL("/portal/cliente#" + key, window.location.origin).href; }
  async function manage(action: "status" | "obtain" | "issue" | "revoke") {
    if ((action === "issue" || action === "revoke") && !window.confirm(`¿${action === "issue" ? "Emitir" : "Revocar"} el acceso al portal de ${name}?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/customer-portal/admin/access", {method: "POST", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({customerId, action, id: access?.id})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo consultar el acceso.");
      setAccess(body);
      if (body.key && canvas.current) await QRCode.toCanvas(canvas.current, link(body.key), {width: 240, margin: 4});
    } catch (cause) {
      setAccess(null);
      setError(cause instanceof Error ? cause.message : "Acceso no disponible.");
    } finally { setBusy(false); }
  }
  return <section className="party-detail-section"><h4>Acceso al portal de {name}</h4>
    {error && <p role="alert">{error}</p>}
    {access?.notice && <p role="status">{access.notice}</p>}
    {permissions.consultar && <button disabled={busy} type="button" onClick={() => void manage("status")}>Consultar estado</button>}
    {permissions.reenviar && <button disabled={busy} type="button" onClick={() => void manage("obtain")}>Obtener enlace y QR</button>}
    {access?.active === false && <p>Este cliente no tiene enlace activo.</p>}
    {access?.active === true && <p>Enlace activo.</p>}
    {permissions.emitir && !access?.active && <button disabled={busy} type="button" onClick={() => void manage("issue")}>Emitir enlace y QR</button>}
    <canvas hidden={!access?.key} ref={canvas} role="img" aria-label={`QR del portal de ${name}`}/>
    {access?.key && <button disabled={busy} type="button" onClick={() => void navigator.clipboard.writeText(link(access.key!)).catch(() => setError("El navegador bloqueó la copia del enlace."))}>Copiar enlace</button>}
    {permissions.revocar && access?.active !== false && <button disabled={busy} type="button" onClick={() => void manage("revoke")}>Revocar acceso</button>}
  </section>;
}
