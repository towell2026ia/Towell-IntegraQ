# Flujos de aprobación

`approval_requests` es el motor transversal. Conserva solicitante, entidad, permiso requerido, aprobador o rol asignado, decisión, comentario y fechas. La función `decide_approval` bloquea decisiones repetidas, autoaprobación, aprobadores ajenos, falta de permiso y rechazos sin motivo.

```text
ACTION → APPROVAL REQUIRED → PENDING
                              ├── APPROVED → ACTIVITY LOG + DOMAIN EVENT
                              └── REJECTED → REASON + ACTIVITY LOG + DOMAIN EVENT
```

APIs:

- `POST /api/approvals`
- `GET /api/approvals/pending`
- `POST /api/approvals/{id}/approve`
- `POST /api/approvals/{id}/reject`

`getApprovalPolicy()` determina permiso y segregación. `validateStateTransition()` impide saltos arbitrarios para documentos, riesgos, auditorías, acciones correctivas y mejoras.

La independencia de auditoría se evalúa con `validateAuditorIndependence()`: un conflicto por área o proceso requiere justificación suficiente y autorización de una persona distinta al auditor. La validación de eficacia de una acción queda separada de su ejecución.

Las solicitudes crean una notificación interna cuando hay aprobador asignado y publican `approval_request.created`. Las decisiones generan eventos tipados para los workflows posteriores.
