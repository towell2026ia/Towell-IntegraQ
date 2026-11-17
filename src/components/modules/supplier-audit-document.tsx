"use client";
import { useCallback } from "react";
import { DocumentPreviewViewer } from "./document-preview-viewer";
import type { SupplierAuditFile } from "@/lib/supplier-audits/model";
import styles from "./supplier-audit-calendar.module.css";
export function SupplierAuditDocument({ eventId, file, resolveUrl }: { eventId: string; file: SupplierAuditFile; resolveUrl: () => Promise<string> }) {
  const onReady = useCallback(() => {}, []);
  return <div className={styles.preview}><DocumentPreviewViewer code={eventId} version={{ id: file.id, revision: file.version, fileName: file.original_name, uploadedBy: "", validator: "", modifiedAt: file.created_at, changeReason: "Documento original de auditoría", status: "current", mimeType: "application/pdf", sizeBytes: file.size_bytes }} onReadyChange={onReady} sourceUrl={resolveUrl} /></div>;
}
