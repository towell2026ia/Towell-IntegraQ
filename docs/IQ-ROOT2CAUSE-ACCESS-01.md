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
