# IQ-RNCP-01 r2 — Fase 1

## Fuente e inventario verificados

Fuente: `F-CA-24_Matriz de RNCP.xlsx`, hoja MATRIZ, filas 6–231.
SHA-256: `92d6d355416f58042cc9ec4cce46721a94f054e48e1db390ac7920e87f30a1ca`.

| Comprobación de la fuente | Resultado |
|---|---:|
| Folios únicos | 226 |
| Cerrado / Tarde / En Proceso originales | 177 / 47 / 2 |
| Registros de 2024 / 2025 / 2026 | 39 / 101 / 86 |
| Conciliación verificable con el catálogo de 61 proveedores | 196 |
| Conciliación pendiente, sin asignación automática | 30 |

La hoja DASBOARD contiene tablas dinámicas filtradas a 26 registros. Los gráficos nuevos conservan su composición, títulos y paleta; calculan los datos de MATRIZ completa, excluyendo subtotales como «Total general». Los archivos fuente, sus datos completos y las capturas con nombres de proveedores no se publican en el repositorio.

RNCP0228.pdf contiene un folio fuera de RNCP0001–RNCP0226. Debe conservarse como PDF privado pendiente mientras no exista su expediente formal. Cargarlo nunca crea otro RNCP ni incrementa los indicadores.

## Implementación

- Cinco gráficas: dos circulares y barras apiladas con segmentación a la derecha; debajo, tendencia por fecha real y Pareto por proveedor. Todos los filtros alimentan KPI, gráficas, tabla y exportaciones.
- La consulta paginada falla explícitamente ante errores, conteos cambiantes o páginas incompletas. No hay sustitución por demostraciones ni localStorage.
- Importación: vista previa sin escrituras, comprobación del archivo oficial y confirmación del mismo hash. La RPC serializa importaciones, conserva las nueve celdas originales de cada fila y revierte la transacción ante conflictos. Repetir la importación no duplica folios.
- Las relaciones ambiguas permanecen sin proveedor asignado. El administrador puede confirmar una asociación individual con motivo y catálogo real. No se modifica la titularidad de empresas.
- Carga múltiple de PDF: firma, contenido, folio, código de proveedor y SHA-256. Almacenamiento privado, ruta nueva y versiones conservadas; no sobrescribe originales ni crea reportes. Los pendientes pueden volver a conciliarse.
- Los expedientes muestran originales, avances estructurados, evidencias, fechas verificadas, validación, historial y notificaciones preparadas. Se reutiliza el visor documental existente.
- El portal de proveedores conserva su separación del Portal de Clientes. Los enlaces usan la navegación autenticada existente. La autorización se comprueba antes de firmar cada archivo durante 60 segundos.

## Estados y cálculos

No se infiere notificación a partir de la creación o del cambio de estado legacy. Registrar la comunicación exige administrador o inspectormp, fecha/hora real y referencia verificable.

El vencimiento es la notificación original más siete días naturales en Ciudad de México; no cambia por avances, rechazo ni archivos tardíos. Abierto durante las primeras 24 horas, Sin atención después sin avance válido, En proceso con avance comprobable, Tarde al vencimiento sin entrega completa y En validación cuando están completos los requisitos. Sólo la cuenta activa y confirmada inspectormp autoriza el cierre.

Un comentario genérico no detiene el aviso por falta de atención. El avance requiere análisis, plan, contención o evidencia válida; su primera fecha se registra en servidor. La entrega completa verifica causa, plan, compromisos, contención cuando aplica, documentos obligatorios y archivos privados vinculados. Archivos vacíos, ajenos, retirados o duplicados no satisfacen los requisitos. Una entrega enviada no puede editarse mientras se valida.

Cada RNCP tiene un estado operativo y, por separado, cumplimiento conocido/desconocido. «Tarde» histórico conserva el significado del Excel y no prueba un vencimiento de siete días. El cumplimiento mostrado es entregas completas dentro de plazo / resultados medibles con notificación verificada; excluye históricos sin fechas y plazos todavía abiertos. Los registros cerrados permanecen en el total.

Las alertas comparan cohortes explícitas y periodos adyacentes con igual número de días. No reducen un mes al intervalo entre sus primeros y últimos incidentes. Las selecciones de un mes sin año no generan una comparación continua ficticia entre años. Los folios de las alertas respetan el conjunto seleccionado.

## Alertas y comunicaciones

Reglas configurables: reincidencia de descripción normalizada por proveedor y materia prima, crecimiento con línea base suficiente, incumplimientos con fechas verificables y posible repetición posterior a cierre validado. Cada alerta conserva sus IDs, folios, periodo, criterio y revisión administrativa con motivo y auditoría. No modifica estados, crea A3, bloquea proveedores ni envía comunicaciones.

IA externa desactivada por defecto. Requiere configuración del operador y consentimiento administrativo explícito para descripciones minimizadas. No recibe PDF, nombres de empresas, folios, contactos ni IDs estables como campos del análisis. El texto libre debe revisarse antes de autorizar cualquier salida. Se separan proveedor y materia prima; sólo se admiten IDs de entrada. Las sugerencias se identifican como tales. Un fallo de IA no interrumpe reglas ni KPI. Las explicaciones visibles se construyen a partir de hechos comprobables.

La cola idempotente distingue falta de destinatario confirmado y envío desactivado. inspectormp se resuelve por usuario activo y correo confirmado; no se inventan direcciones ni se crean cuentas. Los reintentos preparados tienen arrendamiento exclusivo, clave única por evento/destinatario, límite de intentos y espera creciente. Las pruebas no envían correo real.

