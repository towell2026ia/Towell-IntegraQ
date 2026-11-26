"use client";
import { useEffect, useState } from "react";
import { SupplierActionEvidence } from "./supplier-action-evidence";
import { getSupplierAssessmentFileUrl } from "@/lib/supplier-assessment-data";
import dynamic from "next/dynamic";
import { deriveLifecycle } from "@/lib/rncp/analytics";
import { rncpEffectiveness } from "@/lib/rncp/effectiveness";
import type { MatrixReport } from "@/lib/rncp/model";
import type { PortalActionSummary } from "@/lib/rncp-data";
import {
  type ActionItem,
  ActionList,
  auditLabel,
  AuditTrends,
  Dashboard,
  Dialog,
  Empty,
  inPeriod,
  Panel,
  PortalFrame,
  Profile,
  ReportList,
  type Section,
  SupplierPicker,
} from "./supplier-portal-view";
import css from "./supplier-portal.module.css";
const DetailModal = dynamic(() =>
  import("./rncp-matrix-dashboard").then((m) => m.SelectedReportModal)
);
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
  reports: MatrixReport[];
  actions: PortalActionSummary[];
  audits: {
    id: string;
    date: string | null;
    state: string;
    score: number | null;
    method: string | null;
    kind: string | null;
    actions: Omit<PortalActionSummary, "parent">[];
  }[];
  assessments: {
    id: string;
    source_file_id?: string | null;
    assessment_date: string;
    classification: string;
    score: number | null;
  }[];
};
const issuanceLimit =
  "Se alcanzó el límite de tres emisiones para este correo en 24 horas.";
