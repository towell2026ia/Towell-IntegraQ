"use client";
import { CustomerA3Detail } from "./customer-a3-detail";
import { readCustomerLink } from "@/lib/customer-portal-link-client";
import { SupplierEvidenceList } from "./supplier-evidence-list";
import { SupplierReportFiles } from "./supplier-report-files";
import { SupplierPortalAdmin } from "./supplier-portal-admin";
import { canAccessModule } from "@/lib/access-policy";
import { reportOperationalState, reportStateLabel } from "@/lib/rncp/flow";
import { PhotoAttachmentPicker } from "@/components/images/photo-attachment-picker";
import { rncpIdFromSearch } from "@/lib/rncp/link";
import { followupCommand } from "@/lib/rncp/client";

import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  ImagePlus,
  LockKeyhole,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { useRncpReports } from "@/hooks/use-rncp-reports";
import { useSupplierAssessments } from "@/hooks/use-supplier-assessments";
import { SupplierAuditPortal } from "./supplier-audit-portal";
import {
  resolvePortalCompany,
  type PortalCompany,
} from "@/lib/portal-access";
import type { ActiveSession } from "@/lib/session-data";
import { RncpEvidenceFile } from "./rncp-evidence-file";
import { saveRncpResponseAction, uploadRncpEvidence, type RncpReport } from "@/lib/rncp-data";
import { getSupplierAssessmentFileUrl, supplierAssessmentTypeLabel } from "@/lib/supplier-assessment-data";
import type { CorrectiveAction } from "@/lib/types";
import { loadPublishedCorrectiveActions, type PublishedCorrectiveAction } from "@/lib/root-cause-publication";
import portalStyles from "@/components/modules/stakeholder-portal.module.css";

type PortalKind = "customer" | "supplier";

type CustomerPublication = { id: string; customer_id: string | null; display_name: string; description: string | null; version: number; status: "draft" | "published" | "withdrawn" | "superseded"; file_id: string; original_name?: string; size_bytes?: number; revision: number; withdrawal_reason?: string | null; created_at: string; published_at?: string | null; withdrawn_at?: string | null; created_by_name?: string; published_by_name?: string; withdrawn_by_name?: string };

function CustomerPortalAdmin({ initialCustomerId = "" }: { initialCustomerId?: string }) {
  const [general, setGeneral] = useState(false);
  return <section className="party-detail-section">
    <div className="quality-view-tabs" aria-label="Alcance documental">
      <button type="button" className={general ? "active" : ""} aria-pressed={general} onClick={() => setGeneral(true)}>Generales para clientes</button>
      <button type="button" className={!general ? "active" : ""} aria-pressed={!general} onClick={() => setGeneral(false)}>Por cliente</button>
    </div>
    <PublicationLibrary key={general ? "general" : initialCustomerId} general={general} initialCustomerId={general ? "" : initialCustomerId}/>
  </section>;
}

