"use client";

import {
  Archive,
  ArrowDownToLine,
  ChevronRight,
  Eye,
  FileClock,
  FilePenLine,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  History,
  Info,
  LoaderCircle,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { DocumentPreviewViewer } from "@/components/modules/document-preview-viewer";
import styles from "@/components/modules/general-information.module.css";
import { useGeneralInformation } from "@/hooks/use-general-information";
import type { ControlledDocumentVersion } from "@/lib/document-control-data";
import {
  buildFolderBreadcrumb,
  canManageGeneralInformation,
  type GeneralInformationDocument,
  type GeneralInformationDocumentInput,
  type GeneralInformationFolder,
  type GeneralInformationReference,
  type GeneralInformationValidity,
} from "@/lib/general-information";
import {
  addGeneralInformationDocuments,
  addGeneralInformationFolder,
  getGeneralInformationFileUrl,
  patchGeneralInformation,
} from "@/lib/services/general-information-service";
import type { ActiveSession } from "@/lib/session-data";

type AdministrationView = "active" | "deleted" | "history" | "audit";
type UploadMode = "single" | "bulk" | "replace";

export function GeneralInformationModule({ session }: { session: ActiveSession }) {
  const administrator = canManageGeneralInformation(session);
  const [currentFolderId, setCurrentFolderId] = useState<string>();
  const [query, setQuery] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [validityStatus, setValidityStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState<AdministrationView>("active");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<GeneralInformationDocument>();
  const [information, setInformation] = useState<GeneralInformationDocument>();
  const [upload, setUpload] = useState<{ mode: UploadMode; replace?: GeneralInformationDocument }>();
  const { folders, documents, audit, loading, error, refresh } = useGeneralInformation({
    folderId: currentFolderId,
    query,
    referenceType,
    validityStatus,
    sort,
    administrationView: administrator ? view : "active",
  });
  const activeFolders = folders.filter((folder) => !folder.deletedAt && !folder.archivedAt);
  const childFolders = activeFolders.filter((folder) => folder.parentFolderId === currentFolderId || (!currentFolderId && !folder.parentFolderId));
  const breadcrumb = buildFolderBreadcrumb(activeFolders, currentFolderId);
  const currentFolder = currentFolderId ? activeFolders.find((folder) => folder.id === currentFolderId) : undefined;

  async function mutate(task: () => Promise<unknown>, success: string) {
    try {
      await task();
      setNotice(success);
      await refresh();
    } catch (mutationError) {
      setNotice(mutationError instanceof Error ? mutationError.message : "No fue posible completar la operación.");
    }
  }

  async function createFolder() {
    const name = window.prompt(currentFolder ? `Nombre de la subcarpeta dentro de ${currentFolder.name}:` : "Nombre de la nueva carpeta:");
    if (!name?.trim()) return;
    const description = window.prompt("Descripción opcional:") || undefined;
    await mutate(() => addGeneralInformationFolder({ name, description, parentFolderId: currentFolderId }), "Carpeta creada.");
  }

  async function renameFolder(folder: GeneralInformationFolder) {
    const name = window.prompt("Nuevo nombre:", folder.name);
    if (!name?.trim()) return;
    await mutate(() => patchGeneralInformation({ entity: "folder", action: "rename", id: folder.id, name, description: folder.description }), "Carpeta actualizada.");
  }

  async function moveFolder(folder: GeneralInformationFolder) {
    const destination = chooseFolder(activeFolders.filter((candidate) => candidate.id !== folder.id), "Mover carpeta a (escribe el nombre; vacío = raíz):");
    if (destination === undefined) return;
    await mutate(() => patchGeneralInformation({ entity: "folder", action: "move", id: folder.id, parentFolderId: destination }), "Carpeta movida.");
  }

  async function removeFolder(folder: GeneralInformationFolder, archive = false) {
    if (archive) {
      await mutate(() => patchGeneralInformation({ entity: "folder", action: "archive", id: folder.id }), "Carpeta archivada.");
      return;
    }
    const reason = window.prompt("Motivo de eliminación lógica:");
    if (!reason?.trim()) return;
    await mutate(() => patchGeneralInformation({ entity: "folder", action: "delete", id: folder.id, reason }), "Carpeta enviada a Eliminados.");
  }

  async function editDocument(document: GeneralInformationDocument) {
    const name = window.prompt("Nombre:", document.name);
    if (!name?.trim()) return;
    const reference = window.prompt("Referencia: internal o external", document.referenceType);
    if (reference !== "internal" && reference !== "external") return;
    const validity = window.prompt("Vigencia: current o not_current", document.validityStatus);
    if (validity !== "current" && validity !== "not_current") return;
    const externalOrigin = reference === "external" ? window.prompt("Origen externo (opcional):", document.externalOrigin || "") || "" : "";
    const description = window.prompt("Descripción (opcional):", document.description || "") || "";
    const observations = window.prompt("Observaciones (opcional):", document.observations || "") || "";
    const validFrom = window.prompt("Vigente desde (AAAA-MM-DD, opcional):", document.validFrom || "") || "";
    const validUntil = window.prompt("Vigente hasta (AAAA-MM-DD, opcional):", document.validUntil || "") || "";
    await mutate(() => patchGeneralInformation({
      entity: "document",
      action: "update",
      id: document.id,
      name,
      referenceType: reference,
      validityStatus: validity,
      externalOrigin,
      description,
      observations,
      validFrom,
      validUntil,
    }), "Metadata actualizada.");
  }

  async function moveDocument(document: GeneralInformationDocument) {
    const folderId = chooseFolder(activeFolders, "Mover documento a la carpeta (escribe el nombre):");
    if (!folderId) return;
    await mutate(() => patchGeneralInformation({ entity: "document", action: "move", id: document.id, folderId }), "Documento movido.");
  }

  async function removeDocument(document: GeneralInformationDocument) {
    const reason = window.prompt("Motivo de eliminación lógica:");
    if (!reason?.trim()) return;
    await mutate(() => patchGeneralInformation({ entity: "document", action: "delete", id: document.id, reason }), "Documento enviado a Eliminados.");
  }

  async function restore(entity: "folder" | "document", id: string) {
    await mutate(() => patchGeneralInformation({ entity, action: "restore", id }), "Contenido restaurado.");
  }

  async function download(document: GeneralInformationDocument) {
    try {
      const { signedUrl } = await getGeneralInformationFileUrl(document.id, "download");
      const anchor = window.document.createElement("a");
      anchor.href = signedUrl;
      anchor.download = document.originalName;
      anchor.click();
    } catch (downloadError) {
      setNotice(downloadError instanceof Error ? downloadError.message : "Descarga no autorizada.");
    }
  }

  return <section className={styles.repository}>
    <header className={styles.heading}>
      <div><p className="module-kicker">Información documentada</p><h3>Información General</h3><p>Carpetas y documentos generales disponibles para todos los usuarios autenticados.</p></div>
      {administrator ? <div className={styles.actions}>
        <button className="button button-secondary" type="button" onClick={() => void createFolder()}><Plus size={16} /> Nueva carpeta</button>
        <button className="button button-primary" disabled={!currentFolderId} type="button" onClick={() => setUpload({ mode: "single" })}><Upload size={16} /> Cargar</button>
        <button className="button button-secondary" disabled={!currentFolderId} type="button" onClick={() => setUpload({ mode: "bulk" })}><UploadCloud size={16} /> Carga masiva</button>
      </div> : <span className={styles.readOnly}><ShieldCheck size={15} /> Consulta autenticada</span>}
    </header>

    {administrator ? <nav className={styles.adminTabs} aria-label="Administración de Información General">
      {(["active", "deleted", "history", "audit"] as const).map((item) => <button className={view === item ? styles.activeTab : ""} key={item} type="button" onClick={() => setView(item)}>{item === "active" ? "Activos" : item === "deleted" ? "Eliminados" : item === "history" ? "Historial" : "Auditoría"}</button>)}
    </nav> : null}

    {notice ? <div className={notice.includes("No fue") || notice.includes("inválid") ? "form-error" : "form-success"} role="status">{notice}</div> : null}
    {error ? <div className="form-error" role="alert">{error} <button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Reintentar</button></div> : null}

    {view === "active" ? <>
      <nav className={styles.breadcrumb} aria-label="Ruta de carpetas">
        <button type="button" onClick={() => setCurrentFolderId(undefined)}>Inicio</button>
        {breadcrumb.map((folder) => <span key={folder.id}><ChevronRight size={14} /><button type="button" onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button></span>)}
      </nav>

      <div className={styles.filters}>
        <label><Search size={16} /><input aria-label="Buscar documentos" placeholder="Buscar por nombre, descripción u origen" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filtrar referencia" value={referenceType} onChange={(event) => setReferenceType(event.target.value)}><option value="">Referencia: Todos</option><option value="internal">Interno</option><option value="external">Externo</option></select>
        <select aria-label="Filtrar vigencia" value={validityStatus} onChange={(event) => setValidityStatus(event.target.value)}><option value="">Vigencia: Todos</option><option value="current">Vigente</option><option value="not_current">No vigente</option></select>
        <select aria-label="Ordenar documentos" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Orden: Nombre</option><option value="date">Fecha de carga</option><option value="reference">Referencia</option><option value="validity">Vigencia</option></select>
      </div>

      {!query && childFolders.length ? <div className={styles.folderGrid}>{childFolders.map((folder) => <article className={styles.folderCard} key={folder.id}>
        <button className={styles.folderOpen} type="button" onClick={() => setCurrentFolderId(folder.id)}><Folder size={24} /><span><strong>{folder.name}</strong><small>{folder.description || "Carpeta documental"}</small></span></button>
        {administrator ? <div className={styles.rowActions}><button title="Renombrar" type="button" onClick={() => void renameFolder(folder)}><FilePenLine size={14} /></button><button title="Mover" type="button" onClick={() => void moveFolder(folder)}><FolderInput size={14} /></button><button title="Archivar" type="button" onClick={() => void removeFolder(folder, true)}><Archive size={14} /></button><button title="Eliminar" type="button" onClick={() => void removeFolder(folder)}><Trash2 size={14} /></button></div> : null}
      </article>)}</div> : null}

      {currentFolderId || query ? <DocumentTable documents={documents} administrator={administrator} loading={loading} onDownload={download} onEdit={editDocument} onInfo={setInformation} onMove={moveDocument} onPreview={setPreview} onRemove={removeDocument} onReplace={(document) => setUpload({ mode: "replace", replace: document })} /> : !loading && !childFolders.length ? <EmptyState administrator={administrator} onCreate={createFolder} /> : null}
    </> : null}

    {view === "deleted" ? <div className={styles.deletedGrid}>
      {folders.filter((folder) => folder.deletedAt).map((folder) => <article key={folder.id}><Folder size={20} /><div><strong>{folder.name}</strong><small>{folder.deletionReason}</small></div><button className="button button-secondary" type="button" onClick={() => void restore("folder", folder.id)}><RotateCcw size={14} /> Restaurar</button></article>)}
      {documents.filter((document) => document.deletedAt).map((document) => <article key={document.id}><FileText size={20} /><div><strong>{document.name}</strong><small>{document.deletionReason}</small></div><button className="button button-secondary" type="button" onClick={() => void restore("document", document.id)}><RotateCcw size={14} /> Restaurar</button></article>)}
      {!folders.some((folder) => folder.deletedAt) && !documents.some((document) => document.deletedAt) ? <EmptyAdministrative icon={<PackageOpen size={24} />} title="Sin eliminados" copy="No hay carpetas ni documentos pendientes de restauración." /> : null}
    </div> : null}

    {view === "history" ? <DocumentTable documents={documents} administrator loading={loading} onDownload={download} onEdit={editDocument} onInfo={setInformation} onMove={moveDocument} onPreview={setPreview} onRemove={removeDocument} onReplace={(document) => setUpload({ mode: "replace", replace: document })} /> : null}
    {view === "audit" ? <div className={styles.auditList}>{audit.map((event) => <article key={event.id}><History size={16} /><div><strong>{event.action}</strong><small>{event.actorName || "Sistema"} · {formatDate(event.createdAt)}</small></div><code>{event.resourceType}</code></article>)}{!audit.length && !loading ? <EmptyAdministrative icon={<FileClock size={24} />} title="Sin eventos" copy="La bitácora aparecerá después de la primera operación." /> : null}</div> : null}

    {upload ? <UploadDialog currentFolderId={currentFolderId} folders={activeFolders} mode={upload.mode} replace={upload.replace} onClose={() => setUpload(undefined)} onComplete={async (message) => { setUpload(undefined); setNotice(message); await refresh(); }} /> : null}
    {preview ? <GeneralInformationPreview document={preview} onClose={() => setPreview(undefined)} /> : null}
    {information ? <MetadataDialog document={information} folders={folders} onClose={() => setInformation(undefined)} /> : null}
  </section>;
}

function DocumentTable({ documents, administrator, loading, onDownload, onEdit, onInfo, onMove, onPreview, onRemove, onReplace }: {
  documents: GeneralInformationDocument[];
  administrator: boolean;
  loading: boolean;
  onDownload: (document: GeneralInformationDocument) => void;
  onEdit: (document: GeneralInformationDocument) => void;
  onInfo: (document: GeneralInformationDocument) => void;
  onMove: (document: GeneralInformationDocument) => void;
  onPreview: (document: GeneralInformationDocument) => void;
  onRemove: (document: GeneralInformationDocument) => void;
  onReplace: (document: GeneralInformationDocument) => void;
}) {
  if (loading) return <div className={styles.loading}><LoaderCircle className="spin" size={22} /> Cargando documentos…</div>;
  if (!documents.length) return <div className={styles.tableEmpty}><FileText size={24} /><strong>No hay documentos en esta vista</strong><span>Usa las carpetas, búsqueda o filtros para localizar contenido.</span></div>;
  return <div className={styles.tableWrap}><table className={styles.documentTable}><thead><tr><th>Nombre</th><th>Referencia</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><FileText size={17} /><span><strong>{document.name}</strong><small>{formatBytes(document.sizeBytes)} · V{document.version}</small></span></td><td>{document.referenceType === "external" ? "Externo" : "Interno"}</td><td>{formatDate(document.createdAt)}</td><td><span className={document.validityStatus === "current" ? styles.current : styles.notCurrent}>{document.validityStatus === "current" ? "Vigente" : "No vigente"}</span></td><td><div className={styles.rowActions}><button title="Ver" type="button" onClick={() => onPreview(document)}><Eye size={15} /></button><button title="Información" type="button" onClick={() => onInfo(document)}><Info size={15} /></button>{administrator ? <><button title="Descargar" type="button" onClick={() => onDownload(document)}><ArrowDownToLine size={15} /></button><button title="Editar metadata" type="button" onClick={() => onEdit(document)}><FilePenLine size={15} /></button><button title="Mover" type="button" onClick={() => onMove(document)}><FolderInput size={15} /></button><button title="Reemplazar" type="button" onClick={() => onReplace(document)}><RefreshCw size={15} /></button><button title="Eliminar" type="button" onClick={() => onRemove(document)}><Trash2 size={15} /></button></> : null}</div></td></tr>)}</tbody></table></div>;
}

