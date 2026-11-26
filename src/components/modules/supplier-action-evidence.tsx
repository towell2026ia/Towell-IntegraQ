"use client";
import { useEffect, useState } from "react";
type Action = { id: string; description: string };
type Item = {
  id: string;
  name: string;
  date: string;
  action: string;
  status: string;
  note: string;
};
const url = "/api/suppliers/portal-evidence";
async function checked<T>(r: Response): Promise<T> {
  if (!r.ok)
    throw new Error(
      "No se pudo completar la operación. Actualiza el expediente y comprueba tu acceso.",
    );
  return r.json();
}
export function SupplierActionEvidence({
  event,
  actions,
  review = false,
  onChange,
}: {
  event: string;
  actions: Action[];
  review?: boolean;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Item[] | null>(null),
    [refresh, reload] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    fetch(url + "?event=" + encodeURIComponent(event), {
      signal: c.signal,
      cache: "no-store",
    })
      .then((r) => checked<{ items: Item[] }>(r))
      .then((b) => {
        if (!c.signal.aborted) setRows(b.items);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("No se pudieron consultar las evidencias.");
      });
    return () => c.abort();
  }, [event, open, refresh]);
  async function operation(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChange?.();
      reload((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function file(item: Item, download: boolean) {
    try {
      const r = await checked<{ url: string }>(
        await fetch(
          url +
            "?" +
            new URLSearchParams({
              event,
              file: item.id,
              download: download ? "1" : "0",
            }),
          { cache: "no-store" },
        ),
      );
      const a = document.createElement("a");
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (download) a.download = item.name;
      a.click();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section>
      <button
        className="button button-secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Evidencias de la auditoría
      </button>
      {open && (
        <>
          <label>
            Estado de revisión{" "}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="pending">Pendientes</option>
              <option value="accepted">Aceptadas</option>
              <option value="returned">Devueltas</option>
            </select>
          </label>
          {!rows && !error && <progress aria-label="Cargando evidencias" />}
          {rows
            ?.filter((i) => !filter || i.status === filter)
            .map((i) => (
              <article key={i.id}>
                <strong>{i.name}</strong>
                <p>
                  {actions.find((a) => a.id === i.action)?.description} ·{" "}
                  {i.date} ·{" "}
                  {
                    {
                      pending: "Pendiente",
                      accepted: "Aceptada",
                      returned: "Devuelta",
                    }[i.status]
                  }{" "}
                  {i.note}
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => void file(i, false)}
                >
                  Ver
                </button>{" "}
                <button
                  className="button button-secondary"
                  onClick={() => void file(i, true)}
                >
                  Descargar
                </button>
                {review && i.status === "pending" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void operation(async () => {
                        await checked(
                          await fetch(url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              file: i.id,
                              decision: f.get("decision"),
                              note: f.get("note"),
                            }),
                          }),
                        );
                      });
                    }}
                  >
                    <label>
                      Decisión
                      <select name="decision">
                        <option value="accepted">Aceptar cumplimiento</option>
                        <option value="returned">
                          Devolver para corrección
                        </option>
                      </select>
                    </label>
                    <label>
                      Observaciones para el proveedor
                      <input name="note" maxLength={2000} />
                    </label>
                    <button className="button button-secondary" disabled={busy}>
                      Confirmar revisión
                    </button>
                  </form>
                )}
              </article>
            ))}
          {rows && !rows.some((i) => !filter || i.status === filter) && (
            <p>Sin evidencias para esta selección.</p>
          )}
          {!review && actions.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const el = e.currentTarget;
                const f = new FormData(el);
                void operation(async () => {
                  for (const entry of f.getAll("files")) {
                    if (!(entry instanceof File) || !entry.size)
                      throw new Error("Selecciona un archivo.");
                    const upload = new FormData();
                    for (const field of ["action", "date"])
                      upload.set(field, String(f.get(field)));
                    upload.set("event", event);
                    upload.set("file", entry);
                    await checked(
                      await fetch(url, { method: "POST", body: upload }),
                    );
                  }
                  el.reset();
                });
              }}
            >
              <div className="rncp-form-grid">
                <label>
                  Acción
                  <select name="action" required>
                    <option value="">Seleccionar acción</option>
                    {actions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.description}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha de cumplimiento
                  <input name="date" type="date" required />
                </label>
                <label className="button button-secondary file-button">
                  Seleccionar evidencias
                  <input
                    name="files"
                    type="file"
                    multiple
                    required
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx"
                  />
                </label>
              </div>
              <button className="button button-primary" disabled={busy}>
                Guardar evidencias
              </button>
            </form>
          )}
          {error && (
            <p role="alert">
              {error}{" "}
              <button
                onClick={() => {
                  setError("");
                  reload((v) => v + 1);
                }}
              >
                Reintentar consulta
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
