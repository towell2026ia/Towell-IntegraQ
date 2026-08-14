"use client";

import {
  Activity,
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
import { CustomersModule } from "@/components/modules/customers-module";
import { DocumentsModule } from "@/components/modules/documents-module";
import { HomeModule } from "@/components/modules/home-module";
import { IndicatorsModule } from "@/components/modules/indicators-module";
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
import { getAssetDueStatus, toIsoDate } from "@/lib/domain";
import {
  isWorkspaceModuleId,
  workspaceModuleMeta,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import { activeSession } from "@/lib/session-data";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [actions, setActions] = useState<CorrectiveAction[]>(demoCorrectiveActions);
  const [assets, setAssets] = useState<MeasurementAsset[]>(demoMeasurementAssets);
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
        if (savedActions) {
          setActions(
            enrichSavedCorrectiveActions(
              JSON.parse(savedActions) as CorrectiveAction[],
            ),
          );
        }
        if (savedAssets) setAssets(JSON.parse(savedAssets) as MeasurementAsset[]);
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

  const activeMeta = workspaceModuleMeta[activeModule];
  const today = toIsoDate(new Date());
  const openActions = useMemo(
    () => actions.filter((action) => action.status !== "closed").length,
    [actions],
  );
  const overdueAssets = useMemo(
    () => assets.filter((asset) => getAssetDueStatus(asset, today) === "overdue").length,
    [assets, today],
  );

  const changeModule = (module: WorkspaceModuleId) => {
    setActiveModule(module);
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
                <Bell size={19} /><span aria-label="3 notificaciones">3</span>
              </button>
              {notificationsOpen ? (
                <div className="notification-popover">
                  <div className="popover-heading"><strong>Notificaciones</strong><small>3 pendientes</small></div>
                  <button type="button" onClick={() => changeModule("processes")}><Network size={16} /><span><strong>Alcance pendiente</strong><small>34 elementos por definir</small></span></button>
                  <button type="button" onClick={() => changeModule("corrective-actions")}><ClipboardCheck size={16} /><span><strong>Acciones abiertas</strong><small>{openActions} registros activos</small></span></button>
                  <button type="button" onClick={() => changeModule("calibrations")}><Wrench size={16} /><span><strong>Equipos vencidos</strong><small>{overdueAssets} requieren atención</small></span></button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className={`workspace ${activeModule === "home" ? "workspace-home" : ""}`}>
          {activeModule === "home" ? <HomeModule onNavigate={changeModule} openActions={openActions} overdueAssets={overdueAssets} /> : null}
          {activeModule === "processes" ? <ProcessesModule /> : null}
          {activeModule === "organization" ? <OrganizationModule /> : null}
          {activeModule === "access" ? <AccessModule /> : null}
          {activeModule === "documents" ? <DocumentsModule /> : null}
          {activeModule === "indicators" ? <IndicatorsModule /> : null}
          {activeModule === "corrective-actions" ? <CorrectiveActionsModule actions={actions} onActionsChange={setActions} /> : null}
          {activeModule === "calibrations" ? <CalibrationsModule assets={assets} onAssetsChange={setAssets} /> : null}
          {activeModule === "customers" ? <CustomersModule actions={actions} /> : null}
          {activeModule === "suppliers" ? <SuppliersModule /> : null}
          {activeModule === "customer-portal" ? <StakeholderPortalModule kind="customer" actions={actions} /> : null}
          {activeModule === "supplier-portal" ? <StakeholderPortalModule kind="supplier" actions={actions} /> : null}
          {!["home", "processes", "organization", "access", "documents", "indicators", "corrective-actions", "calibrations", "customers", "suppliers", "customer-portal", "supplier-portal"].includes(activeModule) ? <ModulePlaceholder module={activeMeta} /> : null}
        </main>
      </div>

    </div>
  );
}
