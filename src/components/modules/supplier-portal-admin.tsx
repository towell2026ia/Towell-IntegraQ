"use client";
import { useEffect, useState } from "react";
import { SupplierActionEvidence } from "./supplier-action-evidence";
type Company = { id: string; name: string; code: string; category: string };
type Detail = {
  users: {
    id: string;
    full_name: string;
    email: string;
    status: string;
    created_at: string;
    lastAccess?: string;
  }[];
  invitations: {
    id: string;
    email: string;
    accepted_at?: string;
    withdrawn_at?: string;
    blocked_at?: string;
    expires_at: string;
  }[];
  contacts: { email: string; name: string }[];
  sites: { id: string; name: string }[];
  accessReady: boolean;
  reports: {
    id: string;
    folio: string;
    report_date: string | null;
    status: string;
  }[];
  audits: {
    id: string;
    date: string | null;
    state: string;
    actions: { id: string; description: string }[];
  }[];
  assessments: {
    id: string;
    assessment_date: string;
    classification: string;
    score: number | null;
  }[];
};
const issuanceLimit = "Se alcanzó el límite de tres emisiones para este correo en 24 horas.";
async function access<T>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch("/api/suppliers/portal-access" + url, {
    cache: "no-store",
    ...options,
  });
  if (r.status === 429)
    throw new Error(issuanceLimit);
  if (!r.ok)
    throw new Error(
      "No se pudo completar la operación. Actualiza la consulta y comprueba tus permisos.",
    );
  return r.json();
}
const yearNow = () => String(new Date().getFullYear());
export function SupplierPortalAdmin() {
  const [companies, setCompanies] = useState<Company[]>([]),
    [supplier, setSupplier] = useState(""),
    [query, setQuery] = useState(""),
    [year, setYear] = useState(yearNow);
  const [state, setState] = useState("loading"),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    access<{ suppliers: Company[] }>("", { signal: c.signal })
      .then((x) => {
        if (!c.signal.aborted) {
          setCompanies(x.suppliers);
          setState("ready");
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setState("error");
      });
    return () => c.abort();
  }, [attempt]);
  const selected = companies.find((c) => c.id === supplier);
  return (
    <section className="portal-record-list">
      <h2>Portal de proveedores</h2>
      <div className="rncp-form-grid">
        <label>
          Buscar proveedor
          <input
            value={query}
            placeholder="Nombre, código o categoría"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Proveedor
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">Seleccionar proveedor</option>
            {companies
              .filter(
                (c) =>
                  c.id === supplier ||
                  [c.name, c.code, c.category]
                    .join(" ")
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {state === "loading" && <progress aria-label="Cargando proveedores" />}
      {state === "error" && (
        <button
          className="button button-secondary"
          onClick={() => retry(attempt + 1)}
        >
          Reintentar consulta
        </button>
      )}
      {selected && (
        <CompanyPortal
          key={selected.id}
          company={selected}
          year={year}
          setYear={setYear}
        />
      )}
    </section>
  );
}
function CompanyPortal({
  company,
  year,
  setYear,
}: {
  company: Company;
  year: string;
  setYear: (s: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [data, setData] = useState<Detail | null>(null),
    [attempt, reload] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [site, setSite] = useState(""),
    [links, setLinks] = useState<
      Record<string, { path: string; code?: string }>
    >({});
  useEffect(() => {
    const c = new AbortController();
    access<Detail>("?supplier=" + encodeURIComponent(company.id), {
      signal: c.signal,
    })
      .then((d) => {
        if (!c.signal.aborted) {
          setNow(Date.now());
          setData(d);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("No se pudo consultar el expediente.");
      });
    return () => c.abort();
  }, [company.id, attempt]);
  async function command(action: string, id?: string, email?: string) {
    return access<{ path?: string; verificationCode?: string }>("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, supplier: company.id, site, id, email }),
    });
  }
  async function issue() {
    if (
      !selected.length ||
      busy ||
      !window.confirm(
        "¿Crear invitaciones individuales para los contactos seleccionados?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      for (const email of selected) {
        const r = await command("invite", undefined, email);
        if (!r.path) throw new Error();
        setLinks((old) => ({
          ...old,
          [email]: { path: r.path!, code: r.verificationCode },
        }));
        setSelected((old) => old.filter((x) => x !== email));
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === issuanceLimit
          ? issuanceLimit
          : "No se completaron todas las invitaciones. Comprueba los estados antes de reintentar.",
      );
    } finally {
      setBusy(false);
      reload((v) => v + 1);
    }
  }
  async function change(action: string, id: string) {
    if (!window.confirm("¿Confirmar el cambio de acceso para este proveedor?"))
      return;
    setBusy(true);
    setError("");
    try {
      await command(action, id);
      setLinks({});
    } catch {
      setError("No se pudo modificar el acceso.");
    } finally {
      setBusy(false);
      reload((v) => v + 1);
    }
  }
  if (!data)
    return error ? (
      <p role="alert">
        {error}{" "}
        <button
          onClick={() => {
            setError("");
            reload((v) => v + 1);
          }}
        >
          Reintentar
        </button>
      </p>
    ) : (
      <progress aria-label="Cargando expediente" />
    );
  const match = (date: string | null) =>
    year === "all" || date?.slice(0, 4) === year;
  const years = Array.from(
    new Set([
      yearNow(),
      year,
      ...[
        ...data.reports.map((r) => r.report_date),
        ...data.audits.map((a) => a.date),
        ...data.assessments.map((a) => a.assessment_date),
      ].flatMap((d) => (d ? [d.slice(0, 4)] : [])),
    ]),
  )
    .filter((y) => y !== "all")
    .sort()
    .reverse();
  return (
    <section>
      <header className="module-heading">
        <h3>{company.name}</h3>
        <label>
          Año{" "}
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
            <option value="all">Todos</option>
          </select>
        </label>
      </header>
      <h4>RNCP</h4>
      <ul>
        {data.reports
          .filter((r) => match(r.report_date))
          .map((r) => (
            <li key={r.id}>
              <a
                className="evidence-link"
                href={"/?rncp=" + encodeURIComponent(r.id) + "#suppliers"}
              >
                {r.folio} · Consultar expediente
              </a>{" "}
              · {r.report_date ?? "Sin fecha"} · {r.status}
            </li>
          ))}
      </ul>
      <h4>Auditorías y planes</h4>
      <ul>
        {data.audits
          .filter((a) => match(a.date))
          .map((a) => (
            <li key={a.id}>
              {a.date ?? "Sin fecha"} · {a.state}
              <ul>
                {a.actions.map((v) => (
                  <li key={v.id}>{v.description}</li>
                ))}
              </ul>
              <SupplierActionEvidence event={a.id} actions={a.actions} review />
            </li>
          ))}
      </ul>
      <h4>Evaluaciones y calificaciones</h4>
      <ul>
        {data.assessments
          .filter((a) => match(a.assessment_date))
          .map((a) => (
            <li key={a.id}>
              {a.assessment_date} · {a.classification} ·{" "}
              {a.score ?? "Sin calificación"}
            </li>
          ))}
      </ul>
      <h3>Usuarios con acceso</h3>
      {!data.users.length ? (
        <p>Sin cuentas vinculadas.</p>
      ) : (
        <div className="quality-table-wrap">
          <table className="quality-table">
            <thead>
              <tr>
                {[
                  "Nombre",
                  "Correo",
                  "Proveedor",
                  "Estado",
                  "Registro",
                  "Último acceso",
                  "",
                ].map((v) => (
                  <th key={v}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{company.name}</td>
                  <td>{u.status === "active" ? "Activo" : "Inactivo"}</td>
                  <td>{u.created_at?.slice(0, 10)}</td>
                  <td>{u.lastAccess?.slice(0, 10) ?? "Sin registro"}</td>
                  <td>
                    <button
                      className="button button-secondary"
                      disabled={busy || !data.accessReady}
                      onClick={() =>
                        void change(
                          u.status === "active" ? "revoke" : "reactivate",
                          u.id,
                        )
                      }
                    >
                      {u.status === "active"
                        ? "Revocar acceso"
                        : "Reactivar acceso"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h4>Invitaciones</h4>
      {data.invitations.map((i) => {
        const status = i.accepted_at
          ? "Aceptada"
          : i.withdrawn_at
            ? "Revocada"
            : i.blocked_at ? "Bloqueada" : Date.parse(i.expires_at) <= now
              ? "Vencida"
              : "Pendiente";
        return (
          <p key={i.id}>
            {i.email} · {status}{" "}
            {status === "Pendiente" && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void change("withdraw", i.id)}
              >
                Revocar invitación
              </button>
            )}
          </p>
        );
      })}
      <fieldset disabled={busy || !data.accessReady}>
        <legend>Invitar usuario</legend>
        <label>
          Sucursal{" "}
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Todo el proveedor</option>
            {data.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {data.contacts.map((c) => (
          <label key={c.email}>
            <input
              type="checkbox"
              checked={selected.includes(c.email)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, c.email]
                    : selected.filter((x) => x !== c.email),
                )
              }
            />
            {c.name} {c.email}
          </label>
        ))}
        <button
          className="button button-primary"
          disabled={!selected.length}
          onClick={() => void issue()}
        >
          Crear invitaciones
        </button>
      </fieldset>
      {Object.entries(links).map(([email, invitation]) => (
        <div key={email}>
          <button
            className="button button-secondary"
            key={email}
            onClick={() =>
              void navigator.clipboard
                .writeText(location.origin + invitation.path)
                .catch(() => setError("No se pudo copiar el enlace."))
            }
          >
            Copiar invitación de {email}
          </button>
          {invitation.code && (
            <>
              <button
                className="button button-secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(invitation.code!)
                    .catch(() => setError("No se pudo copiar el código."))
                }
              >
                Copiar código de verificación
              </button>
              <small>
                Entrega el código por separado al correo registrado {email}.
              </small>
            </>
          )}
        </div>
      ))}
      {!data.accessReady && (
        <p>Administración de accesos pendiente de activación.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
