# IQ-ROOT2CAUSE-ACCESS-01 — Consulta interna y seguridad

## Hallazgo comprobado

- La función productiva `can_access_corrective_action` limitaba la lectura interna al responsable, creador o participante. Itzel tiene permiso de consulta de Root2Cause y procesos asignados, pero no cumple esas tres condiciones para el expediente existente.
- El cliente cargaba `corrective_actions` bajo esa RLS y después marcaba falsamente al usuario actual como participante al transformar cada fila. El filtro de interfaz también exigía participación o titularidad.
- Diecisiete usuarios internos activos conservan permisos antiguos de alta o edición. Las políticas permisivas actuales permiten solicitudes directas a `corrective_actions` y sus tablas hijas aunque la interfaz y el API de aplicación las bloqueen.

## Matriz esperada tras publicar código y aplicar la propuesta RLS por separado

| Perfil | Consulta | Escritura por API | Escritura directa por Supabase |
|---|---|---|---|
| Administrador activo | Expedientes de su organización por API y, tras aplicar la propuesta, por Supabase directo | Permitida dentro de su organización | SELECT y escritura limitados a su organización tras aplicar RLS |
| Interno con `corrective-actions:view` | Expedientes de su organización, limitados a procesos asignados; los sin proceso son de alcance organizacional | Denegada | Denegada tras aplicar RLS |
| Interno sin consulta | Denegada | Denegada | Denegada |
| Cliente A | Sólo resumen de análisis de reclamaciones `source=customer`, publicados expresamente para el ID real de A mediante Portal de Clientes | Denegada | Sólo expedientes de A publicados; adjuntos Root2Cause denegados |
| Cliente B | Igual que A, exclusivamente para el ID real de B; no consulta expedientes de A | Denegada | Sólo expedientes de B publicados; adjuntos Root2Cause denegados |
| Proveedor | Sólo Portal de Proveedores y sus expedientes propios; sin Portal de Clientes ni análisis Root2Cause | Denegada | Expedientes y adjuntos Root2Cause denegados |

La interfaz interna consulta mediante `/api/root2cause/internal-actions`, que comprueba la sesión vigente, organización y procesos antes de enviar datos. La producción deja de combinar expedientes reales con localStorage o ejemplos. El dashboard conserva cuatro listados, tarjetas, búsqueda y filtros.

## Propuesta SQL no aplicada

`20261102190001_root2cause_admin_writes.sql` agrega políticas `AS RESTRICTIVE` para INSERT, UPDATE y DELETE sobre el expediente, sus tablas hijas y metadatos de archivos etiquetados para Root2Cause. También restringe SELECT de esos metadatos a usuarios internos y administradores: la publicación de un resumen no publica automáticamente evidencias. Estas políticas se combinan por AND con las permisivas existentes, incluidas las de tipo `ALL`. No cambia SELECT de expedientes ni de archivos de otros módulos, asignaciones o filas. Las funciones auxiliares son `SECURITY INVOKER`; sus comprobaciones de escritura exigen administrador activo y organización del expediente.

`20261102210001_root2cause_select_organization_scope.sql` agrega una concesión SELECT permisiva para los usuarios internos con `view` y proceso autorizado, seguida de políticas SELECT restrictivas para el expediente y sus tablas hijas. La comprobación de administrador también compara la organización del perfil con la del expediente. Los metadatos `file_objects` y los objetos Storage asociados se limitan al expediente autorizado, incluidos originales y vistas previas; otros módulos siguen sus reglas existentes. Las políticas restrictivas sobre `organizations` y `quality_cases` exigen titularidad explícita de clientes y reclamaciones para usuarios internos. Las condiciones del Portal de Clientes siguen en las políticas existentes para cuentas externas.

**Bloqueo para aceptación:** ninguna de las migraciones propuestas se ejecutó. Las pruebas de solicitudes directas con cuentas reales y la aceptación visual permanecen pendientes de un entorno aislado y autorización de aplicación. Hasta entonces, los permisos antiguos de Supabase siguen vigentes. El build y los mocks no equivalen a una prueba RLS productiva.

## Compatibilidad con PR #19 — revisión estática

