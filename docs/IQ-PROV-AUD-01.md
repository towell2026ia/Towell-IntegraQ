# IQ-PROV-AUD-01 — Calendario y evaluación de proveedores

## Fuentes leídas sin modificar ni ejecutar macros

| Fuente | SHA-256 | Contenido verificado |
|---|---|---|
| F-CA-58_Programa de auditoría a Proveedores_V0.xlsx | `28f5784c76c2cb077f9d0aae69c8de10175f2c66f7b1ad130c98e7261ff164df` | 22 eventos, tres hojas; 14 con fecha R, tres cancelados y cinco pendientes sin R |
| F-CO-05_Evaluación de proveedores_V2 (esp).xlsm | `fa8dd9b090a9a2e5d210ab75531f44b717c46fa7ba1ec92144472c74ff6669c5` | Nueve rubros Manufacturers y ocho Distribuidores y Servicio |

Las hojas del programa son `2025 JUL-ENE`, `2026 FEB-JUL` y `2026 AGO-ENE`. Se conservan nombre histórico, criterios, método, responsables, P/R, estado original, observaciones, las 35 celdas de la fila, archivo/hash, hoja, fila y columna. No se convierten cancelaciones en fechas, ni fechas R en informes o resultados. Las coincidencias sólo admiten nombre normalizado completo y único; los alias y coincidencias ambiguas requieren conciliación individual con motivo.

Manufacturers: C10, C18, C25, C33, C41, C50, C57, C66 y C74. Distribuidores y Servicio: C10, C18, C26, C34, C43, C51, C60 y C68. Los promedios O1 y P1 omiten J74 y J68 respectivamente. La portada D29 utiliza uno de esos resultados; G29 deja un intervalo problemático entre 70% y 71%. La implementación captura porcentajes, final y clasificación reportados, sin promediar ni reclasificar automáticamente. La revisión anterior `provider-audit-review.md` contiene recomendaciones de otras fases; no sustituye estas reglas aprobadas.

## Implementación

- Doce casillas anuales, navegación por año, cuatro conteos separados y agenda mensual con vista de días y lista adaptable a móvil. No existe máximo mensual de cuatro visitas.
- Programación por fecha tentativa, semana o mes sin inventar el día. Confirmación exige fecha exacta. P, R, evaluación y carga del PDF se almacenan por separado.
- Creación, confirmación, reprogramación, cancelación y resultados usan RPC autenticadas con perfil activo, organización y permiso de Proveedores administrado desde Usuarios y acceso; las modificaciones exigen motivo y revisión del registro. Dos actualizaciones simultáneas no se sobrescriben.
- El calendario no contiene configuración de inspectores, permisos ni proveedores históricos sin titular. La propuesta administrativa descrita al final reconoce el permiso heredado del Administrador y mantiene el permiso explícito de edición para usuarios internos. No se utiliza correo, nombre de usuario o posición fija ni se asigna ninguna cuenta como inspector.
- Historial importado transaccional e idempotente de 22 eventos. Vista previa obligatoria, mismo hash al confirmar y conservación de los pendientes sin asociación. No se crea evaluación por importar.
- PDF privado, hasta 4 MB o el límite menor de la política. Firma, lectura real del PDF, huella, referencia física y relación con el expediente se verifican antes de registrar. Versiones previas conservadas. No hay borrado físico compensatorio.
- Se reutilizan `supplier_assessments`, `file_objects`, Storage privado, `audit_log`, `workspace_data` y el visor documental. La ficha y el calendario abren el mismo ID de evento.
- Captura F-CO-05 en dos modalidades, calificación final manual, fecha, auditor, observaciones, hallazgos y plan PDF opcional. Finalizar requiere informe consultable del mismo expediente, fecha real y todos los rubros.
- La ficha del proveedor consolida contactos, conteos RNCP persistentes, agenda, resultados y PDFs históricos. No se usan calificaciones ni próximas auditorías de los catálogos estáticos en producción.
- Contactos en la metadata existente, con confirmación manual de receptor/correo y auditoría. Se conservan UUID, código, titularidad y otras claves de metadata. No se crean accesos.
- Los eventos de auditoría dejan una intención de notificación desactivada en su trazabilidad. No hay transporte de correo ni activación de portales en esta fase.

## Migración específica aplicada