async function access<T>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch("/api/suppliers/portal-access" + url, {
    cache: "no-store",
    ...options,
  });
  if (r.status === 429) {
    throw new Error(issuanceLimit);
  }
  if (!r.ok) {
    throw new Error(
      "No se pudo completar la operación. Actualiza la consulta y comprueba tus permisos.",
    );
  }
  return r.json();
}
const yearNow = () => String(new Date().getFullYear());
export function SupplierPortalAdmin() {
  const [companies, setCompanies] = useState<Company[]>([]),
    [supplier, setSupplier] = useState(""),
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
    <section className={css.root}>
      <SupplierPicker
        companies={companies}
        selected={supplier}
        choose={setSupplier}
      />
      {!selected && state === "ready" && (
        <Empty>Selecciona un proveedor para consultar su portal.</Empty>
      )}
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
  const [section, setSection] = useState<Section>("home");
  const [invite, setInvite] = useState(false);
  const [report, setReport] = useState<MatrixReport | null>(null);
  const [fullReport, setFullReport] = useState(false);
  const [audit, setAudit] = useState("");
  const [auditAction, setAuditAction] = useState("");
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
        if (!c.signal.aborted) {
          setData(null);
          setError("No se pudo consultar el expediente.");
        }
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
    ) {
      return;
    }
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
      setInvite(false);
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
  async function openAssessment(id: string, download: boolean) {
    try {
      const { signedUrl } = await getSupplierAssessmentFileUrl(id, download);
      const anchor = document.createElement("a");
      anchor.href = signedUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch {
      setError("No se pudo abrir el informe.");
    }
  }
  async function change(action: string, id: string) {
    if (
      !window.confirm("¿Confirmar el cambio de acceso para este proveedor?")
    ) {
      return;
    }
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
  if (!data) {
    return error
      ? (
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
      )
      : <progress aria-label="Cargando expediente" />;
  }
  const match = (date: string | null) =>
    year === "all" || date?.slice(0, 4) === year;
  const years = Array.from(
    new Set([
      yearNow(),
      year,
      ...[
        ...data.reports.map((r) => r.reportDate),
        ...data.audits.map((a) => a.date),
        ...data.assessments.map((a) => a.assessment_date),
      ].flatMap((d) => (d ? [d.slice(0, 4)] : [])),
    ]),
  )
    .filter((y) => y !== "all")
    .sort()
    .reverse();
  const currentReports = data.reports.filter((r) => match(r.reportDate));
  const records = currentReports.map((r) => ({
    id: r.id,
    folio: r.folio,
    date: r.reportDate,
    description: r.defect,
    classification: r.material,
    state: deriveLifecycle(r, new Date(now).toISOString()).state,
    deadline: r.responseDeadline,
    progress: r.firstValidProgressAt,
    returned: r.validationOutcome === "rejected" && !r.closedAt,
    awaitingResponse: r.origin === "native" && !!r.notifiedAt &&
      !r.completeSubmittedAt && !r.closedAt,
    draft: r.legacyStatus === "draft" && r.origin !== "historical",
  }));
  const audits = data.audits.filter((a) => match(a.date)),
    assessments = data.assessments.filter((a) => match(a.assessment_date)).sort(
      (a, b) => b.assessment_date.localeCompare(a.assessment_date),
    );
  const parents = new Map(data.reports.map((r) => [r.id, r]));
  const actions: ActionItem[] = [
    ...data.actions.flatMap((a) => {
      const r = parents.get(a.parent);
      return r
        ? [{
          ...a,
          origin: "RNCP" as const,
          folio: r.folio,
          date: r.reportDate,
        }]
        : [];
    }),
    ...data.audits.flatMap((a) =>
      a.actions.map((x) => ({
        ...x,
        parent: a.id,
        origin: "Auditoría" as const,
        folio: "Auditoría · " + (a.date ?? "Sin fecha"),
        date: a.date,
      }))
    ),
  ];
  const openReport = (id: string) => {
    setFullReport(false);
    setReport(parents.get(id) ?? null);
  };
  const openAudit = (id: string, action = "") => {
    setAuditAction(action);
    setAudit(id);
    setSection("audits");
  };
  const navigate = (next: Section) => {
    setSection(next);
    setAudit("");
  };
  const showAudits = (performed: boolean) => {
    const rows = audits.filter((a) => !audit || a.id === audit).filter((a) =>
      ["performed", "completed"].includes(a.state) === performed
    );
    return (
      <Panel
        title={performed
          ? "Auditorías realizadas"
          : "Programación de auditorías"}
      >
        {rows.map((a) => (
          <article className={css.record} key={a.id}>
            <div>
              <h4>{a.date ?? "Fecha pendiente"} · {auditLabel(a.state)}</h4>
              {a.method && (
                <p>{a.method === "other" ? "Otra metodología" : a.method}</p>
              )}
              {a.score != null && <p>Calificación · {a.score} %</p>}
              {a.actions.map((x) => <p key={x.id}>{x.description}</p>)}
              <SupplierActionEvidence
                key={a.id + auditAction}
                event={a.id}
                actions={a.actions}
                initialAction={a.id === audit ? auditAction : ""}
                review
              />
            </div>
          </article>
        ))}
        {!rows.length && <Empty>Sin auditorías para esta selección.</Empty>}
      </Panel>
    );
  };
  return (
    <PortalFrame
      admin
      name={company.name}
      sub={[company.code, company.category].filter(Boolean).join(" · ")}
      years={years}
      year={year}
      onYear={(y) => {
        setYear(y);
        setAudit("");
      }}
      section={section}
      onSection={navigate}
    >
      {section === "home" && (
        <Dashboard
          reports={records}
          percent={rncpEffectiveness(
            currentReports.map((r) => ({ ...r, status: r.legacyStatus })),
            now,
          ).percent}
          audits={audits}
          latestAssessment={assessments.find((a) => a.score !== null)?.score}
          actions={actions.filter((a) => inPeriod(a.date, year))}
          openReport={openReport}
          openAudit={openAudit}
          openAction={(a) =>
            a.origin === "RNCP"
              ? openReport(a.parent)
              : openAudit(a.parent, a.id)}
          otherPeriods={actions.some((a) =>
            !inPeriod(a.date, year) && !["closed", "accepted"].includes(a.state)
          )}
          onOther={() => {
            setYear("all");
            navigate("plans");
          }}
        />
      )}
      {section === "rncp" && <ReportList rows={records} open={openReport} />}
      {section === "audits" && (
        <>
          {audit && (
            <button
              className="button button-secondary"
              onClick={() => setAudit("")}
            >
              Ver todas las auditorías
            </button>
          )}
          {showAudits(false)}
          {showAudits(true)}
          <AuditTrends
            rows={audits.filter((a) =>
              ["performed", "completed"].includes(a.state)
            )}
          />
          <Panel title="Evaluaciones F-CO-05">
            {assessments.map((a) => (
              <div key={a.id} className={css.record}>
                {a.assessment_date} · {a.classification}
                <strong>{a.score ?? "—"}</strong>
              </div>
            ))}
            {!assessments.length && (
              <Empty>Sin evaluaciones en el período.</Empty>
            )}
          </Panel>
        </>
      )}
      {section === "plans" && (
        <ActionList
          rows={actions.filter((a) => match(a.date ?? null))}
          onOpen={(a) =>
            a.origin === "RNCP"
              ? openReport(a.parent)
              : openAudit(a.parent, a.id)}
        />
      )}
      {section === "profile" && (
        <>
          <Profile
            name={company.name}
            code={company.code}
            category={company.category}
            sites={data.sites.map((s) => s.name)}
            contacts={data.contacts}
          />
          <Panel title="Documentos del expediente">
            {data.assessments.filter((a) => a.source_file_id).map((a) => (
              <div className={css.record} key={a.id}>
                <span>Informe · {a.assessment_date}</span>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    void openAssessment(a.id, false)}
                >
                  Ver documento
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    void openAssessment(a.id, true)}
                >
                  Descargar
                </button>
              </div>
            ))}
            {!data.assessments.some((a) => a.source_file_id) && (
              <Empty>Sin informes de evaluación vinculados.</Empty>
            )}
            {error && <p role="alert">{error}</p>}
          </Panel>
        </>
      )}
      {report && !fullReport && (
        <Dialog
          title={report.folio}
          onClose={() => setReport(null)}
        >
          <div className={css.detail}>
            <small>{company.name} · {report.reportDate ?? "Sin fecha"}</small>
            <h4>Descripción de la no calidad</h4>
            <p>{report.defect || "Sin descripción registrada."}</p>
            <dl className={css.stats}>
              <div>
                <dt>Clasificación</dt>
                <dd>{report.material || "—"}</dd>
              </div>
              <div>
                <dt>Vencimiento</dt>
                <dd>{report.responseDeadline?.slice(0, 10) ?? "—"}</dd>
              </div>
            </dl>
            <button
              className="button button-primary"
              onClick={() => setFullReport(true)}
            >
              Consultar archivos y seguimiento
            </button>
          </div>
        </Dialog>
      )}
      {report && fullReport && (
        <DetailModal
          deferPdf
          report={report}
          administrator
          inspector={false}
          onClose={() => setReport(null)}
          onChanged={async () => {
            setReport(null);
            reload((v) => v + 1);
          }}
        />
      )}
      {section === "access" && (
        <Panel
          title="Usuarios con acceso"
          aside={
            <button
              className="button button-primary"
              disabled={!data.accessReady}
              onClick={() => setInvite(true)}
            >
              Invitar usuario
            </button>
          }
        >
          {!data.users.length
            ? <p>Sin cuentas vinculadas.</p>
            : (
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
                      ].map((v) => <th key={v}>{v}</th>)}
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
                              )}
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
              : i.blocked_at
              ? "Bloqueada"
              : Date.parse(i.expires_at) <= now
              ? "Vencida"
              : "Pendiente";
            return (
              <p key={i.id}>
                {i.email} · {status} {status === "Pendiente" && (
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
          {!data.invitations.length && (
            <Empty>Sin invitaciones registradas.</Empty>
          )}
          {invite && (
            <Dialog
              title="Invitar usuario"
              onClose={() => {
                if (!busy) setInvite(false);
              }}
            >
              <fieldset disabled={busy || !data.accessReady}>
                <label>
                  Sucursal{" "}
                  <select
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  >
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
                        )}
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
              {error && <p role="alert">{error}</p>}
            </Dialog>
          )}
          {Object.entries(links).map(([email, invitation]) => (
            <div key={email}>
              <button
                className="button button-secondary"
                key={email}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(location.origin + invitation.path)
                    .catch(() => setError("No se pudo copiar el enlace."))}
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
                        .catch(() => setError("No se pudo copiar el código."))}
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
          {error && !invite && <p role="alert">{error}</p>}
        </Panel>
      )}
    </PortalFrame>
  );
}
