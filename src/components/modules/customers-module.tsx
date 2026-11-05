"use client";

import {
  CheckCircle2,
  ClipboardCheck,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { useExternalCompanies } from "@/hooks/use-external-companies";
import { saveExternalCompany } from "@/lib/external-company-data";
import {
  customerQualityCatalog,
  type CustomerQualityRecord,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction } from "@/lib/types";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { CustomerClaimsPanel, useClaimsCatalog } from "@/components/modules/customer-claims-panel";
import { claimMetrics, type CustomerClaim } from "@/lib/customer-claims";
import { useContinuityState, useFormDraft } from "@/components/workspace-continuity";
import { confirmLeaving } from "@/lib/workspace-continuity";
import { CustomerCertificationsPanel } from "@/components/modules/customer-certifications-panel";

type CustomerView = "customers" | "cases" | "certifications";

export function CustomersModule({ demoMode, session, onCreateA3, onOpenA3 }: { actions: CorrectiveAction[]; demoMode: boolean; session: ActiveSession; onCreateA3: (claim: CustomerClaim) => void; onOpenA3: (id: string) => void }) {
  const [view, setView] = useContinuityState<CustomerView>("customers:tab","customers");
  const [demoCustomers, setDemoCustomers] = useState(customerQualityCatalog);
  const [query, setQuery] = useContinuityState("customers:query","");
  const [selectedId, setSelectedId] = useContinuityState("customers:selected","");
  const [isCreateOpen, setCreateOpen] = useContinuityState("customers:create-open",false);
  const [isEditOpen, setEditOpen] = useContinuityState("customers:edit-open",false);
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");
  const companyDirectory = useExternalCompanies();
  const claimsDirectory = useClaimsCatalog(!demoMode);
  const administrator = isAdministrator(session);
  const navigateView=(next:CustomerView)=>{if(confirmLeaving())setView(next);};
  const customers = demoMode
    ? demoCustomers
    : companyDirectory.companies
      .filter((company) => company.kind === "customer" && company.active)
      .map((company) => ({ id: company.id, code: company.code, name: company.name, legalName: company.legalName, taxId: company.taxId, address: company.address, contactName: company.contactName, contactEmail: company.contactEmail, claims: claimMetrics(claimsDirectory.data?.claims??[],claimsDirectory.data?.actions??[],{customerId:company.id}).received, findings: 0, openActions: (claimsDirectory.data?.actions??[]).filter(a=>a.external_organization_id===company.id&&a.status!=="closed").length, nextExternalAudit: "Sin programar", certificates: 0 }));

  const filteredCustomers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return customers.filter(
      (customer) =>
        !normalized ||
        [customer.code, customer.name].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        ),
    );
  }, [customers, query]);

  const selected =
    filteredCustomers.find((customer) => customer.id === selectedId) ?? filteredCustomers[0];
  const selectedMetrics = claimMetrics(claimsDirectory.data?.claims??[],claimsDirectory.data?.actions??[],{customerId:selected?.id});

  const addCustomer = async (customer: Pick<CustomerQualityRecord, "code" | "name">) => {
    setOperationError("");
    if (!administrator) return;
    if (!demoMode) {
      try {
        const saved = await saveExternalCompany({ ...customer, kind: "customer" });
        companyDirectory.setCompanies(saved.companies);
        setSelectedId(saved.company.id);
        setCreateOpen(false);
        return true;
      } catch (cause) {
        setOperationError(cause instanceof Error ? cause.message : "No fue posible guardar el cliente.");
        return false;
      }
      return;
    }
    const record: CustomerQualityRecord = {
      ...customer,
      id: crypto.randomUUID(),
      claims: 0,
      findings: 0,
      openActions: 0,
      nextExternalAudit: "Sin programar",
      certificates: 0,
    };
    setDemoCustomers((current) => [record, ...current]);
    setSelectedId(record.id);
    setCreateOpen(false);
    return true;
  };

  const deactivateCustomer = async () => {
    if (!administrator || demoMode || !selected) return;
    if (!window.confirm(`Se desactivará ${selected.code} · ${selected.name}. Sus reclamaciones y relaciones históricas se conservarán. ¿Continuar?`)) return;
    const reason = window.prompt("Motivo obligatorio para desactivar el cliente:")?.trim() ?? "";
    if (!reason) {
      setOperationError("La desactivación se canceló: debes indicar un motivo.");
      return;
    }
    setOperationError("");
    setNotice("");
    try {
      const saved = await saveExternalCompany({ id: selected.id, code: selected.code, name: selected.name, kind: "customer", active: false, reason });
      companyDirectory.setCompanies(saved.companies);
      setSelectedId("");
      setNotice(`${selected.code} se desactivó. Sus relaciones e historial se conservaron.`);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "No fue posible desactivar el cliente.");
    }
  };

  const editCustomer = async (customer: Pick<CustomerQualityRecord, "id" | "code" | "name" | "legalName" | "taxId" | "address" | "contactName" | "contactEmail">) => {
    if (!administrator || demoMode) return;
    setOperationError("");
    setNotice("");
    try {
      const saved = await saveExternalCompany({ ...customer, kind: "customer" });
      companyDirectory.setCompanies(saved.companies);
      setSelectedId(saved.company.id);
      setEditOpen(false);
      setNotice("Cliente actualizado.");
      return true;
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "No fue posible actualizar el cliente.");
      return false;
    }
  };

  if (!demoMode && companyDirectory.loading && !companyDirectory.hasLoaded) return <div className="access-empty" role="status"><p>Consultando clientes registrados…</p></div>;
  if (!demoMode && companyDirectory.error && !companyDirectory.hasLoaded) return <div className="access-empty" role="alert"><p>No fue posible consultar los clientes: {companyDirectory.error}</p><button className="button button-secondary" onClick={() => void companyDirectory.refresh()} type="button">Reintentar</button></div>;

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Gestión interna</p>
          <h2>Gestión de calidad de clientes</h2>
          <p>Expedientes de cliente conectados con reclamos y acciones de Root2Cause.</p>
        </div>
        {administrator ? <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Agregar cliente</button> : null}
      </section>

      {companyDirectory.error && companyDirectory.hasLoaded ? <p role="alert">No se pudo actualizar el catálogo. Se conserva la vista cargada. <button type="button" onClick={()=>void companyDirectory.refresh()}>Reintentar</button></p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {operationError ? <p role="alert">{operationError}</p> : null}

      <section className="metric-grid" aria-label="Resumen de clientes">
        <QualityMetric icon={<Users size={18} />} label="Clientes registrados" value={customers.length} tone="neutral" />
        <QualityMetric icon={<ClipboardCheck size={18} />} label="Reclamos recibidos" value={demoMode?customers.reduce((total,item)=>total+item.claims,0):claimsDirectory.data?claimMetrics(claimsDirectory.data.claims,claimsDirectory.data.actions).received:"—"} tone="danger" />
        <QualityMetric icon={<CheckCircle2 size={18} />} label="Acciones abiertas" value={customers.reduce((total, item) => total + item.openActions, 0)} tone="warning" />
      </section>

      <div className="quality-view-tabs" aria-label="Vistas de calidad de clientes">
        <button className={view === "customers" ? "active" : ""} type="button" onClick={() => navigateView("customers")}>Clientes</button>
        <button className={view === "cases" ? "active" : ""} type="button" onClick={() => navigateView("cases")}>Reclamos y hallazgos</button>
        <button className={view === "certifications" ? "active" : ""} type="button" onClick={() => navigateView("certifications")}>Certificaciones</button>
      </div>

      {view === "customers" ? (
        <section className="party-directory-layout">
          <div className="party-list-panel">
            <label className="panel-search party-search">
              <Search size={16} />
              <input aria-label="Buscar cliente" placeholder="Código o cliente" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="configuration-count">{filteredCustomers.length} clientes</div>
            <div className="party-list">
              {filteredCustomers.map((customer) => (
                <button className={customer.id === selected?.id ? "selected" : ""} key={customer.id} type="button" onClick={() => {if(confirmLeaving())setSelectedId(customer.id);}}>
                  <span><strong>{customer.name}</strong><small>{customer.code}</small></span>
                  <span className={customer.openActions > 0 ? "quality-state warning" : "quality-state success"}>
                    {customer.openActions > 0 ? `${customer.openActions} abiertas` : "Sin pendientes"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected ? <div className="party-detail-panel">
            <header>
              <span className="detail-eyebrow"><Users size={14} /> {selected.code}</span>
              <h3>{selected.name}</h3>
              <p>Expediente interno y contenido autorizado para su portal.</p>
              {administrator && !demoMode ? <div className="customer-detail-actions"><button className="button button-secondary" type="button" onClick={() => setEditOpen(true)}><Pencil size={15} /> Editar cliente</button><button className="button button-secondary" type="button" onClick={() => void deactivateCustomer()}>Desactivar cliente</button></div> : null}
            </header>
            <div className="party-detail-facts">
              <div><small>Reclamos totales</small><strong>{claimsDirectory.data?selectedMetrics.received:"—"}</strong></div>
              <div><small>Abiertos</small><strong>{claimsDirectory.data?selectedMetrics.open:"—"}</strong></div>
              <div><small>Cerrados</small><strong>{claimsDirectory.data?selectedMetrics.closed:"—"}</strong></div>
              <div><small>Sin A3</small><strong>{claimsDirectory.data?selectedMetrics.withoutA3:"—"}</strong></div>
            </div>
            {!demoMode?<CustomerClaimsPanel key={selected.id} directory={claimsDirectory} session={session} onCustomerCatalog={()=>setView("customers")} customerId={selected.id} onCreateA3={onCreateA3} onOpenA3={onOpenA3}/>:null}
            <section className="party-detail-section">
              <div className="section-title-row"><h4>Acceso del cliente</h4><span className="quality-state success">Cuenta aislada</span></div>
              <div className="account-scope-list">
                <div><ShieldCheck size={17} /><span><strong>Solo información propia</strong><small>Ningún cliente puede consultar expedientes de otra cuenta.</small></span></div>
                <div><ClipboardCheck size={17} /><span><strong>Acciones desde Root2Cause</strong><small>Se muestran reclamos, acciones correctivas y planes vinculados.</small></span></div>
              </div>
            </section>
          </div> : <div className="party-detail-panel"><p>{demoMode ? "No hay clientes en el catálogo." : "No hay clientes activos registrados en Supabase."}</p></div>}
        </section>
      ) : null}

      {view === "cases" ? (
        demoMode?<p>El registro de reclamos reales requiere una sesión de producción autorizada.</p>:<CustomerClaimsPanel directory={claimsDirectory} session={session} onCustomerCatalog={()=>setView("customers")} onCreateA3={onCreateA3} onOpenA3={onOpenA3}/>
      ) : null}

      {view === "certifications" ? (demoMode ? <p>Las certificaciones reales requieren una sesión de producción autorizada.</p> : <CustomerCertificationsPanel />) : null}

      {isEditOpen && selected && administrator && !demoMode ? <EditCustomerModal customer={selected} onClose={() => setEditOpen(false)} onSave={editCustomer} /> : null}
      {isCreateOpen && administrator ? <CreateCustomerModal onClose={() => setCreateOpen(false)} onCreate={addCustomer} /> : null}
    </>
  );
}

function EditCustomerModal({ customer, onClose, onSave }: { customer: Pick<CustomerQualityRecord, "id" | "code" | "name" | "legalName" | "taxId" | "address" | "contactName" | "contactEmail">; onClose: () => void; onSave: (customer: Pick<CustomerQualityRecord, "id" | "code" | "name" | "legalName" | "taxId" | "address" | "contactName" | "contactEmail">) => Promise<boolean | undefined> }) {
  const {formRef:recoveryRef,notice:recoveryNotice,clear:clearRecovery}=useFormDraft(`customer:edit:${customer.id}`, ["code","name","legalName","taxId","address","contactName","contactEmail"]);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const confirmed=await onSave({ id: customer.id, code: String(form.get("code")).trim(), name: String(form.get("name")).trim(), legalName: String(form.get("legalName")).trim() || undefined, taxId: String(form.get("taxId")).trim() || undefined, address: String(form.get("address")).trim() || undefined, contactName: String(form.get("contactName")).trim() || undefined, contactEmail: String(form.get("contactEmail")).trim() || undefined });
      if(confirmed)clearRecovery();
    } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" role="presentation"><div className="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="edit-customer-title"><div className="modal-header"><div><p className="module-kicker">Directorio</p><h3 id="edit-customer-title">Editar cliente</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={()=>{if(confirmLeaving())onClose();}}><X size={18} /></button></div><form ref={recoveryRef} onSubmit={(event) => void submit(event)}><div className="form-grid single-column"><label><span>Abreviatura</span><input name="code" required defaultValue={customer.code} /></label><label><span>Nombre comercial</span><input name="name" required defaultValue={customer.name} /></label><label><span>Razón social (opcional)</span><input name="legalName" defaultValue={customer.legalName ?? ""} /></label><label><span>RFC (opcional)</span><input name="taxId" defaultValue={customer.taxId ?? ""} /></label><label><span>Domicilio (opcional)</span><textarea name="address" rows={2} defaultValue={customer.address ?? ""} /></label><label><span>Contacto (opcional)</span><input name="contactName" defaultValue={customer.contactName ?? ""} /></label><label><span>Correo (opcional)</span><input name="contactEmail" type="email" defaultValue={customer.contactEmail ?? ""} /></label></div>{recoveryNotice?<p role="status">{recoveryNotice}</p>:null}<div className="modal-footer"><button className="button button-secondary" type="button" onClick={()=>{if(confirmLeaving())onClose();}}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></div></form></div></div>;
}

function QualityMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number|string; tone: "neutral" | "success" | "warning" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function CreateCustomerModal({ onClose, onCreate }: { onClose: () => void; onCreate: (customer: Pick<CustomerQualityRecord, "code" | "name">) => boolean | undefined | Promise<boolean | undefined> }) {
  const {formRef:recoveryRef,notice:recoveryNotice,clear:clearRecovery}=useFormDraft("customer:new",["code","name"]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() && name.trim()) void Promise.resolve(onCreate({ code: code.trim(), name: name.trim() })).then(confirmed=>{if(confirmed)clearRecovery();});
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="new-customer-title">
        <div className="modal-header"><div><p className="module-kicker">Directorio</p><h3 id="new-customer-title">Agregar cliente</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={()=>{if(confirmLeaving())onClose();}}><X size={18} /></button></div>
        <form ref={recoveryRef} onSubmit={submit}>
          <div className="form-grid single-column">
            <label><span>Código</span><input name="code" required value={code} onChange={(event) => setCode(event.target.value)} placeholder="CLI-004" /></label>
            <label><span>Nombre del cliente</span><input name="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
          </div>
          {recoveryNotice?<p role="status">{recoveryNotice}</p>:null}<div className="modal-footer"><button className="button button-secondary" type="button" onClick={()=>{if(confirmLeaving())onClose();}}>Cancelar</button><button className="button button-primary" type="submit">Agregar cliente</button></div>
        </form>
      </div>
    </div>
  );
}