`20261106221636_supplier_audit_calendar.sql` añade una tabla de agenda porque no existe una entidad persistente de programación y los resultados requieren proveedor y fecha de evaluación reales. Usar una evaluación como evento obligaría a inventar fechas o perder los proveedores históricos pendientes.

Añade a `supplier_assessments` únicamente vínculo único al evento, cuestionario, rubros, hallazgos y referencias de informe/plan. Las columnas y filas legacy se conservan. Los PDF nuevos usan recursos específicos; no se amplían los tipos permitidos de archivos de otros módulos.

RLS impide lectura entre organizaciones incluso a administradores. La escritura de la agenda se realiza exclusivamente por RPC con asignación efectiva; los resultados gestionados no pueden cambiarse por la API legacy ni mediante peticiones directas. Archivos y objetos privados se firman por servidor tras comprobar sesión, organización, evento y proveedor. Clientes y proveedores externos no reciben acceso a esta función.

El cotejo final identificó que la política heredada de `audit_log` permite consultas de otras organizaciones. La propuesta añade guardas restrictivas únicamente para los eventos nuevos y las evaluaciones vinculadas. Los movimientos legacy de esas evaluaciones se resuelven mediante el evento real, incluso si su disparador dejó `organization_id` vacío. Se bloquea la falsificación directa de esa trazabilidad. Los historiales de otros módulos mantienen sus condiciones existentes. Las rutas generales de actividad ya usan el cliente autenticado y RLS, por lo que no necesitan cambios.

La lectura de evaluaciones del resumen existente de Proveedores pasa por el cliente autenticado y su RLS, para que una consulta privilegiada heredada no exponga los nuevos resultados. Las demás consultas y fórmulas de ese resumen se conservan. La lista legacy de evaluaciones excluye los eventos nuevos para no duplicar su presentación; ambos reutilizan la misma tabla.

La configuración nueva tiene guardas restrictivas contra escritura directa, compatibles con las políticas permisivas anteriores. Los RPC `SECURITY DEFINER` tienen `search_path` vacío, permisos de ejecución acotados y comprobación explícita de `auth.uid()`, perfil y organización. Los helpers no se publican como endpoints generales.

## Condiciones de activación

1. CI completo y pruebas PostgreSQL efímeras con RNCP y definiciones legacy aplicadas.
2. Autorización específica del SQL propuesto. No ejecutar otras migraciones pendientes.
3. Aplicación mediante el mecanismo oficial que registre su versión real, con comparación de datos antes/después.
4. La propuesta complementaria elimina la asignación adicional del calendario. Usuarios y acceso es la única administración del permiso Proveedores → Editar; no se asigna ninguna cuenta automáticamente.
5. Los 61 proveedores históricos consultados no tienen `owning_organization_id`. Se reutiliza su catálogo únicamente cuando existe una sola organización interna en toda la base. Una segunda organización, incluso inactiva, impide usar proveedores sin titular; los proveedores con titular sólo se admiten en su organización. No se reasigna ninguna empresa.
6. Inspector autorizado revisa/importa el F-CA-58 original y concilia los pendientes individualmente. No se importan ni cargan datos productivos durante pruebas.
7. Sesión real para verificar calendario, carga/descarga PDF y captura manual. Sin documentos ficticios en producción.

## Validación

Las pruebas automatizadas cubren calendario, años bisiestos, semanas, meses sin fecha, separación de estados, 9/8 rubros, cero frente a ausencia, origen inalterado, API de consulta/escritura, proveedores ambiguos y denegación a usuarios externos.

La prueba adicional con las fuentes locales coteja los 22 eventos, 14/3/5 estados y los nombres y fórmulas de ambos cuestionarios. En CI no se copian los archivos privados; sólo se usan fixtures sintéticos.

La comprobación visual aislada utiliza un perfil vacío de Chrome, sin sesión ni conexión a Supabase, a 1500×1100 y 390×844. Verifica las doce casillas, más de cuatro eventos, años anteriores, separación P/R, rubros, calificación manual, gestión reservada al inspector, campos sin recortes y apertura del mismo ID desde calendario/ficha. Estas capturas no sustituyen la aceptación productiva ni acreditan carga de informes reales.

