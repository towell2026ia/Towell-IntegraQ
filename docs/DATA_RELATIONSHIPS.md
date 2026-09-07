# Integridad y relaciones de datos

## Regla central

Los nombres describen; los IDs relacionan. Los textos como área, responsable o proceso se conservan únicamente como presentación, dato importado o snapshot histórico.

```text
Organization
   ├── Area
   │    └── Process
   │         ├── Document ── document_processes
   │         ├── Indicator
   │         ├── Risk ────── risk_item_processes
   │         ├── Audit ───── audit_processes
   │         │    └── Finding ── Corrective Action
   │         │                       └── corrective_action_a3
   │         ├── Equipment ── Measurement Events
   │         └── Improvement ── improvement_source_links
   ├── Customer  (organizations.kind = customer)
   └── Supplier  (organizations.kind = supplier)
```

## Fuentes maestras reutilizadas

- `organizations` continúa siendo el catálogo único de organización interna, clientes y proveedores mediante `kind`. No se duplicaron tablas `customers` o `suppliers`.
- `areas` es el nuevo catálogo maestro por organización.
- `processes` conserva sus IDs legibles actuales (`P-17`, por ejemplo) porque ya son claves foráneas estables. `code` mantiene el identificador visible y permite una futura migración del PK a UUID sin romper referencias.
- `positions` y `profiles` siguen siendo las fuentes maestras de puestos y usuarios.
- Los usuarios externos continúan vinculados por `profiles.external_party_id → organizations.id`; el correo y el nombre no determinan el alcance.

## Relaciones principales

| Entidad | Relación oficial | Histórico conservado |
|---|---|---|
| Documento | `process_id`, `document_processes`, `owner_id` | `owner_name_snapshot` |
| Indicador | `process_id`, `leader_id` | `owner_name_snapshot` |
| Riesgo | `organization_id`, `area_id`, `process_id`, `risk_item_processes` | `owner_name_snapshot` |
| Auditoría | `audit_processes` | `scope_description` |
| Hallazgo | `audit_id`, `process_id`, `corrective_action_id` | `requirement`, `description` |
| Acción correctiva | `process_id` y FK específica del origen | `source_record_id`, `owner_name` |
| Root2Cause | `corrective_action_a3.corrective_action_id` (1:1) | contexto y borrador A3 existentes |
| Equipo | `process_id`, `area_id`, `owner_id` | código, ubicación y resolución en cada evento |
| Mejora | `process_id`, `improvement_source_links` | `source_code_snapshot` |
| Revisión por la Dirección | `management_review_source_links` | `source_snapshot` |

`corrective_action_a3` ya representaba el análisis principal de causa raíz; se reforzó en vez de crear una entidad duplicada. Se agregaron organización, proceso, creador, estado y fecha de creación.

## Cardinalidades controladas

- Un documento puede pertenecer o aplicar a varios procesos. `document_processes.relationship_type` acepta `owner`, `applicable`, `related`, `reference` y `support`.
- Una auditoría puede cubrir varios procesos. `audit_processes.scope_type` acepta `primary`, `audited` y `support`.
- Un riesgo puede relacionarse con varios procesos mediante la tabla existente `risk_item_processes`. `risk_scope` distingue `corporate`, `area` y `process`.
- Una mejora puede tener varias fuentes, pero cada fila usa una FK real tipada; no existe una tabla genérica universal.

## Consulta estándar

`getProcessRelations(processId)` en `src/lib/relations/process-relations.ts` devuelve siempre los grupos:

```text
documents
indicators
risks
audits
findings
correctiveActions
equipment
improvements
```

La implementación Supabase consulta exclusivamente `process_id` y tablas puente. `GET /api/processes/{processId}/relations` valida sesión y acceso al proceso antes de devolver la información.

## Migración y conflictos

La migración `202609070003_data_integrity_relationships.sql` es aditiva y sigue estas fases:

1. crea catálogos, columnas y tablas puente;
2. asigna organización usando relaciones existentes y sólo usa fallback cuando existe una única organización interna;
3. crea áreas normalizando exclusivamente para detectar coincidencias;
4. asigna áreas y responsables sólo con una coincidencia inequívoca;
5. copia relaciones directas actuales a tablas puente;
6. conserva snapshots históricos;
7. registra faltantes, ambigüedades y posibles duplicados;
8. genera `migration_report`;
9. activa índices, FKs, checks y RLS.

No se eliminan registros ni columnas. La normalización (`trim`, minúsculas, espacios y acentos) sólo se usa para detectar candidatos; la ortografía oficial permanece intacta. Los conflictos quedan en `migration_conflicts` para resolución manual.

## Política de borrado

Las entidades maestras y registros de calidad usan `ON DELETE RESTRICT` o estados inactivos. `ON DELETE CASCADE` se limita a filas dependientes, como tablas puente y detalles cuyo ciclo de vida pertenece completamente al registro padre.

## Validación técnica final

Sí: una vez aplicada la migración, IntegraQ puede reconstruir toda la información relacionada con un proceso utilizando solamente IDs, claves foráneas y tablas puente. No necesita comparar nombres manualmente. Los casos que no pudieron migrarse de forma inequívoca quedan señalados y no se asocian por suposición.

