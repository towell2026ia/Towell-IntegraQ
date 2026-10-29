"use client";

import Image from "next/image";
import { ImagePlus, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { homeImageSlots, maximumHomeImageBytes, createHomeImageDraft, type HomeImageDraft, type HomeImageSlotId, type HomeImageVersion } from "@/lib/home-image-slots";
import styles from "./home-image-slots.module.css";

export function HomeImageSlots({ editing, administrator }: { editing: boolean; administrator: boolean }) {
  const [versions, setVersions] = useState<HomeImageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<HomeImageVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<HomeImageDraft | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true);
  const [ready, setReady] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const response = await fetch("/api/home/images", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar las imágenes.");
    if (!Array.isArray(payload.versions)) throw new Error("La respuesta de imágenes no es válida.");
    if (mounted.current && sequence === loadSequence.current) { setVersions(payload.versions); setReady(true); }
    return payload.versions as HomeImageVersion[];
  }, []);
  useEffect(() => {
    mounted.current = true;
    const load = () => void refresh().catch((cause: Error) => { if (mounted.current) { setReady(false); setError(cause.message); } }).finally(() => { if (mounted.current) setLoading(false); });
    load();
    window.addEventListener("focus", load);
    const interval = window.setInterval(load, 480000);
    return () => { mounted.current = false; window.removeEventListener("focus", load); window.clearInterval(interval); };
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [selected]);

  async function retry() {
    setLoading(true); setError("");
    try { await refresh(); setMustReload(false); setDraft(null); setConfirmed(false); }
    catch (cause) { setReady(false); setError(cause instanceof Error ? cause.message : "No fue posible cargar las imágenes."); }
    finally { setLoading(false); }
  }

  async function viewVersion(version: HomeImageVersion) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/home/images?version=" + encodeURIComponent(version.id), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible consultar la versión.");
      const historical = payload.versions?.find((item: HomeImageVersion) => item.id === version.id);
      if (!historical?.url) throw new Error("La versión no está disponible.");
      setSelected(historical);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible consultar la versión."); }
    finally { setBusy(false); }
  }

  function prepare(slot: HomeImageSlotId, file?: File, restore?: HomeImageVersion) {
    setNotice(""); setError(""); setConfirmed(false); setReason("");
    if (file && (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > maximumHomeImageBytes || !file.size)) {
      setError("Adjunta una imagen PNG, JPG o WebP de hasta 5 MB."); return;
    }
    if (!ready || mustReload) return;
    setDraft(createHomeImageDraft(slot, versions, file, restore));
  }
  async function save() {
    if (!draft || busy || !ready || mustReload || !confirmed || reason.trim().length < 5) return;
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    form.set("slot", draft.slot); form.set("expectedRevision", String(draft.expectedRevision));
    form.set("reason", reason.trim()); form.set("confirmed", "true");
    if (draft.file) form.set("file", draft.file);
    if (draft.restore) form.set("restoreVersion", draft.restore.id);
    try {
      const response = await fetch("/api/home/images", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar la imagen.");
      const after = await refresh();
      if (!after.some((version) => version.id === payload.version.id)) throw new Error("El guardado no pudo verificarse. Recarga antes de reintentar.");
      setDraft(null); setNotice("Imagen guardada y verificada. La versión anterior permanece en el historial.");
    } catch (cause) { setMustReload(true); setConfirmed(false); setError(cause instanceof Error ? cause.message : "No fue posible guardar la imagen."); }
    finally { setBusy(false); }
  }

  return <section className={styles.section} aria-label="Imágenes de políticas y objetivos">
    <header className={styles.heading}><div><strong>Políticas y objetivos</strong><p>{administrator ? editing ? "Adjunta una imagen en cada espacio. PNG, JPG o WebP, hasta 5 MB." : "Abre Editar inicio para adjuntar o cambiar las imágenes." : "Información del sistema de gestión."}</p></div>{loading ? <LoaderCircle className="spin" size={18} aria-label="Cargando imágenes" /> : null}</header>
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    {error || mustReload || !ready && !loading ? <button className="button button-secondary" type="button" disabled={busy || loading} onClick={() => void retry()}>Recargar imágenes</button> : null}
    {notice ? <div className="form-success" role="status">{notice}</div> : null}
    <div className={styles.grid}>
      {homeImageSlots.map((slot) => {
        const history = versions.filter((version) => version.slot === slot.id);
        const current = history[0];
        return <article key={slot.id} className={styles.card}>
          {current?.url ? <button className={styles.preview} type="button" aria-label={`Ampliar ${slot.title}`} onClick={() => setSelected(current)}>
            <Image src={current.url} alt={slot.title} fill sizes="(max-width: 680px) 50vw, 25vw" unoptimized onError={() => setError("No se pudo mostrar una imagen. Recarga para volver a intentarlo.")} />
          </button> : <div className={styles.empty}><ImagePlus size={26} /><small>{loading ? "Cargando…" : "Espacio para imagen"}</small></div>}
          <strong>{slot.title}</strong>
          {administrator && editing ? <>
            <label className={styles.upload}>{current ? "Cambiar imagen" : "Adjuntar imagen"}<input aria-label={`Adjuntar ${slot.title}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={loading || busy || !ready || mustReload} onChange={(event) => { const file = event.target.files?.[0]; if (file) prepare(slot.id, file); event.target.value = ""; }} /></label>
            {history.length > 1 ? <details><summary>Historial ({history.length})</summary>{history.slice(1).map((version) => <div className={styles.history} key={version.id}><small>Versión {version.revision} · {version.file_name}</small><button type="button" disabled={busy} onClick={() => void viewVersion(version)}>Consultar imagen</button><button type="button" disabled={busy || !ready || mustReload} onClick={() => prepare(slot.id, undefined, version)}><RotateCcw size={13} /> Recuperar</button></div>)}</details> : null}
          </> : null}
        </article>;
      })}
    </div>
    {draft && administrator && editing ? <div className={styles.confirmation}>
      <strong>{draft.restore ? "Recuperar imagen anterior" : "Guardar imagen"} · {homeImageSlots.find((slot) => slot.id === draft.slot)?.title}</strong>
      <p>{draft.file?.name ?? draft.restore?.file_name}</p>
      <label>Motivo del cambio<textarea rows={2} minLength={5} maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo publicar esta imagen para los usuarios autorizados. Se conservará el historial.</label>
      <div><button className="button button-primary" type="button" disabled={busy || !ready || mustReload || !confirmed || reason.trim().length < 5} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Guardar imagen</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button></div>
    </div> : null}
    {selected?.url ? <div className="home-policy-viewer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="home-image-viewer-title"><header><h2 id="home-image-viewer-title">{homeImageSlots.find((slot) => slot.id === selected.slot)?.title}</h2><button type="button" autoFocus aria-label="Cerrar imagen" onClick={() => setSelected(null)}><X size={20} /></button></header><Image src={selected.url} alt={selected.file_name} width={2000} height={1500} sizes="94vw" unoptimized /></div>
    </div> : null}
  </section>;
}