Orden previsto, sin ejecución: `20261102170852_admin_delete_guard.sql` (PR #19), `20261102190001_root2cause_admin_writes.sql` (PR #20), `20261102200001_general_information_external_read_guard.sql` (PR #20), `20261102210001_root2cause_select_organization_scope.sql` (PR #20). La última depende de las columnas anulables de titularidad añadidas por PR #19. Los nombres de políticas no colisionan. Ninguna migración asigna titularidad a registros históricos.

| Operación | PR #19 | PR #20 | Resultado combinado esperado |
|---|---|---|---|
| SELECT de análisis e hijos | Sin política restrictiva nueva | Nueva concesión SELECT para internos con `view` y proceso, combinada con restricción de organización para internos y administradores | Consultas directas de otro ámbito denegadas; RLS del portal conserva sus condiciones de publicación por empresa |
| SELECT de metadatos de archivos Root2Cause | Sin política restrictiva nueva | Restrictiva sólo para etiquetas Root2Cause; externa denegada | Clientes y proveedores no obtienen evidencias internas por solicitudes directas; el resumen compartido sigue disponible |
| INSERT/UPDATE de expediente e hijos | Trigger exige administrador para cambiar metadatos de retiro | Políticas restrictivas exigen administrador activo de la organización | Administrador conserva gestión; internos no escriben directamente |
| DELETE físico de expediente, hijos y `file_objects` | `USING (false)` restrictivo | Exige administrador en su organización para Root2Cause | Denegado para todos los roles autenticados por el AND de PR #19; el borrado lógico por API sigue usando autorización explícita |
| INSERT/UPDATE de `file_objects` de otros módulos | Sin restricción nueva | Función devuelve `true` para etiquetas ajenas a Root2Cause | Continúan las políticas existentes de carga y actualización |
| INSERT/UPDATE de adjuntos Root2Cause | Sin restricción nueva | Administrador activo; si existe `resource_id`, debe pertenecer a su organización | Carga administrativa sin identificador vinculado posible; vinculación de un expediente ajeno denegada |
| Marcas de ejemplos en `workspace_data` | Administrador, ámbito e historial protegidos | Sin política nueva | Endpoint y trazabilidad de retiro preservados; el catálogo productivo sólo muestra expedientes reales del servidor |
| SELECT de Información General y Storage | Sin política nueva | Nueva función de alcance y políticas restrictivas para carpetas, metadatos y objetos originales/vistas previas | Clientes y proveedores no consultan directamente documentos internos; otros tipos de archivo conservan sus políticas |
| SELECT de catálogo de clientes y reclamaciones | Añade `owning_organization_id` y `quality_cases.organization_id` anulables | API con credenciales privilegiadas filtra ambos IDs; RLS restrictiva deniega a internos los registros sin titularidad comprobada o de otra organización | No se infiere ni cambia la titularidad histórica; clientes conocidos sin vínculo explícito quedan bloqueados |

## Separación de portales — comprobación estática

| Perfil / acción | Interfaz | API | RLS versionada | Resultado esperado |
|---|---|---|---|---|
| Administrador / gestionar análisis | Root2Cause completo y botón explícito de publicación o retiro | POST/PATCH verifican perfil activo y organización persistidos | Escritura restrictiva para administrador de la organización tras aplicar PR #20 | Gestiona sin publicar por seleccionar cliente |
| Interno con `view` / consultar | Dashboard Root2Cause, sin escritura | Ruta interna comprueba tipo, permiso, organización y proceso; POST/PATCH/DELETE denegados | SELECT vigente; INSERT/UPDATE/DELETE restrictivos tras aplicar PR #20 | Consulta de su alcance |
| Cliente A / consultar análisis de A | Portal de Clientes | GET exige sesión cliente, compañía A, `source=customer`, `portal_visible=true`, sin retiro lógico; respuesta de campos compartidos | `has_external_organization_scope('customer', A)` y `portal_clientes.acceder` | Sólo A publicado |
| Cliente B / intentar consultar A | Portal de Clientes de B | GET usa ID B de la sesión y filtra de nuevo la respuesta | La comparación de compañía y tipo deniega A | Denegado |
| Proveedor / intentar Portal de Clientes o Root2Cause | Portal de Proveedores | GET de publicaciones exige usuario `Cliente`; rutas internas y de escritura también lo deniegan | Alcance `customer` no coincide con perfil `supplier`; archivos Root2Cause denegados por propuesta restrictiva | Denegado; expedientes propios de proveedor intactos |

Un análisis externo requiere un UUID existente y activo del catálogo de clientes con `owning_organization_id` igual a la organización del administrador. Cuando se vincula una reclamación, el API exige además `quality_cases.organization_id` igual a esa organización y comprueba el ID del cliente. Si faltan las columnas o la titularidad, la operación queda bloqueada. `portal_visible` se guarda en `false` por defecto; únicamente la acción explícita de publicación del administrador lo activa. La retirada la ejecuta PATCH con autorización administrativa. Los análisis internos y del sistema de gestión no se publican en ninguno de los dos portales.

La ruta de Portal de Clientes usa el cliente Supabase autenticado. El endpoint interno usa credenciales privilegiadas, pero comprueba tipo de usuario, permiso, organización y proceso antes de consultar y responder. La RLS de `file_objects` anterior permitía SELECT genérico de archivos etiquetados Root2Cause según audiencia o cargador; la política restrictiva propuesta cierra ese acceso externo sin afectar archivos de proveedores. La navegación de cuentas externas se limita a su portal respectivo. Ninguna de estas comprobaciones está validada con cuentas reales hasta aplicar la migración en un entorno aislado.

## Información General — exposición heredada y cierre propuesto

`requireGeneralInformationActor` aceptaba cualquier perfil activo y, si no tenía organización, usaba el workspace fijo `TOWELL`; después las rutas de lista y archivo consultaban mediante `service_role`. La función RLS `can_access_general_information_workspace` permitía expresamente perfiles `customer` y `supplier` para ese workspace. Por tanto, ocultar el menú no cerraba consultas directas. El API ahora exige que sesión y perfil sean internos o administradores activos con organización asignada. La propuesta incremental `20261102200001_general_information_external_read_guard.sql` reemplaza sólo esa función de alcance y agrega políticas `AS RESTRICTIVE` de SELECT para `document_folders`, `file_objects` de Información General y los objetos correspondientes en Storage, incluidas las vistas previas. El helper de Storage usa `SECURITY DEFINER` para localizar metadatos aunque RLS los oculte, devuelve sólo booleano, comprueba usuario activo, fija `search_path` y limita EXECUTE a `authenticated`. No modifica archivos ni políticas de otros módulos.

**Aceptación pendiente:** estas políticas no se han aplicado. La API bloquea solicitudes externas con el código propuesto, pero PostgREST y Storage directos conservan el acceso heredado hasta que se valide y aplique la migración autorizadamente.

**Conflicto resuelto en la rama del PR #20:** la rama se rebasó sobre PR #19, sin merge a `main`. En `integraq-workspace.tsx` se conservó la carga paginada de expedientes reales y el error con Reintentar; los ejemplos locales quedan únicamente en DEMO. Permanecen el endpoint y la trazabilidad administrativa de retiros preparados por PR #19, y el borrado lógico de expedientes reales con motivo. El retiro de ejemplos no vuelve a presentar muestras como si fueran registros productivos.

**Riesgos y pruebas pendientes:**

1. Probar en entorno aislado las cuatro migraciones en ese orden. Confirmar que los helpers de PR #20 consultan el expediente padre bajo RLS y que las políticas permisivas `ALL` no reabren escritura ni lectura externa.
2. Ejecutar PostgREST directo como administrador de la organización, administrador ajeno, interno con y sin `view`, cliente y proveedor: SELECT, INSERT, UPDATE, DELETE, publicación y adjuntos. Comprobar que el borrado lógico administrativo conserva A3, planes, evidencias y auditoría.
3. Probar `file_objects` y Storage con originales y vistas previas de Información General como Cliente A, Cliente B, Proveedor, interno y administrador; repetir carga, reemplazo, lectura y descarga de Información Documentada, Indicadores, Revisión por la Dirección y Proveedores. El DELETE físico de `file_objects` quedará denegado por PR #19 a usuarios autenticados; revisar cualquier limpieza heredada que no use `service_role`.
4. Comprobar con sesión real el dashboard y sus cuatro listas para administrador e interno con permiso; recargar y volver a iniciar sesión. Validar portal de Cliente A frente a Cliente B y proveedor sin acceso.
5. Las columnas `organizations.owning_organization_id` y `quality_cases.organization_id` aún no existen en el esquema productivo consultado de sólo lectura. Tras aplicar PR #19 en un entorno autorizado, los valores históricos seguirán nulos. Verificar titularidad con fuente aprobada antes de asignarlos individualmente; mientras tanto, el catálogo interno no muestra esos clientes y Root2Cause bloquea su vinculación. No ejecutar un relleno automático.
6. Probar SELECT directo sobre expediente, A3, planes, participantes, revisiones, metadatos y Storage como administrador de otra organización. La propuesta lo deniega, pero no hay prueba con RLS ejecutada. Revisar también rutas privilegiadas y operaciones del maestro externo fuera de Root2Cause antes de declarar aislamiento general de la plataforma.

La revisión usó Git y archivos versionados; **no ejecutó SQL productivo ni aplicó migraciones**.
