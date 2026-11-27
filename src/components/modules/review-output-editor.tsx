"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { managementReviewGroups } from "@/lib/management-review-sections";
import {
  classifications,
  commands,
  priorities,
  todayInMexico,
  type Action,
  type Command,
  type Output,
  type OutputContext,
} from "@/lib/review-outputs";
import { references, sendOutput } from "@/lib/review-output-storage";
import { markDirty } from "@/lib/workspace-continuity";
import styles from "./management-review-portal.module.css";

export type EditOutput = {
  command: Command;
  decision?: Output;
  action?: Action;
};
function ReferencePicker({
  year,
  historic,
  initial,
}: {
  year: number;
  historic: boolean;
  initial?: string | null;
}) {
  const [term, setTerm] = useState(""),
    [rows, setRows] = useState<{ id: string; label: string }[]>([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false);
  const [file, setFile] = useState(initial ?? "");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      references(term, historic, year)
        .then((data) => {
          if (active) {
            setRows(data);
            setMessage("");
          }
        })
        .catch(() => {
          if (active) {
            setRows([]);
            setMessage("Referencias no disponibles.");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, historic, year]);
  return (
    <div className={styles.fields}>
      <label>
        Buscar documento
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </label>
      <label>
        {historic ? "Acta original" : "Referencia documental"}
        <select
          name="file"
          value={file}
          required={historic}
          onChange={(e) => setFile(e.target.value)}
        >
          <option value="">Seleccionar documento</option>
          {file && !rows.some((row) => row.id === file) && (
            <option value={file}>Referencia seleccionada</option>
          )}
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      {loading && <progress aria-label="Buscando documentos" />}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

export function OutputEditor({
  edit,
  context,
  year,
  onClose,
  onSaved,
}: {
  edit: EditOutput;
  context: OutputContext;
  year: number;
  onClose: (reload: boolean) => void;
  onSaved: (id: string, year: number) => void;
}) {
  const { command, decision: d, action: a } = edit;
  const [id] = useState(() => d?.id ?? crypto.randomUUID()),
    [actionId] = useState(
      () => a?.id ?? (command === "action" ? crypto.randomUUID() : null),
    );
  const receipt = useRef({ id: crypto.randomUUID(), payload: "" }),
    dirty = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [historic, setHistoric] = useState(false);
  const [origin, setOrigin] = useState(d?.origin_year ?? year),
    [actionable, setActionable] = useState(d?.actionable ?? true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const [review, setReview] = useState("");
  const [percent, setPercent] = useState(a?.progress ?? 0);
  const create = command === "create",
    draft = create || command === "amend";
  useEffect(() => () => markDirty("review:output", false), []);
  function close() {
    if (
      !busy &&
      (!dirty.current || window.confirm("¿Salir sin guardar los cambios?"))
    )
      onClose(error.startsWith("El acuerdo cambió"));
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const detail: Record<string, unknown> = Object.fromEntries(form.entries());
    if (create) Object.assign(detail, { actionable, historic, year: origin });
    if (command === "action") detail.evidence = form.has("evidence");
    const payload = JSON.stringify(detail);
    if (receipt.current.payload !== payload)
      receipt.current = { id: crypto.randomUUID(), payload };
    setBusy(true);
    setError("");
    try {
      await sendOutput(
        receipt.current.id,
        id,
        actionId,
        command,
        d?.revision ?? 0,
        detail,
      );
      dirty.current = false;
      markDirty("review:output", false);
      onSaved(id, origin);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          (cause.message.startsWith("El acuerdo cambió") ||
            cause.message.startsWith("Este acuerdo del acta"))
          ? cause.message
          : "No se confirmó el guardado. Revisa los datos y el estado, o reintenta la misma operación.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="output-editor-title"
      className={`${styles.sheet} ${styles.outputDialog}`}
    >
      <h3 id="output-editor-title">
        {create ? "Registrar acuerdo" : commands[command]}
      </h3>
      <form
        onSubmit={submit}
        onChange={() => {
          dirty.current = true;
          markDirty("review:output", true);
        }}
      >
        <fieldset className={styles.fields} disabled={busy}>
          {create && (
            <>
              <label>
                Año de origen
                <input
                  name="year"
                  type="number"
                  value={origin || ""}
                  min={1900}
                  max={new Date().getFullYear()}
                  required
                  onChange={(e) => {
                    setOrigin(Number(e.target.value));
                    setReview("");
                  }}
                />
              </label>
              <label>
                Fecha del acuerdo
                <input
                  name="date"
                  type="date"
                  required
                  min={origin + "-01-01"}
                  max={
                    origin === new Date().getFullYear()
                      ? todayInMexico()
                      : origin + "-12-31"
                  }
                />
              </label>
            </>
          )}
          {draft && (
            <>
              <label>
                Título
                <input
                  name="title"
                  defaultValue={d?.title}
                  required
                  maxLength={250}
                />
              </label>
              <label>
                Clasificación
                <select
                  name="classification"
                  required
                  defaultValue={d?.classification ?? ""}
                >
                  <option value="">Seleccionar</option>
                  {Object.entries(classifications).map(([key, v]) => (
                    <option key={key} value={key}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Apartado de origen
                <select
                  name="section"
                  required
                  defaultValue={d?.section_id ?? ""}
                >
                  <option value="">Seleccionar</option>
                  {managementReviewGroups
                    .flatMap((g) => g.sections)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Prioridad
                <select name="priority" defaultValue={d?.priority ?? "medium"}>
                  {Object.entries(priorities).map(([key, v]) => (
                    <option key={key} value={key}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Decisión o descripción
                <textarea
                  name="description"
                  required
                  defaultValue={d?.description}
                />
              </label>
              <label>
                Justificación
                <textarea
                  name="justification"
                  defaultValue={d?.justification ?? ""}
                />
              </label>
              <label>
                Recursos requeridos
                <input name="resources" defaultValue={d?.resources ?? ""} />
              </label>
              {create && (
                <>
                  <label>
                    Tipo de decisión
                    <select
                      value={String(actionable)}
                      onChange={(e) => setActionable(e.target.value === "true")}
                    >
                      <option value="true">Requiere ejecución</option>
                      <option value="false">Informativa</option>
                    </select>
                  </label>
                  <label>
                    Informe anual
                    <select
                      name="review"
                      value={review}
                      onChange={(e) => setReview(e.target.value)}
                    >
                      <option value="">Sin informe vinculado</option>
                      {context.reports
                        .filter((r) => r.year === origin)
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  {review && (
                    <label>
                      Registro de origen
                      <select key={review} name="source">
                        <option value="">Sin registro vinculado</option>
                        {context.reports
                          .find((r) => r.id === review)
                          ?.sources.map((s) => (
                            <option value={s.id} key={s.id}>
                              {
                                (
                                  {
                                    indicator: "Indicador",
                                    risk: "Riesgo",
                                    audit: "Auditoría",
                                    corrective_action: "Acción correctiva",
                                    customer: "Cliente",
                                    supplier: "Proveedor",
                                    metrology: "Metrología",
                                    improvement: "Mejora",
                                    document: "Documento",
                                  } as Record<string, string>
                                )[s.type]
                              }{" "}
                              · {s.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Proceso relacionado
                    <select name="process">
                      <option value="">Sin proceso</option>
                      {context.processes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Procedencia
                    <select
                      value={String(historic)}
                      onChange={(e) => setHistoric(e.target.value === "true")}
                    >
                      <option value="false">Revisión del período</option>
                      <option value="true">
                        Decisión documentada en acta histórica
                      </option>
                    </select>
                  </label>
                  {historic && (
                    <label>
                      Acuerdo en el acta (página e inciso)
                      <input name="item" required maxLength={180} />
                    </label>
                  )}
                  <ReferencePicker
                    key={String(historic) + origin}
                    year={origin}
                    historic={historic}
                  />
                </>
              )}
              <label>
                Fecha compromiso
                <input
                  name="due"
                  type="date"
                  required={actionable}
                  defaultValue={d?.due_date ?? ""}
                />
              </label>
            </>
          )}
          {(create ||
            command === "assign" ||
            command === "action" ||
            command === "assign_action") && (
            <label>
              Responsable
              <select
                name="owner"
                required={!create}
                defaultValue={a?.owner_id ?? d?.owner_id ?? ""}
              >
                <option value="">Seleccionar</option>
                {context.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.name, p.position, p.process]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {command === "action" && (
            <>
              <label>
                Actividad
                <textarea name="description" required />
              </label>
              <label>
                Inicio previsto
                <input name="start" type="date" required />
              </label>
              <label>
                Fecha compromiso
                <input name="due" type="date" required />
              </label>
              <label>
                <input type="checkbox" name="evidence" />
                Requiere referencia documental
              </label>
            </>
          )}
          {command === "progress" && (
            <>
              <label>
                Avance (%)
                <input
                  name="progress"
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                />
              </label>
              <label>
                Fecha real de ejecución
                <input
                  name="actual"
                  type="date"
                  max={todayInMexico()}
                  required={percent === 100}
                />
              </label>
              <label>
                Resultado obtenido
                <textarea
                  name="result"
                  required={percent === 100}
                  defaultValue={a?.result ?? ""}
                />
              </label>
              <ReferencePicker
                year={origin}
                historic={false}
                initial={a?.file_id}
              />
            </>
          )}
          {!draft && command !== "action" && (
            <label>
              {command === "close"
                ? "Conclusión validada"
                : command === "authorize" && d?.historic
                  ? "Confirmación de procedencia del acta"
                  : "Motivo u observaciones"}
              <textarea
                name="note"
                required={
                  command !== "submit" &&
                  (command !== "authorize" || d?.historic)
                }
              />
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <div className={styles.recordTools}>
            <button className="button button-primary" type="submit">
              {busy ? "Guardando…" : "Confirmar"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={close}
            >
              Cancelar
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
