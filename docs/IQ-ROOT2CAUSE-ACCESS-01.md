# IQ-ROOT2CAUSE-ACCESS-01 — Consulta interna y seguridad

## Hallazgo comprobado

- La función productiva `can_access_corrective_action` limitaba la lectura interna al responsable, creador o participante. Itzel tiene permiso de consulta de Root2Cause y procesos asignados, pero no cumple esas tres condiciones para el expediente existente.
- El cliente cargaba `corrective_actions` bajo esa RLS y después marcaba falsamente al usuario actual como participante al transformar cada fila. El filtro de interfaz también exigía participación o titularidad.
- Diecisiete usuarios internos activos conservan permisos antiguos de alta o edición. Las políticas permisivas actuales permiten solicitudes directas a `corrective_actions` y sus tablas hijas aunque la interfaz y el API de aplicación las bloqueen.

## Matriz esperada tras publicar código y aplicar la propuesta RLS por separado

| Perfil | Consulta | Escritura por API | Escritura directa por Supabase |
|---|---|---|---|
| Administrador activo | Expedientes de su organización | Permitida dentro de su organización | Permitida dentro de su organización |
| Interno con `corrective-actions:view` | Expedientes de su organización, limitados a procesos asignados; los sin proceso son de alcance organizacional | Denegada | Denegada tras aplicar RLS |
| Interno sin consulta | Denegada | Denegada | Denegada |
| Cliente / proveedor | Sin acceso a la ruta interna; el portal de cliente conserva su publicación explícita | Denegada | Denegada para expedientes internos |

El cliente consulta mediante `/api/root2cause/internal-actions`, que comprueba la sesión vigente, organización y procesos antes de enviar datos. La producción deja de combinar expedientes reales con localStorage o ejemplos. El dashboard conserva cuatro listados, tarjetas, búsqueda y filtros.

## Propuesta SQL no aplicada

`20261102190001_root2cause_admin_writes.sql` agrega sólo políticas `AS RESTRICTIVE` para INSERT, UPDATE y DELETE sobre el expediente, sus tablas hijas y metadatos de archivos etiquetados para Root2Cause. Estas se combinan por AND con las políticas permisivas existentes, incluidas las de tipo `ALL`. No añade restricciones SELECT, no cambia asignaciones ni toca filas. Las funciones auxiliares son `SECURITY INVOKER`; sus comprobaciones exigen administrador activo y organización del expediente. Los archivos de otros módulos conservan sus políticas actuales.

**Bloqueo para aceptación:** la migración no se ejecutó. Las pruebas de solicitudes directas con cuentas reales y la aceptación visual permanecen pendientes de un entorno aislado y autorización de aplicación. Hasta entonces, los permisos antiguos de Supabase siguen vigentes. El build y los mocks no equivalen a una prueba RLS productiva.

## Compatibilidad con PR #19 — revisión estática

Orden previsto: `20261102170852_admin_delete_guard.sql` (PR #19) y después `20261102190001_root2cause_admin_writes.sql` (PR #20). Los nombres de políticas no colisionan. Ambas actúan sobre `corrective_actions`, A3, planes, participantes, revisiones de eficacia y `file_objects`.

| Operación | PR #19 | PR #20 | Resultado combinado esperado |
|---|---|---|---|
| SELECT de análisis y archivos | Sin política restrictiva nueva | Sin política restrictiva nueva | Lectura por la ruta interna filtrada por organización/proceso; portal de cliente conserva publicación y empresa |
| INSERT/UPDATE de expediente e hijos | Trigger exige administrador para cambiar metadatos de retiro | Políticas restrictivas exigen administrador activo de la organización | Administrador conserva gestión; internos no escriben directamente |
| DELETE físico de expediente, hijos y `file_objects` | `USING (false)` restrictivo | Exige administrador en su organización para Root2Cause | Denegado para todos los roles autenticados por el AND de PR #19; el borrado lógico por API sigue usando autorización explícita |
| INSERT/UPDATE de `file_objects` de otros módulos | Sin restricción nueva | Función devuelve `true` para etiquetas ajenas a Root2Cause | Continúan las políticas existentes de carga y actualización |
| INSERT/UPDATE de adjuntos Root2Cause | Sin restricción nueva | Administrador activo; si existe `resource_id`, debe pertenecer a su organización | Carga administrativa sin identificador vinculado posible; vinculación de un expediente ajeno denegada |
| Marcas de ejemplos en `workspace_data` | Administrador, ámbito e historial protegidos | Sin política nueva | Compatibles a nivel SQL; el tratamiento en la interfaz requiere conciliación |

**Conflicto de código pendiente:** ambas ramas modifican `integraq-workspace.tsx`. PR #19 muestra ejemplos hasta retirarlos mediante `workspace_data`; PR #20 utiliza únicamente expedientes persistidos en producción. El cálculo `git merge-tree` encontró un conflicto en ese archivo. Debe resolverse explícitamente antes de integrar; no se hizo merge.

**Riesgos y pruebas pendientes:**

1. Probar en entorno aislado ambas migraciones en ese orden. Confirmar que el helper `SECURITY INVOKER` puede consultar el expediente padre bajo RLS y que las políticas permisivas `ALL` no reabren escritura.
2. Ejecutar PostgREST directo como administrador de la organización, administrador ajeno, interno con y sin `view`, cliente y proveedor: SELECT, INSERT, UPDATE, DELETE, publicación y adjuntos. Comprobar que el borrado lógico administrativo conserva A3, planes, evidencias y auditoría.
3. Probar `file_objects` y Storage en carga, reemplazo, lectura y descarga de Información Documentada, Indicadores, Revisión por la Dirección y Proveedores. El DELETE físico de `file_objects` quedará denegado por PR #19 a usuarios autenticados; revisar cualquier limpieza heredada que no use `service_role`.
4. Comprobar con sesión real el dashboard y sus cuatro listas para administrador e interno con permiso; recargar y volver a iniciar sesión. Validar portal de Cliente A frente a Cliente B y proveedor sin acceso.
5. Revisar las rutas privilegiadas `internal-actions`, `published-actions` y `root2cause/customers` con perfiles activos y pertenencia organizacional. La lista de clientes usa el catálogo externo global; si se incorpora más de una organización interna, falta una relación de titular verificada antes de filtrar ese catálogo.

La revisión usó Git y archivos versionados; **no ejecutó SQL productivo ni aplicó migraciones**.
