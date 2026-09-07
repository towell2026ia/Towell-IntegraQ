# Arquitectura de Inteligencia de IntegraQ

## Estado de esta fase

IntegraQ únicamente prepara en esta fase la infraestructura común. Los agentes especializados se implementarán en releases posteriores. No existen agentes autónomos, routing, memoria, RAG, embeddings, fine-tuning ni ejecución automática de cambios.

## Flujo previsto

```text
Frontend IntegraQ PWA
        ↓ intención y referencias
API interna autenticada
        ↓
AI Core
  ├─ Contracts
  ├─ Context selectivo
  ├─ Permissions
  ├─ Registry
  ├─ Approvals
  └─ Audit fingerprints
        ↓
Capability registrada
        ↓
Agente futuro
        ↓
Tool futura controlada
        ↓
Supabase
```

El navegador sólo envía intención, identificadores y entradas necesarias. Las credenciales de proveedores permanecen en el servidor. `POST /api/ai/execute` es el punto de entrada común, pero durante esta fase todas las capacidades del registro están deshabilitadas.

## Componentes

### Contracts

`src/ai/core/contracts` define `IntegraQAiRequest`, `IntegraQAiResponse`, los estados comunes y errores seguros. La validación rechaza módulos, tareas y fuentes de contexto desconocidos antes de consultar datos.

### Context

`buildIntegraQContext()` recibe el usuario autenticado, módulo, acción, registro, proceso y la lista `include`. Sólo solicita las familias incluidas. El resultado separa usuario, sesión, navegación, organización, registro, fuentes y fuentes omitidas.

Los selectores actuales conectan procesos, documentos, indicadores, riesgos, auditorías, acciones correctivas, metrología/equipos y mejora continua. Clientes y proveedores quedan como placeholders explícitos (`not_available`); no se inventan datos ni se amplía su exposición hasta definir reglas de contexto específicas.

### Permissions

Los permisos `ai.read`, `ai.suggest`, `ai.generate_draft`, `ai.execute`, `ai.approve` y `ai.admin` se derivan de los permisos existentes por módulo, acción y proceso. No existe un sistema de usuarios paralelo. Los administradores reciben el conjunto completo; los usuarios internos conservan el principio de mínimo privilegio.

### Registry

`AiCapabilityRegistry` registra metadatos, módulo, permisos y requisito de aprobación. Las capacidades de riesgos, Root2Cause, auditorías, metrología, mejora y revisión por la Dirección existen únicamente como descriptores con `status: disabled`.

### Human approval

`AiApprovalRequirement` y `AiApprovalRecord` preparan los estados `suggestion`, `draft`, `review`, `awaiting_approval`, `approved` y `rejected`. Esta fase no incluye una interfaz de aprobación ni modifica registros.

### Audit

`ai_activity_log` almacena usuario, módulo, capacidad, referencias, estado, tipo de respuesta, requisito de aprobación y fingerprints SHA-256. Nunca almacena prompts completos, archivos, API keys, tokens, cookies, contraseñas o credenciales. Los fingerprints son trazabilidad, no un control de seguridad.

## Endpoint común

`POST /api/ai/execute` realiza, en orden:

1. autenticación;
2. validación del contrato;
3. resolución de capability;
4. autorización de módulo y permisos IA;
5. construcción selectiva del contexto;
6. autorización del proceso relacionado;
7. registro de fingerprints y trazabilidad;
8. respuesta controlada `CAPABILITY_DISABLED`.

Ejemplo de solicitud de infraestructura:

```json
{
  "requestId": "req-2026-001",
  "task": "suggest",
  "capability": "risks.evaluate",
  "module": "risks",
  "action": "evaluate",
  "recordId": "uuid-del-riesgo",
  "context": {
    "processId": "P-08",
    "include": ["process", "documents", "indicators"]
  },
  "input": {},
  "metadata": {}
}
```

Mientras la capability permanezca deshabilitada, la API responde sin invocar proveedor alguno:

```json
{
  "requestId": "req-2026-001",
  "status": "disabled",
  "type": "error",
  "result": null,
  "warnings": [],
  "sources": [],
  "requiresApproval": false,
  "metadata": {
    "capability": "risks.evaluate"
  },
  "error": {
    "code": "CAPABILITY_DISABLED",
    "message": "Esta capacidad todavía no está habilitada.",
    "retryable": false
  }
}
```

## Compatibilidad y migración gradual

Las rutas existentes de Root2Cause, importación de formularios y revisión por la Dirección conservan su lógica y proveedores actuales. Un adaptador añade autenticación, permisos integrados y fingerprints sin reescribirlas. La importación de organigramas ya conservaba autenticación propia y permanece operativa.

El patrón para releases posteriores es:

```text
API existente → Adapter → AI Core → lógica existente
```

## FUTURE ENHANCEMENTS

- Implementar repositorios de contexto autorizados para clientes y proveedores.
- Migrar la finalización de ejecuciones heredadas a actualizaciones de estado en `ai_activity_log`.
- Añadir interfaz de revisión y aprobación humana.
- Habilitar capabilities una por una cuando exista su agente, evaluación y control de tools.

Estas mejoras están documentadas, pero deliberadamente no se implementan en esta fase.

