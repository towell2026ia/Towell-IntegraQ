# PRD-SEG-01.1 · Permisos de proveedores y portales

## Diagnóstico previo

La rama operativa partió de `8fe797a`. La cuenta interna activa de la auditora conserva su organización, un proceso asignado, permisos individuales de consulta, creación, edición y gestión de proveedores y acceso al portal de proveedores. En clientes existe una denegación expresa del portal. El catálogo instalado carece de una facultad específica para invitar.

Una consulta SQL de sólo lectura con el contexto RLS de la auditora reconoció 227 RNCP. Con el límite productivo de ocho segundos, listar sus identificadores y folios devolvió 57014 al encadenar las políticas de lectura y repetir la evaluación de permisos en cada fila. La prueba comprobó las asignaciones persistidas. La autenticación interactiva de la auditora constituye una comprobación independiente.

La interfaz de ambos portales y sus servicios de administración seleccionan al administrador por tipo global. Así, una persona interna puede entrar por el menú y recibir el mensaje para una empresa externa ausente. La emisión también depende de un RPC exclusivo de administrador, compartido con operaciones ajenas a invitaciones.

Usuarios y acceso realiza escrituras de perfil, procesos, módulos, acciones y excepciones en solicitudes separadas. Presenta permisos ausentes como denegaciones expresas, reemplaza asignaciones y no comprueba el resultado del registro de auditoría. La recarga del directorio también captura sus errores sin informar al guardado. Las peticiones verificadas recuperan el perfil y sus permisos desde PostgreSQL. La inspección del cliente no identificó un trabajador de servicio que almacene estas respuestas.

La administración de empresas requiere administrador global aunque existan permisos de crear o editar. El tablero alternativo de proveedores consulta varias tablas mediante un cliente de servicio sin aplicar todo el alcance del lector. El seguimiento RNCP contiene además una validación histórica por identidad de inspector. Las facultades de aprobación formal y los derechos de otros módulos requieren conservar sus límites actuales.

## Comparativo para autorización de liberación

| Operación | Producción antes del candidato | Candidato de fase 1 |
|---|---|---|
| RNCP de Karen | La asignación existe. La consulta de 227 registros puede vencer a los ocho segundos. | PostgreSQL evalúa el acceso general una vez por consulta. El expediente, el tablero y los archivos privados comprueban su alcance. |
| Portal de proveedores | Karen tiene acceso al módulo. La aplicación exige el tipo administrador al gestionar invitaciones. | Gestión interna desde su propia sesión y organización. Cuatro permisos separados permiten consultar, emitir, reenviar y revocar. |
| Portal de clientes | Karen tiene una denegación explícita. | Se conserva la denegación. Los cuatro permisos de invitaciones de clientes quedan disponibles para asignación individual. |
| Validar y cerrar | El verificador anterior depende del correo de la auditora. | Las decisiones se asignan en Usuarios y acceso. Una misma persona puede validar, verificar la efectividad, cerrar el plan y cerrar el RNCP. Cada paso comprueba expediente, estado y evidencia. |
| Reabrir | La función instalada permite la reapertura a administradores globales con motivo. | Los tres administradores globales activos conservan la reapertura y los futuros la heredan del rol. Una denegación individual prevalece. Cualquier persona interna con alcance y asignación expresa puede ejercerla. Karen conserva el cierre y queda inicialmente sin reapertura. |
| Correo | Las invitaciones abren el cliente de correo con un enlace individual. El código de RNCP admite Graph delegado. En el listado de variables del sitio Netlify no se encontraron claves de activación de correo o Graph. | Se conserva el buzón institucional del operador y la configuración instalada. La preparación, la confirmación manual con referencia y la aceptación técnica de Graph son hechos distintos. Reclamos, seguimientos y recordatorios tienen permisos independientes. |
| Administración | La edición reemplaza permisos en varias solicitudes. Un disparador reconstruye asignaciones del puesto cuando se incluyen ciertas columnas, incluso con valores iguales. | La operación comprueba la revisión guardada, bloquea la cuenta, escribe los cambios y registra al administrador en una transacción. La interfaz comprueba la revisión con una lectura posterior. Las asignaciones por puesto se conservan cuando sus campos permanecen iguales. |

El catálogo incorpora ocho permisos de invitaciones, 17 de RNCP y dos de reapertura en Revisión por la Dirección. El cambio inicial autorizado para Karen comprende los cuatro de invitaciones de proveedores y 15 de RNCP. Quedan fuera configurar el módulo y reabrir RNCP. El catálogo y las funciones operan por asignaciones. La continuidad del cierre y la asignación inicial se confirman en la misma transacción. La organización, el proceso, el puesto y la denegación de clientes conservan su valor.

La revisión de los contratos instalados y sus controles de interfaz identificó tres operaciones explícitas sobre registros cerrados. Son la reapertura del RNCP, del acuerdo de Dirección y de la acción de un acuerdo. Las tres usan la misma regla de permiso individual, motivo e historial. En Dirección se conservan las comprobaciones existentes de organización, proceso y asignación, así como la autoridad vigente de Dirección. Una concesión de reapertura por sí sola permite exclusivamente esa transición. En Root2Cause la acción «reabrir el borrador» recupera un borrador guardado para continuar la captura. La búsqueda de operaciones de reapertura no constituye una homologación de todos los permisos de la plataforma.

