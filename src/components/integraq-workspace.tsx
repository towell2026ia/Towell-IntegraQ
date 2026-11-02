"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
  LogOut,
  Menu,
  Network,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Target,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { AccessModule } from "@/components/modules/access-module";
import { ActivityLogModule } from "@/components/modules/activity-log-module";
import { AuditsModule } from "@/components/modules/audits-module";
import { CalibrationsModule } from "@/components/modules/calibrations-module";
import { CorrectiveActionsModule } from "@/components/modules/corrective-actions-module";
import { ContinuousImprovementModule } from "@/components/modules/continuous-improvement-module";
import { CustomersModule } from "@/components/modules/customers-module";
import { DocumentsModule } from "@/components/modules/documents-module";
import { FormsModule } from "@/components/modules/forms-module";
import { HomeModule } from "@/components/modules/home-module";
import { HomeSettingsModule } from "@/components/modules/home-settings-module";
import { IndicatorsModule } from "@/components/modules/indicators-module";
import { ManagementReviewModule } from "@/components/modules/management-review-module";
import { ModulePlaceholder } from "@/components/modules/module-placeholder";
import { OrganizationModule } from "@/components/modules/organization-module";
import { ProcessesModule } from "@/components/modules/processes-module";
import { RisksOpportunitiesModule } from "@/components/modules/risks-opportunities-module";
import { StakeholderPortalModule } from "@/components/modules/stakeholder-portal-module";
import { SuppliersModule } from "@/components/modules/suppliers-module";
import { useIndicatorRuntime } from "@/hooks/use-indicator-runtime";
import { useHomeAppearance } from "@/lib/use-home-appearance";
import { withoutUnchangedSamples } from "@/lib/demo-cleanup";
import {
  demoCorrectiveActions,
  demoMeasurementAssets,
  enrichSavedCorrectiveActions,
} from "@/lib/demo-data";
import { normalizeMeasurementAssets } from "@/lib/metrology-data";
import {
  canAccessModule,
  getDefaultModuleForSession,
  resolveAuthorizedModule,
} from "@/lib/access-policy";
import {
  buildInitialControlledDocuments,
  mergeInitialControlledDocuments,
  synchronizeAppFormDocuments,
  type ControlledDocument,
} from "@/lib/document-control-data";
import {
  loadStoredControlledDocuments,
} from "@/lib/document-storage";
import {
  appFormCatalog,
  normalizeAppForms,
  type AppFormDefinition,
} from "@/lib/form-data";
import {
  buildInitialImprovementProjects,
  normalizeImprovementProjects,
  type ImprovementProject,
} from "@/lib/continuous-improvement-data";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import {
  buildInitialIndicatorDefinitions,
  buildInitialIndicatorResults,
  type ConfiguredIndicator,
  type IndicatorResults,
} from "@/lib/indicator-data";
import { applyIndicatorRuntimeAccess } from "@/lib/indicator-access";
import { DEFAULT_CAPTURE_DAYS_AFTER_CLOSE } from "@/lib/indicators/indicator-windows";
import {
  buildDemoManagementReviewHistory,
  type ManagementReviewRecord,
} from "@/lib/management-review-data";
import {
  isWorkspaceModuleId,
  workspaceModuleMeta,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import { isDemoSession, isExternalUser, type ActiveSession } from "@/lib/session-data";
import {
  loadRiskWorkspace,
  saveRiskWorkspace,
  startRiskAnalysis,
} from "@/lib/risk-workspace-storage";
import {
  externalAuditCalendar,
  supplierAuditSemesters,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";
import {
  buildInitialRiskWorkspace,
  buildEmptyRiskWorkspace,
  normalizeRiskWorkspace,
  type RiskWorkspaceState,
} from "@/lib/risk-opportunity-data";
import {
  initialAuditOccurrences,
  type AuditOccurrence,
} from "@/lib/audit-data";

const navigationGroups = [
  {
    label: "General",
    items: [{ id: "home" as const, icon: Gauge }],
  },
  {
    label: "Operación",
    items: [
      { id: "documents" as const, icon: FileText },
      { id: "risks" as const, icon: Target },
      { id: "indicators" as const, icon: ChartNoAxesCombined },
      { id: "audits" as const, icon: ShieldCheck },
      { id: "audit-app" as const, icon: Smartphone },
      { id: "corrective-actions" as const, icon: ClipboardCheck },
      { id: "customers" as const, icon: Users },
      { id: "suppliers" as const, icon: Network },
      { id: "management-review" as const, icon: Settings2 },
      { id: "continuous-improvement" as const, icon: TrendingUp },
      { id: "calibrations" as const, icon: Wrench },
    ],
  },
  {
    label: "Portales",
    items: [
      { id: "customer-portal" as const, icon: Users },
      { id: "supplier-portal" as const, icon: Network },
    ],
  },
  {
    label: "Configuración",
    items: [
      { id: "processes" as const, icon: Network },
      { id: "organization" as const, icon: Building2 },
      { id: "access" as const, icon: UserCog },
      { id: "home-settings" as const, icon: Settings2 },
      { id: "forms" as const, icon: Settings2 },
    ],
  },
  {
    label: "Plataforma",
    items: [
      { id: "ai-assistant" as const, icon: Bot },
      { id: "integrations" as const, icon: PlugZap },
      { id: "data-traceability" as const, icon: Database },
    ],
  },
] as const;

export function IntegraQWorkspace({
  onSignOut,
  session,
}: {
  onSignOut: () => void;
  session: ActiveSession;
}) {
  const demoMode = isDemoSession(session);
  const { appearance, error: appearanceError, refresh: refreshAppearance } = useHomeAppearance();
  const [activeModule, setActiveModule] = useState<WorkspaceModuleId>(() =>
    getDefaultModuleForSession(session),
  );
  const [navigationTarget, setNavigationTarget] = useState<{ module: WorkspaceModuleId; id: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [assets, setAssets] = useState<MeasurementAsset[]>(demoMeasurementAssets);
  const [loadedDocuments, setControlledDocuments] = useState<ControlledDocument[]>(
    () => demoMode ? buildInitialControlledDocuments() : [],
  );
  const [documentLoad, setDocumentLoad] = useState<{ session: ActiveSession; error: string | null } | null>(null);
  const [documentRetry, setDocumentRetry] = useState(0);
  const controlledDocuments = useMemo(
    () => demoMode || (documentLoad?.session === session && !documentLoad.error) ? loadedDocuments : [],
    [demoMode, documentLoad, session, loadedDocuments],
  );
  const [forms, setForms] = useState<AppFormDefinition[]>(() =>
    normalizeAppForms(appFormCatalog.map(form => ({ ...form, records: [] }))),
  );
  const [demoIndicatorDefinitions, setDemoIndicatorDefinitions] = useState<ConfiguredIndicator[]>(
    () => demoMode ? buildInitialIndicatorDefinitions() : [],
  );
  const [demoIndicatorResults, setDemoIndicatorResults] = useState<IndicatorResults>(
    () => demoMode ? buildInitialIndicatorResults() : {},
  );
  const [demoIndicatorCaptureDays, setDemoIndicatorCaptureDays] = useState(DEFAULT_CAPTURE_DAYS_AFTER_CLOSE);
  const indicatorRuntime = useIndicatorRuntime(
    !demoMode && !isExternalUser(session) && canAccessModule(session, "indicators"),
  );
  const indicatorDefinitions = demoMode ? demoIndicatorDefinitions : indicatorRuntime.definitions;
  const indicatorResults = demoMode ? demoIndicatorResults : indicatorRuntime.results;
  const indicatorSession = useMemo(
    () => demoMode || !indicatorRuntime.access ? session : applyIndicatorRuntimeAccess(session, indicatorRuntime.access),
    [demoMode, indicatorRuntime.access, session],
  );
  const [riskWorkspace, setRiskWorkspace] = useState<RiskWorkspaceState>(
    buildEmptyRiskWorkspace,
  );
  const [managementReviews, setManagementReviews] = useState<ManagementReviewRecord[]>(
    () => [],
  );
  const [improvementProjects, setImprovementProjects] = useState<ImprovementProject[]>(
    () => [],
  );
  const [auditOccurrences, setAuditOccurrences] = useState<AuditOccurrence[]>(
    initialAuditOccurrences,
  );
  const [storageReady, setStorageReady] = useState(false);
  const [riskServerReady, setRiskServerReady] = useState(false);
  const [riskLoadError, setRiskLoadError] = useState("");
  const [riskRetry, setRiskRetry] = useState(0);
  const loadedRiskSnapshot = useRef<string | null>(null);

  useEffect(() => {
    const syncModuleFromHash = () => {
      const hash = window.location.hash.slice(1);
      const requestedModule = isWorkspaceModuleId(hash) ? hash : null;
      const authorizedModule = resolveAuthorizedModule(
        session,
        requestedModule,
      );
      setActiveModule(authorizedModule);
      if (hash !== authorizedModule) {
        window.history.replaceState(null, "", `#${authorizedModule}`);
      }
    };

    syncModuleFromHash();
    window.addEventListener("hashchange", syncModuleFromHash);
    return () => window.removeEventListener("hashchange", syncModuleFromHash);
  }, [session]);

  useEffect(() => {
    const hydrationTask = window.setTimeout(() => {
      try {
        const savedActions = window.localStorage.getItem("integraq.correctiveActions");
        const savedAssets = window.localStorage.getItem("integraq.measurementAssets.v2");
        const savedDocuments = demoMode ? window.localStorage.getItem("integraq.controlledDocuments.v1") : null;
        const savedForms = window.localStorage.getItem("integraq.appForms.v1");
        const savedRiskWorkspace = window.localStorage.getItem("integraq.riskWorkspace.v1");
        const savedManagementReviews = window.localStorage.getItem("integraq.managementReviews.v2");
        const savedManagementReview = window.localStorage.getItem("integraq.managementReview.v1");
        const savedImprovementProjects = window.localStorage.getItem("integraq.improvementProjects.v2") ?? window.localStorage.getItem("integraq.improvementProjects.v1");
        const savedAudits = window.localStorage.getItem("integraq.auditOccurrences.v1");
        if (savedActions) {
          setActions(
            enrichSavedCorrectiveActions(
              withoutUnchangedSamples(JSON.parse(savedActions) as CorrectiveAction[], demoCorrectiveActions),
            ),
          );
        }
        if (savedAssets) setAssets(normalizeMeasurementAssets(JSON.parse(savedAssets) as MeasurementAsset[], demoMeasurementAssets));
        const hydratedForms = normalizeAppForms((savedForms
          ? JSON.parse(savedForms) as AppFormDefinition[]
          : appFormCatalog).map(form => ({ ...form,
          records: withoutUnchangedSamples(form.records, appFormCatalog.find(sample => sample.id === form.id)?.records ?? []),
        })));
        const hydratedDocuments = savedDocuments
          ? mergeInitialControlledDocuments(JSON.parse(savedDocuments) as ControlledDocument[])
          : buildInitialControlledDocuments();
        setForms(hydratedForms);
        if (demoMode) setControlledDocuments(
          synchronizeAppFormDocuments(hydratedDocuments, hydratedForms),
        );
        if (savedRiskWorkspace) {
          const saved = JSON.parse(savedRiskWorkspace) as RiskWorkspaceState;
          const samples = buildInitialRiskWorkspace();
          setRiskWorkspace(normalizeRiskWorkspace({ ...saved,
            risks: withoutUnchangedSamples(saved.risks ?? [], samples.risks),
            swotItems: withoutUnchangedSamples(saved.swotItems ?? [], samples.swotItems),
            actions: withoutUnchangedSamples(saved.actions ?? [], samples.actions),
            contributions: withoutUnchangedSamples(saved.contributions ?? [], samples.contributions),
            importIssues: withoutUnchangedSamples(saved.importIssues ?? [], samples.importIssues),
          }));
        }
        if (savedManagementReviews) {
          setManagementReviews(withoutUnchangedSamples(JSON.parse(savedManagementReviews) as ManagementReviewRecord[], buildDemoManagementReviewHistory()));
        } else if (savedManagementReview) {
          const migrated = JSON.parse(savedManagementReview) as ManagementReviewRecord;
          setManagementReviews(withoutUnchangedSamples([migrated], buildDemoManagementReviewHistory()));
        }
        if (savedImprovementProjects) {
          const samples = buildInitialImprovementProjects();
          setImprovementProjects(normalizeImprovementProjects(withoutUnchangedSamples(JSON.parse(savedImprovementProjects) as ImprovementProject[], [...samples, ...normalizeImprovementProjects(samples)], ["createdAt", "updatedAt"])));
        }
        if (savedAudits) {
          setAuditOccurrences(JSON.parse(savedAudits) as AuditOccurrence[]);
        }
      } catch {
        // Keep the empty state when browser storage is unavailable.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrationTask);
  }, [demoMode]);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("integraq.correctiveActions", JSON.stringify(actions));
    }
  }, [actions, storageReady]);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("integraq.measurementAssets.v2", JSON.stringify(assets));
    }
  }, [assets, storageReady]);

  useEffect(() => {
    if (!storageReady || !demoMode) return;
    window.localStorage.setItem("integraq.controlledDocuments.v1", JSON.stringify(loadedDocuments));
  }, [loadedDocuments, storageReady, demoMode]);

  useEffect(() => {
    if (!storageReady || demoMode) return;
    let active = true;
    void loadStoredControlledDocuments()
      .then((documents) => {
        if (!active) return;
        setControlledDocuments(documents);
        setDocumentLoad({ session, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setControlledDocuments([]);
        setDocumentLoad({ session, error: error instanceof Error ? error.message : "No fue posible consultar el catálogo de Supabase." });
      });
    return () => { active = false; };
  }, [storageReady, demoMode, session, documentRetry]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.appForms.v1", JSON.stringify(forms));
  }, [forms, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.riskWorkspace.v1", JSON.stringify(riskWorkspace));
  }, [riskWorkspace, storageReady]);

  useEffect(() => {
    if (!storageReady || isExternalUser(session)) return;
    let active = true;
    void loadRiskWorkspace()
      .then(({ state }) => {
        if (!active) return;
        const normalized = normalizeRiskWorkspace(state);
        loadedRiskSnapshot.current = JSON.stringify(normalized);
        setRiskWorkspace(normalized);
        setRiskServerReady(true);
        setRiskLoadError("");
      })
      .catch((cause: unknown) => {
        if (active) { setRiskServerReady(false); setRiskLoadError(cause instanceof Error ? cause.message : "No se pudo consultar la matriz de riesgos."); }
      });
    return () => { active = false; };
  }, [session, storageReady, riskRetry]);

  useEffect(() => {
    if (!riskServerReady || isExternalUser(session)) return;
    const snapshot = JSON.stringify(riskWorkspace);
    if (snapshot === loadedRiskSnapshot.current) return;
    const timer = window.setTimeout(() => {
      void saveRiskWorkspace(riskWorkspace)
        .then(() => { loadedRiskSnapshot.current = snapshot; })
        .catch((cause: unknown) => {
          setRiskServerReady(false);
          setRiskLoadError(cause instanceof Error ? cause.message : "No se pudo guardar la matriz de riesgos.");
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [riskServerReady, riskWorkspace, session]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.managementReviews.v2", JSON.stringify(managementReviews));
  }, [managementReviews, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.improvementProjects.v2", JSON.stringify(improvementProjects));
  }, [improvementProjects, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.auditOccurrences.v1", JSON.stringify(auditOccurrences));
  }, [auditOccurrences, storageReady]);

  const currentManagementReview = useMemo(
    () =>
      managementReviews.find((record) => record.period.year === new Date().getFullYear()) ??
      managementReviews[0] ??
      null,
    [managementReviews],
  );

  const activeMeta = workspaceModuleMeta[activeModule];
  const homeSources = useMemo(
    () => ({
      session,
      documents: controlledDocuments,
      documentLoadError: !demoMode && documentLoad?.session === session ? documentLoad.error : undefined,
      documentsLoading: !demoMode && documentLoad?.session !== session,
      actions,
      assets,
      indicators: indicatorDefinitions,
      indicatorResults,
      supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
      externalAudits: externalAuditCalendar,
      managementReview: currentManagementReview,
      risks: riskWorkspace,
    }),
    [demoMode, documentLoad, actions, assets, controlledDocuments, currentManagementReview, indicatorDefinitions, indicatorResults, riskWorkspace, session],
  );
  const managementReviewSources = useMemo(
    () => ({
      session,
      documents: controlledDocuments,
      actions,
      assets: withoutUnchangedSamples(assets, demoMeasurementAssets),
      indicators: indicatorDefinitions,
      indicatorResults,
      supplierAudits: [],
      externalAudits: [],
      customers: [],
      suppliers: [],
      certifications: [],
      rncpSummary: { total: 0, closed: 0, late: 0, inProcess: 0 },
    }),
    [actions, assets, controlledDocuments, indicatorDefinitions, indicatorResults, session],
  );
  const homeDashboard = useMemo(
    () => buildHomeDashboard(homeSources),
    [homeSources],
  );

  const changeModule = (module: WorkspaceModuleId, targetId?: string) => {
    const authorizedModule = resolveAuthorizedModule(session, module);
    setActiveModule(authorizedModule);
    setNavigationTarget(
      authorizedModule === module && targetId ? { module, id: targetId } : null,
    );
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setNavigationQuery("");
    window.scrollTo({ top: 0, behavior: "auto" });
    if (window.location.hash.slice(1) !== authorizedModule) {
      window.history.pushState(null, "", `#${authorizedModule}`);
    }
  };

  const changeForms = (nextForms: AppFormDefinition[]) => {
    setForms(nextForms);
    if (demoMode) setControlledDocuments((documents) =>
      synchronizeAppFormDocuments(documents, nextForms),
    );
  };

  const normalizedNavigationQuery = navigationQuery.trim().toLocaleLowerCase("es");
  const externalSession = isExternalUser(session);

  return (
    <div className="app-frame" data-text-size={appearance.textSize} style={{ "--app-text-scale": appearance.textSize / 100, "--home-text-scale": appearance.textSize / 100 } as CSSProperties}>
      {appearanceError ? <div className="app-appearance-error" role="alert">No se pudo consultar el tamaño de texto. <button type="button" onClick={refreshAppearance}>Reintentar</button></div> : null}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Image src="/brand/integraq-logo.png" alt="" width={38} height={38} priority />
          </div>
          <div>
            <div className="brand-name">IntegraQ</div>
            <div className="brand-subtitle">Gestión de calidad</div>
          </div>
          <button className="icon-button sidebar-close" type="button" title="Cerrar navegación" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="brand-flow-bar" aria-hidden="true" />

        <div className="sidebar-search">
          <Search size={15} />
          <input value={navigationQuery} onChange={(event) => setNavigationQuery(event.target.value)} placeholder="Buscar módulo" aria-label="Buscar módulo" />
        </div>

        <nav className="sidebar-nav" aria-label="Módulos principales">
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) =>
                canAccessModule(session, item.id) &&
                workspaceModuleMeta[item.id].label
                  .toLocaleLowerCase("es")
                  .includes(normalizedNavigationQuery),
            );
            if (visibleItems.length === 0) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-section-label">{group.label}</div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const meta = workspaceModuleMeta[item.id];
                  const isActive = item.id === activeModule;
                  return (
                    <button key={item.id} type="button" className={`nav-item ${isActive ? "nav-item-active" : ""}`} onClick={() => changeModule(item.id)}>
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{meta.label}</span>
                      {meta.status !== "Disponible" ? <span className={`nav-status nav-status-${meta.status.toLocaleLowerCase("es")}`} title={meta.status} /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="user-summary" onClick={onSignOut} title="Cerrar sesión" type="button">
            <div className="avatar">{session.initials}</div>
            <div className="user-copy"><strong>{session.shortName}</strong><span>{session.position}</span></div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" type="button" title="Abrir navegación" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <Image className="topbar-company-logo" src="/brand/towell-logo.jpg" alt="Towell" width={154} height={44} priority />
          </div>
          <h1 className="topbar-page-title">{activeMeta.label}</h1>
          <div className="topbar-actions">
            {!externalSession ? <button className="icon-button" type="button" title="Actividad" onClick={() => changeModule("home")}><Activity size={19} /></button> : null}
            {!externalSession ? <div className="notification-wrap">
              <button className="icon-button notification-button" type="button" title="Notificaciones" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                <Bell size={19} />{homeDashboard.alerts.length ? <span aria-label={`${homeDashboard.alerts.length} notificaciones`}>{homeDashboard.alerts.length}</span> : null}
              </button>
              {notificationsOpen ? (
                <div className="notification-popover">
                  <div className="popover-heading"><strong>Notificaciones</strong><small>{homeDashboard.alerts.length} pendientes</small></div>
                  {homeDashboard.alerts.slice(0, 5).map((alert) => (
                    <button key={alert.id} type="button" onClick={() => changeModule(alert.module, alert.targetId)}><AlertTriangle size={16} /><span><strong>{alert.title}</strong><small>{alert.alertType} · {alert.moduleLabel}</small></span></button>
                  ))}
                  {homeDashboard.alerts.length === 0 ? <div className="notification-empty">Sin alertas pendientes</div> : null}
                </div>
              ) : null}
            </div> : null}
          </div>
        </header>

        <main className={`workspace ${activeModule === "home" ? "workspace-home" : ""}`}>
          {activeModule === "home" ? <HomeModule loading={!storageReady} onNavigate={changeModule} sources={homeSources} /> : null}
          {activeModule === "processes" ? <ProcessesModule /> : null}
          {activeModule === "organization" ? <OrganizationModule session={session} /> : null}
          {activeModule === "access" ? <AccessModule /> : null}
          {activeModule === "home-settings" ? <HomeSettingsModule onChangeDocument={(updated) => setControlledDocuments(current => current.map(document => document.id === updated.id ? updated : document))} documents={controlledDocuments} session={session} onManageDocument={(id) => changeModule("documents", id)} /> : null}
          {activeModule === "data-traceability" ? <ActivityLogModule /> : null}
          {activeModule === "documents" && !demoMode && documentLoad?.session !== session ? <p role="status">Cargando el catálogo autorizado de Supabase…</p> : null}
          {activeModule === "documents" && !demoMode && documentLoad?.session === session && documentLoad.error ? <section role="alert"><p>{documentLoad.error}</p><button type="button" onClick={() => { setDocumentLoad(null); setDocumentRetry(value => value + 1); }}>Reintentar</button></section> : null}
          {activeModule === "documents" && (demoMode || (documentLoad?.session === session && !documentLoad.error)) ? <DocumentsModule controlledDocuments={controlledDocuments} focusId={navigationTarget?.module === "documents" ? navigationTarget.id : undefined} forms={forms} key={`documents-${navigationTarget?.module === "documents" ? navigationTarget.id : "index"}`} onControlledDocumentsChange={setControlledDocuments} session={session} /> : null}
          {activeModule === "forms" ? <FormsModule forms={forms} onFormsChange={changeForms} session={session} /> : null}
          {activeModule === "indicators" ? <IndicatorsModule captureDaysAfterClose={demoMode ? demoIndicatorCaptureDays : indicatorRuntime.settings.captureDaysAfterClose} definitions={indicatorDefinitions} error={demoMode ? "" : indicatorRuntime.error} focusId={navigationTarget?.module === "indicators" ? navigationTarget.id : undefined} key={`indicators-${navigationTarget?.module === "indicators" ? navigationTarget.id : "index"}`} loading={!demoMode && indicatorRuntime.loading} onDefinitionDelete={demoMode ? async (indicatorId) => { setDemoIndicatorDefinitions((definitions) => definitions.filter((indicator) => indicator.id !== indicatorId)); setDemoIndicatorResults((results) => { const next = { ...results }; delete next[indicatorId]; return next; }); } : indicatorRuntime.disableDefinition} onDefinitionSave={demoMode ? async (indicator) => { setDemoIndicatorDefinitions((definitions) => definitions.some((item) => item.id === indicator.id) ? definitions.map((item) => item.id === indicator.id ? indicator : item) : [...definitions, indicator]); } : indicatorRuntime.saveDefinition} onRefresh={demoMode ? async () => undefined : indicatorRuntime.refresh} onResultSave={demoMode ? async (input) => { setDemoIndicatorResults((results) => ({ ...results, [input.indicatorId]: { ...(results[input.indicatorId] ?? {}), [String(input.year)]: { ...(results[input.indicatorId]?.[String(input.year)] ?? {}), [input.quarter]: { value: input.value, comments: input.comments, evidenceFileId: input.evidenceFileId, adminOverrideReason: input.adminOverrideReason, submittedAt: new Date().toISOString(), submittedBy: session.name } } } })); } : indicatorRuntime.saveResult} onSettingsSave={demoMode ? async (days) => setDemoIndicatorCaptureDays(days) : async (days) => indicatorRuntime.saveSettings({ captureDaysAfterClose: days, timezone: "America/Mexico_City" })} results={indicatorResults} saving={!demoMode && indicatorRuntime.saving} session={indicatorSession} /> : null}
          {activeModule === "risks" && !demoMode && !riskServerReady ? <section role={riskLoadError ? "alert" : "status"}><p>{riskLoadError || "Consultando riesgos autorizados en Supabase…"}</p>{riskLoadError ? <button type="button" onClick={() => { setRiskLoadError(""); setRiskRetry(value => value + 1); }}>Reintentar</button> : null}</section> : null}
          {activeModule === "risks" && (demoMode || riskServerReady) ? <RisksOpportunitiesModule indicatorResults={indicatorResults} indicators={indicatorDefinitions} onActivate={async () => { const result = await startRiskAnalysis(); setRiskWorkspace(result.state); setRiskServerReady(true); return result; }} onChange={setRiskWorkspace} onNavigateToIndicators={(indicatorId) => changeModule("indicators", indicatorId)} serverConnected={riskServerReady} session={session} state={riskWorkspace} /> : null}
          {activeModule === "audits" ? <AuditsModule occurrences={auditOccurrences} onOccurrencesChange={setAuditOccurrences} session={session} /> : null}
          {activeModule === "corrective-actions" ? <CorrectiveActionsModule actions={actions} focusId={navigationTarget?.module === "corrective-actions" ? navigationTarget.id : undefined} key={`corrective-${navigationTarget?.module === "corrective-actions" ? navigationTarget.id : "index"}`} onActionsChange={setActions} session={session} /> : null}
          {activeModule === "calibrations" ? <CalibrationsModule assets={assets} focusId={navigationTarget?.module === "calibrations" ? navigationTarget.id : undefined} key={`calibrations-${navigationTarget?.module === "calibrations" ? navigationTarget.id : "index"}`} onAssetsChange={setAssets} session={session} /> : null}
          {activeModule === "customers" ? <CustomersModule actions={actions} /> : null}
          {activeModule === "suppliers" ? <SuppliersModule session={session} /> : null}
          {activeModule === "management-review" ? <ManagementReviewModule onRecordsChange={setManagementReviews} records={managementReviews} sources={managementReviewSources} /> : null}
          {activeModule === "continuous-improvement" ? <ContinuousImprovementModule projects={improvementProjects} onProjectsChange={setImprovementProjects} session={session} /> : null}
          {activeModule === "customer-portal" ? <StakeholderPortalModule kind="customer" actions={actions} session={session} /> : null}
          {activeModule === "supplier-portal" ? <StakeholderPortalModule kind="supplier" actions={actions} session={session} /> : null}
          {!["home", "processes", "organization", "access", "documents", "forms", "risks", "indicators", "audits", "corrective-actions", "calibrations", "customers", "suppliers", "management-review", "continuous-improvement", "customer-portal", "supplier-portal", "data-traceability"].includes(activeModule) ? <ModulePlaceholder module={activeMeta} /> : null}
        </main>
      </div>

    </div>
  );
}
