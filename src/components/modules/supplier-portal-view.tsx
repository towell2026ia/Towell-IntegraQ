"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Files,
  LayoutDashboard,
  ListChecks,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { type OperationalState, stateLabels } from "@/lib/rncp/model";
import { auditStates } from "@/lib/supplier-audits/model";
import css from "./supplier-portal.module.css";

export type Section =
  | "home"
  | "rncp"
  | "audits"
  | "plans"
  | "profile"
  | "access";
const sections = [
  ["home", "Inicio", LayoutDashboard],
  ["rncp", "Mis RNCP", Files],
  ["audits", "Mis auditorías", ClipboardCheck],
  ["plans", "Planes de acción y evidencias", ListChecks],
  ["profile", "Mi expediente", BriefcaseBusiness],
  ["access", "Usuarios con acceso", Users],
] as const;
export type ReportItem = {
  id: string;
  folio: string;
  date?: string | null;
  description?: string;
  classification?: string;
  state: OperationalState;
  deadline?: string | null;
  progress?: string | null;
  returned?: boolean;
  awaitingResponse?: boolean;
  draft?: boolean;
};
export type ActionItem = {
  id: string;
  parent: string;
  origin: "RNCP" | "Auditoría";
  folio: string;
  date?: string | null;
  description: string;
  owner?: string | null;
  due?: string | null;
  completed?: string | null;
  state: string;
  files?: number | null;
};
export type AuditItem = {
  id: string;
  date: string | null;
  state: string;
  score?: number | null;
  method?: string | null;
};
export const inPeriod = (date: string | null | undefined, year: string) =>
  year === "all" || date?.slice(0, 4) === year;
const actionLabels: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En ejecución",
  submitted: "En revisión",
  accepted: "Validada",
  closed: "Cerrada",
  rejected: "Devuelta",
};
export const actionLabel = (key: string) =>
  actionLabels[key] ?? "Estado no disponible";
export const auditLabel = (key: string) =>
  key === "withdrawn"
    ? "Retirada"
    : auditStates[key as keyof typeof auditStates] ?? "Estado no disponible";
const reportLabel = (r: ReportItem) =>
  r.draft ? "Borrador" : r.state === "late" ? "Tardío" : stateLabels[r.state];
