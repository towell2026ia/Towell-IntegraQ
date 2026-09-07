# IntegraQ AI Core

`src/ai/core` contiene contratos y servicios transversales para capacidades inteligentes futuras. En esta fase no contiene agentes, prompts finales, proveedores obligatorios ni ejecución autónoma.

- `contracts`: solicitudes, respuestas y errores normalizados.
- `context`: contexto modular, selectores y repositorio Supabase.
- `permissions`: permisos `ai.*` derivados del acceso actual por módulo y proceso.
- `registry`: catálogo de capacidades futuras, inicialmente deshabilitadas.
- `approvals`: contrato de aprobación humana.
- `audit`: fingerprints, saneamiento y escritura de trazabilidad.

El único punto de entrada nuevo es `POST /api/ai/execute`. Las APIs heredadas permanecen disponibles mediante adaptadores graduales.

