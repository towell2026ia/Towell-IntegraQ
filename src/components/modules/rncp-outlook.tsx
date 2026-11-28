"use client";
import { useState } from "react";
import { followupCommand } from "@/lib/rncp/client";

const titles = {enviar_reclamos:"Reclamo",enviar_seguimientos:"Reporte de seguimiento",enviar_recordatorios:"Recordatorio"};
export type MailKind = keyof typeof titles;
interface Receipt {sender:string; recipient:string; folio:string; request:string;}
export function RncpOutlook({reportId, permitted}:{reportId:string; permitted:MailKind[]}) {
  const [prepared,setPrepared] = useState<{kind:MailKind;receipt:Receipt}>();
  const [reference,setReference] = useState(""), [message,setMessage] = useState(""), [busy,setBusy] = useState(false);
  async function prepare(kind:MailKind) {
    setBusy(true); setMessage(""); setPrepared(undefined); setReference("");
    try {
      const receipt=await followupCommand<Receipt>("prepare_mail",{reportId,kind,requestId:crypto.randomUUID()});
      setPrepared({kind,receipt});
    } catch(e) {setMessage(e instanceof Error ? e.message : "No se pudo preparar el correo.");}
    finally {setBusy(false);}
  }
  async function confirm() {
    if (!prepared) return;
    setBusy(true);
    try {
      await followupCommand("confirm_mail",{reportId,kind:prepared.kind,requestId:prepared.receipt.request,reference});
      setPrepared(undefined); setMessage("Se registró tu confirmación de envío.");
    } catch(e) {setMessage(e instanceof Error ? e.message : "No se pudo confirmar el envío.");}
    finally {setBusy(false);}
  }
  if (!permitted.length) return null;
  return <details><summary>Correspondencia con el proveedor</summary>
    {permitted.map(kind=><button key={kind} type="button" disabled={busy} onClick={()=>void prepare(kind)}>{titles[kind]}</button>)}
    {prepared && <div><p>Remitente institucional: {prepared.receipt.sender}</p>
      <a href={`mailto:${encodeURIComponent(prepared.receipt.recipient)}?subject=${encodeURIComponent(titles[prepared.kind]+" · "+prepared.receipt.folio)}`}>Abrir correo en Outlook</a>
      <label>Referencia del envío realizado<input value={reference} maxLength={300} onChange={e=>setReference(e.target.value)}/></label>
      <button type="button" disabled={busy || reference.trim().length<5} onClick={()=>void confirm()}>Registrar envío realizado</button></div>}
    {message && <p role="status">{message}</p>}</details>;
}
