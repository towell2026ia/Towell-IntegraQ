# Candidata de integración de correcciones del cliente

Rama: `codex/integration-client-fixes`. Base main: `b4f5bb7e046ed02ac8149a0014e95dcd063eefb9`.

Fuentes fijadas en scripts/integration-migrations.json: PR #4, #5, #6, #7 y #8 (incluido FIX-03A). PR #5 incluye los commits de PR #4; se incorporan una sola vez. Los PR originales y main no se modifican. La candidata se prepara mediante parches, sin fusionar PR ni desplegar.

Conflictos resueltos:
- CI: combinación de los validadores de retención documental, imágenes y FIX-03; inventario/hash y parser adicional de integración.
- API de archivos: consulta con cliente autenticado/RLS de PR #5, acceso administrativo a eliminados e históricos, selección de PDF convertido y protección del original de PR #7.
- Prueba de la API: mock de la consulta autenticada y regresión de consulta administrativa de históricos. Se conservan pruebas de todos los PR: 477 pruebas locales PASS, typecheck/lint PASS.
- Los cambios de indicadores de PR #4 y evidencias de PR #7, y los controles de usuario/expedientes de PR #8, coexisten en la candidata.

Orden de migraciones sobre el esquema de main (comprobar primero historial real del entorno destino; no reaplicar versiones ya registradas):
1. 202610210003_indicator_global_capture_windows.sql — reglas y operaciones auditadas de captura (PR #4).
2. 202610220001_document_retention_code_reuse.sql — eliminación lógica, reutilización de códigos y restauración (PR #5).
3. 202610270001_home_image_slots.sql — cuatro imágenes e historial (PR #6).
4. 20261028153100_iq_fix03_user_permissions_portal_isolation.sql — permisos/portales (PR #8).
5. 20261028180652_iq_fix03a_document_file_process_scope.sql — lectura documental por proceso (PR #8/FIX-03A).

PR #7 no añade SQL. Las cinco migraciones se conservan byte por byte respecto de sus fuentes; las migraciones de main tampoco se editan. No hay identificadores duplicados. El validador comprueba SHA-256, SQL/PLpgSQL, operaciones de instalación y colisiones sin conectarse a una base.

La instalación no ejecuta UPDATE/DELETE/TRUNCATE sobre datos existentes, ni DROP TABLE ni RPC. La migración de imágenes crea un bucket privado nuevo; si el ID ya existe, falla en lugar de sobrescribirlo. Hay sustituciones controladas de trigger/política y de la restricción global de código por un índice único de códigos activos; su compatibilidad con el catálogo real sigue PENDING.

No confundir instalación con ejecución funcional: PR #4 conserva DELETE acotados dentro de RPC de recuperación de reglas y reasignación de procesos de un indicador. No se invocan durante la migración y no se ejecutaron en esta tarea. Su aceptación de conservación, concurrencia, recuperación y autorización sigue PENDING. No se certifica ausencia absoluta de operaciones de borrado en los cuerpos de todas las RPC. Las pruebas SQL y scripts de fixtures existentes se conservan, pero NO se ejecutan.

CI de la candidata se activa por push sólo para validación de código y SQL estático. Los jobs de integración Supabase existentes no se activan para esta rama. No se abre un PR adicional que pudiera aprovisionar un Preview. No se cambian instalaciones locales, bases, datos, buckets, entornos ni configuración de despliegue.

Para ver las correcciones:
- Autorizar un entorno aislado existente o acordado, sin aprovisionamiento automático ni costos nuevos en esta tarea.
- Comprobar el historial de migraciones, catálogo/dependencias, unicidad de códigos activos y existencia del bucket; aplicar sólo las versiones faltantes tras autorización.
- Validar RLS/organizaciones/DEMO, cuentas reales, documentos/versiones/evidencias, 52 indicadores y cambios de sesión con comparaciones BEFORE/AFTER.
- Autorizar por separado un despliegue de esta candidata con configuración del entorno aislado y efectuar aceptación visual de los cinco PR.
- Cualquier promoción a producción o merge requiere autorización posterior. STOP antes de desplegar.

BASES DE DATOS INTACTAS — SIN PÉRDIDA DE INFORMACIÓN: PENDING de comprobación directa. Ninguna conexión u operación de base de datos fue ejecutada; sólo se verificaron fuentes, SQL estático y pruebas simuladas.
