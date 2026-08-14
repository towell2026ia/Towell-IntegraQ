"use client";

import {
  KeyRound,
  LockKeyhole,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";

import {
  permissionAreaCatalog,
  userTypeCatalog,
} from "@/lib/configuration-data";

type AccessTab = "types" | "permissions" | "users";

export function AccessModule() {
  const [activeTab, setActiveTab] = useState<AccessTab>("types");
  const [query, setQuery] = useState("");

  const normalized = query.trim().toLocaleLowerCase("es");
  const visibleTypes = userTypeCatalog.filter((item) =>
    [item.id, item.name, item.defaultAccess, item.processScope, item.description].some(
      (value) => value.toLocaleLowerCase("es").includes(normalized),
    ),
  );
  const visiblePermissionAreas = permissionAreaCatalog.filter((item) =>
    [item.id, item.name, item.administrator, item.user, item.status].some((value) =>
      value.toLocaleLowerCase("es").includes(normalized),
    ),
  );

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Configuración base</p>
          <h2>Usuarios y acceso</h2>
          <p>Dos tipos de usuario; la matriz detallada de permisos se diseñará después.</p>
        </div>
        <button className="button button-primary" type="button" disabled>
          <UserPlus size={17} /> Nuevo usuario
        </button>
      </section>

      <section className="metric-grid" aria-label="Resumen de acceso">
        <AccessMetric icon={<Users size={18} />} label="Tipos de usuario" value="2" tone="neutral" />
        <AccessMetric icon={<KeyRound size={18} />} label="Áreas de permiso" value="5" tone="success" />
        <AccessMetric icon={<ShieldCheck size={18} />} label="Procesos controlados" value="34" tone="warning" />
        <AccessMetric icon={<LockKeyhole size={18} />} label="Usuarios activos" value="0" tone="danger" />
      </section>

      <section className="access-policy-note">
        <ShieldCheck size={19} />
        <div>
          <strong>Regla base definida</strong>
          <p>El Administrador tiene acceso total. El Usuario solo podrá acceder a módulos, acciones y procesos que le sean asignados.</p>
        </div>
        <span>Permisos pendientes</span>
      </section>

      <section className="access-panel">
        <div className="access-panel-header">
          <div className="segmented-control" aria-label="Vistas de acceso">
            <button className={activeTab === "types" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("types")}>Tipos de usuario</button>
            <button className={activeTab === "permissions" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("permissions")}>Permisos</button>
            <button className={activeTab === "users" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("users")}>Usuarios</button>
          </div>
          <label className="panel-search wide">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" aria-label="Buscar configuración de acceso" />
          </label>
        </div>

        {activeTab === "types" ? (
          <div className="access-table-wrap">
            <table className="access-table">
              <thead><tr><th>ID</th><th>Tipo de usuario</th><th>Acceso base</th><th>Procesos visibles</th><th>Estado</th></tr></thead>
              <tbody>
                {visibleTypes.map((item) => (
                  <tr key={item.id}>
                    <td><code>{item.id}</code></td>
                    <td><strong>{item.name}</strong><small className="access-cell-detail">{item.description}</small></td>
                    <td>{item.defaultAccess}</td>
                    <td>{item.processScope}</td>
                    <td><span className="status-badge status-open">{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === "permissions" ? (
          <div className="access-table-wrap">
            <table className="access-table">
              <thead><tr><th>ID</th><th>Área de permiso</th><th>Administrador</th><th>Usuario</th><th>Estado</th></tr></thead>
              <tbody>
                {visiblePermissionAreas.map((item) => (
                  <tr key={item.id}>
                    <td><code>{item.id}</code></td>
                    <td><strong>{item.name}</strong></td>
                    <td><span className="access-value access-value-admin">{item.administrator}</span></td>
                    <td><span className="access-value access-value-user">{item.user}</span></td>
                    <td><span className="permission-status">{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === "users" ? (
          <div className="access-empty">
            <span><Users size={24} /></span>
            <h3>Sin usuarios registrados</h3>
            <p>La carga de usuarios se habilitará al conectar autenticación y aprobar la matriz de permisos.</p>
            <button className="button button-secondary" type="button" disabled>Importar usuarios</button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function AccessMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}
