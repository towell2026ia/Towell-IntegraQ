"use client";
import { useCallback, useEffect, useState } from "react";
import {
  auditActionStates,
  auditClassifications,
  type PortalAudit,
} from "@/lib/supplier-audits/manual";
import type { SupplierAuditFile } from "@/lib/supplier-audits/model";
import { SupplierAuditDocument } from "./supplier-audit-document";
import { SupplierActionEvidence } from "./supplier-action-evidence";
import portalCss from "./supplier-portal.module.css";
import styles from "./supplier-audit-calendar.module.css";
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/suppliers/audit-portal${path}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body.error ?? "No se pudieron consultar las auditorías autorizadas.",
    );
  }
  return body;
}
export async function downloadPortalAuditFile(
  eventId: string,
  file: SupplierAuditFile,
) {
  const { signedUrl } = await request<{ signedUrl: string }>(
    `/${eventId}/files/${file.id}?download=true`,
  );
  const link = document.createElement("a");
  link.href = signedUrl;
  link.download = file.original_name;
  link.rel = "noopener";
  link.click();
}
export function PortalDocument(
  { eventId, file }: { eventId: string; file: SupplierAuditFile },
) {
  const resolveUrl = useCallback(
    async () =>
      (await request<{ signedUrl: string }>(`/${eventId}/files/${file.id}`))
        .signedUrl,
    [eventId, file.id],
  );
  return (
    <SupplierAuditDocument
      eventId={eventId}
      file={file}
      resolveUrl={resolveUrl}
    />
  );
}
export function usePortalAudits(identity: string) {
  const [scheduleAvailable, setScheduleAvailable] = useState(false);
  const [audits, setAudits] = useState<PortalAudit[] | null>(null),
    [error, setError] = useState(""),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      try {
        const result = await request<
          { audits: PortalAudit[]; scheduleAvailable?: boolean }
        >("", c.signal);
        if (!c.signal.aborted) {
          setAudits(result.audits);
          setScheduleAvailable(result.scheduleAvailable === true);
          setError("");
        }
      } catch {
        if (!c.signal.aborted) {
          setAudits(null);
          setError("No se pudieron consultar las auditorías.");
        }
      }
    }
    void load();
    return () => c.abort();
  }, [identity, attempt]);
  return {
    audits,
    scheduleAvailable,
    error,
    refresh: () => {
      setAudits(null);
      setError("");
      retry((v) => v + 1);
    },
  };
}
export function SupplierAuditPortal({
  directory,
  year,
  selectedEvent = "",
  initialAction = "",
  evidenceOnly = false,
  onEvidenceChange,
}: {
  directory: ReturnType<typeof usePortalAudits>;
  selectedEvent?: string;
  initialAction?: string;
  evidenceOnly?: boolean;
  onEvidenceChange?: () => void;
  year?: string;
}) {
  const { audits, error, refresh } = directory;
  const [fileError, setFileError] = useState(""),
    [preview, setPreview] = useState<
      { eventId: string; file: SupplierAuditFile } | null
    >(null);
  const [chosen, setChosen] = useState(selectedEvent);
  const visible = (audits ?? []).filter((a) =>
    evidenceOnly ||
    !["scheduled", "confirmed", "rescheduled"].includes(a.state ?? "")
  ).filter((a) =>
    !year || year === "all" ||
    (a.auditDate ?? a.plannedDate)?.slice(0, 4) === year
  );
  async function download(eventId: string, file: SupplierAuditFile) {
    try {
      await downloadPortalAuditFile(eventId, file);
    } catch {
      setFileError("No se pudo abrir el documento.");
    }
  }
  return (
    <section
      className={styles.section}
      aria-label="Expedientes y acciones de mis auditorías"
    >
      <h3>Expedientes y planes de acción</h3>
      <p>
        Información autorizada por Calidad para tu proveedor. Las acciones no se
        cierran automáticamente.
      </p>
      <div className={portalCss.auditControls}>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setPreview(null);
            refresh();
          }}
        >
          Actualizar auditorías
        </button>
        {evidenceOnly && (
          <label>
            Expediente de auditoría{" "}
            <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Seleccionar evento</option>
              {visible.map((a) => (
                <option key={a.eventId} value={a.eventId}>
                  {a.auditDate ?? a.plannedDate ?? "Fecha pendiente"} ·{" "}
                  {a.methodology === "other"
                    ? "Otra metodología"
                    : a.methodology} · {auditClassifications[a.classification]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {fileError && <p role="alert">{fileError}</p>}
      {error ? <p role="alert">{error}</p> : !audits
        ? (
          <p role="status">
            <progress aria-label="Cargando auditorías" />
          </p>
        )
        : !visible.length
        ? <p>No hay auditorías publicadas para este proveedor.</p>
        : null}
      {audits
        ? visible.filter((a) => !evidenceOnly || a.eventId === chosen).map(
          (a) => (
            <article key={a.eventId} className={styles.section}>
              <h4>
                Auditoría · {a.auditDate ?? a.plannedDate ?? "Fecha pendiente"}
              </h4>
              <p>
                {auditClassifications[a.classification]} ·{" "}
                {a.methodology === "other"
                  ? "Otra metodología"
                  : a.methodology ?? "Metodología no confirmada"}{" "}
                · Calificación:{" "}
                {a.score === null ? "No confirmada" : `${a.score} %`}
              </p>
              {a.files.map((f) => (
                <div key={f.id} className={styles.fileRow}>
                  <span>
                    {f.resource_type === "supplier_audit_report"
                      ? "Informe"
                      : "Plan de acción"}: {f.original_name} · v{f.version}
                  </span>
                  <div className={styles.actions}>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() =>
                        setPreview({ eventId: a.eventId, file: f })}
                    >
                      Ver PDF
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void download(a.eventId, f)}
                    >
                      Descargar PDF
                    </button>
                  </div>
                </div>
              ))}
              {!a.files.length
                ? <p>PDF pendiente de carga o autorización.</p>
                : null}
              {a.actions.map((action) => (
                <div key={action.id} className={styles.section}>
                  <strong>{action.description}</strong>
                  <p>
                    Responsable: {action.responsibleName} · Compromiso:{" "}
                    {action.commitmentDate} · {auditActionStates[action.status]}
                  </p>
                  <p>
                    Conclusión real: {action.completedDate ?? "No registrada"}
                  </p>
                  {action.evidenceFileIds.map((id) => {
                    const f = a.files.find((file) =>
                      file.id === id
                    );
                    return f
                      ? (
                        <button
                          key={id}
                          type="button"
                          className="button button-secondary"
                          onClick={() =>
                            setPreview({ eventId: a.eventId, file: f })}
                        >
                          Evidencia: {f.original_name}
                        </button>
                      )
                      : null;
                  })}
                </div>
              ))}
              <SupplierActionEvidence
                event={a.eventId}
                initialAction={a.eventId === selectedEvent ? initialAction : ""}
                actions={a.actions.filter((x) => x.status !== "closed")}
                onChange={onEvidenceChange}
              />
              {!a.actions.length ? <p>Sin acciones capturadas.</p> : null}
            </article>
          ),
        )
        : null}
      {preview && audits
        ? (
          <section aria-label="PDF autorizado de auditoría">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPreview(null)}
            >
              Cerrar PDF
            </button>
            <PortalDocument eventId={preview.eventId} file={preview.file} />
          </section>
        )
        : null}
    </section>
  );
}
