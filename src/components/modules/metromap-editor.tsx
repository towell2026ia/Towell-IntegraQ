"use client";

import { Download, ExternalLink, FilePenLine, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const DRAWIO_ORIGIN = "https://embed.diagrams.net";
const DRAWIO_URL =
  `${DRAWIO_ORIGIN}/?embed=1&ui=min&spin=1&proto=json&saveAndExit=0`;
const DIAGRAM_STORAGE_KEY = "integraq.metromap.xml";
const SAVED_AT_STORAGE_KEY = "integraq.metromap.savedAt";
const FILE_NAME = "MetroMap Towel.drawio";

type EditorPhase = "notice" | "loading" | "editor";

type DrawioMessage = {
  event?: string;
  xml?: string;
};

export function MetroMapEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (savedAt: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<EditorPhase>("notice");
  const [xml, setXml] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const openEditor = async () => {
    setPhase("loading");
    setError("");

    try {
      let sourceXml = window.localStorage.getItem(DIAGRAM_STORAGE_KEY);
      if (!sourceXml) {
        const response = await fetch("/api/metromap", { cache: "no-store" });
        if (!response.ok) throw new Error("No fue posible leer el archivo fuente.");
        sourceXml = await response.text();
      }

      setXml(sourceXml);
      setSavedAt(window.localStorage.getItem(SAVED_AT_STORAGE_KEY) ?? "");
      setPhase("editor");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible abrir el Metro Map.",
      );
      setPhase("notice");
    }
  };

  const saveLocalCopy = useCallback(
    (nextXml: string) => {
      const timestamp = new Date().toISOString();
      window.localStorage.setItem(DIAGRAM_STORAGE_KEY, nextXml);
      window.localStorage.setItem(SAVED_AT_STORAGE_KEY, timestamp);
      setXml(nextXml);
      setSavedAt(timestamp);
      onSaved(timestamp);
    },
    [onSaved],
  );

  useEffect(() => {
    if (phase !== "editor" || !xml) return;

    const receiveMessage = (event: MessageEvent) => {
      if (
        event.origin !== DRAWIO_ORIGIN ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      try {
        const message = (
          typeof event.data === "string" ? JSON.parse(event.data) : event.data
        ) as DrawioMessage;

        if (message.event === "init") {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: "load",
              autosave: 1,
              title: FILE_NAME,
              xml,
            }),
            DRAWIO_ORIGIN,
          );
        }

        if (
          (message.event === "save" || message.event === "autosave") &&
          typeof message.xml === "string"
        ) {
          saveLocalCopy(message.xml);
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: "spinner", show: 0 }),
            DRAWIO_ORIGIN,
          );
        }

        if (message.event === "exit") onClose();
      } catch {
        // Ignore messages that do not follow the diagrams.net embed protocol.
      }
    };

    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onClose, phase, saveLocalCopy, xml]);

  const downloadCurrentCopy = () => {
    if (!xml) return;
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (phase !== "editor") {
    return (
      <div className="metromap-consent-backdrop" role="presentation">
        <section
          className="metromap-consent"
          role="dialog"
          aria-modal="true"
          aria-labelledby="metromap-editor-title"
        >
          <header>
            <span><FilePenLine size={20} /></span>
            <div>
              <p className="module-kicker">Editor externo</p>
              <h3 id="metromap-editor-title">Editar MetroMap Towel</h3>
            </div>
            <button className="icon-button" type="button" title="Cerrar" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <p>
            El archivo se abrirá en el editor web de diagrams.net. Al continuar,
            el XML del Metro Map se enviará al iframe del editor para procesarlo
            en esta sesión.
          </p>

          <dl className="metromap-consent-details">
            <div><dt>Archivo</dt><dd>{FILE_NAME}</dd></div>
            <div><dt>Páginas</dt><dd>Towel y T</dd></div>
            <div><dt>Persistencia</dt><dd>Navegador local</dd></div>
          </dl>

          {error ? <p className="metromap-editor-error">{error}</p> : null}

          <footer>
            <button className="button button-secondary" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={phase === "loading"}
              onClick={openEditor}
            >
              <ExternalLink size={16} />
              {phase === "loading" ? "Cargando..." : "Abrir diagrams.net"}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <section className="metromap-editor" role="dialog" aria-modal="true" aria-label="Editor del Metro Map">
      <header className="metromap-editor-header">
        <div>
          <span className="metromap-editor-icon"><FilePenLine size={18} /></span>
          <div>
            <strong>{FILE_NAME}</strong>
            <small>
              {savedAt
                ? `Guardado local ${new Date(savedAt).toLocaleString("es-MX")}`
                : "Edición local sin Supabase"}
            </small>
          </div>
        </div>
        <div className="metromap-editor-actions">
          <button className="icon-button" type="button" title="Descargar copia editable" onClick={downloadCurrentCopy}>
            <Download size={18} />
          </button>
          <span className="editor-save-hint"><Save size={15} /> Guardar desde el editor</span>
          <button className="icon-button" type="button" title="Cerrar editor" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="metromap-editor-frame-wrap">
        <iframe
          ref={iframeRef}
          className="metromap-editor-frame"
          src={DRAWIO_URL}
          title="Editor diagrams.net para MetroMap Towel"
          referrerPolicy="no-referrer"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      </div>
    </section>
  );
}