function PublicationLibrary({general, initialCustomerId}: {general: boolean; initialCustomerId: string}) {
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [search, setSearch] = useState("");
  const [versionParent, setVersionParent] = useState<CustomerPublication | null>(null);
  const [publications, setPublications] = useState<CustomerPublication[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedCustomer, setLoadedCustomer] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = () => { setLoadedCustomer(null); setRevision(value => value + 1); };
  const matching = customers.filter(customer => (customer.code + " " + customer.name).toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
  const recipient = general ? {id:"", name:"todos los clientes"} : customers.find(customer => customer.id === customerId);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const suffix = general ? "?scope=general" : customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
      const response = await fetch(`/api/customer-portal/admin/documents${suffix}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok || body.available !== true || !Array.isArray(body.customers) || !Array.isArray(body.publications)) {
        throw new Error(body.error || "No fue posible consultar las publicaciones.");
      }
      if (controller.signal.aborted) return;
      setCustomers(body.customers);
      setPublications(body.publications.filter((item: CustomerPublication) => item.customer_id === (general ? null : customerId)));
      setLoadedCustomer(customerId);
      setError("");
    }
    void load().catch(cause => {
      if (controller.signal.aborted) return;
      setLoadedCustomer(null);
      setPublications([]);
      setError(cause instanceof Error ? cause.message : "No fue posible consultar las publicaciones.");
    });
    return () => controller.abort();
  }, [customerId, general, revision]);
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!recipient || loadedCustomer !== customerId) return; const form = event.currentTarget; const data = new FormData(form); if (general) data.set("scope","general"); else data.set("customerId", customerId); if (versionParent) data.set("previousPublicationId", versionParent.id);
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/customer-portal/admin/documents", { method: "POST", body: data }); const body = await response.json() as { error?: string };
      if (!response.ok) { if ([403,503].includes(response.status)) reload(); throw new Error(body.error || "No fue posible cargar el documento."); } form.reset(); setVersionParent(null); reload(); setMessage("Documento cargado en privado como borrador. Aún no es visible para el cliente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cargar el documento."); } finally { setBusy(false); }
  };
  const transition = async (item: CustomerPublication, action: "publish" | "withdraw") => {
    if (!recipient || loadedCustomer !== customerId || item.customer_id !== (general ? null : customerId)) return;
    const reason = action === "withdraw" ? window.prompt("Motivo obligatorio del retiro:")?.trim() : undefined;
    if (action === "withdraw" && !reason) return;
    if (action === "publish" && !window.confirm(`¿Publicar «${item.display_name}» para ${recipient.name}?`)) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/customer-portal/admin/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, scope: general ? "general" : "individual", action, reason, revision: item.revision }) }); const body = await response.json() as { error?: string };
      if (!response.ok) { if ([403,503].includes(response.status)) reload(); throw new Error(body.error || "No fue posible cambiar la publicación."); } reload(); setMessage(action === "publish" ? `Publicado para ${recipient.name}.` : "Publicación retirada; el original se conserva.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cambiar la publicación."); } finally { setBusy(false); }
  };
  return <>
    <section className="portal-record-list"><header><div><h3>{general ? "Documentos generales para clientes" : "Documentos por cliente"}</h3><p>{general ? "El borrador es privado. Al publicar, todos los clientes de esta organización con acceso al portal podrán consultarlo." : "Cada archivo permanece privado hasta su publicación para la empresa seleccionada."}</p></div><FileText size={19}/></header>
      {!general && <div className={portalStyles.recipientFilter}>
        <label>Buscar por código o nombre<input type="search" className="panel-search" value={search} disabled={busy}
          onChange={event => { setSearch(event.target.value); setCustomerId(""); setLoadedCustomer(customerId ? null : loadedCustomer); setPublications([]); setVersionParent(null); setMessage(""); setError(""); }}/></label>
        <label>Cliente destinatario<select disabled={busy} value={customerId} onChange={event => {
          setLoadedCustomer(null); setCustomerId(event.target.value); setPublications([]); setError(""); setVersionParent(null); setMessage("");
        }}><option value="">Seleccionar cliente</option>{matching.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label>
        {search && !matching.length && <small>Sin coincidencias.</small>}
      </div>}
      {!general && loadedCustomer === "" ? <p>Selecciona un cliente destinatario antes de publicar</p> : null}
      {loadedCustomer === null && !error ? <p role="status">Consultando publicaciones…</p> : null}
      {loadedCustomer === null && error ? <button type="button" onClick={reload}>Reintentar consulta</button> : null}
      {recipient && loadedCustomer === customerId ? <><form className={portalStyles.documentUpload} onSubmit={event => void upload(event)}>
        {versionParent ? <p>Se preparará la versión {versionParent.version + 1} de «{versionParent.display_name}»; la versión publicada anterior permanece disponible hasta publicar la nueva.</p> : null}
        <label><span>Nombre visible</span><input name="name" defaultValue={versionParent?.display_name ?? ""} required maxLength={200}/></label><label><span>Descripción</span><textarea name="description" defaultValue={versionParent?.description ?? ""} maxLength={1000}/></label>
        <label><span>PDF original</span><input name="file" type="file" accept="application/pdf,.pdf" required/></label>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Procesando…" : "Cargar privado como borrador"}</button>
      </form>
      <h4>Publicaciones e historial</h4>{publications.map(item => <article key={item.id}><div><code>Versión {item.version} · {item.status === "published" ? `Publicado para ${recipient.name}` : item.status === "draft" ? "Privado / borrador" : item.status === "withdrawn" ? "Retirado" : "Sustituido"}</code><h4>{item.display_name}</h4>{item.description ? <p>{item.description}</p> : null}<small>{item.original_name ?? item.file_id} · {item.size_bytes ? formatFileSize(item.size_bytes) : ""}<br/>Cargado {formatTimestamp(item.created_at)} · {item.created_by_name ?? "Administrador"}{item.published_at ? <><br/>Publicado {formatTimestamp(item.published_at)} · {item.published_by_name ?? "Administrador"}</> : null}{item.withdrawn_at ? <><br/>Retirado {formatTimestamp(item.withdrawn_at)} · {item.withdrawn_by_name ?? "Administrador"}</> : null}{item.withdrawal_reason ? ` · Motivo: ${item.withdrawal_reason}` : ""}</small></div><div className={portalStyles.documentLinks}><a className="button button-secondary" href={`/api/customer-portal/documents/${item.id}/file?admin=1&${general ? "scope=general" : "customerId=" + encodeURIComponent(customerId)}`} target="_blank" rel="noreferrer">Vista previa</a><a className="button button-secondary" href={`/api/customer-portal/documents/${item.id}/file?admin=1&${general ? "scope=general" : "customerId=" + encodeURIComponent(customerId)}&disposition=download`}>Descargar</a>{item.status === "draft" ? <button className="button button-primary" disabled={busy} onClick={() => void transition(item,"publish")}>Publicar para {recipient.name}</button> : item.status === "published" ? <><button className="button button-ghost" disabled={busy} onClick={() => void transition(item,"withdraw")}>Retirar publicación</button><button className="button button-ghost" type="button" disabled={busy} onClick={() => setVersionParent(item)}>Cargar nueva versión</button></> : null}</div></article>)}{publications.length===0 ? <PortalEmpty message={general ? "No hay documentos generales cargados." : "Este cliente aún no tiene documentos cargados."}/> : null}</> : null}
      {message ? <p role="status">{message}</p> : null}{error ? <div className="form-error" role="alert">{error}</div> : null}
    </section></>;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(value));
}

export function StakeholderPortalModule({
  kind,
  session, initialCustomerId,
}: {
  kind: PortalKind; initialCustomerId?: string;
  actions: CorrectiveAction[];
  session: ActiveSession;
}) {
  if (kind === "customer" && session.userType === "Administrador" && session.workspaceMode === "production") {
    return <CustomerPortal isAdministrator initialCustomerId={initialCustomerId} />;
  }
  if(kind==="supplier" && session.workspaceMode==="production"){
    if(!canAccessModule(session,"supplier-portal"))return <PortalAccessDenied/>;
    if(session.userType==="Administrador")return <SupplierPortalAdmin/>;
    if(session.userType!=="Proveedor")return <PortalAccessDenied/>;
  }
  const company = resolvePortalCompany(session, kind);
  if (!company || (kind === "customer" && (session.userType !== "Cliente" || session.externalParty?.kind !== "customer"))) return <PortalAccessDenied />;
  return kind === "customer" ? (
    <CustomerPortal key={session.authUserId + ":" + company.companyId} company={company} />
  ) : (
    <SupplierPortal key={[session.authUserId,company.companyId,company.siteId].join(":")} company={company} actorId={session.authUserId ?? ""} />
  );
}

type CustomerPortalDocument = {
  id: string; folderId: string; name: string; originalName: string; mimeType: string; sizeBytes: number;
  referenceType: "internal" | "external"; validityStatus: "current" | "not_current";
  validFrom?: string | null; validUntil?: string | null; description?: string | null; version: number;
  fileHref?: string; managedInCertifications?: boolean; general?: boolean;
};

export function CustomerPortal({ company, isAdministrator = false, accessKey, initialCustomerId }: { company?: PortalCompany; isAdministrator?: boolean; accessKey?: string; initialCustomerId?: string }) {
  const [view, setView] = useState<"documents" | "actions">("documents");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [actions, setActions] = useState<PublishedCorrectiveAction[]>([]);
  const [documents, setDocuments] = useState<CustomerPortalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState("");
  const [retry, setRetry] = useState(0);
  const [actionRetry, setActionRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (accessKey ? readCustomerLink("/documents", accessKey) : fetch("/api/customer-portal/documents", { cache: "no-store" })).then(async response => {
      const body = await response.json() as { documents?: CustomerPortalDocument[]; sectionErrors?: { documents?: string; certifications?: string }; error?: string };
      if (!response.ok || !Array.isArray(body.documents)) throw new Error(body.error || "No se pudieron consultar documentos y certificaciones.");
      if (active) {
        setDocuments(body.documents);
        setError([body.sectionErrors?.documents, body.sectionErrors?.certifications].filter(Boolean).join(" "));
      }
    }).catch(cause => {
      if (active) { setDocuments([]); setError(cause instanceof Error ? cause.message : "Documentos y certificaciones no disponibles."); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry, accessKey]);
  useEffect(() => {
    if (isAdministrator) return;
    let active = true;
    const result: Promise<PublishedCorrectiveAction[]> = accessKey ? readCustomerLink("/actions", accessKey).then(async response => {
      if (!response.ok) throw new Error();
      return (await response.json()).actions;
    }) : loadPublishedCorrectiveActions();
    void result.then(rows => {
      if (active) { setActions(rows); setActionsError(""); }
    }).catch(() => {
      if (active) { setActions([]); setActionsError("Mis análisis A3: no se pudieron consultar los análisis autorizados."); }
    }).finally(() => { if (active) setActionsLoading(false); });
    return () => { active = false; };
  }, [isAdministrator, actionRetry, accessKey]);
  async function openFile(item: CustomerPortalDocument, download: boolean) {
    if (!accessKey) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setError("Permite abrir una pestaña para consultar el archivo."); return; }
    tab.opener = null;
    try {
      const id = encodeURIComponent(item.id);
      const path = item.managedInCertifications ? "/certifications/" + id : "/documents/" + id + "/file";
      const response = await readCustomerLink(path + "?" + new URLSearchParams({...(item.general ? {scope:"general"} : {}), ...(download ? {disposition:"download"} : {})}), accessKey);
      if (!response.ok) throw new Error();
      const { url } = await response.json();
      if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error();
      tab.location.replace(url);
    } catch {
      tab.close();
      setError("El servidor no autorizó la apertura del archivo o el archivo no está disponible.");
    }
  }
  const selectedAction = actions.find((action) => action.id === selectedActionId);
  return (
    <>
      <PortalHeading title="Portal del cliente" account={isAdministrator ? "Administración por cliente" : company?.companyName ?? "Cliente"} description="Documentos, certificaciones y análisis A3 autorizados." />
      <div className="quality-view-tabs portal-tabs" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} aria-label="Secciones del Portal de Clientes">
        <button className={view === "documents" ? "active" : ""} type="button" onClick={() => setView("documents")}>Documentos</button>
        <button className={view === "actions" ? "active" : ""} type="button" onClick={() => setView("actions")}>Mis análisis A3</button>
      </div>
      {accessKey && <button type="button" onClick={() => { setRetry(n => n + 1); setActionRetry(n => n + 1); }}>Actualizar contenido</button>}
      {view === "documents" ? <section className="portal-record-list">
        {isAdministrator ? <CustomerPortalAdmin initialCustomerId={initialCustomerId}/> : null}
        <header><div><h3>{isAdministrator ? "Certificaciones publicadas" : "Documentos y certificaciones"}</h3></div><FileText size={19} /></header>
        {loading ? <PortalEmpty message="Consultando documentos autorizados…" /> : null}
        {error ? <div role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Reintentar</button></div> : null}
        {!loading ? documents.map(document => <article key={document.id}>
          <div><code>Versión {document.version}</code><h4>{document.name}</h4>{document.description ? <p>{document.description}</p> : null}<small>{document.originalName} · {formatFileSize(document.sizeBytes)}</small></div>
          <div className={portalStyles.documentLinks}>{accessKey ? <><button type="button" className="button button-secondary" onClick={() => void openFile(document, false)}>Ver documento</button><button type="button" className="button button-secondary" onClick={() => void openFile(document, true)}>Descargar</button></> : <><a className="button button-secondary" href={document.fileHref ?? `/api/customer-portal/documents/${document.id}/file${document.general ? "?scope=general" : ""}`} target="_blank" rel="noreferrer">Ver documento</a><a className="button button-secondary" href={`${document.fileHref ?? `/api/customer-portal/documents/${document.id}/file`}?${document.general ? "scope=general&" : ""}disposition=download`}>Descargar</a></>}
          </div>
        </article>) : null}
        {!loading && !error && documents.length === 0 ? <PortalEmpty message={isAdministrator ? "No hay documentos vigentes en el catálogo." : "No hay documentos publicados y vigentes para clientes."} /> : null}
      </section> : null}
      {view === "actions" ? (isAdministrator ? <PortalEmpty message="Los clientes sólo ven aquí los análisis A3 publicados expresamente para su propia cuenta." /> :
        selectedAction ? (
          <CustomerA3Detail key={selectedAction.id} id={selectedAction.id} accessKey={accessKey} back={() => setSelectedActionId("")}/>
        ) : <section className="portal-record-list">
          <header><div><h3>Mis análisis A3</h3><p>Únicamente análisis autorizados para esta cuenta; este portal permite consulta.</p></div><ClipboardCheck size={19} /></header>
          {actionsLoading ? <PortalEmpty message="Consultando acciones autorizadas…" /> : null}
          {actionsError ? <div role="alert">{actionsError} <button type="button" onClick={() => { setActionsLoading(true); setActionRetry(value => value + 1); }}>Reintentar</button></div> : null}
          {actions.map((action) => (
            <article key={action.id}>
              <div><code>{action.folio}</code><h4>{action.title}</h4><button className="button button-secondary portal-report-link" type="button" onClick={() => setSelectedActionId(action.id)}><FileText size={15} /> Ver información compartida</button></div>
              <dl><div><dt>Avance</dt><dd>{action.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(action.dueDate)}</dd></div></dl>
              <span className="quality-state warning">{action.status}</span>
            </article>
          ))}
          {!actionsLoading && !actionsError && actions.length === 0 ? <PortalEmpty message="No hay análisis A3 publicados para esta empresa." /> : null}
        </section>
      ) : null}
    </>
  );
}

function SupplierPortal({
  company,
  actorId,
}: {
  company: PortalCompany;
  actorId: string;
}) {
  const [view, setView] = useState<"rncp" | "audits" | "plans">(() =>
    typeof window !== "undefined" && rncpIdFromSearch(window.location.search)
      ? "plans"
      : "rncp",
  );
  const [selectedReportId, setSelectedReportId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : rncpIdFromSearch(window.location.search),
  );
  const [evidenceType, setEvidenceType] = useState(() =>
    selectedReportId ? "rncp" : "",
  );
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rncpDirectory = useRncpReports(true, "portal");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [auditDates, setAuditDates] = useState<string[]>([]);
  const assessmentDirectory = useSupplierAssessments(view === "audits");
  const allReports = rncpDirectory.reports.filter(
    (report) =>
      !report.deletedAt &&
      report.supplierId === company.companyId &&
      report.portalVisible,
  );
  const reports = allReports.filter(
    (r) => year === "all" || r.reportDate?.slice(0, 4) === year,
  );
  const detailId = selectedReportId || reports[0]?.id;
  const detail = useRncpReports(
    view === "plans" && evidenceType === "rncp" && Boolean(detailId),
    "detail",
    detailId,
  );
  const selectedReport = detail.reports.find((r) => r.id === detailId);
  const actionId =
    selectedAction ??
    selectedReport?.actions.find(
      (a) =>
        a.createdBy === actorId &&
        ["pending", "in_progress", "rejected"].includes(a.status),
    )?.id ??
    "";
  const assessments = assessmentDirectory.assessments.filter(
    (a) =>
      a.portalVisible &&
      a.supplierId === company.companyId &&
      (!company.siteId || !a.siteId || company.siteId === a.siteId),
  );
  const years = Array.from(
    new Set([
      String(new Date().getFullYear()),
      ...allReports.flatMap((r) =>
        r.reportDate ? [r.reportDate.slice(0, 4)] : [],
      ),
      ...assessments.map((a) => a.assessmentDate.slice(0, 4)),
      ...auditDates.map((d) => d.slice(0, 4)),
    ]),
  )
    .sort()
    .reverse();
  const states = reports.map((r) => reportOperationalState(r));
  const closed = states.filter((s) => s === "closed").length,
    late = states.filter((s) => s === "late").length;
  const nextCommitment = reports
    .filter((report) => report.responseDueDate && report.status !== "closed")
    .sort((left, right) =>
      (left.responseDueDate ?? "").localeCompare(right.responseDueDate ?? ""),
    )[0];

  const [readOnlyDetail,setReadOnlyDetail]=useState(false);
  function openReport(id:string,readOnly:boolean){
    setSelectedReportId(id);setReadOnlyDetail(readOnly);setFiles([]);setRequestId(crypto.randomUUID());
    setSelectedAction(null);setEvidenceType("rncp");setView("plans");setError("");setNotice("");
  }
  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReport) return;
    setSaving(true);
    setError("");
    setNotice("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      if (files.length && !form.get("executedAt"))
        throw new Error(
          "Indica la fecha de cumplimiento para adjuntar evidencias.",
        );
      if (selectedReport.origin === "historical")
        throw new Error(
          "El registro importado conserva su seguimiento histórico.",
        );
      if (selectedReport.origin === "native") {
        if (!selectedReport.notifiedAt)
          throw new Error(
            "Calidad todavía no ha registrado la comunicación formal y su plazo. No se guardó ningún avance.",
          );
        const documentTypes = Object.fromEntries(
          (selectedReport.responseRequirements?.documents ?? []).map((name) => [
            name,
            String(form.get(`document:${name}`) ?? ""),
          ]),
        );
        const result = await followupCommand<{ actionId: string }>(
          "save_response",
          {
            reportId: selectedReport.id,
            requestId,
            actionId: actionId || null,
            payload: {
              executedAt: String(form.get("executedAt") ?? ""),
              comment: String(form.get("comment") ?? ""),
              description: String(form.get("description") ?? ""),
              responsibleName: String(form.get("responsibleName") ?? ""),
              dueDate: String(form.get("dueDate") ?? ""),
              rootCause: String(form.get("rootCause") ?? ""),
              actionPlan: String(form.get("actionPlan") ?? ""),
              containment: String(form.get("containment") ?? ""),
              commitments: String(form.get("commitments") ?? ""),
              documentTypes,
            },
          },
        );
        setSelectedAction(result.actionId);
        for (const file of files)
          await uploadRncpEvidence(
            result.actionId,
            file,
            String(form.get("executedAt") ?? ""),
          );
        setFiles([]);
        if (form.get("status") === "submitted")
          await followupCommand("submit_delivery", {
            reportId: selectedReport.id,
            payload: { actionId: result.actionId },
          });
        setEvidenceRevision((v) => v + 1);
        await Promise.all([detail.refresh(), rncpDirectory.refresh()]);
        setNotice(
          form.get("status") === "submitted"
            ? "Respuesta enviada a Calidad para validación."
            : "Avance guardado. El plazo original continúa vigente.",
        );
        return;
      }
      const values = {
        reportId: selectedReport.id,
        description: String(form.get("description") ?? ""),
        responsibleName: String(form.get("responsibleName") ?? ""),
        dueDate: String(form.get("dueDate") ?? ""),
        executedAt: String(form.get("executedAt") ?? "") || undefined,
        comment: String(form.get("comment") ?? ""),
        status: String(form.get("status") ?? "in_progress") as
          | "pending"
          | "in_progress"
          | "submitted",
      };
      const result = await followupCommand<{ actionId: string }>(
        "save_response",
        {
          requestId,
          actionId: actionId || null,
          reportId: selectedReport.id,
          payload: values,
        },
      );
      setSelectedAction(result.actionId);
      for (const file of files)
        await uploadRncpEvidence(
          result.actionId,
          file,
          String(form.get("executedAt") ?? ""),
        );
      if (values.status !== "in_progress")
        await saveRncpResponseAction({ ...values, actionId: result.actionId });
      setEvidenceRevision((v) => v + 1);
      await Promise.all([detail.refresh(), rncpDirectory.refresh()]);
      setFiles([]);
      element.reset();
      setNotice("Acción y evidencias enviadas a Calidad para revisión.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible enviar la respuesta.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openAssessmentFile(assessmentId: string, download = false) {
    setError("");
    try {
      const result = await getSupplierAssessmentFileUrl(assessmentId, download);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible abrir el archivo.",
      );
    }
  }

  function addFiles(selected: FileList | File[] | null) {
    if (!selected) return;
    setFiles((current) => [...current, ...Array.from(selected)]);
  }
  return (
    <>
      <PortalHeading
        title="Portal de proveedores"
        account={`${company.companyName}${company.siteName ? ` · ${company.siteName}` : ""}`}
        description="RNCP, auditorías, planes de acción, plazos y evidencias de la cuenta."
      />
      <label>
        Año{" "}
        <select
          value={year}
          onChange={(e) => {
            if (
              files.length &&
              !window.confirm(
                "¿Descartar los archivos seleccionados al cambiar de año?",
              )
            )
              return;
            setYear(e.target.value);
            setSelectedReportId("");
            setSelectedAction(null);
            setRequestId(crypto.randomUUID());
            setFiles([]);
          }}
        >
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
          <option value="all">Todos</option>
        </select>
      </label>
      {view === "rncp" && !rncpDirectory.loading && !rncpDirectory.error && (
        <div className="metric-grid">
          {[
            ["Total RNCP", reports.length],
            ["Abiertos", reports.length - closed - late],
            ["Cerrados", closed],
            ["Tardíos", late],
          ].map(([label, value]) => (
            <article className="metric metric-blue" key={label}>
              <div>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            </article>
          ))}
        </div>
      )}
      {nextCommitment ? (
        <section className="portal-deadline-band">
          <CalendarDays size={18} />
          <div>
            <strong>
              Próximo compromiso: {formatDate(nextCommitment.responseDueDate!)}
            </strong>
            <p>Respuesta pendiente para {nextCommitment.folio}.</p>
          </div>
          <span
            className={`quality-state ${nextCommitment.late ? "danger" : "warning"}`}
          >
            {nextCommitment.late ? "Tardío" : "En tiempo"}
          </span>
        </section>
      ) : null}
      <div
        className="quality-view-tabs portal-tabs"
        aria-label="Vistas del portal de proveedores"
      >
        <button
          className={view === "rncp" ? "active" : ""}
          type="button"
          onClick={() => setView("rncp")}
        >
          Mis RNCP
        </button>
        <button
          className={view === "audits" ? "active" : ""}
          type="button"
          onClick={() => setView("audits")}
        >
          Mis auditorías y calificaciones
        </button>
        <button
          className={view === "plans" ? "active" : ""}
          type="button"
          onClick={() => {
            setEvidenceType("");setReadOnlyDetail(false);
            setView("plans");
          }}
        >
          Mis evidencias
        </button>
      </div>
      {view === "rncp" ? (
        <section className="portal-record-list">
          <header>
            <div>
              <h3>Reportes de no calidad asignados</h3>
              <p>Publicados desde Gestión de calidad de proveedores.</p>
            </div>
            <FileText size={19} />
          </header>
          {rncpDirectory.loading ? (
            <progress aria-label="Cargando reportes" />
          ) : rncpDirectory.error ? (
            <p role="alert">
              No se pudieron consultar los reportes.{" "}
              <button onClick={() => void rncpDirectory.refresh()}>
                Reintentar
              </button>
            </p>
          ) : (
            reports.map((record) => (
              <article key={record.id}>
                <div>
                  <code>{record.folio}</code>
                  <h4>{record.findingType ?? "Reporte de no calidad"}</h4>
                  <p>
                    {record.materialOrService ?? "Material pendiente"}
                    {record.siteName ? ` · ${record.siteName}` : ""}
                  </p>
                  {record.description&&<p>{record.description}</p>}
                  <button className="button button-secondary" onClick={()=>openReport(record.id,true)}>Ver reporte</button>
                  <button className="button button-secondary portal-report-link" onClick={()=>openReport(record.id,false)}><Send size={14}/> {record.status==="closed"||record.origin==="historical"?"Consultar plan":"Responder o consultar plan"}</button>
                </div>
                <dl>
                  <div>
                    <dt>Fecha</dt>
                    <dd>
                      {record.reportDate
                        ? formatDate(record.reportDate)
                        : "Pendiente"}
                    </dd>
                  </div>
                  <div>
                    <dt>Plazo</dt>
                    <dd>
                      {record.responseDueDate
                        ? formatDate(record.responseDueDate)
                        : "Pendiente"}
                    </dd>
                  </div>
                  <div>
                    <dt>Clasificación</dt>
                    <dd>{record.classification ?? "Sin clasificación"}</dd>
                  </div>
                  {record.firstValidProgressAt && (
                    <div>
                      <dt>Primer avance</dt>
                      <dd>{formatDate(record.firstValidProgressAt)}</dd>
                    </div>
                  )}
                </dl>
                <span
                  className={`quality-state ${reportOperationalState(record)==="late" ? "danger" : reportOperationalState(record)==="closed" ? "success" : "warning"}`}
                >
                  {portalStatus(record)}
                </span>
              </article>
            ))
          )}
          {!rncpDirectory.loading &&
          !rncpDirectory.error &&
          reports.length === 0 ? (
            <PortalEmpty message="No hay reportes de no calidad asignados a esta empresa y sucursal." />
          ) : null}
        </section>
      ) : null}
      {view === "plans" && (
        <SupplierEvidenceList
          key={year}
          year={year}
          revision={evidenceRevision}
        />
      )}
      {view === "plans" && (
        <label>
          Gestionar un expediente{" "}
          <select
            value={evidenceType}
            onChange={(e) => {setReadOnlyDetail(false);setEvidenceType(e.target.value)}}
          >
            <option value="">Seleccionar tipo</option>
            <option value="rncp">RNCP</option>
            <option value="audit">Auditoría</option>
          </select>
        </label>
      )}
      {(view === "audits" ||
        (view === "plans" && evidenceType === "audit")) && (
        <SupplierAuditPortal
          identity={company.companyId}
          year={year}
          onDates={setAuditDates}
          onEvidenceChange={() => setEvidenceRevision((v) => v + 1)}
          evidenceOnly={view === "plans"}
        />
      )}
      {view === "audits" ? (
        <>
          <section className="supplier-portal-audit">
            <header>
              <div>
                <h3>Auditorías y evaluaciones autorizadas</h3>
                <p>
                  Resultados publicados por Calidad para esta empresa y
                  sucursal.
                </p>
              </div>
              <FileCheck2 size={19} />
            </header>
            {assessmentDirectory.loading ? (
              <PortalEmpty message="Consultando resultados autorizados…" />
            ) : (
              <div className="quality-table-wrap">
                <table className="quality-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Resultado</th>
                      <th>Clasificación</th>
                      <th>Archivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessments
                      .filter(
                        (a) =>
                          year === "all" ||
                          a.assessmentDate.slice(0, 4) === year,
                      )
                      .map((assessment) => (
                        <tr key={assessment.id}>
                          <td>{formatDate(assessment.assessmentDate)}</td>
                          <td>
                            {supplierAssessmentTypeLabel(
                              assessment.assessmentType,
                            )}
                          </td>
                          <td>
                            <strong>
                              {assessment.score === undefined
                                ? "Sin puntuación"
                                : `${assessment.score}%`}
                            </strong>
                          </td>
                          <td>
                            {assessment.classification ?? "Sin clasificación"}
                          </td>
                          <td>
                            {assessment.sourceFile ? (
                              <>
                                <button
                                  className="evidence-link"
                                  onClick={() =>
                                    void openAssessmentFile(assessment.id)
                                  }
                                  type="button"
                                >
                                  <FileText size={14} /> Ver archivo
                                </button>{" "}
                                <button
                                  type="button"
                                  className="evidence-link"
                                  onClick={() =>
                                    void openAssessmentFile(assessment.id, true)
                                  }
                                >
                                  Descargar
                                </button>
                              </>
                            ) : (
                              "Sin archivo"
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!assessments.some(
                  (a) =>
                    year === "all" || a.assessmentDate.slice(0, 4) === year,
                ) ? (
                  <PortalEmpty message="No hay resultados autorizados para esta empresa y sucursal." />
                ) : null}
              </div>
            )}
            {error || assessmentDirectory.error ? (
              <div className="form-error" role="alert">
                {error || assessmentDirectory.error}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {view === "plans" && evidenceType === "rncp" ? (
        detail.loading ? (
          <progress aria-label="Cargando expediente" />
        ) : detail.error ? (
          <p role="alert">
            No se pudo consultar el expediente.{" "}
            <button onClick={() => void detail.refresh()}>Reintentar</button>
          </p>
        ) : (
          <SupplierRncpResponse
            key={detailId}
            readOnlyDetail={readOnlyDetail}
            actionId={actionId}
            onAction={(id) => {
              setSelectedAction(id);
              setRequestId(crypto.randomUUID());
              setFiles([]);
            }}
            actorId={actorId}
            error={error || rncpDirectory.error}
            files={files}
            onAddFiles={addFiles}
            onSelectReport={(id) => {
              if (
                files.length &&
                !window.confirm(
                  "Hay archivos pendientes. Cambiar de RNCP descarta sólo esta selección local. ¿Continuar?",
                )
              )
                return;
              setFiles([]);
              setSelectedAction(null);
              setRequestId(crypto.randomUUID());
              setSelectedReportId(id);
            }}
            notice={notice}
            onSubmit={submitPlan}
            report={selectedReport}
            reports={reports}
            saving={saving}
          />
        )
      ) : null}
    </>
  );
}

function SupplierRncpResponse({
  readOnlyDetail,
  actionId,
  onAction,
  actorId,
  error,
  files,
  notice,
  onAddFiles,
  onSelectReport,
  onSubmit,
  report,
  reports,
  saving,
}: {
  readOnlyDetail:boolean;
  actionId: string;
  onAction: (id: string) => void;
  actorId: string;
  error: string;
  files: File[];
  notice: string;
  onAddFiles: (files: FileList | File[] | null) => void;
  onSelectReport: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  report?: RncpReport;
  reports: RncpReport[];
  saving: boolean;
}) {
  const [photosPending, setPhotosPending] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const locked =
    report?.origin === "historical" ||
    report?.status === "closed" ||
    (report?.origin === "native" &&
      (!report.notifiedAt ||
        report.actions.some((action) => action.status === "submitted")));
  const previous = report?.actions.find(
    (action) => action.id === actionId && action.createdBy === actorId,
  );
  return (
    <section className="portal-action-form">
      <header>
        <div>
          <h3>Acciones y evidencias</h3>
          <p>
            Registra lo realizado y adjunta fotografías o documentos
            directamente a la RNCP.
          </p>
        </div>
        <ShieldCheck size={19} />
      </header>
      {report ? (
        <>
          <h4>{report.folio}</h4>
          <p>{report.description}</p>
          <p>
            Comunicación: {report.notifiedAt?.slice(0, 10) ?? "Pendiente"} ·
            Plazo:{" "}
            {report.responseDeadline?.slice(0, 10) ??
              report.responseDueDate ??
              "Pendiente"}
          </p>
          <div className="portal-rncp-selector">
            <label>
              RNCP
              <select
                value={report.id}
                onChange={(event) => {
                  if (
                    photosPending &&
                    !window.confirm(
                      "Hay fotografías sin confirmar. ¿Descartar esta selección local y cambiar de RNCP?",
                    )
                  )
                    return;
                  onSelectReport(event.target.value);
                }}
              >
                {reports.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.folio} · {item.findingType ?? "Sin descripción"}
                  </option>
                ))}
              </select>
            </label>
            <span
              className={`quality-state ${report.late ? "danger" : "warning"}`}
            >
              {report.late ? "Tardía" : portalStatus(report)}
            </span>
          </div>
          <SupplierReportFiles id={report.id} />
          {locked ? (
            <p>
              Expediente de sólo consulta: histórico, sin notificación formal,
              cerrado o con entrega en validación.
            </p>
          ) : null}
          {!locked && !readOnlyDetail && (
            <label>
              Acción del plan{" "}
              <select
                value={actionId}
                onChange={(e) => onAction(e.target.value)}
              >
                <option value="">Agregar acción</option>
                {report.actions
                  .filter(
                    (a) =>
                      a.createdBy === actorId &&
                      ["pending", "in_progress", "rejected"].includes(a.status),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.description}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!readOnlyDetail&&!locked&&<form
            key={actionId}
            onSubmit={(event) => {
              if (photosPending) {
                event.preventDefault();
                return;
              }
              void onSubmit(event);
            }}
          >
            <fieldset disabled={Boolean(locked) || saving}>
              <div className="rncp-form-grid">
                <label className="wide">
                  <span>Descripción *</span>
                  <textarea
                    name="description"
                    defaultValue={previous?.description}
                    rows={4}
                    required
                    placeholder="Describe la acción realizada o propuesta"
                  />
                </label>
                <label>
                  <span>Responsable *</span>
                  <input
                    name="responsibleName"
                    defaultValue={previous?.responsibleName}
                    required
                  />
                </label>
                <label>
                  <span>Fecha compromiso *</span>
                  <input
                    name="dueDate"
                    type="date"
                    defaultValue={previous?.dueDate ?? report.responseDueDate}
                    readOnly={Boolean(previous)}
                    required
                  />
                </label>
                <label>
                  <span>Fecha de ejecución</span>
                  <input
                    name="executedAt"
                    required={files.length > 0}
                    defaultValue={previous?.executedAt?.slice(0, 10)}
                    type="date"
                  />
                </label>
                <label>
                  <span>Estatus</span>
                  <select name="status" defaultValue="in_progress">
                    <option value="pending">Pendiente</option>
                    <option value="in_progress">En proceso</option>
                    <option value="submitted">
                      Realizada · enviar a Calidad
                    </option>
                  </select>
                </label>
                {report.origin === "native" ? (
                  <>
                    <label className="wide">
                      <span>Análisis de causa</span>
                      <textarea
                        name="rootCause"
                        defaultValue={previous?.rootCause}
                        rows={3}
                      />
                    </label>
                    <label className="wide">
                      <span>Plan de acciones</span>
                      <textarea
                        name="actionPlan"
                        defaultValue={previous?.actionPlan}
                        rows={3}
                      />
                    </label>
                    {report.responseRequirements?.containment ? (
                      <label className="wide">
                        <span>Contención requerida</span>
                        <textarea
                          name="containment"
                          defaultValue={previous?.containment}
                          rows={3}
                        />
                      </label>
                    ) : null}
                    <label className="wide">
                      <span>Observaciones y compromisos</span>
                      <textarea
                        name="commitments"
                        defaultValue={previous?.commitments}
                        rows={3}
                      />
                    </label>
                    {report.responseRequirements?.documents?.map((name) => (
                      <label key={name}>
                        <span>Documento requerido: {name}</span>
                        <select
                          name={`document:${name}`}
                          defaultValue={previous?.documentTypes?.[name] ?? ""}
                        >
                          <option value="">
                            Seleccionar evidencia guardada
                          </option>
                          {report.actions
                            .flatMap((action) => action.evidences)
                            .map((file) => (
                              <option key={file.id} value={file.id}>
                                {file.fileName}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                    <p className="wide">
                      Puedes guardar avances parciales. Para enviar a validación
                      se requieren causa, plan, compromisos, contención cuando
                      aplique y evidencias válidas. Los documentos obligatorios
                      se seleccionan después de adjuntarlos. Ninguna carga
                      cierra el reporte.
                    </p>
                  </>
                ) : null}
                <label className="wide">
                  <span>Comentario</span>
                  <textarea
                    name="comment"
                    defaultValue={previous?.comment}
                    rows={3}
                  />
                </label>
                <div className="wide rncp-upload-actions">
                  <PhotoAttachmentPicker
                    key={report.id}
                    scope="supplier-response"
                    camera
                    disabled={saving || locked}
                    label="Fotografías de acciones del proveedor"
                    onPendingChange={setPhotosPending}
                    onAccept={(file) => onAddFiles([file])}
                  />
                  <label className="button button-secondary file-button">
                    <ImagePlus size={15} /> Documento / original exacto (sin
                    compresión)
                    <input
                      accept=".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx"
                      multiple
                      type="file"
                      onChange={(event) => {
                        onAddFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <small>
                    JPG, JPEG, PNG, WEBP, PDF, XLS o XLSX · máximo configurado
                    por archivo.
                  </small>
                </div>
                {files.length ? (
                  <div className="wide rncp-selected-files">
                    {files.map((file, index) => (
                      <span key={`${file.name}-${index}`}>
                        <FileText size={13} /> {file.name} ·{" "}
                        {formatFileSize(file.size)} · Pendiente de guardar
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {notice ? (
                <div className="form-success">
                  <CheckCircle2 size={17} /> {notice}
                </div>
              ) : null}
              {error ? (
                <div className="form-error" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="configuration-actions">
                <button
                  className="button button-primary"
                  disabled={saving || locked || photosPending}
                  type="submit"
                >
                  <Send size={16} /> {saving ? "Enviando…" : "Guardar acción"}
                </button>
              </div>
            </fieldset>
          </form>}
          <div className="portal-rncp-actions">
            <h4>Acciones registradas</h4>
            <label>
              Estado de revisión{" "}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {Array.from(new Set(report.actions.map((a) => a.status))).map(
                  (status) => (
                    <option key={status} value={status}>
                      {actionStatusLabel(status)}
                    </option>
                  ),
                )}
              </select>
            </label>
            {report.actions
              .filter((a) => !statusFilter || a.status === statusFilter)
              .map((action) => (
                <article key={action.id}>
                  <div>
                    <strong>{action.description}</strong>
                    <small>
                      {action.responsibleName} · compromiso{" "}
                      {formatDate(action.dueDate)}
                    </small>
                    {action.validationComment ? (
                      <p>Calidad: {action.validationComment}</p>
                    ) : null}
                  </div>
                  <span
                    className={`quality-state ${action.status === "accepted" ? "success" : action.status === "rejected" ? "danger" : "warning"}`}
                  >
                    {actionStatusLabel(action.status)}
                  </span>
                  <div className="rncp-evidence-links">
                    {action.evidences.map((evidence) => (
                      <div key={evidence.id}>
                        <RncpEvidenceFile
                          id={evidence.id}
                          name={evidence.fileName}
                          bytes={evidence.sizeBytes}
                        />
                        {evidence.performedOn && (
                          <small>
                            Cumplimiento · {formatDate(evidence.performedOn)}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            {!report.actions.length ? (
              <p>Esta RNCP todavía no tiene acciones.</p>
            ) : null}
          </div>
        </>
      ) : (
        <PortalEmpty message="No hay RNCP disponibles para responder." />
      )}
    </section>
  );
}

function PortalHeading({ title, account, description }: { title: string; account: string; description: string }) {
  return <section className="module-heading portal-heading"><div><p className="module-kicker">Acceso externo</p><h2>{title}</h2><p>{description}</p></div><div className="portal-account"><UserRoundCheck size={18} /><span><small>Cuenta activa</small><strong>{account}</strong></span></div></section>;
}

function PortalEmpty({ message }: { message: string }) {
  return <div className="access-empty portal-empty"><LockKeyhole size={22} /><p>{message}</p></div>;
}

function PortalAccessDenied() {
  return <section className="access-empty portal-access-denied"><LockKeyhole size={28} /><h2>Acceso no disponible</h2><p>La sesión no tiene una empresa válida vinculada para este portal.</p></section>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function portalStatus(report: RncpReport) {
  return reportStateLabel(report);
}

function actionStatusLabel(status: RncpReport["actions"][number]["status"]) {
  return { pending: "Pendiente", in_progress: "En proceso", submitted: "Realizada", accepted: "Validada", rejected: "Rechazada", closed: "Validada" }[status];
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
