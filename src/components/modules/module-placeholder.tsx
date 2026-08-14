import { CheckCircle2, CircleDashed, Database, Network } from "lucide-react";

import type { WorkspaceModuleMeta } from "@/lib/navigation";

interface ModulePlaceholderProps {
  module: WorkspaceModuleMeta;
}

export function ModulePlaceholder({ module }: ModulePlaceholderProps) {
  const isPending = module.status === "Pendiente";

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">{module.breadcrumb}</p>
          <h2>{module.label}</h2>
          <p>Estado de preparación del módulo en Fase 1.</p>
        </div>
        <span className={`module-state module-state-${module.status.toLocaleLowerCase("es")}`}>
          {module.status}
        </span>
      </section>

      <section className="placeholder-panel">
        <div className="placeholder-status">
          <span className="placeholder-icon">
            {isPending ? <CircleDashed size={24} /> : <Network size={24} />}
          </span>
          <div>
            <span>Preparación</span>
            <h3>{isPending ? "Pendiente de definición" : "Estructura de navegación lista"}</h3>
          </div>
        </div>
        <div className="readiness-steps">
          <div className="readiness-complete"><CheckCircle2 size={18} /><span><strong>Navegación</strong><small>Ruta disponible</small></span></div>
          <div><CircleDashed size={18} /><span><strong>Alcance</strong><small>Por confirmar</small></span></div>
          <div><CircleDashed size={18} /><span><strong>Datos</strong><small>Modelo pendiente</small></span></div>
          <div><Database size={18} /><span><strong>Persistencia</strong><small>Sin Supabase</small></span></div>
        </div>
      </section>
    </>
  );
}
