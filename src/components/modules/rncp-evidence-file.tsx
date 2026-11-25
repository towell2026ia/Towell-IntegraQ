"use client";

import { Download, Eye, FileText } from "lucide-react";
import { useState } from "react";
import { getRncpEvidenceUrl } from "@/lib/rncp-data";
import styles from "./rncp-matrix.module.css";

export function RncpEvidenceFile({ id, name, bytes }: { id: string; name: string; bytes: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open(download: boolean) {
    const preview = download ? null : window.open("about:blank", "_blank");
    if (!download && !preview) {
      setError("Permite abrir la vista previa en una pestaña nueva.");
      return;
    }
    if (preview) preview.opener = null;
    setError("");
    setBusy(true);
    try {
      const { signedUrl } = await getRncpEvidenceUrl(id);
      if (download) {
        const response = await fetch(signedUrl, { cache: "no-store", credentials: "omit" });
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (blob.size !== bytes) throw new Error();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } else if (preview) {
        preview.location.replace(signedUrl);
      }
    } catch {
      preview?.close();
      setError("No se pudo abrir el archivo. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }
  return <div className={styles.file} aria-busy={busy}>
    <FileText size={16} aria-hidden="true" /><span>{name}<small>{name.includes(".") ? name.split(".").pop()?.toUpperCase() : "Archivo"} · {Math.ceil(bytes / 1024)} KB</small></span>
    <button className="icon-button" type="button" aria-label={"Ver "+name} disabled={busy} onClick={() => void open(false)}><Eye size={16} /></button>
    <button className="icon-button" type="button" aria-label={"Descargar "+name} disabled={busy} onClick={() => void open(true)}><Download size={16} /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
