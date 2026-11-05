# Gestión de Clientes — Certificaciones

## Implementación

Se retiran la pestaña y el KPI de Auditorías externas de Gestión de Clientes. No se borran sus registros ni se modifica el módulo de Auditorías. Se conservan Clientes y Reclamos y hallazgos. Certificaciones utiliza `public.certifications`, `public.file_objects`, `public.audit_log` y el bucket privado existente `integraq-private`; no utiliza localStorage ni catálogos de ejemplo.

El registro permite nombre, tipo, referencia, organismo emisor, emisión, vencimiento, alcance, observaciones internas, responsable interno activo y cliente real opcional. Sin cliente corresponde a General de Towell. La relación con cliente se fija al crear para impedir trasladar documentos históricos a otra empresa durante una edición. Los administradores pueden modificar el resto de los campos, adjuntar documentos y retirar expedientes con confirmación y motivo. El retiro conserva archivos, versiones e historial.

## Fechas y publicación

- Calendario: America/Mexico_City. Emisión y vencimiento son inclusivos.
- Vencida: vencimiento anterior a hoy.
- Próxima a vencer: entre hoy y 30 días, inclusive.
- Vigente: más de 30 días hasta vencimiento, con emisión no posterior a hoy.
- Pendiente de vigencia: emisión futura; no se puede publicar todavía.
- El estado se recalcula al consultar y la interfaz actualiza su fecha cada minuto y al recuperar el foco.
- Alta, edición, nuevo adjunto o sustitución dejan el expediente privado. Publicar requiere una acción administrativa explícita, fechas vigentes y al menos un archivo actual.
- General de Towell se publica para las cuentas activas autorizadas del mismo titular. Una certificación particular sólo se comparte con su cliente. Las observaciones, responsable e historial no se proyectan al portal.
- El Portal conserva exactamente Documentos y Mis análisis A3. Sus documentos existentes se conservan; las certificaciones publicadas se agregan a Documentos. Las versiones históricas sólo se consultan internamente.

## Archivos y autorización

PDF, JPG/JPEG, PNG, WEBP, DOC/DOCX y XLSX, hasta 4 MB por archivo. Se comprueban extensión, firma binaria y tamaño en el servidor, reutilizando sin cambios el validador de archivos existente. Vista previa mediante el visor existente; DOC antiguo conserva descarga original. No se convierte el original ni se garantizan funciones no soportadas por el visor.

Cada subida usa una ruta única sin sobrescritura. Sustituir conserva el archivo anterior y crea una versión nueva. Registro de metadatos, cambio de versión y auditoría son una sola transacción. Si la subida termina pero falla el registro de metadatos, el binario permanece privado con referencia de recuperación; no se elimina ningún archivo como compensación. Las descargas requieren verificar sesión, organización, recurso y archivo. Las URLs firmadas duran 60 segundos; una URL ya emitida puede seguir funcionando hasta su vencimiento después de retirar una publicación.

Las mutaciones usan un comando `SECURITY INVOKER` sólo ejecutable por `service_role`. API y comando comprueban administrador activo, organización interna activa, responsable y cliente titular. Los usuarios internos autorizados tienen consulta; clientes y proveedores no acceden a la API interna. El portal verifica el cliente autenticado y su titular antes de proyectar documentos publicados. Los proveedores se rechazan. No se crean usuarios ni permisos externos.

Las políticas RESTRICTIVE se combinan mediante AND con las políticas permisivas existentes. Se bloquea la escritura directa de certificaciones y de sus archivos, y se impide cambiar la clasificación de un archivo protegido para eludirlas. El acceso directo externo a metadatos internos queda cerrado; la consulta de cliente utiliza exclusivamente la proyección mínima del servidor. La política de Storage sólo afecta al prefijo nuevo `customer-certifications/`.

## Migración aplicada y preservación

Proyecto verificado: `yptrqowmviixlkrxjrqr`.

Única migración aplicada: `20261105201826_customer_certifications`, registrada por Supabase. El archivo conserva íntegramente el SQL aplicado. Amplía la tabla existente y agrega políticas, un trigger específico y un comando transaccional; no crea tablas ni modifica datos históricos. No se ejecutaron las migraciones generales pendientes. La sincronización automática de migraciones continúa desactivada en `supabase/config.toml`.

Antes y después: 33 clientes, 61 proveedores, 45 usuarios y 0 certificaciones. Comparación de hashes de filas ordenadas: clientes, proveedores, perfiles, IDs de Auth, `file_objects`, `quality_cases` y `corrective_actions` idénticos. El bucket sigue privado. `has_function_privilege` confirma EXECUTE denegado para anon/authenticated y concedido para service_role. Las nueve políticas nuevas constan como RESTRICTIVE. El asesor de seguridad conserva los mismos 154 hallazgos previos, sin nuevos hallazgos.

No se crearon certificaciones ni documentos ficticios para pruebas productivas. No se modificaron fuentes ni registros de Reclamos o Root2Cause.

## Validación y límites de aceptación

- Typecheck, lint y build de producción local con webpack: PASS. Se usa webpack en el worktree por el enlace de dependencias de Windows; GitHub y Netlify validan el build estándar de Next.
- Suite: 554 PASS / 107 archivos. Pruebas nuevas: 28 PASS; fechas y ausencia de publicación implícita, permisos de administrador/interno/cliente/proveedor, paginación, aislamiento de organización y cliente, versiones, descarga privada y contrato SQL.
- Las pruebas API son automatizadas con mocks y datos aislados. No equivalen a una ejecución de las escrituras RLS con sesiones reales.
- Navegador integrado y helper nativo: timeout antes de acceder a la sesión. Aceptación visual y sesión real: PENDING.
- Alta real general y por cliente, subida/descarga real, edición de fechas, reingreso, publicación y aislamiento con dos clientes reales: PENDING hasta disponer de sesiones autorizadas y certificaciones auténticas. No se debe declarar aceptación integral basándose sólo en los tests.
- CI y Netlify deben cotejarse con el commit publicado; sus resultados se entregan en el reporte de esta tarea.

## Archivos

- `src/components/modules/customers-module.tsx`: retiro de la vista de auditorías e integración de Certificaciones, sin cambiar el panel de Reclamos.
- `src/components/modules/customer-certifications-panel.tsx`: catálogo, expediente, editor, documentos, versiones, historial y publicación.
- `src/lib/customer-certifications{,-server}.ts`, `certification-files.ts`, `certification-portal-server.ts`: contratos, validación, autorización y proyección externa.
- `src/app/api/customers/certifications/**`: consulta, mutación, carga y acceso interno autorizado.
- `src/app/api/customer-portal/certifications/[fileId]/route.ts` y biblioteca existente: acceso externo a archivos publicados.
- `src/components/modules/stakeholder-portal-module.tsx`: misma sección Documentos; administración de certificados remite a Certificaciones.
- Migración específica y pruebas de regresión correspondientes.
