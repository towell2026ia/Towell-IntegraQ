# IQ-CLIENTES-02 — Etapa 1: Reclamos

## Alcance

Alta y edición persistentes de reclamos, anulación con motivo, expediente por cliente, evidencia privada con versiones, métricas reales y relación bidireccional con A3. No se desarrollaron Auditorías ni Certificaciones.

## Base real y migración

Producción: `yptrqowmviixlkrxjrqr`. Se verificaron los enums reales: `quality_case_kind = claim | finding`; `quality_case_status = open | under_review | action_required | closed`.

Migraciones ejecutadas mediante el servicio de migraciones: `20261105185946_customer_claims_stage1.sql` y `20261105191408_customer_claim_link_guard.sql`. SQL registrado idéntico a los archivos. No se ejecutaron migraciones generales pendientes. `[db.migrations] enabled = false` permanece vigente.

- Tres campos de anulación en `quality_cases`, sin añadir `organization_id`.
- Se conserva `quality_cases.external_organization_id -> organizations.id`.
- Se conserva la FK `corrective_actions.quality_case_id -> quality_cases.id`; se retiró sólo `corrective_actions_quality_case_id_key` y se creó un índice no único. No había funciones, upserts ni otras FK dependientes de esa unicidad. Esto permite varios A3 por reclamo sin duplicarlo.
- Comando transaccional `iq_customer_claim_command`, SECURITY INVOKER, ejecutable sólo por `service_role`. La API valida sesión, perfil activo, organización y permisos efectivos; el comando vuelve a verificar actor, organización, cliente, concurrencia y vínculos.
- Políticas RESTRICTIVE específicas para reclamos, su categoría `customer_claim_evidence` y el prefijo privado `claim-evidence/`. Las políticas previas no se sustituyeron. Los archivos de otros módulos no usan ese prefijo ni categoría.
- Las solicitudes directas autenticadas no pueden escribir reclamos/evidencias ni reclasificar filas para eludir las protecciones. Ningún comando elimina físicamente filas o binarios.
- La segunda migración añade una guardia invocadora sobre las columnas del vínculo A3. También valida solicitudes directas: administrador activo para vínculos nuevos, misma organización y cliente, rechazo de reclamos anulados para nuevos enlaces, y conservación de enlaces existentes. El bloqueo de lectura del reclamo serializa el enlace con la anulación; un A3 ya vinculado puede continuar su seguimiento tras la anulación sin cambiar su FK.

## Evidencias

Bucket existente `integraq-private`, no público. Máximo 4 MB por archivo para el flujo de carga del despliegue actual. PDF, JPG/JPEG, PNG, WEBP, DOC/DOCX, XLSX, EML y MSG; comprobación de extensión y cabecera del contenido. No se ejecutan macros ni se interpreta correo. EML/MSG se descargan como originales y no tienen vista previa.

La URL de lectura se firma durante 60 segundos tras autorizar individualmente el reclamo y el archivo. Sustituir conserva el binario anterior y registra nueva versión. Si falla el registro de metadatos, no se altera la versión anterior ni se elimina el binario privado; el servidor registra una referencia para recuperación administrativa.

## Métricas

Fuente: `quality_cases`, exclusivamente `kind = claim`, clientes de la organización autenticada. Filtros de fecha basados en `received_at`, inclusivos, y cliente por UUID.

- Recibidos: IDs distintos no anulados dentro del rango.
- Abiertos: recibidos en `open`, `under_review` o `action_required`.
- Cerrados: recibidos en `closed`.
- Sin A3: recibidos sin vínculo válido con `corrective_actions.quality_case_id` del mismo cliente.
- Los hallazgos se cuentan por separado. Varios A3, ediciones y versiones de archivo no multiplican reclamos. Los cerrados permanecen en recibidos; las anulaciones conservan expediente y auditoría.

Estas métricas de Gestión de Clientes no escriben resultados históricos del módulo Indicadores.

## Archivos de implementación

- `src/lib/customer-claims.ts`, `customer-claims-server.ts`, `customer-claim-files.ts` y pruebas.
- `src/app/api/customers/claims/route.ts`, `[claimId]/evidence/route.ts`, `[claimId]/evidence/[fileId]/route.ts` y pruebas de API.
- `src/components/modules/customer-claims-panel.tsx`, `customers-module.tsx`.
- `src/components/modules/a3-analysis-workbench.tsx`, `corrective-actions-module.tsx`, `src/components/integraq-workspace.tsx` (únicamente navegación y precarga).
- Rutas y pruebas `src/app/api/root2cause/customers` y `published-actions` (exclusión de anulados y conservación de vínculos históricos).
- Las dos migraciones específicas indicadas arriba.

## Preservación verificada tras aplicar SQL

No se crearon reclamos ni archivos de prueba en producción. Reclamos: 0 antes y después. Usuarios: 45 antes y después; huella de IDs `b3e41867e47fff3ff14019700cf0c5aa` idéntica. Perfiles `2c52af5f85ed33654e5f3202a53e05a3`, proveedores `4194772eed25f245b26e146a79067ca9`, archivos `341ccde293a1a0b74423d68d7d31ba38` y A3 `538658ee8fb8bf01eb0dec30eeb96d85`: huellas idénticas. Sólo dos nuevas entradas en el historial de migraciones, ambas de esta etapa.

Pruebas automatizadas cubren conteo único, filtros, anulaciones, Walmart/Liverpool, vínculos de otro cliente, permisos revocados, clientes/proveedores externos, paginación, contenido de archivos, descarga privada y alcance SQL. Las pruebas de API usan datos aislados simulados; no se presentan como aceptación productiva de escritura.

## Aceptación pendiente

No se dispone de navegador automatizable ni sesión aislada autorizada para pruebas RLS con JWT reales. Queda pendiente registrar un reclamo auténtico autorizado, adjuntar/descargar su evidencia y verificar ambos flujos A3 en sesión administrativa real. No deben generarse reclamos ficticios ni manipular KPI productivos para esa comprobación.
