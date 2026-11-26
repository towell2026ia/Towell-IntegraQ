"use client";
import { useState } from "react";
type Attachment = { id: string; name: string; kind: string };
export function SupplierReportFiles({ id }: { id: string }) {
  const [files, setFiles] = useState<Attachment[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function open(file?: Attachment, download = false) {
    setError("");
    setBusy(true);
    try {
      const q = new URLSearchParams({ report: id });
      if (file) {
        q.set("file", file.id);
        if (download) q.set("download", "1");
      }
      const r = await fetch("/api/suppliers/portal-files?" + q, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (!file) setFiles(body.files);
      else {
        const a = document.createElement("a");
        a.href = body.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (download) a.download = file.name;
        a.click();
      }
    } catch {
      setError("No se pudieron abrir los archivos del reporte.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => void open()}
      >
        Consultar fotografías y PDF del RNCP
      </button>
      {files?.map((f) => (
        <p key={f.id}>
          {f.name}{" "}
          <button
            className="button button-secondary"
            onClick={() => void open(f)}
          >
            Ver
          </button>{" "}
          <button
            className="button button-secondary"
            onClick={() => void open(f, true)}
          >
            Descargar
          </button>
        </p>
      ))}
      {files?.length === 0 && <p>Sin archivos publicados.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
