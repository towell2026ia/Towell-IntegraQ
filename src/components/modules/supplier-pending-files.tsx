"use client";

import type { Dispatch, SetStateAction } from "react";
import { FileText, Replace, X } from "lucide-react";
import { attachmentDescription } from "@/lib/attachment-description";
import styles from "./supplier-portal.module.css";

export const supplierFileTypes = ".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx";

export function SupplierPendingFiles({
  files,
  setFiles,
  disabled,
}: {
  files: File[];
  setFiles: Dispatch<SetStateAction<File[]>>;
  disabled: boolean;
}) {
  if (!files.length) return null;
  return (
    <section
      className={styles.pendingFiles}
      aria-label="Archivos pendientes de guardar"
    >
      <h4>Archivos seleccionados ({files.length})</h4>
      <ul>
        {files.map((file, index) => (
          <li key={index}>
            <FileText size={18} aria-hidden="true" />
            <div className={styles.fileInfo}>
              <strong>{file.name}</strong>
              <small>
                {attachmentDescription(file)} · Pendiente de guardar
              </small>
            </div>
            <div className={styles.fileControls}>
              <label className="button button-secondary file-button">
                <Replace size={14} aria-hidden="true" /> Sustituir
                <input
                  type="file"
                  aria-label={`Sustituir ${file.name}`}
                  accept={supplierFileTypes}
                  disabled={disabled}
                  onChange={({ currentTarget }) => {
                    const replacement = currentTarget.files?.[0];
                    if (replacement) {
                      setFiles((current) =>
                        current.map((item, i) =>
                          i === index ? replacement : item
                        )
                      );
                    }
                    currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                aria-label={`Retirar ${file.name}`}
                disabled={disabled}
                onClick={() =>
                  setFiles((current) => current.filter((_, i) => i !== index))}
              >
                <X size={14} aria-hidden="true" /> Retirar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
