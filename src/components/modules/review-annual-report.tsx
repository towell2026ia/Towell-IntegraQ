"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Printer, Sparkles } from "lucide-react";
import {
  availability,
  blocksGeneration,
  renderNarrative,
  type Report,
  type Snapshot,
} from "@/lib/review-report";
import styles from "./management-review-portal.module.css";

type Run = {
  id: string;
  state: string;
  revision: number | null;
  started_at: string;
};
type Event = {
  sequence: number;
  command: string;
  stage: string;
  actor: string;
  position_name: string;
  created_at: string;
  reason: string;
  conclusion: string;
  content_hash: string;
  proposal: string | null;
  decision_id: string | null;
};
type Detail = Run & {
  year: number;
  snapshot: Snapshot;
  snapshot_hash: string;
  model: string;
  instructions: string;
  report: Report | null;
  review_report_events: Event[];
};
const status: Record<string, string> = {
  processing: "En proceso",
  completed: "Generado",
  failed: "Generación fallida",
  uncertain: "Pendiente de conciliación",
  draft: "Borrador",
  validation: "En validación de SGC",
  direction: "Pendiente de autorización de Dirección",
  authorized: "Autorizado",
};
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/ai/management-review" + path, {
    cache: "no-store",
    signal,
    ...(body
      ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
      : {}),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => null);
    throw Error(e?.error ?? "No se pudo consultar el expediente.");
  }
  return response.json();
}
export function AnnualReviewReport(
  { year, administrator }: { year: number; administrator: boolean },
) {
  const [open, setOpen] = useState(false),
    [refresh, setRefresh] = useState(0),
    [id, setId] = useState("");
  const [catalog, setCatalog] = useState<
    { runs: Run[]; enabled: boolean; admin: boolean; director: boolean } | null
  >(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false),
    [reason, setReason] = useState(""),
    [conclusion, setConclusion] = useState("");
  const operation = useRef<string | null>(null), locked = useRef(false);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const read = async () => {
      setLoading(true);
      setError("");
      setAccepted(false);
      operation.current = null;
      setCatalog(null);
      setSnapshot(null);
      setDetail(null);
      const base = "?year=" + year;
      const reads = await Promise.allSettled([
        request<NonNullable<typeof catalog>>(base, undefined, abort.signal),
        administrator
          ? request<Snapshot>(base + "&view=sources", undefined, abort.signal)
          : Promise.resolve(null),
        id
          ? request<Detail>(
            base + "&id=" + encodeURIComponent(id),
            undefined,
            abort.signal,
          )
          : Promise.resolve(null),
      ]);
      if (abort.signal.aborted) return;
      const [c, s, d] = reads;
      if (c.status === "fulfilled") setCatalog(c.value);
      if (s.status === "fulfilled") setSnapshot(s.value);
      if (d.status === "fulfilled") {
        setDetail(d.value);
        const events = d.value?.review_report_events ?? [];
        setConclusion(
          [...events].sort((a, b) => b.sequence - a.sequence)[0]?.conclusion ??
            "",
        );
      }
      const failed = reads.find((x) => x.status === "rejected");
      if (failed?.status === "rejected") setError(failed.reason.message);
      setLoading(false);
    };
    void read();
    return () => abort.abort();
  }, [open, id, year, administrator, refresh]);
  const events = [...(detail?.review_report_events ?? [])].sort((a, b) =>
      b.sequence - a.sequence
    ),
    latest = events[0],
    stage = latest?.stage ?? "draft";
  const limited = snapshot?.sources.some((s) => s.status !== "available");
  const canGenerate = catalog?.enabled && !!snapshot &&
    !snapshot.sources.some(blocksGeneration) && (!limited || accepted);
  async function send(command: string, proposal?: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const body = command === "generate"
        ? {
          year,
          command,
          accepted,
          fingerprint: snapshot?.fingerprint,
          operation: operation.current ??= crypto.randomUUID(),
        }
        : {
          year,
          command,
          operation: crypto.randomUUID(),
          run: id,
          expected: latest?.sequence ?? 0,
          reason,
          text: command === "edit" ? conclusion : undefined,
          proposal,
        };
      const res = await request<{ id?: string }>("", body);
      operation.current = null;
      if (res.id) setId(res.id);
      setReason("");
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se confirmó la operación.");
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <section aria-label="Informe anual" className={styles.annual}>
      <div className={styles.annualActions}>
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <FileText size={16} />
          {open ? "Ocultar expediente anual" : "Consultar expediente anual"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={!open || !canGenerate || busy || loading}
          onClick={() => void send("generate")}
        >
          <Sparkles size={16} />Generar Revisión por la Dirección
        </button>
        {!catalog?.enabled && (
          <small>Generación pendiente de configuración autorizada.</small>
        )}
      </div>
      {open && (
        <>
          <h3>Expediente anual · {year}</h3>
          {loading && <progress aria-label="Consultando el expediente" />}
          {error && (
            <p role="alert">
              {error}{" "}
              <button type="button" onClick={() => setRefresh((x) => x + 1)}>
                Reintentar consulta
              </button>
            </p>
          )}
          {snapshot && (
            <details open={!detail}>
              <summary>Fuentes del período</summary>
              <p>
                Corte institucional ·{" "}
                {new Date(snapshot.cutoff).toLocaleString("es-MX", {
                  timeZone: "America/Mexico_City",
                })}
              </p>
              <div className={styles.sourceList}>
                {snapshot.sources.map((s) => (
                  <details key={s.id}>
                    <summary>{s.label} · {availability[s.status]}</summary>
                    <p>{s.period}. {s.note}</p>
                    {s.metrics.map((m) => (
                      <p key={m.id}>
                        {m.label} ·{" "}
                        {m.value === null
                          ? "—"
                          : new Intl.NumberFormat("es-MX", {
                            maximumFractionDigits: 2,
                          }).format(m.value) + " " + m.unit}{" "}
                        <small>{m.rule}</small>
                      </p>
                    ))}
                  </details>
                ))}
              </div>
              {limited && catalog?.enabled && (
                <label>
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />Acepto las limitaciones de estas fuentes para este borrador.
                </label>
              )}
            </details>
          )}
          {catalog && (
            <>
              <h4>Versiones y operaciones</h4>
              {catalog.runs.length === 0
                ? <p>Sin informes centrales para este período.</p>
                : catalog.runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setId(r.id)}
                    className="button button-secondary"
                  >
                    {r.revision ? "Versión " + r.revision : "Solicitud"} ·{" "}
                    {status[r.state]} ·{" "}
                    {new Date(r.started_at).toLocaleDateString("es-MX")}
                  </button>
                ))}
            </>
          )}
          {detail?.report && (
            <article className={styles.printReport}>
              <header>
                <small>IntegraQ</small>
                <h3>Revisión por la Dirección · {year}</h3>
                <p>
                  {detail.snapshot.organizationName ||
                    detail.snapshot.organization} · Versión {detail.revision} ·
                  {" "}
                  {stage === "draft" || stage === "authorized"
                    ? status[stage]
                    : "Borrador · " + status[stage]}
                </p>
                <p>Corte · {detail.snapshot.cutoff}</p>
                <button
                  className="button button-secondary print-hidden"
                  onClick={() => window.print()}
                >
                  <Printer size={16} />Imprimir o guardar PDF
                </button>
              </header>
              {snapshot &&
                snapshot.fingerprint !== detail.snapshot.fingerprint && (
                <p>
                  Las fuentes actuales difieren de la fotografía de este
                  informe.
                </p>
              )}
              <nav aria-label="Apartados del informe">
                {detail.report.sections.map((s, i) => (
                  <button
                    className="button button-secondary"
                    key={s.title}
                    onClick={() =>
                      document.getElementById("review-section-" + i)
                        ?.scrollIntoView()}
                  >
                    {s.title}
                  </button>
                ))}
              </nav>
              {detail.report.sections.map((s, i) => (
                <section id={"review-section-" + i} key={s.title}>
                  <h4>{s.title}</h4>
                  <p>{renderNarrative(s.text, detail.snapshot)}</p>
                  <small>{s.references.join(" · ")}</small>
                </section>
              ))}
              {detail.report.findings.map((f) => (
                <p key={f.id}>
                  <strong>{f.id} · {f.kind} · {f.priority}</strong>{" "}
                  {renderNarrative(f.text, detail.snapshot)}{" "}
                  {renderNarrative(f.justification, detail.snapshot)}{" "}
                  <small>{f.references.join(" · ")}</small>
                </p>
              ))}
              {([
                "risks",
                "recommendations",
                "limitations",
                "warnings",
              ] as const).map((k, i) =>
                detail.report![k].length > 0 && (
                  <section key={k}>
                    <h4>
                      {[
                        "Riesgos",
                        "Recomendaciones",
                        "Limitaciones",
                        "Advertencias",
                      ][i]}
                    </h4>
                    {detail.report![k].map((x, j) => (
                      <p key={j}>{renderNarrative(x, detail.snapshot)}</p>
                    ))}
                  </section>
                )
              )}
              <h4>Conclusión de la revisión humana</h4>
              <p>{latest?.conclusion || "Sin observaciones registradas."}</p>
              <details>
                <summary>Fotografía y referencias de origen</summary>
                <p>
                  Huella de la fotografía ·{" "}
                  <small>{detail.snapshot_hash}</small>
                </p>
                <p>
                  Modelo · {detail.model} · Instrucciones {detail.instructions}
                </p>
                {detail.snapshot.sources.map((s) => (
                  <section key={s.id}>
                    <h4>{s.label} · {availability[s.status]}</h4>
                    <p>{s.period} {s.note}</p>
                    {s.metrics.map((m) => (
                      <p key={m.id}>
                        {m.label} · {m.value ?? "—"} {m.unit} · {m.rule}
                      </p>
                    ))}
                    {s.evidence?.map((item) => (
                      <p key={item.id}>
                        {item.label} · {item.date} · {item.status} {item.value}
                        {" "}
                        {item.unit} <small>{item.id}</small>
                      </p>
                    ))}
                    <small>{s.records.join(" · ")}</small>
                  </section>
                ))}
              </details>
              <h4>Historial y aprobaciones</h4>
              {events.map((e) => (
                <p key={e.sequence}>
                  {new Date(e.created_at).toLocaleString("es-MX")} ·{" "}
                  {e.position_name} · {e.actor} · {status[e.stage]} · {e.reason}
                </p>
              ))}
              <div className="print-hidden">
                <label>
                  Motivo u observaciones{" "}
                  <input
                    value={reason}
                    maxLength={3000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {stage === "draft" && catalog?.admin && (
                  <>
                    <label>
                      Conclusión revisada{" "}
                      <textarea
                        value={conclusion}
                        onChange={(e) => setConclusion(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !reason.trim() || !conclusion.trim()}
                      onClick={() => void send("edit")}
                    >
                      Guardar conclusión
                    </button>
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() => void send("submit")}
                    >
                      Solicitar validación
                    </button>
                  </>
                )}
                {((stage === "validation" && catalog?.admin) ||
                  (stage === "direction" && catalog?.director)) && (
                  <>
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() =>
                        void send(
                          stage === "validation" ? "validate" : "authorize",
                        )}
                    >
                      {stage === "validation"
                        ? "Validar como SGC"
                        : "Autorizar como Dirección"}
                    </button>
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() => void send("return")}
                    >
                      Devolver a borrador
                    </button>
                  </>
                )}
              </div>
              {detail.report.proposals.map((p) => (
                <section key={p.id}>
                  <h4>
                    Propuesta · {renderNarrative(p.title, detail.snapshot)}
                  </h4>
                  <p>
                    {renderNarrative(p.description, detail.snapshot)} ·{" "}
                    {p.finding}
                  </p>
                  {events.some((e) => e.proposal === p.id)
                    ? <small>Borrador de acuerdo registrado</small>
                    : catalog?.admin && (
                      <button
                        className="print-hidden"
                        disabled={busy || !reason.trim()}
                        onClick={() => void send("proposal", p.id)}
                      >
                        Convertir en borrador de acuerdo
                      </button>
                    )}
                </section>
              ))}
            </article>
          )}
        </>
      )}
    </section>
  );
}
