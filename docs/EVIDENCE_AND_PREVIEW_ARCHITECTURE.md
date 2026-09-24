# Evidencias y previews documentales

## Decisión sobre el sistema vivo

La plataforma ya utilizaba `public.file_objects` como registro transversal de
metadatos y `integraq-private` como bucket privado. Por esa razón no se creó una
tabla `attachments`: la migración `202609240002` extiende `file_objects` con:

- `resource_key` para entidades cuyo identificador no es UUID;
- versión, vigente y referencia al archivo reemplazado;
- estado y ruta del PDF de preview;
- soft delete con usuario y fecha;
- índices de cola, recurso y versión vigente.

Los binarios originales no se sobrescriben. Un reemplazo retira la versión
anterior de la vista operativa, pero conserva el registro y el objeto privado.

## Flujo de preview

1. La aplicación carga el original al bucket privado.
2. `file_objects.preview_status` queda en `pending` para Office y en
   `not_required` para PDF o imágenes.
3. `pnpm previews:worker -- --limit=10` reclama registros pendientes.
4. LibreOffice en modo headless genera un PDF respetando configuración de página,
   orientación, saltos, áreas de impresión y diapositivas.
5. El worker guarda `preview.pdf` en el mismo ámbito privado y marca `ready`.
6. El visor usa el PDF normalizado; Descargar siempre firma el original.

El host del worker debe tener LibreOffice instalado o definir `LIBREOFFICE_BIN`.
Un error deja `preview_status = error`, conserva `preview_error` y nunca retira
el original.

## Seguridad

- El bucket permanece privado.
- Los visores solicitan URLs firmadas con vigencia de 60–120 segundos.
- RLS de `file_objects` valida módulo, proceso, empresa externa o propietario.
- La política de Storage sólo permite el original o el preview de un
  `file_objects` visible por RLS.
- Clientes y proveedores requieren menú, ruta de workspace, permiso de módulo,
  permiso específico y RLS.

## Permisos

Se reutilizan `permissions`, `role_permissions` y `user_roles`. Como el sistema
no tenía excepciones por usuario sobre el catálogo central, se agregó
`user_permission_overrides`, con `allowed` explícito y auditoría automática en
`audit_log`. Las tablas legacy de permisos de módulo continúan activas para
compatibilidad y alcance por proceso.
