"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { loadCurrentQualityPolicy } from "@/lib/document-storage";
import type { ControlledDocument } from "@/lib/document-control-data";
import type { ActiveSession } from "@/lib/session-data";
import { AuthorizedDocumentPreview } from "./document-type-workspace";
import styles from "./quality-policy-dialog.module.css";

export function QualityPolicyDialog({ session, onClose }: { session: ActiveSession; onClose: () => void }) {
  const [result, setResult] = useState<ControlledDocument | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    loadCurrentQualityPolicy(session).then(doc => {
      if (active) setResult(doc);
    }).catch(() => { if (active) setResult("error"); });
    return () => { active = false; };
  }, [session, attempt]);
  useEffect(() => {
    overlay.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [result]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = overlay.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(<div className={styles.policyOverlay} ref={overlay}>
    {result && result !== "error"
      ? <AuthorizedDocumentPreview document={result} session={session} activeOnly onClose={onClose} />
      : <div className="quality-modal-backdrop"><section className="quality-modal" role="dialog" aria-modal="true" aria-label="Política de Calidad">
          <header><h3>Política de Calidad</h3><button type="button" className="button button-secondary" onClick={onClose}>Cerrar</button></header>
          {result === "error" ? <p role="alert">La política vigente no está disponible. <button type="button" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Reintentar</button></p>
            : <span role="status" aria-label="Abriendo la política"><LoaderCircle size={16} className="spin" /></span>}
        </section></div>}
  </div>, document.body);
}
