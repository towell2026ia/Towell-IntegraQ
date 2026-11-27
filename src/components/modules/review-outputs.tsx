"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import {
  authorization,
  classifications,
  cohort,
  commands,
  execution,
  late,
  localDate,
  meanProgress,
  outputMetrics,
  priorities,
  todayInMexico,
  type Action,
  type Command,
  type Metric,
  type Output,
  type OutputContext,
} from "@/lib/review-outputs";
import {
  listOutputs,
  openOutputFile,
  outputContext,
  outputDetail,
} from "@/lib/review-output-storage";
import { managementReviewGroups } from "@/lib/management-review-sections";
import { OutputEditor, type EditOutput } from "./review-output-editor";
import css from "./management-review-portal.module.css";
const metricLabels = {
  authorized: "Acuerdos autorizados",
  working: "En proceso",
  closed: "Concluidos y validados",
  overdue: "Vencidos",
  previous: "Pendientes de años anteriores",
  received: "Cumplimiento",
};
const sectionNames = new Map(
  managementReviewGroups.flatMap((g) => g.sections).map((s) => [s.id, s.title]),
);
function Filter({
  label,
  options,
  value,
  change,
}: {
  label: string;
  options: Record<string, string>;
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => change(e.target.value)}>
        <option value="">Todos</option>
        {Object.entries(options).map(([k, v]) => (
          <option value={k} key={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
export function OutputFile({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => {
          setFailed(false);
          void openOutputFile(id).catch(() => setFailed(true));
        }}
      >
        <FileText size={14} />
        Consultar referencia
      </button>
      {failed && (
        <small role="alert">Documento no disponible para esta sesión.</small>
      )}
    </>
  );
}
export function ReviewOutputs({
  year,
  onYearsChanged,
}: {
  year: number;
  onYearsChanged: (year: number) => void;
}) {
  const [page, setPage] = useState<{ rows: Output[]; ctx: OutputContext }>(),
    [rev, setRev] = useState(0),
    [error, setError] = useState(false);
  const [filter, setFilter] = useState({
      classification: "",
      state: "",
      owner: "",
      priority: "",
      due: "",
    }),
    [metric, setMetric] = useState<Metric>("all");
  const [selected, setSelected] = useState(""),
    [edit, setEdit] = useState<EditOutput>();
  const today = todayInMexico();
  useEffect(() => {
    let active = true;
    Promise.all([listOutputs(year), outputContext()])
      .then(([rows, ctx]) => {
        if (active) setPage({ rows, ctx });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [year, rev]);
  function refresh() {
    setPage(undefined);
    setError(false);
    setRev((n) => n + 1);
  }
  if (error)
    return (
      <p role="alert">
        Los acuerdos no están disponibles.{" "}
        <button className="button button-secondary" onClick={refresh}>
          Reintentar
        </button>
      </p>
    );
  if (!page) return <progress aria-label="Cargando acuerdos" />;
  const { rows, ctx } = page;
  const d = rows.find((r) => r.id === selected);
  const matching = rows.filter(
    (r) =>
      (!filter.classification || r.classification === filter.classification) &&
      (!filter.state ||
        filter.state === r.auth_state ||
        filter.state === "exec:" + r.execution) &&
      (!filter.owner || r.owner_id === filter.owner) &&
      (!filter.priority || r.priority === filter.priority) &&
      (!filter.due || r.due_date === filter.due),
  );
  const metrics = outputMetrics(matching, year, today);
  const list = cohort(matching, year, metric, today);
  const owners = Object.fromEntries(
    rows
      .filter((d) => d.owner_id)
      .map((d) => [d.owner_id!, d.owner_name ?? "Responsable registrado"]),
  );
  const stateOptions = {
    ...authorization,
    ...Object.fromEntries(
      Object.entries(execution).map(([k, v]) => [
        "exec:" + k,
        v + " · ejecución",
      ]),
    ),
  };
  const update = (field: keyof typeof filter) => (s: string) =>
    setFilter((v) => ({ ...v, [field]: s }));
  return (
    <section className={css.records} aria-label="Acuerdos de Dirección">
      {d ? (
        <>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setSelected("")}
          >
            <ArrowLeft size={14} />
            Listado de acuerdos
          </button>
          <DecisionDetail
            key={d.id + ":" + d.revision}
            d={d}
            ctx={ctx}
            edit={setEdit}
          />
        </>
      ) : (
        <>
          <div className={css.metrics}>
            {(Object.keys(metricLabels) as (keyof typeof metricLabels)[]).map(
              (k) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={metric === k}
                  onClick={() => setMetric(metric === k ? "all" : k)}
                >
                  <span>{metricLabels[k]}</span>
                  <strong
                    aria-label={
                      k === "received" && metrics[k] === null
                        ? "Sin acuerdos evaluables"
                        : undefined
                    }
                  >
                    {metrics[k] === null
                      ? "—"
                      : metrics[k] + (k === "received" ? " %" : "")}
                  </strong>
                </button>
              ),
            )}
          </div>
          <div className={css.recordTools}>
            <h3>
              {metric === "previous"
                ? "Acuerdos pendientes de revisiones anteriores"
                : metric === "completedYear"
                  ? "Concluidos durante el período"
                  : "Acuerdos del período"}
            </h3>
            {ctx.admin && (
              <button
                className="button button-primary"
                onClick={() => setEdit({ command: "create" })}
              >
                <Plus size={14} />
                Registrar acuerdo
              </button>
            )}
          </div>
          <div className={css.fields}>
            <Filter
              label="Clasificación"
              options={classifications}
              value={filter.classification}
              change={update("classification")}
            />
            <Filter
              label="Estado"
              options={stateOptions}
              value={filter.state}
              change={update("state")}
            />
            <Filter
              label="Responsable"
              options={owners}
              value={filter.owner}
              change={update("owner")}
            />
            <Filter
              label="Prioridad"
              options={priorities}
              value={filter.priority}
              change={update("priority")}
            />
            <label>
              Fecha compromiso
              <input
                type="date"
                value={filter.due}
                onChange={(e) => update("due")(e.target.value)}
              />
            </label>
            <label>
              Consulta
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                <option value="all">Todos del año de origen</option>
                {Object.entries(metricLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k === "received" ? "Numerador de cumplimiento" : v}
                  </option>
                ))}
                <option value="completedYear">
                  Concluidos durante el período
                </option>
              </select>
            </label>
          </div>
          <small>
            Cumplimiento de acuerdos con fecha compromiso dentro del plazo ·{" "}
            {metrics.onTime === null ? (
              <span aria-label="Sin acuerdos autorizados con fecha compromiso">
                —
              </span>
            ) : (
              metrics.onTime + " %"
            )}
          </small>
          {list.length === 0 ? (
            <p>No hay acuerdos para esta selección.</p>
          ) : (
            list.map((r) => (
              <article key={r.id} className={css.record}>
                <div>
                  <small>
                    {r.folio} · {priorities[r.priority]}
                  </small>
                  <h4>{r.title}</h4>
                  <p>
                    {classifications[r.classification]} ·{" "}
                    {r.owner_name ?? "Sin asignar"}
                  </p>
                </div>
                <div>
                  <span>
                    {authorization[r.auth_state]}
                    {r.auth_state === "authorized" &&
                      ` · ${execution[r.execution]}`}
                    {r.auth_state === "authorized" &&
                    late(r.due_date, r.execution, today)
                      ? " · Vencido"
                      : ""}
                  </span>
                  <p>{r.due_date ?? "Sin fecha compromiso"}</p>
                  <button
                    className="button button-secondary"
                    onClick={() => setSelected(r.id)}
                  >
                    Ver acuerdo
                  </button>
                </div>
              </article>
            ))
          )}
        </>
      )}
      {edit && (
        <OutputEditor
          edit={edit}
          context={ctx}
          year={year}
          onClose={(reload) => {
            setEdit(undefined);
            if (reload) refresh();
          }}
          onSaved={(id, y) => {
            setEdit(undefined);
            setSelected(id);
            refresh();
            onYearsChanged(y);
          }}
        />
      )}
    </section>
  );
}

function DecisionDetail({
  d,
  ctx,
  edit,
}: {
  d: Output;
  ctx: OutputContext;
  edit: (e: EditOutput) => void;
}) {
  const [detail, setDetail] =
      useState<Awaited<ReturnType<typeof outputDetail>>>(),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    outputDetail(d.id)
      .then((x) => {
        if (active) setDetail(x);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [d.id, attempt]);
  const control = (cmd: Command, a?: Action) => (
    <button
      type="button"
      key={cmd}
      className="button button-secondary"
      onClick={() => edit({ command: cmd, decision: d, action: a })}
    >
      {commands[cmd]}
    </button>
  );
  const authorized = d.auth_state === "authorized",
    ongoing = authorized && d.execution !== "completed",
    validator = ctx.admin || ctx.director;
  const full = validator || d.owner_id === ctx.actor;
  return (
    <>
      <article className={css.record}>
        <div>
          <small>
            {d.folio} · {d.agreement_date} · {classifications[d.classification]}
          </small>
          <h3>{d.title}</h3>
          <p>{d.description}</p>
          <p>
            {sectionNames.get(d.section_id)} · {priorities[d.priority]} ·{" "}
            {d.actionable ? "Requiere ejecución" : "Decisión informativa"}
          </p>
          <p>
            {d.owner_name ?? "Sin asignar"} ·{" "}
            {d.due_date ?? "Sin fecha compromiso"}
          </p>
          {d.process_id && <p>Proceso {d.process_id}</p>}
          {d.justification && <p>Justificación · {d.justification}</p>}
          {d.resources && <p>Recursos · {d.resources}</p>}
          {d.historic && (
            <p>Decisión documentada en acta histórica · {d.historic_item}</p>
          )}
          {d.evidence_file_id && <OutputFile id={d.evidence_file_id} />}
          {d.source_link_id && <p>Registro de origen · {d.source_link_id}</p>}
          {d.review_id && (
            <p>
              Informe vinculado ·{" "}
              {ctx.reports.find((r) => r.id === d.review_id)?.label ??
                `Revisión de ${d.origin_year}`}
            </p>
          )}
        </div>
        <div>
          <strong>
            {authorization[d.auth_state]}
            {d.auth_state === "authorized" && ` · ${execution[d.execution]}`}
          </strong>
          {ongoing && late(d.due_date, d.execution, todayInMexico()) && (
            <p>Vencido</p>
          )}
          {d.resolution && <p>Última conclusión · {d.resolution}</p>}
          {d.completed_at && (
            <p>
              Cierre · {localDate(d.completed_at)}
              {d.due_date
                ? localDate(d.completed_at) <= d.due_date
                  ? " · Dentro del plazo"
                  : " · Fuera de plazo"
                : ""}
            </p>
          )}
        </div>
      </article>
      <div className={css.recordTools}>
        {ctx.admin && d.auth_state === "draft" && (
          <>
            {control("amend")}
            {control("submit")}
          </>
        )}
        {ctx.director && d.auth_state === "review" && (
          <>
            {control("authorize")}
            {control("return")}
          </>
        )}
        {ctx.admin &&
          d.auth_state !== "cancelled" &&
          d.execution !== "completed" && (
            <>
              {control("assign")}
              {control("cancel")}
            </>
          )}
        {validator && d.execution === "completed" && control("reopen")}
        {validator && ongoing && control("close")}
      </div>
      {failed ? (
        <p role="alert">
          El plan y su historial no están disponibles.{" "}
          <button
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      ) : !detail ? (
        <progress aria-label="Cargando plan e historial" />
      ) : (
        <>
          <div className={css.recordTools}>
            <h3>Plan de acción</h3>
            <span>
              {full ? "Avance del acuerdo" : "Avance de mis acciones"} ·{" "}
              {meanProgress(detail.actions) === null
                ? "—"
                : meanProgress(detail.actions) + " %"}
            </span>
            {ctx.admin &&
              d.actionable &&
              (d.auth_state === "draft" || ongoing) &&
              control("action")}
          </div>
          {!detail.actions.length && <p>No hay acciones disponibles.</p>}
          {detail.actions.map((a) => (
            <article className={css.record} key={a.id}>
              <div>
                <h4>{a.description}</h4>
                <p>
                  {a.owner_name} · {a.starts} a {a.due}
                </p>
                <p>
                  {execution[a.state]}
                  {ongoing && late(a.due, a.state, todayInMexico())
                    ? " · Vencido"
                    : ""}{" "}
                  · {a.progress} %
                </p>
                {a.actual && <p>Ejecución · {a.actual}</p>}
                {a.result && <p>{a.result}</p>}
                {a.file_id && <OutputFile id={a.file_id} />}
              </div>
              <div className={css.recordTools}>
                {ongoing &&
                  (ctx.admin || (ctx.update && a.owner_id === ctx.actor)) &&
                  ["pending", "in_progress"].includes(a.state) &&
                  control("progress", a)}
                {ctx.admin &&
                  ["draft", "authorized"].includes(d.auth_state) &&
                  d.execution !== "completed" &&
                  a.state !== "completed" &&
                  a.state !== "cancelled" && (
                    <>
                      {control("assign_action", a)}
                      {control("cancel_action", a)}
                    </>
                  )}
                {ongoing &&
                  validator &&
                  a.state === "review" &&
                  control("validate_action", a)}
                {ongoing &&
                  validator &&
                  ["review", "completed"].includes(a.state) &&
                  control("reopen_action", a)}
              </div>
            </article>
          ))}
          <h3>Historial</h3>
          {detail.events.map((e) => (
            <article key={e.operation_id} className={css.record}>
              <div>
                <strong>{commands[e.command]}</strong>
                <p>
                  {new Date(e.occurred_at).toLocaleString("es-MX")} ·{" "}
                  {e.actor_name ?? e.actor}
                </p>
                {e.action_id && (
                  <p>
                    {
                      detail.actions.find((a) => a.id === e.action_id)
                        ?.description
                    }
                  </p>
                )}
                {typeof e.detail.owner === "string" && e.detail.owner && (
                  <p>
                    Responsable asignado · {e.assignee_name ?? e.detail.owner}
                  </p>
                )}
                {e.detail.progress != null && <p>{e.detail.progress} %</p>}
                {e.detail.note && <p>{e.detail.note}</p>}
                {e.detail.result && <p>{e.detail.result}</p>}
                {typeof e.detail.file === "string" && e.detail.file && (
                  <OutputFile id={e.detail.file} />
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </>
  );
}
