"use client";
import { useEffect, useState } from "react";
import { getRncpEvidenceUrl } from "@/lib/rncp-data";
type Item = {
  file_id: string;
  expediente: string;
  folio: string;
  tipo: string;
  accion: string;
  nombre: string;
  fecha: string | null;
  estado: string;
  origen: string;
};
export function SupplierEvidenceList({
  year,
  revision,
}: {
  year: string;
  revision: number;
}) {
  const [kind, setKind] = useState(""),
    [query, search] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: Item[] } | null>(
      null,
    ),
    [error, fail] = useState(""),
    [attempt, retry] = useState(0);
  const key = new URLSearchParams({
    index: "1",
    kind,
    year,
    query,
    status,
    offset: String(offset),
  }).toString();
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      void fetch("/api/suppliers/portal-evidence?" + key, {
        signal: c.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const b = await r.json();
          if (!c.signal.aborted) {
            fail("");
            setResult({ key, rows: b.items });
          }
        })
        .catch(() => {
          if (!c.signal.aborted) {
            setResult(null);
            fail("No se pudo consultar la lista de evidencias.");
          }
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [key, revision, attempt]);
  async function open(i: Item, download: boolean) {
    try {
      let url: string;
      if (i.origen === "rncp")
        url = (await getRncpEvidenceUrl(i.file_id, download)).signedUrl;
      else {
        const r = await fetch(
          i.origen === "published"
            ? "/api/suppliers/audit-portal/" +
                i.expediente +
                "/files/" +
                i.file_id +
                "?download=" +
                download
            : "/api/suppliers/portal-evidence?" +
                new URLSearchParams({
                  event: i.expediente,
                  file: i.file_id,
                  download: download ? "1" : "0",
                }),
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error();
        const b = await r.json();
        url = b.url ?? b.signedUrl;
      }
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (download) a.download = i.nombre;
      a.click();
    } catch {
      fail("No se pudo abrir el archivo. Comprueba tu acceso.");
    }
  }
  return (
    <section className="portal-record-list">
      <h3>Mis evidencias</h3>
      <div className="rncp-form-grid">
        <label>
          Tipo
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            <option>RNCP</option>
            <option>Auditoría</option>
          </select>
        </label>
        <label>
          Folio o evento
          <input
            value={query}
            maxLength={100}
            onChange={(e) => {
              search(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Revisión
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Todas</option>
            <option value="pending">Pendientes</option>
            <option value="accepted">Aceptadas</option>
            <option value="returned">Devueltas</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              fail("");
              retry(attempt + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      )}
      {result?.key !== key && !error && (
        <progress aria-label="Cargando evidencias" />
      )}
      {result?.key === key && (
        <>
          {result.rows.slice(0, 50).map((i) => (
            <article key={[i.file_id, i.accion].join(":")}>
              <div>
                <strong>{i.nombre}</strong>
                <p>
                  {i.tipo} · {i.folio} · {i.accion}
                </p>
                <small>
                  {i.fecha ?? "Sin fecha de cumplimiento"} ·{" "}
                  {
                    {
                      pending: "Pendiente",
                      accepted: "Aceptada",
                      returned: "Devuelta",
                      published: "Publicada",
                    }[i.estado]
                  }
                </small>
              </div>
              <div>
                <button
                  className="button button-secondary"
                  onClick={() => void open(i, false)}
                >
                  Ver
                </button>{" "}
                <button
                  className="button button-secondary"
                  onClick={() => void open(i, true)}
                >
                  Descargar
                </button>
              </div>
            </article>
          ))}
          {!result.rows.length && (
            <p>Sin evidencias para los filtros seleccionados.</p>
          )}
          {offset > 0 && (
            <button onClick={() => setOffset(offset - 50)}>Anterior</button>
          )}
          {result.rows.length > 50 && (
            <button onClick={() => setOffset(offset + 50)}>Siguiente</button>
          )}
        </>
      )}
    </section>
  );
}
