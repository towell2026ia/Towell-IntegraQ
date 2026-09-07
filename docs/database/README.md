# Base de datos de IntegraQ

## Migraciones

Ejecutar siempre en este orden:

1. `202608230001_identity_and_access.sql`
   - Organizaciones, procesos, organigrama, usuarios y permisos heredados.
2. `202608230002_platform_core.sql`
   - Permisos por acción, funciones RLS, archivos privados y Storage.
3. `202608230003_documents_forms_indicators_risks.sql`
   - Información documentada, formularios, dashboards, indicadores y riesgos.
4. `202608230004_quality_audits_and_portals.sql`
   - Auditorías, Root2Cause, clientes, proveedores, RNCP y portales.
5. `202608230005_metrology_improvement_management.sql`
   - Metrología, mejora continua, revisión por la dirección, IA y notificaciones.
6. `202608230006_granular_user_permissions.sql`
   - Visor/modificador por proceso, acciones por módulo y participación estricta en Root2Cause.
7. `202608240001_organization_source.sql` y migraciones funcionales de septiembre.
   - Fuente del organigrama, Recursos Humanos, SGC y estrategia/riesgos.
8. `202609070001_expand_organization_levels.sql`
   - Niveles operativos 5 en adelante.
9. `202609070002_ai_core_foundations.sql`
   - Trazabilidad común de capacidades inteligentes.
10. `202609070003_data_integrity_relationships.sql`
   - Áreas maestras, relaciones por ID, tablas puente, backfill y reporte de conflictos.
11. `202609070004_access_traceability_approvals.sql`
   - Roles, permisos, scopes, bitácora transversal, aprobaciones, eventos y soft delete.

## Reglas consolidadas

- El tipo `administrator` omite los filtros funcionales y consulta toda la organización.
- Los usuarios internos reciben módulos y procesos desde su puesto; los permisos directos se conservan.
- Los documentos se consultan por proceso y tipo documental, no mediante una pantalla maestra.
- El rol documental define `viewer`, `modifier` o `authorizer`.
- Las versiones `obsolete` sólo son visibles para el administrador.
- Los indicadores sólo se crean, modifican o eliminan por un administrador.
- La captura de resultados se valida contra `opens_at` y `closes_at` del trimestre.
- Un cliente únicamente consulta registros con su `external_organization_id`.
- Un proveedor únicamente consulta y atiende RNCP o auditorías con su `supplier_id`.
- Los reclamos y acciones del cliente tienen una sola fuente en Root2Cause.
- Los RNCP y acciones del proveedor tienen una sola fuente en Calidad Proveedores.
- Los archivos son privados; PostgreSQL conserva metadatos y Supabase Storage conserva el binario.
- Toda salida de IA se registra como borrador trazable en `ai_runs`.

## Tipos documentales iniciales

| ID | Tipo |
|---|---|
| `process` | Proceso |
| `manual` | Manual |
| `procedure` | Procedimiento |
| `instruction` | Instructivo |
| `format` | Formato |
| `form` | Formulario |
| `standard-operation-sheet` | Hoja de Operación Estándar |
| `visual-aid` | Ayuda visual |

`format` es una plantilla controlada. `form` es una captura digital con estructura,
historial y dashboard propios.

## Vistas para el frontend

- `controlled_document_register`: columnas de revisión dentro de cada proceso y tipo.
- `indicator_quarter_matrix`: sábana trimestral con estado calculado.
- `customer_quality_summary`: reclamos, hallazgos, acciones, auditorías y certificados.
- `supplier_quality_summary`: RNCP, efectividad, nivel de calidad y siguiente auditoría.

Todas las vistas usan `security_invoker = true`; heredan RLS de las tablas origen.

## Aplicación recomendada

Con Supabase CLI enlazado al proyecto:

```powershell
supabase link --project-ref <PROJECT_REF>
supabase db push --dry-run
supabase db push
```

`db push --dry-run` debe ejecutarse primero. No usar `db reset --linked` en el
proyecto productivo porque elimina los datos existentes.

## Verificación posterior

```sql
select count(*) as processes from public.processes;
select count(*) as document_types from public.document_types;
select user_type, count(*) from public.profiles group by user_type;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Resultados base esperados:

- `34` procesos y subprocesos.
- `8` tipos documentales.
- La cuenta `f.hernandez@towell.com.mx` queda como `administrator` al aplicar las migraciones.

## Datos que no se cargan como semilla

Las migraciones no insertan reclamos, RNCP, auditorías, indicadores, equipos,
formularios ni proyectos ficticios. Los datos de demostración del frontend se
migrarán por módulo después de validar los catálogos reales.