El job PostgreSQL efímero aplica el esquema RNCP y las evaluaciones legacy junto a la propuesta específica; comprueba aislamiento, asignación, concurrencia, P/R, informe obligatorio, historial e idempotencia. Rechaza cualquier host/base distintos del servicio efímero de CI. No dispone de credenciales de producción.

Resultados disponibles: 694 pruebas de la suite general PASS (el cotejo con archivos privados se omite en CI y se ejecutó localmente con las fuentes originales); 57 comprobaciones SQL de auditorías PASS, más una prueba de dos transacciones concurrentes; 17 comprobaciones visuales aisladas PASS. Typecheck, lint y build aprobados. Las regresiones SQL existentes de RNCP y reemplazo documental también pasaron.

PENDING: importación histórica por el usuario autorizado, carga de informes reales y aceptación de programación con sesión real. Correos y portal externo permanecen desactivados.

## Evidencia de aplicación autorizada

El usuario autorizó expresamente la versión definitiva del commit `e1d51a6`, sustituyendo la solicitud anterior. Supabase MCP aplicó únicamente ese SQL en `yptrqowmviixlkrxjrqr` y lo registró como `20261106221636`, `supplier_audit_calendar`, exactamente una vez (46 → 47 entradas). El archivo de la propuesta `20261106205722` se renombró para coincidir con el historial, sin alterar sus bytes: SHA-256 `1afdc59448c6038b094dad00b0d9f76e16cb986924c2a60a83adfb7fca8a2120`. No se ejecutó `db push` ni otra migración pendiente.

La comparación inmediata antes/después confirmó igualdad de conteos y huellas en empresas, perfiles, RNCP, acciones RNCP, evaluaciones preexistentes, documentos, versiones, archivos, objetos de Storage, workspace, las cuatro tablas de permisos, notificaciones y cola general. Se conservaron 95 empresas (61 proveedores), 45 perfiles, 226 RNCP, 544 documentos, 544 versiones, 634 referencias de archivo y los 642 objetos de Storage presentes en ese momento. Las 44 notificaciones existentes y los cero eventos de integración no cambiaron. La agenda nueva tiene cero filas; no se cargaron auditorías ni informes de prueba.

Supabase concede privilegios de tabla por defecto: eso no equivale a autorización RLS. La agenda tiene RLS habilitado y únicamente una política SELECT; los roles `authenticated` y `anon` no son propietarios ni pueden omitir RLS. Las pruebas efímeras reproducen esos privilegios y comprueban rechazo de INSERT, UPDATE y DELETE directos. La RPC anónima está denegada. Las dos guardas restrictivas del historial están instaladas. El análisis de seguridad mantuvo los mismos cuatro avisos previos, sin avisos nuevos.

Las condiciones de aplicación de la primera migración están cumplidas. Esa versión requería configurar inspector y proveedores dentro del calendario. El usuario solicitó retirar ambos controles y gestionar permisos únicamente desde Usuarios y acceso; la corrección siguiente sustituye esa doble configuración, sin modificar la migración aplicada ni asignar cuentas.

## Corrección solicitada tras la aceptación del calendario

- Los números de día antes eran texto. Ahora cada día abre Programar auditoría con año, mes y fecha precargados, también en móvil. Elegir otro mes o año conserva la navegación y evita enviar una fecha del periodo anterior; elegir fecha o semana sincroniza su periodo. La lista mensual sigue abriendo el expediente existente, sin duplicarlo.
- Se retiran el icono Configuración, la lista de inspectores, el bloque de proveedores históricos sin titular y su comando API. El servidor deja de leer o enviar identidades y asignaciones adicionales al navegador.
- La corrección `20261107012723_supplier_audit_access_navigation.sql` reemplaza exclusivamente dos helpers de autorización/catálogo y revoca la ejecución pública del antiguo configurador. Exige perfil activo interno, organización vigente, permiso explícito `suppliers:update` y permiso efectivo. El rol administrador por sí solo no da permiso de programación. No modifica filas de permisos, proveedores, perfiles, documentos, archivos ni agenda.
- El catálogo autorizado aplica el mismo criterio en servidor y RPC: titular exacto, o proveedor sin titular únicamente si existe una sola organización interna. No se infiere ni persiste titularidad. En producción se verificó por consulta de sólo lectura una organización interna, 61 proveedores sin titular y cero configuraciones adicionales. Si aparece una configuración antes de aplicar, la propuesta se detiene para revisión.
- Se conservan RLS, CAS, separación P/R, resultados manuales y los controles privados de archivo. El usuario autorizó exclusivamente esta corrección; no se ejecutaron las otras migraciones pendientes.

