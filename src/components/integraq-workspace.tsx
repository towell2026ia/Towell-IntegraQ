"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
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
import { useEffect, useMemo, useState } from "react";

import { AccessModule } from "@/components/modules/access-module";
import { CalibrationsModule } from "@/components/modules/calibrations-module";
import { CorrectiveActionsModule } from "@/components/modules/corrective-actions-module";
import { ContinuousImprovementModule } from "@/components/modules/continuous-improvement-module";
import { CustomersModule } from "@/components/modules/customers-module";
import { DocumentsModule } from "@/components/modules/documents-module";
import { HomeModule } from "@/components/modules/home-module";
import { IndicatorsModule } from "@/components/modules/indicators-module";
import { ManagementReviewModule } from "@/components/modules/management-review-module";
import { ModulePlaceholder } from "@/components/modules/module-placeholder";
import { OrganizationModule } from "@/components/modules/organization-module";
import { ProcessesModule } from "@/components/modules/processes-module";
import { StakeholderPortalModule } from "@/components/modules/stakeholder-portal-module";
import { SuppliersModule } from "@/components/modules/suppliers-module";
import {
  demoCorrectiveActions,
  demoMeasurementAssets,
  enrichSavedCorrectiveActions,
} from "@/lib/demo-data";
import {
  buildInitialControlledDocuments,
  type ControlledDocument,
} from "@/lib/document-control-data";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import {
  buildInitialIndicatorDefinitions,
  buildInitialIndicatorResults,
  normalizeConfiguredIndicators,
  type ConfiguredIndicator,
  type IndicatorResults,
} from "@/lib/indicator-data";
import {
  buildDemoManagementReviewHistory,
  type ManagementReviewRecord,
} from "@/lib/management-review-data";
import {
  isWorkspaceModuleId,
  workspaceModuleMeta,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import { activeSession } from "@/lib/session-data";
import {
  activeCertifications,
  customerQualityCatalog,
  externalAuditCalendar,
  rncpDashboardSummary,
  supplierAuditSemesters,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";

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

export function IntegraQWorkspace() {
  const [activeModule, setActiveModule] = useState<WorkspaceModuleId>("home");
  const [navigationTarget, setNavigationTarget] = useState<{ module: WorkspaceModuleId; id: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [actions, setActions] = useState<CorrectiveAction[]>(demoCorrectiveActions);
  const [assets, setAssets] = useState<MeasurementAsset[]>(demoMeasurementAssets);
  const [controlledDocuments, setControlledDocuments] = useState<ControlledDocument[]>(
    buildInitialControlledDocuments,
  );
  const [indicatorDefinitions, setIndicatorDefinitions] = useState<ConfiguredIndicator[]>(
    buildInitialIndicatorDefinitions,
  );
  const [indicatorResults, setIndicatorResults] = useState<IndicatorResults>(
    buildInitialIndicatorResults,
  );
  const [managementReviews, setManagementReviews] = useState<ManagementReviewRecord[]>(
    buildDemoManagementReviewHistory,
  );
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const syncModuleFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isWorkspaceModuleId(hash)) {
        setActiveModule(hash);
      }
    };

    if (!window.location.hash) {
      window.history.replaceState(null, "", "#home");
    }
    syncModuleFromHash();
    window.addEventListener("hashchange", syncModuleFromHash);
    return () => window.removeEventListener("hashchange", syncModuleFromHash);
  }, []);

  useEffect(() => {
    const hydrationTask = window.setTimeout(() => {
      try {
        const savedActions = window.localStorage.getItem("integraq.correctiveActions");
        const savedAssets = window.localStorage.getItem("integraq.measurementAssets");
        const savedDocuments = window.localStorage.getItem("integraq.controlledDocuments.v1");
        const savedDefinitions = window.localStorage.getItem("integraq.indicatorDefinitions.v3") ?? window.localStorage.getItem("integraq.indicatorDefinitions.v2");
        const savedResults = window.localStorage.getItem("integraq.indicatorResults.v3") ?? window.localStorage.getItem("integraq.indicatorResults.v2");
        const savedManagementReviews = window.localStorage.getItem("integraq.managementReviews.v2");
        const savedManagementReview = window.localStorage.getItem("integraq.managementReview.v1");
        if (savedActions) {
          setActions(
            enrichSavedCorrectiveActions(
              JSON.parse(savedActions) as CorrectiveAction[],
            ),
          );
        }
        if (savedAssets) setAssets(JSON.parse(savedAssets) as MeasurementAsset[]);
        if (savedDocuments) setControlledDocuments(JSON.parse(savedDocuments) as ControlledDocument[]);
        if (savedDefinitions) setIndicatorDefinitions(normalizeConfiguredIndicators(JSON.parse(savedDefinitions) as ConfiguredIndicator[]));
        if (savedResults) setIndicatorResults(JSON.parse(savedResults) as IndicatorResults);
        if (savedManagementReviews) {
          setManagementReviews(JSON.parse(savedManagementReviews) as ManagementReviewRecord[]);
        } else if (savedManagementReview) {
          const migrated = JSON.parse(savedManagementReview) as ManagementReviewRecord;
          setManagementReviews([
            migrated,
            ...buildDemoManagementReviewHistory().filter((record) => record.id !== migrated.id),
          ]);
        }
      } catch {
        // Demo data remains available when browser storage is unavailable.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrationTask);
  }, []);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("integraq.correctiveActions", JSON.stringify(actions));
    }
  }, [actions, storageReady]);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("integraq.measurementAssets", JSON.stringify(assets));
    }
  }, [assets, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.controlledDocuments.v1", JSON.stringify(controlledDocuments));
  }, [controlledDocuments, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.indicatorDefinitions.v3", JSON.stringify(indicatorDefinitions));
    window.localStorage.setItem("integraq.indicatorResults.v3", JSON.stringify(indicatorResults));
  }, [indicatorDefinitions, indicatorResults, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.managementReviews.v2", JSON.stringify(managementReviews));
  }, [managementReviews, storageReady]);

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
      session: activeSession,
      documents: controlledDocuments,
      actions,
      assets,
      indicators: indicatorDefinitions,
      indicatorResults,
      supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
      externalAudits: externalAuditCalendar,
      managementReview: currentManagementReview,
    }),
    [actions, assets, controlledDocuments, currentManagementReview, indicatorDefinitions, indicatorResults],
  );
  const managementReviewSources = useMemo(
    () => ({
      session: activeSession,
      documents: controlledDocuments,
      actions,
      assets,
      indicators: indicatorDefinitions,
      indicatorResults,
      supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
      externalAudits: externalAuditCalendar,
      customers: customerQualityCatalog,
      suppliers: supplierQualityCatalog,
      certifications: activeCertifications,
      rncpSummary: rncpDashboardSummary,
    }),
    [actions, assets, controlledDocuments, indicatorDefinitions, indicatorResults],
  );
  const homeDashboard = useMemo(
    () => buildHomeDashboard(homeSources),
    [homeSources],
  );

  const changeModule = (module: WorkspaceModuleId, targetId?: string) => {
    setActiveModule(module);
    setNavigationTarget(targetId ? { module, id: targetId } : null);
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setNavigationQuery("");
    window.scrollTo({ top: 0, behavior: "auto" });
    if (window.location.hash.slice(1) !== module) {
      window.history.pushState(null, "", `#${module}`);
    }
  };

  const normalizedNavigationQuery = navigationQuery.trim().toLocaleLowerCase("es");

  return (
    <div className="app-frame">
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
            const visibleItems = group.items.filter((item) =>
              workspaceModuleMeta[item.id].label.toLocaleLowerCase("es").includes(normalizedNavigationQuery),
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
          <div className="user-summary">
            <div className="avatar">{activeSession.initials}</div>
            <div className="user-copy"><strong>{activeSession.shortName}</strong><span>{activeSession.position}</span></div>
            <ChevronDown size={16} />
          </div>
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
            <button className="icon-button" type="button" title="Actividad" onClick={() => changeModule("home")}><Activity size={19} /></button>
            <div className="notification-wrap">
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
            </div>
          </div>
        </header>

        <main className={`workspace ${activeModule === "home" ? "workspace-home" : ""}`}>
          {activeModule === "home" ? <HomeModule loading={!storageReady} onNavigate={changeModule} sources={homeSources} /> : null}
          {activeModule === "processes" ? <ProcessesModule /> : null}
          {activeModule === "organization" ? <OrganizationModule /> : null}
          {activeModule === "access" ? <AccessModule /> : null}
          {activeModule === "documents" ? <DocumentsModule controlledDocuments={controlledDocuments} focusId={navigationTarget?.module === "documents" ? navigationTarget.id : undefined} key={`documents-${navigationTarget?.module === "documents" ? navigationTarget.id : "index"}`} onControlledDocumentsChange={setControlledDocuments} /> : null}
          {activeModule === "indicators" ? <IndicatorsModule definitions={indicatorDefinitions} focusId={navigationTarget?.module === "indicators" ? navigationTarget.id : undefined} key={`indicators-${navigationTarget?.module === "indicators" ? navigationTarget.id : "index"}`} onDefinitionsChange={setIndicatorDefinitions} onResultsChange={setIndicatorResults} results={indicatorResults} /> : null}
          {activeModule === "corrective-actions" ? <CorrectiveActionsModule actions={actions} focusId={navigationTarget?.module === "corrective-actions" ? navigationTarget.id : undefined} key={`corrective-${navigationTarget?.module === "corrective-actions" ? navigationTarget.id : "index"}`} onActionsChange={setActions} /> : null}
          {activeModule === "calibrations" ? <CalibrationsModule assets={assets} focusId={navigationTarget?.module === "calibrations" ? navigationTarget.id : undefined} key={`calibrations-${navigationTarget?.module === "calibrations" ? navigationTarget.id : "index"}`} onAssetsChange={setAssets} /> : null}
          {activeModule === "customers" ? <CustomersModule actions={actions} /> : null}
          {activeModule === "suppliers" ? <SuppliersModule /> : null}
          {activeModule === "management-review" ? <ManagementReviewModule onRecordsChange={setManagementReviews} records={managementReviews} sources={managementReviewSources} /> : null}
          {activeModule === "continuous-improvement" ? <ContinuousImprovementModule /> : null}
          {activeModule === "customer-portal" ? <StakeholderPortalModule kind="customer" actions={actions} /> : null}
          {activeModule === "supplier-portal" ? <StakeholderPortalModule kind="supplier" actions={actions} /> : null}
          {!["home", "processes", "organization", "access", "documents", "indicators", "corrective-actions", "calibrations", "customers", "suppliers", "management-review", "continuous-improvement", "customer-portal", "supplier-portal"].includes(activeModule) ? <ModulePlaceholder module={activeMeta} /> : null}
        </main>
      </div>

    </div>
  );
}

