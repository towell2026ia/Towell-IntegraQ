# IQ-HOME-PROCESS-01 — auditoría previa

Base: main productivo; rama independiente `codex/home-process-01`.

| Sección | Fuente actual | Hallazgo |
|---|---|---|
| Imágenes institucionales | Documentos controlados, selección por título y permisos de proceso | La imagen puede variar entre usuarios; el administrador puede ver versión pendiente mientras el interno sólo ve vigente. Compartir la misma imagen requiere una lectura institucional autorizada y resolver candidatos ambiguos. |
| Objetivos | HomeObjectiveCatalog | Catálogo institucional independiente; conservar componente y contenido. |
| Apariencia | Configuración existente de Inicio | Conservar sin modificaciones. |
| Pendientes | buildHomeDashboard: documentos, acciones, equipos, indicadores y calendarios | Mezcla fuentes persistidas con estado del navegador. Acciones abiertas y correcciones no comprueban identidad del responsable; auditorías usan calendarios estáticos. |
| Desempeño | Resultados trimestrales evaluados con reglas KPI | Fórmula real, pero depende de las fuentes recibidas en el navegador y del trimestre calendario; falta alcance organizacional en servidor y tratamiento explícito de frecuencias distintas. |
| Tendencias | Conteos por estado actual | No constituye historial de mediciones. Sustituir los datos exige mantener los componentes gráficos y agrupar únicamente periodos comparables, sin crear ceros por ausencia de captura. |
| Actividad | Versiones documentales, fecha de alta de acciones, calendarios de auditoría | Para acciones y auditorías se fabrica una hora de mediodía; faltan eventos KPI y auditoría persistida. |
| Alcance | home-visibility y filtros del navegador | Administrador utiliza catálogo estático de procesos; usuario sin procesos pierde secciones. No sustituye autorización por organización en servidor. |

## Metadatos contrastados, sólo lectura

Proyecto `yptrqowmviixlkrxjrqr`, consulta MCP list_tables el 3 de noviembre de 2026. No se ejecutó SQL.

- `processes`: organización, proceso padre y responsable persistidos.
- `controlled_documents`: organización, proceso, activo y eliminación lógica; versiones conservan validador, cargador, envío y autorización.
- `indicator_definitions`: organización, workspace_mode, procesos, periodicidad y líder. `indicator_periods`: año, trimestre, apertura/cierre. `indicator_results`: valor, envío y fecha.
- `corrective_actions`: organización, proceso, responsable, estado y eliminación lógica.
- `approval_requests`: organización, proceso, aprobador, rol, permiso requerido y estado.
- `audit_log`: organización, recurso, actor y fecha real.

## Validación y límites

La inspección de metadatos no comprueba los valores ni el acceso efectivo de sesiones de Calidad, Ventas o múltiples procesos. No se han comparado capturas visuales ni ejecutado consultas autenticadas de esos usuarios. La implementación descrita abajo está preparada; no declarar aceptación productiva basándose en esta auditoría.

La implementación debe conservar el JSX y estilos del dashboard, agregar un endpoint de lectura autenticado con paginación y filtros organizacionales antes de responder, comprobar permisos y responsabilidad en cada fuente y rechazar fallos de consulta sin recurrir a datos locales. Debe usar eventos persistidos y ventanas KPI vigentes, y no ampliar permisos de los portales externos.

Producción, SQL, RLS, archivos y datos: sin cambios.

## Implementación

- `/api/home/process-dashboard`: sesión interna activa con permiso de Inicio; perfil persistido; organización y procesos autorizados antes de responder. Las credenciales de servicio sólo se utilizan después de comprobar ese contexto. Clientes y proveedores rechazados antes de acceder a ellas.
- Lecturas paginadas con orden estable, total comprobado y detección de duplicados/cambios durante la consulta. Un error devuelve 503 y el cliente muestra datos no disponibles; no recurre al catálogo local.
- Documentos vigentes/activos y eliminación lógica; versiones y auditoría documental. Pendientes por ID del validador/cargador y permisos efectivos, no por coincidencia de nombres.
- KPI de `indicator_definitions`, relaciones de procesos, reglas, periodos y resultados. Cada indicador se cuenta una vez aun si pertenece a varios procesos. Captura pendiente sólo durante ventana abierta, sin resultado y bajo responsabilidad explícita (líder o responsable de proceso) y permiso de actualización.
- Root2Cause y planes: pendientes del responsable con permiso de intervención; excluye cerrados/completados/retirados. Auditorías y equipos: asignaciones y vencimientos persistidos. Aprobaciones: asignación individual o rol vigente y permiso requerido comprobado en servidor.
- Actividad: `audit_log`, `document_audit_log` e `indicator_results`, conservando timestamps originales y referencias a expedientes autorizados.
- Las cuatro imágenes se resuelven por los mismos títulos/nombres de archivo, dentro de la organización, usando exclusivamente versiones vigentes y archivos no eliminados. URL temporal emitida únicamente tras autorización de Inicio; no depende de permisos de edición. Los candidatos ambiguos no se eligen arbitrariamente. No cambia archivos ni versiones.
- Cinco objetivos, textos institucionales y apariencia conservan sus componentes. La estructura activa configurada para Inicio es común a internos; objetivos e imágenes institucionales permanecen visibles.
- Las notificaciones de Inicio también consumen la respuesta autorizada del servidor.

## Evidencia de cálculo y pruebas

Caso controlado: KPI trimestral con meta >=90, Q1=0 y Q2=95. Resultado: Q1=0% de cumplimiento, Q2=100%; Q3 sin medición no genera punto. Al vincular el mismo KPI a Calidad y Ventas, Q2 continúa teniendo una sola captura en el denominador. Se conserva `2026-07-03T09:08:07Z` como fecha original del evento.

Las pruebas incluyen administrador limitado a su organización; interno limitado a procesos asignados; solicitud de proceso ajeno; cliente y proveedor denegados; usuario sin Inicio; error de consulta sin fallback; imágenes idénticas para administrador e interno sin edición; responsables distintos; documentos eliminados; usuario sin procesos; histórico vacío; KPI multiasignado; cero real y frecuencia incompatible.

`home-layout-baseline.json` fija las firmas de estructura JSX (etiquetas, clases y estilos) y CSS de main `91430b6`. Se comparan seis archivos, incluidos los objetivos y las imágenes. Es una comprobación estática de preservación, no una captura del navegador.

## Limitaciones de aceptación

- Capturas antes/después y sesiones reales: PENDING. El navegador falla al inicializar con `failed to write kernel assets: ... os error 3`. No se puede afirmar identidad visual renderizada ni cotejo de valores productivos por usuario.
- La tabla de periodos disponible representa año/trimestre. Las frecuencias distintas de `quarterly`, reglas ausentes y resultados sin valor o timestamp válido se excluyen del cálculo; no se reinterpretan ni completan. Requieren verificación específica antes de aceptar indicadores de otra frecuencia.
- Si un KPI carece de ID de líder y de responsable de proceso, no se inventa una asignación de captura. No se infieren responsabilidades a partir de nombres.
- Riesgos y Revisión por la Dirección sin fuente operativa verificada en este endpoint muestran estado sin datos; sus aprobaciones explícitamente asignadas sí se consultan mediante `approval_requests`. No se cargan sus ejemplos locales.
- Las políticas/imágenes pendientes de autorización, inexistentes o ambiguas no se publican automáticamente. Debe comprobarse la disponibilidad de los cuatro documentos vigentes en la plataforma.
- Las políticas RLS y el resto de módulos no se modifican. Ninguna validación modifica producción.
