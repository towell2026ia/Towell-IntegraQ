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
- Creación, confirmación, reprogramación, cancelación y resultados usan RPC autenticadas con perfil activo, organización y asignación explícita de inspector; las modificaciones exigen motivo y revisión del registro. Dos actualizaciones simultáneas no se sobrescriben.
- Un administrador configura supervisión y alcance; no es inspector automáticamente. No se utiliza correo, nombre de usuario o posición fija para autorizar.
- Historial importado transaccional e idempotente de 22 eventos. Vista previa obligatoria, mismo hash al confirmar y conservación de los pendientes sin asociación. No se crea evaluación por importar.
- PDF privado, hasta 4 MB o el límite menor de la política. Firma, lectura real del PDF, huella, referencia física y relación con el expediente se verifican antes de registrar. Versiones previas conservadas. No hay borrado físico compensatorio.
- Se reutilizan `supplier_assessments`, `file_objects`, Storage privado, `audit_log`, `workspace_data` y el visor documental. La ficha y el calendario abren el mismo ID de evento.
- Captura F-CO-05 en dos modalidades, calificación final manual, fecha, auditor, observaciones, hallazgos y plan PDF opcional. Finalizar requiere informe consultable del mismo expediente, fecha real y todos los rubros.
- La ficha del proveedor consolida contactos, conteos RNCP persistentes, agenda, resultados y PDFs históricos. No se usan calificaciones ni próximas auditorías de los catálogos estáticos en producción.
- Contactos en la metadata existente, con confirmación manual de receptor/correo y auditoría. Se conservan UUID, código, titularidad y otras claves de metadata. No se crean accesos.
- Los eventos de auditoría dejan una intención de notificación desactivada en su trazabilidad. No hay transporte de correo ni activación de portales en esta fase.

## Migración propuesta — NO aplicada

`20261106205722_supplier_audit_calendar.sql` añade una tabla de agenda porque no existe una entidad persistente de programación y los resultados requieren proveedor y fecha de evaluación reales. Usar una evaluación como evento obligaría a inventar fechas o perder los proveedores históricos pendientes.

Añade a `supplier_assessments` únicamente vínculo único al evento, cuestionario, rubros, hallazgos y referencias de informe/plan. Las columnas y filas legacy se conservan. Los PDF nuevos usan recursos específicos; no se amplían los tipos permitidos de archivos de otros módulos.

RLS impide lectura entre organizaciones incluso a administradores. La escritura de la agenda se realiza exclusivamente por RPC con asignación efectiva; los resultados gestionados no pueden cambiarse por la API legacy ni mediante peticiones directas. Archivos y objetos privados se firman por servidor tras comprobar sesión, organización, evento y proveedor. Clientes y proveedores externos no reciben acceso a esta función.

La configuración nueva tiene guardas restrictivas contra escritura directa, compatibles con las políticas permisivas anteriores. Los RPC `SECURITY DEFINER` tienen `search_path` vacío, permisos de ejecución acotados y comprobación explícita de `auth.uid()`, perfil y organización. Los helpers no se publican como endpoints generales.

## Condiciones de activación

1. CI completo y pruebas PostgreSQL efímeras con RNCP y definiciones legacy aplicadas.
2. Autorización específica del SQL propuesto. No ejecutar otras migraciones pendientes.
3. Aplicación mediante el mecanismo oficial que registre su versión real, con comparación de datos antes/después.
4. Un administrador asigna al inspector por UUID y permiso Proveedores → Editar.
5. Los 61 proveedores históricos consultados no tienen `owning_organization_id`. La aplicación no se lo asigna: el administrador confirma explícitamente los UUID autorizados en la configuración de auditorías. Si otra organización ya tiene un alcance confirmado, se bloquea el conflicto.
6. Inspector autorizado revisa/importa el F-CA-58 original y concilia los pendientes individualmente. No se importan ni cargan datos productivos durante pruebas.
7. Sesión real para verificar calendario, carga/descarga PDF y captura manual. Sin documentos ficticios en producción.

## Validación

Las pruebas automatizadas cubren calendario, años bisiestos, semanas, meses sin fecha, separación de estados, 9/8 rubros, cero frente a ausencia, origen inalterado, API de consulta/escritura, proveedores ambiguos y denegación a usuarios externos.

La prueba adicional con las fuentes locales coteja los 22 eventos, 14/3/5 estados y los nombres y fórmulas de ambos cuestionarios. En CI no se copian los archivos privados; sólo se usan fixtures sintéticos.

El job PostgreSQL efímero aplica el esquema RNCP y las evaluaciones legacy junto a la propuesta específica; comprueba aislamiento, asignación, concurrencia, P/R, informe obligatorio, historial e idempotencia. Rechaza cualquier host/base distintos del servicio efímero de CI. No dispone de credenciales de producción.

PENDING: autorización/aplicación SQL, configuración de inspector y proveedores, importación histórica productiva, carga de informes reales, aceptación con sesión real y publicación final. Correos y portal externo permanecen desactivados.