Las cinco plantillas de proveedores se aplican al elegirlas expresamente en Usuarios y acceso. Ninguna selecciona las cinco facultades de validación, efectividad, cierre de plan, cierre de RNCP y reapertura. El administrador puede configurarlas individualmente. La homologación universal de los demás módulos corresponde a la fase posterior.

## Migraciones y reversión

| Orden | Archivo en `supabase/migrations` | SHA-256 del contenido de Git |
|---|---|---|
| 1 | `20261128010704_prd_seg_01_1_portal_permissions.sql` | `e8bbca37235ca70ed62602fe4c51ff2dc9170488ed7aebea48ff0d028694b64f` |
| 2 | `20261128020100_prd_seg_01_1_rncp_faculties.sql` | `8b06daf844d2999488b8fe4db65014b1c4c916a38d1f0033133b354720a0e66f` |
| 3 | `20261128023000_prd_seg_01_1_reaperturas_direccion.sql` | `f9a662893f369d7d48931c96ae2d285612de02a441b4720e5391908555ad73ac` |

Las políticas de lectura de `supplier_rncp_reports` son `supplier_rncp_select_scope` y `rncp_organization_read_guard`. Las tablas de asignaciones añaden políticas restrictivas de escritura para las sesiones interactivas. La aplicación administrativa escribe por el servicio autenticado y registra al actor. La política de archivos `rncp_response_file_scope_guard` y la de Storage `rncp_response_storage_scope_guard` emplean la comprobación reforzada del vínculo archivo–acción–RNCP. Los enlaces del expediente vuelven a comprobar la sesión al leer los bytes. Las decisiones de efectividad y cierre se conservan en un registro privado asociado a la versión validada de la acción.

Antes de liberar, comprobar la versión de las funciones contra las definiciones de reversión, los SHA, la identidad del destinatario aprobado y la del administrador responsable. Proporcionar en la sesión SQL de instalación los parámetros `integraq.seg01_recipient` e `integraq.seg01_administrator` con esos UUID verificados. La segunda migración aborta si falta un parámetro, cambia el alcance aprobado o existe una denegación de las facultades que se pretende asignar. La configuración del remitente permanece en el mecanismo existente.

Se preparó una copia cifrada DPAPI del perfil y las asignaciones afectadas, con huellas de control de los demás permisos individuales y de los RNCP. Se verificó su descifrado bajo la cuenta local. El SHA-256 del archivo cifrado es `c2621bad7997bcc37c0e516f5fbf6d2e81d994e7790340141d55860f63afd9d5`. Actualizar el comparativo si entretanto cambiaron los datos. Para revertir, reactivar primero el despliegue anterior y aplicar en este orden `supabase/operations/prd_seg_01_1_reaperturas_direccion_rollback.sql`, `supabase/operations/prd_seg_01_1_rncp_rollback.sql` y `supabase/operations/prd_seg_01_1_rollback.sql`. Los tres procedimientos se probaron en las bases aisladas. Las entradas nuevas de catálogo quedan inactivas. Si se necesita reinstalar tras una reversión, conciliar esas entradas y los cambios posteriores antes de ejecutar un nuevo paquete. Las trazas y decisiones ya registradas se conservan. La reversión restaura el control histórico de cierre.

## Validación de fase 1

| Pruebas | Evidencia del candidato | Pendiente productivo |
|---|---|---|
| T01–T03 | Sesiones PostgreSQL restringidas, 227 RNCP sintéticos bajo el límite de ocho segundos, aislamiento entre dos organizaciones. Las pruebas del listado y tablero cubren resultados y errores. | Abrir lista, tablero y expediente con la sesión real de Karen. |
| T04–T05 | Emisión sintética, códigos individuales, consola interna en navegador de escritorio y teléfono con API interceptada. | Verificar selector y controles con Karen. Una emisión real requiere autorización de Calidad. |
| T06–T10 | Los casos aislados comprueban derechos por acción, alcance, restricciones de escritura y revocación durante una sesión abierta. Se comprueban herencia, denegación, retiro de excepciones y concesión independiente de reapertura. El administrador técnico sin facultad específica tampoco puede validar acciones. | Comprobar la asignación inicial en la sesión real tras la instalación. |
| T11–T12 | Guardado en PostgreSQL, auditoría, conflicto de revisión, consulta de estado de clientes sin secreto y denegación fuera de su empresa. | Comprobar la lectura posterior en la interfaz administrativa publicada. |
| T13–T14 | Suite del candidato, transacciones de instalación y reversión, controles de conservación y copia de las asignaciones. | Comparar los permisos y los registros antes y después de la instalación. |
| T15–T16 | Las pruebas diferencian fallo de conexión, respuesta incompleta y conjunto vacío. | Comprobar el tablero con la cuenta autorizada. |

Los archivos modificados se identifican exactamente con `git diff --name-status 8fe797a7f546eef8098c775dfa7e15b42d8e8edc <SHA-del-candidato>`. El flujo CI ejecuta las transacciones sobre PostgreSQL 17 y la suite de aplicación sobre el SHA solicitado. El informe de entrega referencia esa ejecución y el despliegue que sigue activo.

La incidencia permanece abierta. La lectura previa con el contexto RLS real y las pruebas aisladas con identidades internas no administradoras son evidencias distintas de la aceptación interactiva de Karen en el sistema productivo.