## Aplicación autorizada de la corrección de navegación y acceso

Se aplicó únicamente el SQL del commit `7de5be8`, blob `6978db7fb73de4f75b6e88b9319d6433181ceec0`, en `yptrqowmviixlkrxjrqr`. Supabase lo registró como `20261107012723`, `supplier_audit_access_navigation`, exactamente una vez: 47 → 48 entradas, sin alterar ni retirar las versiones anteriores. El archivo propuesto `20261106230012` se renombró a esa versión real sin cambiar contenido ni huella SHA-256 `be34dab91bc2fb1ac0068d3c9f4b0ff84910fdb7b0bc68dceabcc4a7ac5ec896`.

La comparación inmediata antes/después confirmó igualdad de conteos y huellas en las 17 tablas comprobadas: empresas, perfiles, RNCP, acciones RNCP, agenda, evaluaciones, documentos, versiones, referencias de archivo, objetos de Storage, workspace, cuatro tablas de permisos, notificaciones y cola general. Permanecieron 95 empresas, 61 proveedores, 45 perfiles, 226 RNCP, 544 documentos y versiones, 634 referencias de archivo y 642 objetos de Storage. No se crearon auditorías ni resultados de prueba, cuentas, asignaciones o comunicaciones.

La huella de todas las políticas de `public` y `storage` permaneció idéntica, así como la de las definiciones y permisos de ejecución de las funciones ajenas a los tres objetos autorizados. Los cuerpos de los dos helpers coinciden con el SQL aprobado y no son ejecutables directamente por `anon` ni `authenticated`. El configurador retirado tampoco es ejecutable por esos roles. El análisis de seguridad no añadió hallazgos y retiró el aviso de ejecución del configurador anterior.

Validación del commit funcional: 707 pruebas PASS y una prueba de archivos privados omitida en CI; typecheck, lint y build PASS. Los cuatro jobs de CI pasaron, incluidas las pruebas PostgreSQL efímeras de auditorías, RNCP y reemplazo documental. Las 21 comprobaciones aisladas de navegador pasaron en escritorio y móvil: selección de día, fecha precargada, sincronización de mes/año, periodos anteriores, consulta sin escritura, PDF/historial y ausencia del configurador. No sustituyen una prueba de programación con la sesión autorizada real.

## Bloqueo confirmado de la cuenta administradora y propuesta puntual

Después de publicar `ca87032`, el usuario confirmó que accede como Administrador y no ve Programar ni días pulsables. La consulta de sólo lectura comprobó que las tres cuentas administradoras activas no tienen filas explícitas `suppliers:update`. Usuarios y acceso muestra a ese perfil Acceso total y sólo presenta la edición de acciones individuales a usuarios internos. Su API no guarda esas acciones individuales para administradores. La función real `has_module_permission(text,module_permission_action)` reconoce `is_administrator()`, pero el helper del calendario exige además la fila individual mediante un JOIN. Por ello devuelve `canManage=false` antes de respetar el permiso heredado. No es un fallo del selector de fecha ni se corrige asignando una cuenta como inspector.

La propuesta `20261107013816_supplier_audit_admin_effective_access.sql` sustituye únicamente `iq_supplier_audit_inspector(uuid)`: acepta el rol Administrador activo o el permiso explícito de edición de un usuario interno, y conserva permiso efectivo, identidad autenticada, organización interna activa y entorno productivo. Las RPC existentes mantienen sus comprobaciones de alcance, proveedor, concurrencia, documentos y trazabilidad. El administrador queda registrado con su propia identidad, nunca con la de un inspector. No modifica perfiles, asignaciones, filas de permisos, datos, archivos ni políticas RLS.

Las dos migraciones aplicadas se conservan intactas. La propuesta necesita autorización específica antes de aplicarse y no se desplegará ninguna otra migración. Las pruebas efímeras reproducen primero el bloqueo con el helper publicado y después verifican programación persistente como administrador sin filas adicionales, autoría real, rechazo a internos de consulta, cuentas inactivas y organizaciones ajenas. Se conservan las regresiones de PDF e historial. No se generan registros de prueba en producción.
