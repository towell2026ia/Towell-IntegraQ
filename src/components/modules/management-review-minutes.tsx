"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DocumentPreviewViewer } from "@/components/modules/document-preview-viewer";
import { getAttachmentSignedUrl, listAttachments, listModuleAttachments, softDeleteAttachment, uploadAttachment, type AttachmentRecord } from "@/lib/attachment-storage";
import type { ControlledDocumentVersion } from "@/lib/document-control-data";
import { validateHistoricalMinutes } from "@/lib/historical-minutes";
import type { ActiveSession } from "@/lib/session-data";

const resourceType = "management_review_minutes";

export function useReviewMinutes() {
  const [files, setFiles] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void listModuleAttachments("management-review", resourceType)
      .then(result => { if (active) { setFiles(result); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("No se pudieron consultar las actas."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return { files, loading, loadError, reload: () => { setLoading(true); setRetry(value => value + 1); } };
}

export function ManagementReviewMinutes({ session, catalog, period }: {
  session: ActiveSession;
  catalog: ReturnType<typeof useReviewMinutes>;
  period: number;
}) {
  const { files, loading, loadError, reload } = catalog;
  const selectedFiles = files.filter(item => Number(item.resourceKey) === period);
  const [error, setError] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [date, setDate] = useState("");
  const [responsible, setResponsible] = useState("");
  const [status, setStatus] = useState("Finalizada");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AttachmentRecord | null>(null);
  const isAdministrator = session.userType === "Administrador";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdministrator || !file || saving) return;
    const validationError = validateHistoricalMinutes({ year, date, responsible, fileName: file.name, mimeType: file.type }, new Date().getFullYear());
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError("");
    try {
      const existing = await listAttachments({ moduleId: "management-review", resourceType, resourceKey: year }, true);
      const previous = existing.find(item => item.isCurrent && !item.deletedAt);
      await uploadAttachment({ moduleId: "management-review", resourceType, resourceKey: year }, file, previous,
        { displayName: responsible.trim(), validFrom: date, description: status });
      setFile(null); reload();
    } catch { setError("No fue posible registrar el acta."); }
    finally { setSaving(false); }
  }

  async function download(attachment: AttachmentRecord) {
    try {
      const url = await getAttachmentSignedUrl(attachment);
      if (!url) throw new Error("El archivo original no está disponible.");
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = attachment.originalName; anchor.click();
    } catch { setError("No fue posible descargar el acta."); }
  }

  async function remove(attachment: AttachmentRecord) {
    if (!isAdministrator || removingId) return;
    if (!window.confirm(`Se retirará el acta ${attachment.resourceKey} · ${attachment.originalName} del catálogo vigente. El archivo y su historial se conservarán. ¿Continuar?`)) return;
    const reason = window.prompt("Motivo obligatorio para retirar esta acta:")?.trim() ?? "";
    if (!reason) { setError("El retiro se canceló: debes indicar un motivo."); return; }
    setRemovingId(attachment.id); setError("");
    try {
      await softDeleteAttachment(attachment, reason);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible retirar el acta.");
    } finally { setRemovingId(null); }
  }

  const sourceUrl = useCallback(async () => selected
    ? getAttachmentSignedUrl(selected, selected.previewStatus === "ready" && selected.previewPath ? "preview" : "original")
    : null, [selected]);
  const onReadyChange = useCallback(() => undefined, []);
  const version: ControlledDocumentVersion | null = selected ? {
    id: selected.id, revision: selected.version, status: "current", fileName: selected.originalName,
    uploadedBy: selected.displayName || "IntegraQ", validator: selected.displayName || "IntegraQ",
    modifiedAt: selected.createdAt, changeReason: "Acta histórica", mimeType: selected.mimeType,
    sizeBytes: selected.sizeBytes ?? undefined, previewPath: selected.previewPath ?? undefined,
    previewStatus: selected.previewStatus,
  } : null;

  return <section className="management-history-panel work-panel" aria-label="Actas históricas adjuntas">
    <header className="management-panel-heading"><div><span className="module-kicker">Archivo original</span><h3>Actas históricas adjuntas</h3></div></header>
    {isAdministrator ? <details><summary>Adjuntar acta histórica</summary><form className="historical-minutes-form" onSubmit={event => void submit(event)}>
      <label>Año<input required type="number" min="1900" max={new Date().getFullYear()} value={year} onChange={event => setYear(event.target.value)} /></label>
      <label>Fecha<input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>Responsable<input required value={responsible} onChange={event => setResponsible(event.target.value)} /></label>
      <label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option>Finalizada</option><option>En revisión</option></select></label>
      <label>Acta PDF o DOCX<input required type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : files.some(item => item.resourceKey === year && item.isCurrent) ? "Adjuntar nueva versión" : "Adjuntar acta"}</button>
    </form></details> : null}
    {error || loadError ? <p role="alert">{error || loadError} <button type="button" onClick={() => { setError(""); reload(); }}>Reintentar</button></p> : null}
    {loading ? <progress aria-label="Cargando actas" /> : loadError ? null : selectedFiles.length ? <div className="management-history-table-wrap"><table className="management-history-table"><thead><tr><th>Año</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Archivo</th><th>Versión</th><th>Consulta</th>{isAdministrator ? <th>Administración</th> : null}</tr></thead><tbody>{selectedFiles.map(item => <tr key={item.id}><td>{item.resourceKey}</td><td>{item.validFrom || "—"}</td><td>{item.displayName || "—"}</td><td>{item.description || "—"}</td><td>{item.originalName}</td><td>{item.version}</td><td><button className="button button-secondary" type="button" onClick={() => setSelected(item)}>Ver</button> <button className="button button-secondary" type="button" onClick={() => void download(item)}>Descargar original</button></td>{isAdministrator ? <td><button className="button button-secondary" disabled={removingId !== null} type="button" onClick={() => void remove(item)}>{removingId === item.id ? "Retirando…" : "Retirar"}</button></td> : null}</tr>)}</tbody></table></div> : <p>No hay actas adjuntas para este período.</p>}
    {version ? <div className="historical-minutes-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><section role="dialog" aria-modal="true" aria-label={`Vista de ${version.fileName}`} onMouseDown={event => event.stopPropagation()}><button className="button button-secondary" type="button" onClick={() => setSelected(null)}>Cerrar</button><DocumentPreviewViewer code={selected?.resourceKey || "RPD"} version={version} sourceUrl={sourceUrl} onReadyChange={onReadyChange} /></section></div> : null}
  </section>;
}
