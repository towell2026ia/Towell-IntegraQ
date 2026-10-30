"use client";
import { useState } from "react";
import type { ControlledDocument } from "@/lib/document-control-data";
import { findInstitutionalImages } from "@/lib/home-institutional-images";
import { createInstitutionalImageVersion } from "@/lib/home-image-version";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { InstitutionalImage } from "./home-institutional-images";
export function HomeImageSettings({ documents, session, onChange, onManage }: { documents: ControlledDocument[]; session: ActiveSession; onChange: (document: ControlledDocument) => void; onManage: (id: string) => void }) {
  if (!isAdministrator(session)) return null;
  return <section aria-label="Administración de imágenes institucionales"><h3>Imágenes institucionales</h3><p>Las sustituciones y recuperaciones crean una nueva revisión. La imagen vigente permanece hasta su validación.</p>
    {findInstitutionalImages(documents, session).map(slot => <section className="home-appearance-settings" key={slot.title}><h4>{slot.title}</h4>
      {slot.document ? <ImageVersions document={slot.document} session={session} onChange={onChange} onManage={onManage} /> : <p>{slot.ambiguous ? "Hay varias referencias candidatas; requiere revisión documental." : "No se encontró un documento autorizado asociado a este espacio."}</p>}
    </section>)}
  </section>;
}
function ImageVersions({ document, session, onChange, onManage }: { document: ControlledDocument; session: ActiveSession; onChange: (document: ControlledDocument) => void; onManage: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(document.versions.find(version => version.status === "current")?.id ?? document.versions[0]?.id ?? "");
  const [file, setFile] = useState<File | undefined>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = document.versions.find(version => version.id === selectedId);
  const preparing = document.versions.some(version => ["draft", "pending"].includes(version.status));
  async function create(restore: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      const version = await createInstitutionalImageVersion({ document, session, reason, ...(restore ? { restoreVersionId: selectedId } : { file }) });
      onChange({ ...document, versions: [version, ...document.versions] }); setSelectedId(version.id); setFile(undefined); setReason("");
      setNotice("Revisión creada. Envíala a validación desde el control documental para publicarla.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear la revisión."); }
    finally { setBusy(false); }
  }
  return <>
    <label>Versiones <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{document.versions.map(version => <option key={version.id} value={version.id}>Rev. {version.revision} · {version.fileName}</option>)}</select></label>
    {selected ? <InstitutionalImage key={selected.id} version={selected} title={document.name} /> : null}
    {preparing ? <p>Hay una revisión en preparación o pendiente de validación.</p> : null}
    <label>Adjuntar / sustituir imagen <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || preparing} onChange={event => setFile(event.target.files?.[0])} /></label>
    <label>Motivo del cambio <textarea value={reason} disabled={busy || preparing} onChange={event => setReason(event.target.value)} /></label>
    <div className="home-appearance-actions"><button type="button" disabled={busy || preparing || !file || !reason.trim()} onClick={() => void create(false)}>Crear nueva revisión</button><button type="button" disabled={busy || preparing || !selected || selected.status === "current" || !reason.trim()} onClick={() => void create(true)}>Recuperar como nueva revisión</button><button type="button" disabled={busy} onClick={() => onManage(document.id)}>Enviar / validar en control documental</button></div>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
  </>;
}