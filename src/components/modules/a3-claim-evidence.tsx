"use client";

import { useEffect, useState } from "react";
import { claimsRequest, type ClaimEvidence } from "@/lib/customer-claims";

export function A3ClaimEvidence({claimId}:{claimId:string}) {
  const [files,setFiles] = useState<Pick<ClaimEvidence,"id"|"original_name"|"created_at">[]>([]);
  const [message,setMessage] = useState("Consultando evidencias del reclamo…");
  useEffect(() => {
    let active = true;
    fetch("/api/root2cause/claim-evidence/"+claimId,{cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error();
      return await response.json() as {files:typeof files};
    }).then(result => {
      if (active) { setFiles(result.files); setMessage(result.files.length ? "" : "Sin evidencias vigentes en el reclamo."); }
    }).catch(() => { if (active) setMessage("No se pudo autorizar la consulta de evidencias del reclamo."); });
    return () => { active = false; };
  },[claimId]);
  async function download(fileId:string) {
    try {
      const { url } = await claimsRequest<{url:string}>("/"+claimId+"/evidence/"+fileId);
      const link = document.createElement("a"); link.href = url; link.referrerPolicy = "no-referrer"; link.click();
    } catch { setMessage("No se pudo autorizar la descarga."); }
  }
  return <section className="print-hidden"><h4>Evidencias del reclamo vinculado</h4>
    {message && <p role="status">{message}</p>}{files.map(file=><p key={file.id}>{file.original_name} · {file.created_at.slice(0,10)} <button type="button" onClick={()=>void download(file.id)}>Descargar original</button></p>)}
  </section>;
}
