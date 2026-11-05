"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useContinuityState, useFormDraft } from "@/components/workspace-continuity";
import { confirmLeaving } from "@/lib/workspace-continuity";
import { FileCheck2, Plus, X } from "lucide-react";
import { DocumentPreviewViewer } from "@/components/modules/document-preview-viewer";
import { certificationCanPublish, certificationStatus, certificationToday, type Certification, type CertificationCatalog, type CertificationFile } from "@/lib/customer-certifications";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url,{...init,cache:"no-store"});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "No fue posible completar la operación."),{status:response.status});
  return result as T;
}
export function CustomerCertificationsPanel() {
  const [catalog,setCatalog]=useState<CertificationCatalog|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [query,setQuery]=useContinuityState("certifications:query","");
  const [customerId,setCustomerId]=useContinuityState("certifications:customer","all");
  const [showRetired,setShowRetired]=useContinuityState("certifications:retired",false);
  const [selectedId,setSelectedId]=useContinuityState("certifications:selected","");
  const [editingId,setEditingId]=useContinuityState("certifications:editor","");
  const editing=editingId==="new"&&catalog?.administrator?"new":catalog?.administrator?catalog.certifications.find(c=>c.id===editingId&&c.active)??null:null;
  const setEditing=(record:Certification|"new"|null)=>setEditingId(typeof record==="string"?record:record?.id??"");
  const [preview,setPreview]=useState<CertificationFile|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [today,setToday]=useState(certificationToday);
  useEffect(()=>{
    const tick=()=>setToday(certificationToday());
    const timer=window.setInterval(tick,60000);window.addEventListener("focus",tick);
    return ()=>{window.clearInterval(timer);window.removeEventListener("focus",tick);};
  },[]);
  useEffect(()=>{
    let active=true;
    void requestJson<CertificationCatalog>("/api/customers/certifications").then(data=>{if(active){setCatalog(data);setError("");}}).catch(e=>{if(active){setError(e.message);if([401,403].includes(Number(e.status)))setCatalog(null);}}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[retry]);
  const refresh=()=>{setLoading(true);setRetry(v=>v+1);};
  const rows=(catalog?.certifications??[]).filter(c=>(showRetired||c.active)&&(customerId==="all"||(customerId==="general"?!c.external_organization_id:c.external_organization_id===customerId))&&[c.name,c.code,c.reference_number,c.issuer,c.certification_type].some(v=>v?.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))));
  const selected=rows.find(c=>c.id===selectedId)??rows[0];
  const customerName=(id:string|null)=>id?catalog?.customers.find(c=>c.id===id)?.name??"Cliente histórico":"General de Towell";
  const userName=(id:string)=>catalog?.responsibleUsers.find(u=>u.id===id)?.full_name??id;
  async function command(record:Certification,action:"publish"|"unpublish"|"retire") {
    if(!catalog?.administrator)return;
    const audience=record.external_organization_id?`únicamente ${customerName(record.external_organization_id)}`:"todos los clientes autorizados";
    if(!window.confirm(action==="publish"?`¿Autorizar la publicación de los archivos vigentes de «${record.name}» para ${audience}?`:action==="retire"?`¿Retirar «${record.name}» del catálogo? Se conservarán archivos e historial.`:`¿Retirar la publicación de «${record.name}» sin borrar sus archivos?`))return;
    const reason=action==="retire"?window.prompt("Motivo obligatorio del retiro:")?.trim():undefined;
    if(action==="retire"&&!reason){setError("Retiro cancelado: indica un motivo.");return;}
    setBusy(true);setError("");setNotice("");
    try {await requestJson("/api/customers/certifications",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({command:action,id:record.id,revision:record.revision,reason})});setNotice("Operación confirmada por el servidor.");refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function upload(record:Certification,file:File,replaceId?:string) {
    const form=new FormData();form.set("file",file);form.set("revision",String(record.revision));if(replaceId)form.set("replaceId",replaceId);
    return requestJson<{certification:Certification}>(`/api/customers/certifications/${record.id}/files`,{method:"POST",body:form});
  }
  async function addFile(record:Certification,file:File,replaceId?:string) {
    setBusy(true);setError("");setNotice("");
    try {await upload(record,file,replaceId);setNotice("Archivo registrado. La certificación queda privada hasta una nueva publicación explícita.");refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function fileUrl(file:CertificationFile,showPreview=false) {
    return (await requestJson<{url:string}>(`/api/customers/certifications/${file.resource_id}/files/${file.id}${showPreview?"?preview=1":""}`)).url;
  }
  async function download(file:CertificationFile){try{window.location.assign(await fileUrl(file));}catch(e){setError((e as Error).message);}}
  return <section className="quality-table-panel">
    <header><div><h3>Certificaciones</h3><p>Próxima a vencer: 30 días o menos. Las fechas de emisión y vencimiento son inclusivas. Toda alta y modificación queda privada.</p></div>{catalog?.administrator?<button className="button button-primary" type="button" onClick={()=>setEditing("new")}><Plus size={16}/> Agregar certificación</button>:<FileCheck2 size={19}/>}</header>
    {notice?<p role="status">{notice}</p>:null}
    {error?<p role="alert">{error} <button className="button button-secondary" type="button" onClick={refresh}>Reintentar</button></p>:null}
    {loading?<p role="status">Consultando certificaciones…</p>:null}
    {catalog?<>
      <div className="form-grid"><label><span>Buscar certificación</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre, tipo, referencia u organismo"/></label><label><span>Expediente</span><select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="all">Todos los expedientes autorizados</option><option value="general">General de Towell</option>{catalog.customers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label><input type="checkbox" checked={showRetired} onChange={e=>setShowRetired(e.target.checked)}/> Consultar retiradas</label></div>
      <div className="quality-table-wrap"><table className="quality-table"><thead><tr><th>Certificación / tipo</th><th>Cliente</th><th>Referencia / emisor</th><th>Emisión / vencimiento</th><th>Estado</th><th>Publicación</th><th>Expediente</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.name}</strong><br/>{c.certification_type}</td><td>{customerName(c.external_organization_id)}</td><td>{c.reference_number||"Sin referencia"}<br/>{c.issuer}</td><td>{c.valid_from}<br/>{c.valid_until}</td><td>{c.active?certificationStatus(c,today):"Retirada"}</td><td>{c.customer_visible&&certificationCanPublish(c,today)?"Publicada":"Privada / no vigente"}</td><td><button className="button button-secondary" type="button" onClick={()=>setSelectedId(c.id)}>Consultar</button></td></tr>)}{!rows.length?<tr><td colSpan={7}>No hay certificaciones registradas para este alcance.</td></tr>:null}</tbody></table></div>
      {selected?<div className="party-detail-panel"><header><h3>{selected.name}</h3><p>{customerName(selected.external_organization_id)} · {selected.code}</p></header><div className="party-detail-section"><p><strong>Alcance:</strong> {selected.scope||"Sin descripción"}</p><p><strong>Observaciones:</strong> {selected.observations||"Sin observaciones"}</p><p><strong>Responsable:</strong> {userName(selected.responsible_id)}</p><p>Creada: {selected.created_at} · {userName(selected.created_by)}<br/>Última modificación: {selected.updated_at} · {userName(selected.updated_by??selected.created_by)}</p>
        {catalog.administrator&&selected.active?<div className="configuration-actions"><button className="button button-secondary" disabled={busy} type="button" onClick={()=>setEditing(selected)}>Editar certificación</button><button className="button button-secondary" disabled={busy||(!selected.customer_visible&&!certificationCanPublish(selected,today))} type="button" onClick={()=>void command(selected,selected.customer_visible?"unpublish":"publish")}>{selected.customer_visible?"Retirar publicación":`Publicar ${selected.external_organization_id?"para este cliente":"para todos los clientes"}`}</button><button className="button button-ghost" disabled={busy} type="button" onClick={()=>void command(selected,"retire")}>Retirar certificación</button></div>:null}
        {!selected.active?<p>Retirada: {selected.deletion_reason}</p>:null}
        <h4>Documentos y versiones</h4><p>Archivos originales privados · PDF, imágenes, Word o XLSX · máximo 4 MB por archivo.</p>
        {catalog.administrator&&selected.active?<label className="button button-secondary file-button">Adjuntar documento<input type="file" disabled={busy} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void addFile(selected,file);}}/></label>:null}
        {catalog.files.filter(f=>f.resource_id===selected.id).map(file=><article key={file.id}><strong>{file.original_name}</strong><p>Versión {file.version} · {file.is_current?"Actual":"Histórica"} · {file.size_bytes} bytes · {file.created_at} · {userName(file.uploaded_by)}</p><div className="configuration-actions"><button className="button button-secondary" type="button" onClick={()=>setPreview(file)}>Ver documento</button><button className="button button-secondary" type="button" onClick={()=>void download(file)}>Descargar original</button>{catalog.administrator&&selected.active&&file.is_current?<label className="button button-secondary file-button">Adjuntar nueva versión<input type="file" disabled={busy} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx" onChange={e=>{const next=e.target.files?.[0];e.target.value="";if(next)void addFile(selected,next,file.id);}}/></label>:null}</div></article>)}
        {!catalog.files.some(f=>f.resource_id===selected.id)?<p>Sin documentos adjuntos.</p>:null}
        <h4>Historial</h4>{catalog.history.filter(h=>h.resource_id===selected.id).map(h=><p key={h.id}>{h.created_at} · {h.action} · {userName(h.actor_id)}{h.reason?` · ${h.reason}`:""}</p>)}
      </div></div>:null}
      {editing?<CertificationEditor key={editing==="new"?"new":editing.id} record={editing==="new"?undefined:editing} catalog={catalog} onClose={()=>setEditing(null)} onSaved={record=>{setSelectedId(record.id);setNotice("Certificación guardada como privada.");setEditing(null);refresh();}} upload={upload}/>:null}
    </>:null}
    {preview?<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Vista previa de certificación"><div className="modal-header"><h3>{preview.original_name}</h3><button className="icon-button" type="button" aria-label="Cerrar vista previa" onClick={()=>setPreview(null)}><X size={18}/></button></div><DocumentPreviewViewer code="Certificación" version={{id:preview.id,revision:preview.version,status:"current",fileName:preview.original_name,uploadedBy:preview.uploaded_by,validator:"",modifiedAt:preview.created_at,changeReason:"Documento original de certificación",mimeType:preview.mime_type}} sourceUrl={()=>fileUrl(preview,true)} onReadyChange={()=>undefined}/><button className="button button-secondary" type="button" onClick={()=>void download(preview)}>Descargar original</button></div></div>:null}
  </section>;
}

function CertificationEditor({record:incomingRecord,catalog,onClose,onSaved,upload}:{record?:Certification;catalog:CertificationCatalog;onClose:()=>void;onSaved:(record:Certification)=>void;upload:(record:Certification,file:File)=>Promise<{certification:Certification}>}) {
  const [record]=useState(incomingRecord);
  const [draftId,setDraftId]=useContinuityState("certification:new-id",()=>crypto.randomUUID());
  const id=record?.id??draftId;
  const [saved,setSaved]=useState(record);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [customerQuery,setCustomerQuery]=useState("");
  const [customerId,setCustomerId]=useState(record?.external_organization_id??"");
  const [files,setFiles]=useState<File[]>([]);
  const {formRef:recoveryRef,notice:recoveryNotice,clear:clearRecovery}=useFormDraft(`certification:${record?.id??"new"}:${record?.revision??"new"}`,["name","type","reference","issuer","validFrom","validUntil","customerId","responsibleId","scope","observations"],values=>({...values,customerId:catalog.customers.some(c=>c.id===values.customerId&&c.active)?values.customerId:"",responsibleId:catalog.responsibleUsers.some(u=>u.id===values.responsibleId)?values.responsibleId:""}));
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError("");
    try {
      let current=(await requestJson<{certification:Certification}>("/api/customers/certifications",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({command:"save",id,revision:saved?.revision??catalog.certifications.find(c=>c.id===id)?.revision,name:form.get("name"),type:form.get("type"),reference:form.get("reference"),issuer:form.get("issuer"),validFrom:form.get("validFrom"),validUntil:form.get("validUntil"),scope:form.get("scope"),observations:form.get("observations"),responsibleId:form.get("responsibleId"),customerId})})).certification;
      setSaved(current);
      for(const file of files){current=(await upload(current,file)).certification;setSaved(current);setFiles(pending=>pending.filter(f=>f!==file));}
      clearRecovery();if(!record)setDraftId(crypto.randomUUID());onSaved(current);
    } catch(e){setError(`${(e as Error).message} Si el expediente ya se guardó, se conserva privado; los archivos pendientes permanecen seleccionados para reintentar.`);}finally{setBusy(false);}
  }
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Registro de certificación"><div className="modal-header"><h3>{record?"Editar certificación":"Nueva certificación"}</h3><button className="icon-button" type="button" aria-label="Cerrar" disabled={busy} onClick={()=>{if(confirmLeaving())onClose();}}><X size={18}/></button></div><form ref={recoveryRef} onSubmit={e=>void submit(e)}><fieldset disabled={busy}><div className="form-grid">
    <label><span>Nombre *</span><input name="name" maxLength={250} required defaultValue={record?.name}/></label><label><span>Tipo *</span><input name="type" maxLength={250} required defaultValue={record?.certification_type}/></label><label><span>Número o referencia</span><input name="reference" maxLength={5000} defaultValue={record?.reference_number??""}/></label><label><span>Organismo emisor *</span><input name="issuer" maxLength={250} required defaultValue={record?.issuer}/></label><label><span>Fecha de emisión *</span><input name="validFrom" type="date" required defaultValue={record?.valid_from}/></label><label><span>Fecha de vencimiento *</span><input name="validUntil" type="date" required defaultValue={record?.valid_until}/></label>
    <label><span>Buscar cliente</span><input disabled={!!record} value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="Nombre comercial o abreviatura"/></label><label><span>Cliente relacionado</span><select name="customerId" disabled={!!record} value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">General de Towell</option>{catalog.customers.filter(c=>(c.active||c.id===customerId)&&(c.id===customerId||`${c.name} ${c.code}`.toLowerCase().includes(customerQuery.toLowerCase()))).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select><small>El alcance se fija al crear el expediente para proteger su historial.</small></label>
    <label><span>Responsable *</span><select name="responsibleId" required defaultValue={record?.responsible_id??""}><option value="">Seleccionar responsable interno</option>{catalog.responsibleUsers.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label><span>Alcance / descripción</span><textarea name="scope" maxLength={5000} defaultValue={record?.scope??""}/></label><label><span>Observaciones internas</span><textarea name="observations" maxLength={5000} defaultValue={record?.observations??""}/></label><label><span>Documentos (opcionales, hasta 4 MB por archivo)</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx" onChange={e=>{setFiles(Array.from(e.target.files??[]));e.target.value="";}}/>{files.map((f,i)=><small key={`${f.name}-${i}`}>{f.name}</small>)}</label>
    </div></fieldset>{recoveryNotice?<p role="status">{recoveryNotice}</p>:null}{error?<p role="alert">{error}</p>:null}<div className="modal-footer"><button className="button button-secondary" type="button" disabled={busy} onClick={()=>{if(confirmLeaving())onClose();}}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar como privada"}</button></div></form></div></div>;
}
