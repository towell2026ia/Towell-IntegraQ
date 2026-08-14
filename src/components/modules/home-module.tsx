"use client";

import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Network,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import type { WorkspaceModuleId } from "@/lib/navigation";
import { activeSession } from "@/lib/session-data";

interface HomeModuleProps {
  onNavigate: (module: WorkspaceModuleId) => void;
  openActions: number;
  overdueAssets: number;
}

const setupItems = [
  { label: "Procesos principales", value: 20, module: "processes" as const },
  { label: "Subprocesos", value: 14, module: "processes" as const },
  { label: "Tipos de usuario", value: 2, module: "access" as const },
  { label: "Áreas de permiso", value: 5, module: "access" as const },
];

export function HomeModule({
  onNavigate,
  openActions,
  overdueAssets,
}: HomeModuleProps) {
  return (
    <>
      <section className="home-session-band" aria-label="Sesión activa">
        <div className="home-session-identity">
          <span className="home-session-avatar" aria-hidden="true">{activeSession.initials}</span>
          <div>
            <span className="home-session-label"><UserRound size={14} /> Sesión activa</span>
            <h3>{activeSession.name}</h3>
            <p>{activeSession.position}</p>
          </div>
        </div>
        <div className="home-session-company">
          <Building2 size={17} />
          <span><small>Empresa</small><strong>{activeSession.company}</strong></span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Resumen de configuración">
        {setupItems.map((item) => (
          <button
            className="metric metric-action metric-neutral"
            key={item.label}
            type="button"
            onClick={() => onNavigate(item.module)}
          >
            <span className="metric-icon">
              {item.module === "processes" ? (
                <Network size={19} />
              ) : (
                <Users size={19} />
              )}
            </span>
            <span>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </span>
            <ArrowRight className="metric-arrow" size={16} />
          </button>
        ))}
      </section>

      <div className="home-grid">
        <section className="work-panel">
          <div className="panel-section-heading">
            <div>
              <span>Mi trabajo</span>
              <h3>Pendientes prioritarios</h3>
            </div>
            <span className="count-badge">{openActions + overdueAssets + 34}</span>
          </div>

          <button
            className="work-item"
            type="button"
            onClick={() => onNavigate("processes")}
          >
            <span className="work-icon tone-amber"><Network size={18} /></span>
            <span className="work-copy">
              <strong>Definir alcance y responsables</strong>
              <small>34 procesos y subprocesos en borrador</small>
            </span>
            <ArrowRight size={17} />
          </button>

          <button
            className="work-item"
            type="button"
            onClick={() => onNavigate("corrective-actions")}
          >
            <span className="work-icon tone-blue"><ClipboardCheck size={18} /></span>
            <span className="work-copy">
              <strong>Acciones correctivas abiertas</strong>
              <small>{openActions} registros requieren seguimiento</small>
            </span>
            <ArrowRight size={17} />
          </button>

          <button
            className="work-item"
            type="button"
            onClick={() => onNavigate("calibrations")}
          >
            <span className="work-icon tone-red"><AlertCircle size={18} /></span>
            <span className="work-copy">
              <strong>Equipos vencidos</strong>
              <small>{overdueAssets} equipos fuera de vigencia</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </section>

        <section className="work-panel foundation-panel">
          <div className="panel-section-heading">
            <div>
              <span>Fundación</span>
              <h3>Secuencia de configuración</h3>
            </div>
            <ShieldCheck size={20} />
          </div>
          <ol className="foundation-list">
            <li className="foundation-current">
              <span>1</span>
              <div>
                <strong>Procesos y subprocesos</strong>
                <small>Jerarquía capturada; alcance pendiente</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Puestos, usuarios y permisos</strong>
                <small>Dos tipos definidos; permisos pendientes de diseño</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Catálogos base</strong>
                <small>Áreas, puestos, clientes y proveedores</small>
              </div>
            </li>
            <li>
              <span><CheckCircle2 size={14} /></span>
              <div>
                <strong>Supabase</strong>
                <small>Se conecta después de aprobar la configuración</small>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </>
  );
}