La función programada de Netlify permanece inactiva sin `RNCP_FOLLOWUP_ENABLED=true`, contexto publicado y configuración administrativa. Incluso habilitada sólo prepara la cola: no contiene transporte de correo real. La activación de comunicaciones, destinatarios y recepción efectiva de proveedores pertenece a una autorización y aceptación posteriores.

## Migración específica aplicada

`supabase/migrations/20261106163011_rncp_matrix_followup.sql` reutiliza reportes, acciones, archivos, auditoría y workspace existentes. Añade procedencia histórica, hitos de seguimiento y requisitos; no reinterpreta ni actualiza filas anteriores. Añade una única cola RNCP porque las notificaciones existentes requieren usuario registrado y no modelan destinatario desconocido, reintentos ni arrendamientos.

Las políticas RESTRICTIVE combinan alcance organizacional/proveedor con los permisos anteriores. Protegen reportes, acciones, vínculos, originales y evidencias RNCP sin ampliar consulta de otros documentos. Las áreas de configuración RNCP sólo se modifican por la RPC administrativa con control de revisión. No se aplican las migraciones generales pendientes.

El disparador heredado `notify_supplier_response` publica destinatarios sin organización y eventos en la cola general de integraciones. La propuesta conserva su cuerpo para registros legacy y excluye los RNCP gestionados nuevos de ese camino. Estos utilizan exclusivamente la cola específica desactivada. El fixture de compatibilidad reproduce los 15 disparadores existentes, sus funciones y comprobaciones documentales; se verifica que los nuevos RNCP no creen avisos generales ni eventos de envío heredados.

Aplicación productiva autorizada y realizada exclusivamente por Supabase MCP. La propuesta aprobada `20261106031133` del commit `5323a1f` fue registrada por Supabase como `20261106163011`, nombre `rncp_matrix_followup`, exactamente una vez (44 → 45 entradas). El archivo se renombró para coincidir con ese historial, conservando sus bytes y SQL. No se ejecutó `db push`, sincronización automática ni otra migración.

La comparación antes/después de aplicar la migración confirmó 0 RNCP, 0 acciones, 61 proveedores, 45 perfiles, 544 documentos, 544 versiones y 634 archivos/objetos de Storage. Las huellas de filas de proveedores, perfiles, documentos, versiones y archivos permanecieron idénticas. La cola nueva tiene RLS y cero avisos; la cola general conserva cero eventos. La carga real de 226 registros sigue PENDING: el navegador no pudo iniciar el asistente de Windows (1223), por lo que falta completar la importación con una sesión administrativa real.

## Reparación de lectura autorizada y aplicada

La prueba adicional de la consulta por lotes reprodujo `column reference "id" is ambiguous` en `iq_rncp_requirements_summary(uuid[])`. El defecto está en un identificador PL/pgSQL que coincide con una columna; no afecta los registros conservados. El defecto se corrigió mediante una segunda migración específica, sin volver a ejecutar la primera. La importación requiere una sesión administrativa real.

La propuesta `20261106190022_rncp_requirements_batch_scope.sql`, commit `b1eace6`, fue autorizada por separado y registrada como `supabase/migrations/20261106191602_rncp_requirements_batch_scope.sql`. Únicamente desambigua las variables de esa función de lectura. Conserva firma, límite de 500 IDs, comprobación de alcance por expediente y permisos existentes. No añade tablas, columnas ni políticas y no modifica datos. La reparación aparece exactamente una vez en el historial (45 → 46 entradas). Conservó los permisos de la función. Los conteos y huellas completas de las 95 empresas, 45 perfiles, 544 documentos, 544 versiones y 634 archivos/objetos de Storage coincidieron antes/después. Los reportes y acciones RNCP permanecen en cero hasta la importación autenticada. La primera migración aplicada permanece íntegra.

GitHub CI de `b1eace6`, ejecución `42276967126`: PASS en validación, regresión documental y PostgreSQL RNCP efímero. La regresión adicional comprueba lectura propia, lote de 226 expedientes, rechazo de otra organización y límite de lote. Las entregas completas conservan su cumplimiento real y no se presentan como avances incompletos ni acumulan días de retraso después de su entrega.

## Verificación y límites de aceptación

- Pruebas unitarias de estados, plazos, filtros compartidos, Pareto, importación, conciliación, PDF real sintético, firmas de archivo, requisitos, notificaciones, alertas y fallos de IA.
- Pruebas API de perfil activo, organización, roles, exclusión de clientes, acceso individual a archivos, permisos administrativos y paginación completa.
- PostgreSQL 17 efímero en GitHub CI: aplica sólo la migración RNCP y su reparación de lectura sobre metadatos y actores sintéticos. Comprueba políticas permisivas combinadas con las restrictivas, aislamiento A/B, validación exclusiva, importación 226, idempotencia, originales y cola. El runner rechaza cualquier host o base diferentes de su fixture local efímero.
- Capturas aisladas de escritorio y móvil con la fuente oficial: cinco gráficas, posiciones, proporciones, 226 folios únicos, filtros y controles sin recortes. No son capturas de una sesión productiva ni demuestran importación en Supabase.
- Se verifica además la lectura PDF desde el build empaquetado; la prueba detectó y corrigió la dependencia explícita del worker de PDF.js.

PENDING: importación productiva, conciliación administrativa de los 30 registros, asociación formal del PDF RNCP0228, sesiones reales de proveedor/inspectormp, aprobación de destinatarios y recepción efectiva. No declarar completo el flujo externo ni activar envíos por la matriz histórica. La fase 2 de emisión digital y correo no se incluye en esta liberación.