function UploadDialog({ currentFolderId, folders, mode, replace, onClose, onComplete }: {
  currentFolderId?: string;
  folders: GeneralInformationFolder[];
  mode: UploadMode;
  replace?: GeneralInformationDocument;
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [metadata, setMetadata] = useState<GeneralInformationDocumentInput[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ success: number; failed: number; batch: string }>();

  function chooseFiles(selected: File[]) {
    const accepted = mode === "single" || mode === "replace" ? selected.slice(0, 1) : selected;
    setFiles(accepted);
    setMetadata(accepted.map((file) => ({
      folderId: replace?.folderId || currentFolderId || "",
      name: replace?.name || file.name.replace(/\.[^.]+$/, ""),
      referenceType: replace?.referenceType || "internal",
      externalOrigin: replace?.externalOrigin,
      validityStatus: replace?.validityStatus || "current",
      validFrom: replace?.validFrom,
      validUntil: replace?.validUntil,
      description: replace?.description,
      observations: replace?.observations,
    })));
  }

  function changeRow(index: number, changes: Partial<GeneralInformationDocumentInput>) {
    setMetadata((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
  }

  function applyToAll(changes: Partial<GeneralInformationDocumentInput>) {
    setMetadata((rows) => rows.map((row) => ({ ...row, ...changes })));
  }

  function editOptionalMetadata(index: number) {
    const row = metadata[index];
    if (!row) return;
    const description = window.prompt("Descripción (opcional):", row.description || "");
    if (description === null) return;
    const observations = window.prompt("Observaciones (opcional):", row.observations || "");
    if (observations === null) return;
    const validFrom = window.prompt("Vigente desde (AAAA-MM-DD, opcional):", row.validFrom || "");
    if (validFrom === null) return;
    const validUntil = window.prompt("Vigente hasta (AAAA-MM-DD, opcional):", row.validUntil || "");
    if (validUntil === null) return;
    changeRow(index, { description, observations, validFrom, validUntil });
  }

  async function submit(selectedFiles = files, selectedMetadata = metadata) {
    if (!selectedFiles.length) return;
    setBusy(true); setError(""); setProgress(0);
    try {
      const result = await addGeneralInformationDocuments(selectedFiles, selectedMetadata, setProgress, replace?.id);
      setSummary({ success: result.successCount, failed: result.failureCount, batch: result.batchCode });
      if (!result.failureCount) await onComplete(`Carga terminada: ${result.successCount} exitosos · ${result.batchCode}.`);
      else {
        const failedIndexes = result.results.filter((item) => !item.ok).map((item) => item.index);
        setFiles(failedIndexes.map((index) => selectedFiles[index]));
        setMetadata(failedIndexes.map((index) => ({ ...selectedMetadata[index], allowDuplicate: result.results.find((item) => item.index === index)?.error === "DUPLICATE" })));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No fue posible cargar el lote.");
    } finally { setBusy(false); }
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={onClose}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Carga documental" onMouseDown={(event) => event.stopPropagation()}><header><div><UploadCloud size={19} /><span><strong>{mode === "bulk" ? "Carga masiva" : mode === "replace" ? `Reemplazar ${replace?.name}` : "Cargar documento"}</strong><small>Revisa metadata y destino antes de cargar.</small></span></div><button type="button" onClick={onClose}><X size={18} /></button></header>
    <label className={styles.dropZone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFiles(Array.from(event.dataTransfer.files)); }}><UploadCloud size={28} /><strong>Selecciona o arrastra {mode === "bulk" ? "varios archivos" : "un archivo"}</strong><span>PDF, Office, imágenes o TXT · máximo 50 MB por archivo</span><input multiple={mode === "bulk"} type="file" onChange={(event) => chooseFiles(Array.from(event.target.files || []))} /></label>
    {mode === "bulk" && files.length ? <div className={styles.bulkTools}><select aria-label="Aplicar carpeta a todos" defaultValue="" onChange={(event) => event.target.value && applyToAll({ folderId: event.target.value })}><option value="">Aplicar carpeta a todos</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button type="button" onClick={() => applyToAll({ referenceType: "internal" })}>Todos internos</button><button type="button" onClick={() => applyToAll({ referenceType: "external" })}>Todos externos</button><button type="button" onClick={() => applyToAll({ validityStatus: "current" })}>Todos vigentes</button><button type="button" onClick={() => applyToAll({ validityStatus: "not_current" })}>Todos no vigentes</button></div> : null}
    {files.length ? <div className={styles.reviewTable}>{files.map((file, index) => <div className={styles.reviewRow} key={`${file.name}-${index}`}><span title={file.name}>{file.name}</span><input aria-label={`Nombre ${file.name}`} value={metadata[index]?.name || ""} onChange={(event) => changeRow(index, { name: event.target.value })} /><select aria-label={`Referencia ${file.name}`} value={metadata[index]?.referenceType || "internal"} onChange={(event) => changeRow(index, { referenceType: event.target.value as GeneralInformationReference })}><option value="internal">Interno</option><option value="external">Externo</option></select><select aria-label={`Vigencia ${file.name}`} value={metadata[index]?.validityStatus || "current"} onChange={(event) => changeRow(index, { validityStatus: event.target.value as GeneralInformationValidity })}><option value="current">Vigente</option><option value="not_current">No vigente</option></select><select aria-label={`Carpeta ${file.name}`} value={metadata[index]?.folderId || ""} onChange={(event) => changeRow(index, { folderId: event.target.value })}><option value="">Selecciona carpeta</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>{metadata[index]?.referenceType === "external" ? <input aria-label={`Origen ${file.name}`} placeholder="Origen externo" value={metadata[index]?.externalOrigin || ""} onChange={(event) => changeRow(index, { externalOrigin: event.target.value })} /> : <span />}
      <button className={styles.metadataButton} type="button" onClick={() => editOptionalMetadata(index)}>Detalles</button>
    </div>)}</div> : null}
    {busy || progress ? <div className={styles.progress}><div><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong><small>{busy ? `Cargando ${files.length} documento(s)…` : "Carga terminada"}</small></div> : null}
    {summary ? <div className={summary.failed ? "form-error" : "form-success"}>Carga terminada: {summary.success} exitosos · {summary.failed} fallidos · {summary.batch}</div> : null}
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    <footer><button className="button button-secondary" disabled={busy} type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={busy || !files.length} type="button" onClick={() => void submit()}>{summary?.failed ? <><RefreshCw size={15} /> Reintentar fallidos</> : <><Upload size={15} /> Cargar {files.length || ""}</>}</button></footer>
  </section></div>;
}

function GeneralInformationPreview({ document, onClose }: { document: GeneralInformationDocument; onClose: () => void }) {
  const sourceUrl = useCallback(async () => (await getGeneralInformationFileUrl(document.id, "preview")).signedUrl, [document.id]);
  const version = useMemo(() => ({
    id: document.id,
    revision: document.version,
    status: "current" as const,
    fileName: document.originalName,
    uploadedBy: document.uploadedByName || "IntegraQ",
    validator: "Información General",
    modifiedAt: document.updatedAt,
    changeReason: "Consulta de Información General",
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    previewStatus: document.previewStatus,
  } satisfies ControlledDocumentVersion), [document]);
  const onReadyChange = useCallback(() => undefined, []);
  return <div className={styles.backdrop} role="presentation" onMouseDown={onClose}><section className={`${styles.dialog} ${styles.previewDialog}`} role="dialog" aria-modal="true" aria-label={`Vista de ${document.name}`} onMouseDown={(event) => event.stopPropagation()}><header><div><Eye size={19} /><span><strong>{document.name}</strong><small>Vista de solo lectura · URL temporal</small></span></div><button type="button" onClick={onClose}><X size={18} /></button></header><DocumentPreviewViewer code={document.name} onReadyChange={onReadyChange} sourceUrl={sourceUrl} version={version} /></section></div>;
}

function MetadataDialog({ document, folders, onClose }: { document: GeneralInformationDocument; folders: GeneralInformationFolder[]; onClose: () => void }) {
  const folder = folders.find((item) => item.id === document.folderId);
  return <div className={styles.backdrop} role="presentation" onMouseDown={onClose}><section className={`${styles.dialog} ${styles.metadataDialog}`} role="dialog" aria-modal="true" aria-label={`Información de ${document.name}`} onMouseDown={(event) => event.stopPropagation()}><header><div><Info size={19} /><span><strong>{document.name}</strong><small>Metadata documental</small></span></div><button type="button" onClick={onClose}><X size={18} /></button></header><dl><div><dt>Carpeta</dt><dd>{folder?.name || "No disponible"}</dd></div><div><dt>Referencia</dt><dd>{document.referenceType === "external" ? "Externo" : "Interno"}</dd></div><div><dt>Origen externo</dt><dd>{document.externalOrigin || "—"}</dd></div><div><dt>Vigencia</dt><dd>{document.validityStatus === "current" ? "Vigente" : "No vigente"}</dd></div><div><dt>Fecha de carga</dt><dd>{formatDate(document.createdAt)}</dd></div><div><dt>Cargado por</dt><dd>{document.uploadedByName || "IntegraQ"}</dd></div><div><dt>Última modificación</dt><dd>{formatDate(document.updatedAt)}</dd></div><div><dt>Descripción</dt><dd>{document.description || "—"}</dd></div><div><dt>Observaciones</dt><dd>{document.observations || "—"}</dd></div><div><dt>Lote</dt><dd>{document.batchCode || "—"}</dd></div></dl></section></div>;
}

function EmptyState({ administrator, onCreate }: { administrator: boolean; onCreate: () => void }) {
  return <div className={styles.empty}><FolderOpen size={30} /><h4>Información General aún no tiene carpetas</h4><p>{administrator ? "Crea la primera carpeta para comenzar a organizar documentos." : "El administrador todavía no ha publicado contenido general."}</p>{administrator ? <button className="button button-primary" type="button" onClick={onCreate}><Plus size={15} /> Nueva carpeta</button> : null}</div>;
}

function EmptyAdministrative({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className={styles.empty}>{icon}<h4>{title}</h4><p>{copy}</p></div>;
}

function chooseFolder(folders: GeneralInformationFolder[], message: string) {
  const answer = window.prompt(`${message}\n${folders.map((folder) => `• ${folder.name}`).join("\n")}`);
  if (answer === null) return undefined;
  if (!answer.trim()) return "";
  const match = folders.find((folder) => folder.name.toLocaleLowerCase("es") === answer.trim().toLocaleLowerCase("es"));
  if (!match) {
    window.alert("No se encontró la carpeta indicada.");
    return undefined;
  }
  return match.id;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
