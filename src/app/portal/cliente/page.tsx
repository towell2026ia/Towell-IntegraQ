"use client";
import { useEffect, useRef, useState } from "react";
import { CustomerPortal } from "@/components/modules/stakeholder-portal-module";
import { readCustomerLink } from "@/lib/customer-portal-link-client";
import type { PortalCompany } from "@/lib/portal-access";

export default function CustomerLinkPage() {
  const entry = useRef("");
  const [access, setAccess] = useState<{key: string; company: PortalCompany} | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let controller: AbortController;
    function open() {
      controller?.abort();
      controller = new AbortController();
      const {signal} = controller;
      if (window.location.hash) {
        entry.current = window.location.hash.slice(1);
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
      const key = entry.current;
      setAccess(null);
      setError("");
      if (!/^[A-Za-z0-9_-]{43}$/.test(key)) { setError("Enlace no disponible."); return; }
      void readCustomerLink("/entry", key, signal).then(async response => {
        if (!response.ok) throw new Error();
        const company = await response.json() as PortalCompany;
        if (!signal.aborted) setAccess({key, company});
      }).catch(() => { if (!signal.aborted) setError("Enlace no disponible. Abre el enlace vigente de tu empresa."); });
    }
    open();
    window.addEventListener("hashchange", open);
    return () => { controller.abort(); window.removeEventListener("hashchange", open); };
  }, []);
  return <main>{access ? <CustomerPortal key={access.key} company={access.company} accessKey={access.key}/> :
    <p role="status">{error || "Abriendo el portal del cliente…"}</p>}</main>;
}
