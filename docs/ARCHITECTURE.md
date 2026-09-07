# Arquitectura inicial de IntegraQ

## Alcance actual

IntegraQ conserva sus módulos operativos y añade dos capas transversales:

1. AI Core proveedor-neutral para contexto, permisos, registro, aprobación y trazabilidad.
2. Relaciones maestras por ID para reconstruir la información de cada proceso.

Los módulos iniciales siguen incluyendo:

1. Acciones correctivas con un punto de integracion server-to-server para una
   aplicacion externa de IA.
2. Calibraciones y verificaciones con control de vigencias y recurrencias.

La interfaz usa datos de demostracion mientras se conecta Supabase. Las reglas
de dominio y los contratos de integracion se mantienen fuera de los componentes
visuales para poder sustituir esa fuente sin reescribir las pantallas.

## Vista C4 - Contenedores

```text
[Usuario]
    |
    v
[IntegraQ Web/PWA - Next.js]
    |-- Modulo de acciones correctivas
    |-- Modulo de calibraciones y verificaciones
    |-- API interna /api/ai/root-cause
    |
    +--> [Supabase Auth + Postgres + Storage]
    |
    +--> [Aplicacion externa de IA] (contrato pendiente)
```

## Limites de seguridad

- La API key de IA solo existe en el servidor.
- El navegador invoca la API interna de IntegraQ.
- IntegraQ valida entradas y normaliza la respuesta antes de mostrarla.
- Los resultados de IA son borradores; requieren aprobacion humana.
- La futura persistencia aplicara permisos por rol, area y proceso.
- Las evidencias se almacenaran fuera de las tablas y se vincularan por ID.

## Flujo de acciones correctivas

```text
Registro del problema
  -> Analisis de causa
  -> Plan de acciones
  -> Ejecucion y evidencia
  -> Validacion de eficacia
  -> Cierre
```

Estados iniciales:

- `open`
- `analysis`
- `action_plan`
- `implementation`
- `effectiveness`
- `closed`

El vencimiento es una condicion calculada y no sustituye al estado del flujo.

## Flujo de calibracion o verificacion

```text
Equipo vigente
  -> Proximo a vencer
  -> Vencido
  -> Registrar ejecucion y evidencia
  -> Calcular siguiente fecha
  -> Equipo vigente
```

La recurrencia se expresa inicialmente en meses. La fecha siguiente se calcula
desde la fecha real de ejecucion, no desde la fecha previamente programada.

## Contrato provisional de IA

Solicitud interna:

```json
{
  "problem": "Descripcion del problema",
  "context": "Descripcion integral, proceso, responsable y fuentes disponibles",
  "source": "internal | audit | customer | supplier",
  "contextSources": {
    "processId": "P-13",
    "processName": "Tejido",
    "documentFamilies": ["PRC - Procedimientos", "INS - Instructivos"],
    "documents": [
      {
        "id": "doc-001",
        "code": "P-16",
        "title": "Manufactura de Tejido",
        "version": "V2",
        "excerpt": "Extracto autorizado para consulta"
      }
    ],
    "a3Sections": ["Apertura", "5W2H", "Ishikawa 6M"]
  },
  "analysis": "Expediente A3 estructurado"
}
```

Respuesta normalizada:

```json
{
  "mode": "external | demo",
  "summary": "Resumen del analisis",
  "fiveWhys": ["Pregunta o respuesta 1"],
  "probableRootCause": "Hipotesis para validar",
  "suggestedActions": ["Accion sugerida"],
  "warnings": ["Dato faltante o riesgo del analisis"],
  "contextSources": "Fuentes efectivamente consideradas"
}
```

El modo `demo` permite validar el flujo sin simular que existe una integracion
productiva. El contrato final se ajustara cuando se proporcione la documentacion
de la otra aplicacion. Cuando no existen documentos indexados, el resultado lo
declara expresamente y no atribuye a la documentacion informacion inexistente.

## Entidades iniciales

- `CorrectiveAction`
- `CorrectiveActionEvidence`
- `RootCauseAnalysis`
- `EffectivenessReview`
- `MeasurementAsset`
- `MeasurementEvent`
- `User`
- `Area`
- `Process`
- `AuditEvent`

## Integridad transversal

Las relaciones oficiales utilizan claves foráneas. Los nombres son valores de presentación o snapshots históricos, nunca la clave principal de integración. La jerarquía base es `Organization → Area → Process`; documentos y auditorías usan tablas puente para representar varios procesos. Consulta [DATA_RELATIONSHIPS.md](./DATA_RELATIONSHIPS.md) para el modelo y la estrategia de migración.

## Autorización, aprobaciones y trazabilidad

La autorización evoluciona los permisos actuales mediante un gateway central con denegación por defecto. `roles`, `permissions`, `role_permissions` y `user_roles` expresan la acción y el alcance; las validaciones existentes de módulo/proceso se mantienen durante la transición.

`audit_log` continúa como fuente histórica única y se amplía con organización, snapshots, diferencias, motivo, origen y contexto técnico. Las decisiones formales se procesan mediante `approval_requests` y `decide_approval`, que aplican permiso, asignación, segregación y comentario obligatorio de rechazo en backend y base de datos.

Consulta [ACCESS_CONTROL.md](./ACCESS_CONTROL.md), [APPROVAL_WORKFLOWS.md](./APPROVAL_WORKFLOWS.md) y [AUDIT_TRAIL.md](./AUDIT_TRAIL.md) para los contratos completos.

## Decisiones pendientes

- Contrato y autenticacion de la aplicacion externa de IA.
- Catálogos finales y responsables oficiales de las áreas detectadas durante la migración.
- SLA y reglas de excepcion de acciones correctivas.
- Frecuencias permitidas y reglas de tolerancia para equipos.
- Evidencia obligatoria por tipo de calibracion o verificacion.
- Identidad visual derivada de la presentacion de IntegraQ.
