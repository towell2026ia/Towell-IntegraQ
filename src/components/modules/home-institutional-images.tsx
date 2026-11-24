"use client";

import { useEffect, useState } from "react";
import type { ControlledDocument, ControlledDocumentVersion } from "@/lib/document-control-data";
import { getControlledDocumentDownloadUrl } from "@/lib/document-storage";
import { findInstitutionalImages } from "@/lib/home-institutional-images";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import styles from "./home-institutional-images.module.css";
import { sessionAccessKey } from "@/lib/workspace-continuity";
import { getHomeImageUrl } from "@/lib/use-home-process-data";

type ImageBundle = { key: string; documents: ControlledDocument[]; urls: Record<string, string>; error?: boolean };
const bundles = new WeakMap<ActiveSession, { bundle: ImageBundle; until: number }>();
export function clearHomeImages(session: ActiveSession) {
  bundles.delete(session);
}

export function HomeInstitutionalImages({ documents, session, onManage, institutionalRead = false }: {
  documents: ControlledDocument[]; session: ActiveSession; onManage: (id: string) => void; institutionalRead?: boolean;
}) {
  const key = sessionAccessKey(session);
  const [bundle, setBundle] = useState<ImageBundle | null>(null);
  useEffect(() => {
    if (!institutionalRead) return;
    const controller = new AbortController();
    void (async () => {
      const cached = bundles.get(session);
      if (cached?.bundle.key === key && cached.until > Date.now()) return cached.bundle;
      const response = await fetch("/api/home/process-dashboard?view=images", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Imágenes institucionales no disponibles.");
      const payload = await response.json();
      const result = { key, documents: payload.imageDocuments, urls: payload.imageUrls };
      if (!controller.signal.aborted) bundles.set(session, { bundle: result, until: Date.now() + 60_000 });
      return result;
    })().then(result => { if (!controller.signal.aborted) setBundle(result); }).catch(() => { if (!controller.signal.aborted) setBundle({ key, documents: [], urls: {}, error: true }); });
    return () => controller.abort();
  }, [key, institutionalRead, session]);
  const current = bundle?.key === key ? bundle : null;
  return <section aria-label="Imágenes institucionales" className={styles.grid}>
    {findInstitutionalImages(institutionalRead ? current?.documents ?? [] : documents, session, institutionalRead).map((slot, position) => <article key={slot.title} className={styles.card}>
      <h3>{slot.title}</h3>
      {slot.version ? <InstitutionalImage key={key + slot.version.id} priority={position < 2} initialUrl={current?.urls[slot.version.id]} version={slot.version} title={slot.title} institutionalRead={institutionalRead} /> : <p role={current?.error ? "alert" : undefined}>{institutionalRead && !current ? "Consultando imagen institucional…" : current?.error ? "No fue posible consultar la imagen institucional." : slot.ambiguous ? "Hay más de un documento candidato. Requiere revisión administrativa." : "Sin imagen vigente disponible en tu alcance autorizado."}</p>}
      {isAdministrator(session) && slot.document ? <button type="button" onClick={() => onManage(slot.document!.id)}>Actualizar / consultar versiones</button> : null}
    </article>)}
  </section>;
}
export function InstitutionalImage({ version, title, institutionalRead = false, initialUrl, priority = false }: { priority?: boolean; initialUrl?: string; version: ControlledDocumentVersion; title: string; institutionalRead?: boolean }) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (initialUrl && retry === 0) return;
    let cancelled = false;
    void (institutionalRead ? getHomeImageUrl(version.id) : getControlledDocumentDownloadUrl(version)).then(value => {
      if (!value) throw new Error("No se encontró una referencia al archivo original.");
      if (!cancelled) { setUrl(value); setError(""); }
    }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No fue posible consultar la imagen."); });
    return () => { cancelled = true; };
  }, [version, retry, institutionalRead, initialUrl]);
  async function openFullSize() {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const freshUrl = await (institutionalRead ? getHomeImageUrl(version.id) : getControlledDocumentDownloadUrl(version));
      if (!freshUrl) throw new Error("No se encontró el archivo original.");
      if (tab) tab.location.replace(freshUrl);
      else throw new Error("Permite abrir ventanas para consultar la imagen completa.");
    } catch (cause) { tab?.close(); setError(cause instanceof Error ? cause.message : "No fue posible abrir la imagen."); }
  }
  return <>
    <small>Revisión {version.revision} · {({ current: "Vigente", pending: "Pendiente de validación", draft: "Borrador", obsolete: "Obsoleta", rejected: "Rechazada" })[version.status]}</small>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Reintentar</button></div> : url ? <button type="button" className={styles.image} onClick={() => void openFullSize()} aria-label={`Ver completa: ${title}`}>
      {/* The original is private and has a short-lived signed URL; do not proxy through Next Image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} decoding="async" fetchPriority={priority ? "high" : "auto"} alt={title} onError={() => setError("No fue posible visualizar el archivo original.")} />
    </button> : <p role="status">Cargando imagen…</p>}
  </>;
}