export function Empty({ children }: { children: ReactNode }) {
  return <p className={css.empty}>{children}</p>;
}
export function Panel(
  { title, children, aside }: {
    title: string;
    children: ReactNode;
    aside?: ReactNode;
  },
) {
  return (
    <section className={css.panel}>
      <header>
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
export function Dialog(
  { title, children, onClose }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
  },
) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className={css.dialog}
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h3>{title}</h3>
        <button aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function PortalFrame({
  admin = false,
  name,
  sub,
  years,
  year,
  onYear,
  section,
  onSection,
  children,
}: {
  admin?: boolean;
  name: string;
  sub?: string;
  years: string[];
  year: string;
  onYear: (y: string) => void;
  section: Section;
  onSection: (v: Section) => void;
  children: ReactNode;
}) {
  return (
    <div className={css.root}>
      <header className={css.hero}>
        <div className={css.identity}>
          <Building2 size={27} />
          <div>
            <small>
              {admin ? "Consulta administrativa" : "Portal de proveedores"}
            </small>
            <h2>{name}</h2>
            {sub && <p>{sub}</p>}
          </div>
        </div>
        <label className={css.period}>
          <CalendarDays size={16} /> Año{" "}
          <select
            aria-label="Año"
            value={year}
            onChange={(e) => onYear(e.target.value)}
          >
            {[...new Set([...years, year])].filter((v) => v !== "all").sort()
              .reverse().map((y) => <option key={y}>{y}</option>)}
            <option value="all">Todos</option>
          </select>
        </label>
      </header>
      <nav className={css.tabs} aria-label="Navegación del portal">
        {sections.filter(([k]) => admin || k !== "access").map((
          [key, label, Icon],
        ) => (
          <button
            key={key}
            aria-current={section === key ? "page" : undefined}
            onClick={() => onSection(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}
const validGrade = (x: { score?: number | null }) =>
  typeof x.score === "number";
export function Dashboard({
  upcomingAvailable = true,
  reports,
  percent,
  audits,
  actions,
  openReport,
  openAudit,
  openAction,
  latestAssessment,
  otherPeriods,
  onOther,
}: {
  upcomingAvailable?: boolean;
  reports: ReportItem[] | null;
  percent: number | null;
  audits: AuditItem[] | null;
  actions: ActionItem[] | null;
  openReport: (id: string) => void;
  openAudit: (id: string) => void;
  openAction: (a: ActionItem) => void;
  latestAssessment?: number | null;
  otherPeriods: boolean;
  onOther: () => void;
}) {
  const closed = reports?.filter((r) => r.state === "closed").length,
    late = reports?.filter((r) => r.state === "late").length;
  const metrics = [
    ["Total de RNCP", reports?.length, Files],
    [
      "Abiertos",
      reports?.filter((r) => !["closed", "late"].includes(r.state) && !r.draft)
        .length,
      Activity,
    ],
    ["Cerrados", closed, CheckCheck],
    ["Tardíos", late, CircleAlert],
  ] as const;
  const pending = actions?.filter((a) =>
      !["accepted", "closed"].includes(a.state)
    ),
    today = new Date().toLocaleDateString("en-CA");
  const upcoming = audits?.filter((a) =>
    ["scheduled", "confirmed", "rescheduled"].includes(a.state) && a.date &&
    a.date >= today
  ).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const performed = audits?.filter((a) =>
    ["performed", "completed"].includes(a.state)
  ).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const tasks = reports?.filter((r) => r.returned || r.awaitingResponse);
  return (
    <>
      <div className={css.metrics}>
        {metrics.map(([label, value, Icon], i) => (
          <section key={label}>
            <span className={css.icon}>
              <Icon size={18} />
            </span>
            <h3>{label}</h3>
            <strong>{value ?? "—"}</strong>
            {i > 0 && !!reports?.length && value !== undefined && (
              <small>
                {Math.round(100 * value / reports.length)} % del total
              </small>
            )}
          </section>
        ))}
      </div>
      <div className={css.grid}>
        <Panel title="Efectividad RNCP">
          <div className={css.effect}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="39" />
              {percent !== null && (
                <circle
                  cx="50"
                  cy="50"
                  r="39"
                  pathLength="100"
                  strokeDasharray={percent + " 100"}
                />
              )}
            </svg>
            <strong
              aria-label={percent === null ? "Sin RNCP evaluables" : undefined}
            >
              {percent === null ? "—" : Number(percent.toFixed(1)) + " %"}
            </strong>
          </div>
        </Panel>
        <Panel title="Auditorías y calificaciones">
          <dl className={css.stats}>
            {[
              [
                "Próximas auditorías",
                upcomingAvailable ? upcoming?.length : undefined,
              ],
              ["Auditorías realizadas", performed?.length],
              [
                "Última calificación de auditoría",
                performed?.find(validGrade)?.score,
              ],
              ["Evaluación F-CO-05", latestAssessment],
              ["Acciones pendientes", pending?.length],
            ].map(([l, v]) => (
              <div key={l}>
                <dt>{l}</dt>
                <dd>{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel title="Actividades pendientes">
        {tasks?.map((r) => (
          <button
            className={css.row}
            key={r.id}
            onClick={() => openReport(r.id)}
          >
            <span>
              <b>{r.folio}</b> ·{" "}
              {r.returned ? "Respuesta devuelta" : "Respuesta pendiente"}
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {pending?.map((a) => (
          <button
            className={css.row}
            key={a.origin + a.id}
            onClick={() => openAction(a)}
          >
            <span>
              <b>{a.folio}</b> · {a.description}
            </span>
            <small>
              {a.due && a.due < today && !a.completed
                ? "Vencida"
                : actionLabel(a.state)}
              {a.files === 0 ? " · Sin evidencia" : ""}
            </small>
          </button>
        ))}
        {upcoming?.map((a) => (
          <button
            className={css.row}
            onClick={() => openAudit(a.id)}
            key={a.id}
          >
            Auditoría programada · {a.date}
            <ChevronRight size={16} />
          </button>
        ))}
        {reports && actions && audits && !tasks?.length && !pending?.length &&
          !upcoming?.length && (
          <Empty>Sin actividades pendientes en este período.</Empty>
        )}
        {otherPeriods && (
          <button className="button button-secondary" onClick={onOther}>
            Ver pendientes de otros períodos <ArrowUpRight size={14} />
          </button>
        )}
      </Panel>
      {!!reports?.length && (
        <Panel title="Últimos reportes">
          {reports.slice(0, 3).map((r) => (
            <button
              className={css.row}
              key={r.id}
              onClick={() => openReport(r.id)}
            >
              <span>
                <b>{r.folio}</b> · {r.date ?? "Sin fecha"}
              </span>
              <small>{reportLabel(r)}</small>
            </button>
          ))}
        </Panel>
      )}
    </>
  );
}
export function ReportList(
  { rows, open, respond }: {
    rows: ReportItem[];
    open: (id: string) => void;
    respond?: (id: string) => void;
  },
) {
  const [q, search] = useState(""),
    [state, setState] = useState(""),
    [kind, setKind] = useState("");
  const visible = rows.filter((r) =>
    (!state || state === reportLabel(r)) &&
    (!kind || kind === r.classification) &&
    (r.folio + " " + (r.description ?? "")).toLocaleLowerCase().includes(
      q.trim().toLocaleLowerCase(),
    )
  );
  return (
    <Panel title="Reportes de no calidad">
      <div className={css.filters}>
        <label>
          <Search size={15} />Buscar<input
            type="search"
            placeholder="Folio o descripción"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
        </label>
        <label>
          Estado<select
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Todos</option>
            {Array.from(new Set(rows.map(reportLabel))).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Clasificación<select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Todas</option>
            {["QAC", "Hilo", "Avíos"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {visible.map((r) => (
        <article className={css.record} key={r.id}>
          <div>
            <small>
              {r.date ?? "Sin fecha"} ·{" "}
              {r.classification || "Sin clasificación"}
            </small>
            <h4>{r.folio}</h4>
            <p>{r.description}</p>
            {r.deadline && (
              <small>Vencimiento · {r.deadline.slice(0, 10)}</small>
            )}
            {r.progress && (
              <small>Primer avance · {r.progress.slice(0, 10)}</small>
            )}
          </div>
          <div className={css.controls}>
            <span className={css.badge}>{reportLabel(r)}</span>
            <button onClick={() => open(r.id)}>
              Ver reporte <ChevronRight size={14} />
            </button>
            {respond && (
              <button onClick={() => respond(r.id)}>
                {r.state === "closed"
                  ? "Consultar plan"
                  : "Responder o consultar plan"}
              </button>
            )}
          </div>
        </article>
      ))}
      {!visible.length && <Empty>Sin RNCP para esta selección.</Empty>}
    </Panel>
  );
}
export function ActionList(
  { rows, onOpen }: { rows: ActionItem[]; onOpen: (a: ActionItem) => void },
) {
  const [q, setQ] = useState(""),
    [origin, setOrigin] = useState(""),
    [status, setStatus] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const label = (a: ActionItem) =>
    !a.completed && a.due && a.due < today &&
      !["closed", "accepted"].includes(a.state)
      ? "Vencida"
      : actionLabel(a.state);
  const visible = rows.filter((a) =>
    (!origin || a.origin === origin) && (!status || label(a) === status) &&
    (a.folio + " " + a.description).toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Panel title="Planes de acción">
      <div className={css.filters}>
        <label>
          Buscar<input
            type="search"
            placeholder="Folio o acción"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          Origen<select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            <option value="">Todos</option>
            <option>RNCP</option>
            <option>Auditoría</option>
          </select>
        </label>
        <label>
          Estado<select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            {[...new Set(rows.map(label))].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={css.chips}>
        {[...new Set(rows.map(label))].map((v) => (
          <span key={v}>{v} · {rows.filter((a) => label(a) === v).length}</span>
        ))}
      </div>
      {visible.map((a) => (
        <button
          key={a.origin + a.id}
          className={css.row}
          onClick={() => onOpen(a)}
        >
          <span>
            <small>{a.origin} · {a.folio}</small>
            <b>{a.description}</b>
            <small>
              {a.owner || "Sin responsable registrado"} · Compromiso{" "}
              {a.due || "—"} · Cumplimiento {a.completed || "—"} · Evidencias
              {" "}
              {a.files ?? "—"}
            </small>
          </span>
          <span>
            {label(a)} <ChevronRight size={14} />
          </span>
        </button>
      ))}
      {!visible.length && <Empty>Sin acciones para esta selección.</Empty>}
    </Panel>
  );
}
export function Profile({
  name,
  code,
  category,
  sites,
  contacts,
}: {
  name: string;
  code?: string;
  category?: string;
  sites: string[];
  contacts:
    | { id?: string; name: string; email: string; phone?: string; purpose?: string }[]
    | null;
}) {
  return (
    <>
      <Panel title="Datos del proveedor" aside={<Building2 size={18} />}>
        <dl className={css.stats}>
          {[["Razón social", name], ["Código", code], ["Categoría", category], [
            "Sucursales",
            sites.join(", "),
          ]].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Contactos autorizados">
        {contacts?.map((c) => (
          <article className={css.record} key={c.id ?? c.email}>
            <div>
              <h4>{c.name || "Nombre sin registrar"}</h4>
              <p>{c.purpose}</p>
              <p>{c.email || "Sin correo electrónico"}</p>
              {c.phone && <small>{c.phone}</small>}
            </div>
          </article>
        ))}
        {!contacts?.length && (
          <Empty>
            {contacts
              ? "Sin contactos para este alcance."
              : "Información de contactos no disponible."}
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function SupplierPicker(
  { companies, selected, choose }: {
    companies: { id: string; name: string; code: string; category: string }[];
    selected: string;
    choose: (id: string) => void;
  },
) {
  const [open, setOpen] = useState(false), [q, search] = useState("");
  const current = companies.find((c) => c.id === selected);
  const matches = companies.filter((c) =>
    [c.name, c.code, c.category].join(" ").toLowerCase().includes(
      q.trim().toLowerCase(),
    )
  );
  return (
    <div className={css.picker}>
      <div>
        <ShieldCheck size={19} />
        <strong>Administración de portales</strong>
      </div>
      <button
        className={css.pickButton}
        aria-expanded={open}
        onClick={() => {
          search("");
          setOpen(!open);
        }}
      >
        <Search size={16} />
        {current
          ? current.code + " · " + current.name
          : "Seleccionar proveedor"}
      </button>
      {open && (
        <Dialog
          title="Seleccionar proveedor"
          onClose={() => setOpen(false)}
        >
          <label>
            Buscar proveedor<input
              autoFocus
              type="search"
              placeholder="Nombre, código o categoría"
              value={q}
              onChange={(e) => search(e.target.value)}
            />
          </label>
          <div className={css.options}>
            {matches.map((c) => (
              <button
                className={css.row}
                key={c.id}
                onClick={() => {
                  choose(c.id);
                  setOpen(false);
                }}
              >
                <span>
                  <b>{c.name}</b>
                  <small>{c.code} · {c.category}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
            {!matches.length && <Empty>Sin coincidencias.</Empty>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function OwnProfile({ name }: { name: string }) {
  const [data, setData] = useState<Parameters<typeof Profile>[0] | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/suppliers/portal-access?self=1", {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (r) => {
      if (!r.ok) throw Error();
      const d = await r.json();
      if (!controller.signal.aborted) {
        setData(d);
        setError(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setData(null);
        setError(true);
      }
    });
    return () => controller.abort();
  }, [attempt]);
  return data ? <Profile {...data} /> : error
    ? (
      <p role="alert">
        No se pudo consultar el expediente.{" "}
        <button onClick={() => retry((v) => v + 1)}>Reintentar</button>
      </p>
    )
    : <progress aria-label={"Cargando expediente de " + name} />;
}

export function AuditTrends(
  { rows }: {
    rows: {
      date: string | null;
      method: string | null;
      kind: string | null;
      score: number | null;
    }[];
  },
) {
  const groups = new Map<string, { date: string; score: number }[]>();
  for (const a of rows) {
    if (
      !a.date || !a.method || a.method === "other" || !a.kind ||
      a.score === null
    ) continue;
    const key = a.method + " · " + a.kind;
    groups.set(key, [...(groups.get(key) ?? []), {
      date: a.date,
      score: a.score,
    }]);
  }
  const series = [...groups.entries()].filter(([, points]) =>
    points.length > 1
  );
  if (!series.length) return null;
  return (
    <Panel title="Evolución de calificaciones">
      {series.map(([key, items]) => {
        const points = items.sort((a, b) => a.date.localeCompare(b.date));
        return (
          <figure className={css.trend} key={key}>
            <figcaption>{key}</figcaption>
            <ol>
              {points.map((point, i) => (
                <li key={i}>
                  <time>{point.date}</time>
                  <meter min={0} max={100} value={point.score} />
                  <b>{point.score} %</b>
                </li>
              ))}
            </ol>
          </figure>
        );
      })}
    </Panel>
  );
}

export function ExternalPortalShell(
  { name, signOut, children }: {
    name: string;
    signOut: () => void;
    children: ReactNode;
  },
) {
  return (
    <main className={css.external}>
      <header className={css.masthead}>
        <strong>IntegraQ</strong>
        <span>{name}</span>
        <button className="button button-secondary" onClick={signOut}>
          Cerrar sesión
        </button>
      </header>
      {children}
    </main>
  );
}
