"use client";

import { useEffect, useState } from "react";
import type { ControlledDocument, ControlledDocumentVersion } from "@/lib/document-control-data";
import { getControlledDocumentDownloadUrl } from "@/lib/document-storage";
import { findInstitutionalImages } from "@/lib/home-institutional-images";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import styles from "./home-institutional-images.module.css";

export function HomeInstitutionalImages({ documents, session, onManage }: {
  documents: ControlledDocument[]; session: ActiveSession; onManage: (id: string) => void;
}) {
  return <section aria-label="Imágenes institucionales" className={styles.grid}>
    {findInstitutionalImages(documents, session).map(slot => <article key={slot.title} className={styles.card}>
      <h3>{slot.title}</h3>
      {slot.version ? <InstitutionalImage key={slot.version.id} version={slot.version} title={slot.title} /> : <p>{slot.ambiguous ? "Hay más de un documento candidato. Requiere revisión administrativa." : "Sin imagen vigente disponible en tu alcance autorizado."}</p>}
      {isAdministrator(session) && slot.document ? <button type="button" onClick={() => onManage(slot.document!.id)}>Actualizar / consultar versiones</button> : null}
    </article>)}
  </section>;
}
function InstitutionalImage({ version, title }: { version: ControlledDocumentVersion; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getControlledDocumentDownloadUrl(version).then(value => {
      if (!value) throw new Error("No se encontró una referencia al archivo original.");
      if (!cancelled) { setUrl(value); setError(""); }
    }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No fue posible consultar la imagen."); });
    return () => { cancelled = true; };
  }, [version, retry]);
  async function openFullSize() {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const freshUrl = await getControlledDocumentDownloadUrl(version);
      if (!freshUrl) throw new Error("No se encontró el archivo original.");
      if (tab) tab.location.replace(freshUrl);
      else throw new Error("Permite abrir ventanas para consultar la imagen completa.");
    } catch (cause) { tab?.close(); setError(cause instanceof Error ? cause.message : "No fue posible abrir la imagen."); }
  }
  return <>
    <small>Revisión {version.revision} · {version.status === "current" ? "Vigente" : "Pendiente de validación · vista administrativa"}</small>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Reintentar</button></div> : url ? <button type="button" className={styles.image} onClick={() => void openFullSize()} aria-label={`Ver completa: ${title}`}>
      {/* The original is private and has a short-lived signed URL; do not proxy through Next Image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={title} onError={() => setError("No fue posible visualizar el archivo original.")} />
    </button> : <p role="status">Cargando imagen…</p>}
  </>;
}