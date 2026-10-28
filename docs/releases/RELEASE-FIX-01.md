# RELEASE-FIX-01 — compatibilidad con base existente

Estado: BLOCKED. Rama existente codex/integration-client-fixes, base 42e52534b1832758a810a2457a402e17e790b2d0. No hay una actualización SQL completa aprobable bajo las restricciones actuales. No ejecutar las cinco migraciones de la candidata: cuatro CREATE TABLE contradicen la instrucción del release.

## Evidencia comprobada

El 2026-10-28 se consultaron exclusivamente los metadatos list_tables y list_migrations de IntegraQ. No se utilizó execute_sql, apply_migration, conexiones PostgreSQL locales, despliegue ni ninguna operación de datos. El snapshot adjunto contiene nombres/tipos de columnas e historial, sin filas, cuentas, secretos ni evidencias.

Producción tiene 38 versiones registradas. Las 37 de main están representadas en Git. Falta el SQL original de 202610120001_indicator_evidence_storage_permissions, registrado como aplicado; no se encontró en el historial local ni en la búsqueda del repositorio. No se reconstruye ni sustituye esa versión. Ninguna de las cinco versiones pendientes figura en el historial consultado. Esto no prueba que no se hayan aplicado a otros entornos: se mantienen intactas.

## Revisión de las cinco migraciones

| Versión | Dependencia actual | Reutilización posible | Bloqueo/condición |
| --- | --- | --- | --- |
| 202610210003 STB-01 | indicator_capture_rules, indicator_capture_operations; dos columnas de excepciones | indicator_capture_settings para configuración; indicator_periods para ventanas; audit_log para auditoría | settings sólo tiene días globales por organización/modo. No representa reglas por año/trimestre. periodos no tiene fuente/motivo de excepción. Se necesita diseño tipado de ampliación de columnas y actualización conjunta de RPC/APIs, idempotencia y recuperación. No usar audit_log como tabla de configuración mutable. |
| 202610220001 STB-02 | document_retention_events y workspace_mode en cuatro tablas | audit_log y document_audit_log ya tienen BEFORE/AFTER, actor, motivo y contexto; documentos/archivos ya tienen versiones y eliminación lógica | Reemplazar la dependencia de la tabla nueva exige adaptar RPC/consultas y probar historial inmutable. Las cuatro columnas workspace_mode no existen. No asignarles valores históricos inventados; preservar NULL heredado hasta una resolución comprobada. |
| 202610270001 Inicio | home_image_versions y bucket nuevo | file_objects ya tiene workspace_id, resource_type/resource_key, version, is_current, replaces_file_id, description y auditoría existente | Requiere adapter de APIs/RPC y restricciones de slot/revisión/organización/modo, restauración sin borrar binarios y decisión del bucket existente. Falta workspace_mode estable en archivos. La presencia de file_objects no hace compatible la API actual de home_image_versions. |
| 20261028153100 FIX-03 | tablas existentes de usuarios, permisos, empresas y auditoría | Reutilización ya implementada; no CREATE TABLE | Revisar interacción con políticas/funciones reales, incluida la migración aplicada faltante. Concurrencia, delegación, persistencia y aislamiento PENDING. |
| 20261028180652 FIX-03A | file_objects, helpers/RLS de FIX-03 | Reutilización ya implementada; no CREATE TABLE | No validar sustituciones/efecto sobre evidencias antes de recuperar la definición de la migración aplicada faltante. |

## Cambios de esquema que requieren decisión

No se propone ninguna tabla nueva. Antes de emitir un único incremental hace falta acordar y probar:
- STB-01: representación tipada por año/trimestre dentro de la configuración existente, incluyendo excepciones y recuperación; como mínimo falta la procedencia/motivo en periodos. Un único número de días no conserva esas capacidades.
- STB-02/Inicio: aislamiento persistente por workspace_mode en controlled_documents, file_objects, document_folders y document_upload_batches, o una relación equivalente comprobable. No se infiere del creador como sustituto de una identidad estable de ambiente sin validar históricos.
- Auditoría reutilizada: eventos nuevos con namespaces, snapshots y claves de operación; índices/constraints e inmutabilidad limitados a esos eventos, sin sobrescribir ni restringir retrospectivamente registros ajenos.
- Inicio reutilizado: índices de revisión y publicación vigente por organización/modo/slot, más controles de almacenamiento; sin modificar versiones existentes.
- Funciones/RLS/índices nuevos o sustituidos deben cotejarse con el SQL original 202610120001. Los metadatos de tablas no exponen sus políticas ni cuerpos de funciones.

Estos puntos son requisitos de diseño/aceptación, no una migración implementada ni autorización para ampliar el esquema. No se generan vistas para disfrazar tablas inexistentes ni se elimina funcionalidad para que el build pase. El código funcional de STB-01/02, Inicio y FIX-02/03 permanece íntegro en la candidata.

## Capacidades y publicación

- FIX-02 (consulta de evidencias, visor y organigrama), agrupación de procesos FIX-03A y presentación de los 52 indicadores: código integrado y probado, sin tabla nueva adicional. Publicación real PENDING hasta validar permisos y esquema reales y autorizar despliegue.
- Edición de permisos/portales: preparada sobre tablas existentes; aplicación de RPC/RLS y aceptación PENDING.
- STB-01 completo, STB-02 completo e historial de cuatro imágenes: BLOQUEADOS para un release sin tablas nuevas hasta implementar y probar la adaptación descrita. No se declaran listos para publicar.
- Release completo listo para publicar: NO.

## Verificación y siguiente paso exacto

node scripts/audit-release-fix-01.mjs imprime el diagnóstico offline. --require-ready devuelve error mientras haya bloqueos; incluso un análisis compatible no equivale a aceptación productiva. CI conserva SQL estático, typecheck, lint, pruebas y build; PASS de CI no habilita publicación.

Recuperar el SQL original de 202610120001 y resolver los cambios de columnas/contratos indispensables. Después podrá implementarse un único paquete incremental de compatibilidad y sus adaptadores, preservando las migraciones históricas y evitando aplicar automáticamente las cinco alternativas originales. Validarlo en entorno aislado autorizado, comparar BEFORE/AFTER y pedir autorización independiente antes de cualquier operación productiva.

No se creó rama Git ni Supabase, tabla, bucket ni registro. No hubo merge ni despliegue. BASES DE DATOS INTACTAS — SIN PÉRDIDA DE INFORMACIÓN: no hubo escrituras de esta tarea; la comparación directa de datos sigue PENDING.
