# Bitácora transversal

## Fuente única

Se reutiliza `audit_log`; no existe una segunda bitácora paralela. La migración agrega organización, nombre del usuario como snapshot, módulo, código del registro, valores anterior/nuevo, motivo, origen, IP y user agent.

Los orígenes controlados son `human`, `system`, `import`, `migration`, `integration`, `ai` y `admin_override`. Nunca deben persistirse contraseñas, tokens, secretos o archivos completos; para archivos se guarda ID, versión y hash.

`changedFields()` produce un diff mínimo y `getActivityTimeline(entityType, entityId)` ordena el historial inmutable. Se revocan `UPDATE` y `DELETE` sobre `audit_log` al rol autenticado.

## Consulta y exportación

- `GET /api/activity` es exclusivo para administradores y acepta filtros de módulo, acción, usuario y entidad.
- `GET /api/activity?format=csv` exporta CSV.
- `GET /api/activity?format=xlsx` exporta Excel.
- `GET /api/activity/{entityType}/{entityId}` devuelve la línea de tiempo permitida por RLS.

Acciones obligatorias: creación, cambio relevante, estado, aprobación, rechazo, cierre, reapertura, responsable, criticidad, fecha, eliminación lógica, importación y publicación. Los registros críticos incorporan `deleted_at`, `deleted_by` y `deletion_reason` para evitar borrado físico.
