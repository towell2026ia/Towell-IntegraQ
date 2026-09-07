# Control de acceso

## Política central

IntegraQ aplica denegación por defecto. Los nombres de rol no autorizan operaciones por sí solos: `authorize()` evalúa permiso, vigencia y alcance. El frontend puede usar `can()` o los adaptadores existentes para reflejar la política, pero la API y RLS vuelven a comprobarla.

```text
USER → ROLE → PERMISSION → SCOPE → AUTHORIZE
                                      ├── DENIED
                                      └── ALLOWED → ACTION
```

Los permisos usan `module.resource.action` cuando existe un recurso y `module.action` en módulos simples. El catálogo oficial está en `permissions`; `role_permissions` agrupa capacidades reutilizables y `user_roles` agrega alcance y vigencia.

## Alcances

Se soportan `global`, `organization`, `area`, `process`, `own_records`, `assigned_records` y `company`. Una asignación vencida deja de aplicar sin eliminar su historial. `delegations` prepara sustituciones temporales autorizadas.

Los clientes y proveedores se validan contra `profiles.external_party_id`; nunca por nombre. Su rol usa scope `company` y RLS conserva la segunda barrera. Un agente futuro deberá presentar la identidad del usuario iniciador y nunca podrá superar sus permisos.

## Compatibilidad

Los permisos actuales de módulo, acción y proceso continúan operando. La migración asigna roles iniciales desde `profiles` y `position_process_permissions`; no elimina tablas previas. El bypass `system.admin` produce origen `admin_override` en operaciones gobernadas.

## Contrato

```ts
authorize({ user, permission, record, grants })
// { allowed, scope, reason, origin, permission }
```

Errores normalizados: `UNAUTHORIZED`, `FORBIDDEN`, `OUTSIDE_SCOPE`, `CONFLICT_OF_INTEREST`, `APPROVAL_REQUIRED`, `INVALID_STATE_TRANSITION`, `REASON_REQUIRED` y `NOT_FOUND`.
