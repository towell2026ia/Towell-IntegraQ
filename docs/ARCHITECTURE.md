# Arquitectura inicial de IntegraQ

## Alcance de esta iteracion

La primera iteracion entrega dos modulos operativos:

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
    +--> [Supabase Auth + Postgres + Storage] (siguiente iteracion)
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

## Decisiones pendientes

- Contrato y autenticacion de la aplicacion externa de IA.
- Esquema de Supabase y politicas RLS.
- Catalogos oficiales de areas, procesos, fuentes y severidad.
- SLA y reglas de excepcion de acciones correctivas.
- Frecuencias permitidas y reglas de tolerancia para equipos.
- Evidencia obligatoria por tipo de calibracion o verificacion.
- Identidad visual derivada de la presentacion de IntegraQ.
