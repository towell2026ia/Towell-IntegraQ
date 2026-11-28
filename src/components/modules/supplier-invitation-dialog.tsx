"use client";
import { useState } from "react";
import { supplierEmailPattern } from "@/lib/supplier-audits/contacts";
import { Dialog, Empty } from "./supplier-portal-view";
import css from "./supplier-portal.module.css";

export type PortalInvitation = {
  id: string;
  email: string;
  site_id: string | null;
  accepted_at?: string | null;
  withdrawn_at?: string | null;
  blocked_at?: string | null;
  expires_at: string;
};

export function invitationStatus(invitation: PortalInvitation, now: number) {
  if (invitation.accepted_at) return "Aceptada";
  if (invitation.withdrawn_at) return "Revocada";
  if (invitation.blocked_at) return "Bloqueada";
  return Date.parse(invitation.expires_at) <= now ? "Vencida" : "Pendiente";
}

export type PortalContact = {
  unavailable?: boolean;
  id: string;
  name: string;
  email: string;
  purpose: string;
};
type Props = {
  company: { name: string; code: string };
  contacts: PortalContact[];
  sites: { id: string; name: string }[];
  users: { email?: string; status: string }[];
  invitations: PortalInvitation[];
  now: number;
  busy: boolean;
  error: string;
  issue: (emails: string[], site: string) => Promise<string[]>;
  onClose: () => void;
};

export function SupplierInvitationDialog({
  company,
  contacts,
  sites,
  users,
  invitations,
  now,
  busy,
  error,
  issue,
  onClose,
}: Props) {
  const [site, setSite] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const accounts = new Map(
    users.map((u) => [u.email?.trim().toLowerCase(), u.status]),
  );
  const states = new Map<string, string>();
  // Prefer the live invitation, otherwise show the newest historical state.
  for (const invitation of invitations) {
    const email = invitation.email.trim().toLowerCase();
    const status = invitationStatus(invitation, now);
    if (status === "Pendiente" || !states.has(email)) {
      states.set(email, status);
    }
  }
  const rows = contacts.map((contact) => {
    const email = contact.email.trim().toLowerCase();
    const account = accounts.get(email);
    const status = completed.includes(email) ? "Pendiente" : states.get(email);
    const eligible = supplierEmailPattern.test(email) && !contact.unavailable && !account &&
      status !== "Pendiente";
    const access = account
      ? (account === "active" ? "Acceso activo" : "Acceso inactivo")
      : status
      ? `Invitación ${status.toLowerCase()}`
      : contact.unavailable ? "No elegible" : "";
    return { contact, email, eligible, access };
  });
  const eligibleEmails = [
    ...new Set(rows.filter((row) => row.eligible).map((row) => row.email)),
  ];
  const selected = eligibleEmails.filter((email) => selection.includes(email));
  const all = selected.length > 0 && selected.length === eligibleEmails.length;
  const shared = new Set<string>();
  const seen = new Set<string>();
  for (const { email } of rows) {
    if (email && seen.has(email)) shared.add(email);
    seen.add(email);
  }
  async function submit() {
    const issued = await issue(selected, site);
    setCompleted((previous) => [...previous, ...issued]);
    setSelection((previous) =>
      previous.filter((email) => !issued.includes(email))
    );
  }
  return (
    <Dialog title="Enviar invitación al portal" onClose={onClose}>
      <fieldset disabled={busy} className={css.inviteForm}>
        <legend>{company.name}{company.code && ` · ${company.code}`}</legend>
        <label>
          Sucursal
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Todo el proveedor</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={all}
            disabled={!eligibleEmails.length}
            ref={(node) => {
              if (node) node.indeterminate = selected.length > 0 && !all;
            }}
            onChange={() => setSelection(all ? [] : eligibleEmails)}
          />
          Seleccionar todos los elegibles
        </label>
        {!!rows.length && (
          <ul className={css.inviteContacts} aria-label="Contactos activos">
            {rows.map(({ contact, email, eligible, access }) => (
              <li key={contact.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!eligible}
                    checked={eligible && selected.includes(email)}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? [...selected, email]
                          : selected.filter((value) =>
                            value !== email
                          ),
                      )}
                  />
                  <span>
                    <strong>{contact.name || "Nombre sin registrar"}</strong>
                    <small>
                      {contact.purpose || "Cargo o propósito sin registrar"}
                    </small>
                    <span>{email || "Sin correo electrónico"}</span>
                    {email && !supplierEmailPattern.test(email) && (
                      <small>Correo no válido</small>
                    )}
                    {shared.has(email) && (
                      <small>Correo compartido · una invitación</small>
                    )}
                  </span>
                  {access && <span className={css.badge}>{access}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {!rows.length && <Empty>Sin contactos activos en el expediente.</Empty>}
        <div className={css.inviteFooter}>
          <span role="status">
            {selected.length} {selected.length === 1
              ? "destinatario seleccionado"
              : "destinatarios seleccionados"}
          </span>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !selected.length}
            onClick={() => void submit()}
          >
            {busy ? "Preparando…" : "Crear invitaciones"}
          </button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
