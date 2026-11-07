# Reparación de carga documental y RLS

## Estado y alcance

Trabajo conservado y completado sobre `main`, sin ramas ni PR. La única migración propuesta es `20261107021617_controlled_document_upload_registration.sql`. **NO aplicada en producción. Despliegue documental detenido. Aceptación funcional en IntegraQ: PENDING.**

Se conserva íntegra la migración aplicada `20261106020459_controlled_document_replacement.sql`. No se ejecuta `20261102170852_admin_delete_guard.sql` ni ninguna otra migración pendiente. Los commits de preparación incluyen `[skip netlify]`.

## Causa raíz comprobada

La carga publicada sube el binario y ejecuta `INSERT file_objects RETURNING id` mediante `.insert(...).select("id").single()`, antes de registrar la versión. La política restrictiva `iq_document_replacement_file_read` invoca el helper STABLE `iq_can_read_document_file(uuid)`. Su consulta no encuentra esa nueva fila todavía no registrada durante el mismo INSERT, por lo que la comprobación de lectura del RETURNING falla incluso para el administrador.

La prueba inicial reproduce exactamente `new row violates row-level security policy "iq_document_replacement_file_read" for table "file_objects"` antes de aplicar la propuesta en PostgreSQL efímero. Las pruebas antiguas precargaban los archivos como propietario del fixture y no ejercitaban ese INSERT autenticado. No se atribuye el incidente a Netlify ni a una pérdida de archivos.

También se corrigieron el registro restringido indebidamente sólo a administradores, la lectura legacy sin comprobación organizacional previa y la diferencia entre permiso de lectura del archivo histórico y SELECT de su versión para el autorizador.

## Corrección puntual

1. Reservar una referencia privada antes del binario: actor, proceso, organización, metadatos, SHA-256 e intención de carga, reutilizando campos existentes de `file_objects`.
2. Cargar una ruta nueva con `upsert: false`. Un reintento comprueba los bytes ya presentes, sin sobrescribir ni borrar.
3. Registrar expediente, versión pendiente, relaciones y auditoría en una transacción. El recibo permite repetir una petición cuya respuesta se perdió sin duplicar registros.
4. Comprobar identidad, organización activa, proceso, permisos y estado en cada operación. La reserva no es un token de autorización.
5. Mantener la versión vigente hasta la aprobación. Retirar o solicitar recuperación no publica archivos antiguos. Una propuesta anterior al retiro no puede reactivar silenciosamente el documento.

El código y el nombre oficial se capturan por separado. No se extraen del nombre del archivo ni se corrigen códigos históricos automáticamente. La versión explícita y la secuencia de revisión conservan el modelo ya aplicado; no se reinterpretan ni renumeran las revisiones históricas.

## Diez archivos revisados

| Archivo | Cambio |
|---|---|
| `src/lib/document-storage.ts` | Reserva, carga privada, reintento verificable, registro idempotente y UUID del usuario que cargó la versión. |
| `src/lib/document-control-data.ts` | Carga interna expresamente autorizada y vista previa de pendientes propios por UUID. |
| `src/components/modules/document-type-workspace.tsx` | Vista previa autorizada; campos Código y Nombre oficial separados. |
| `src/lib/document-storage-replacement.test.ts` | Carga, estados de reserva, errores, reintentos, huellas y URLs temporales. |
| `src/lib/document-control-data.test.ts` | Permisos de carga y vista previa del usuario autorizado. |
| `scripts/test-document-replacement-db.mjs` | Reproducción previa y ejecución SQL exclusivamente en CI efímero; concurrencia. |
| `supabase/tests/document-replacement-fixture.sql` | Identidades, permisos y políticas sintéticas para ejercer RLS con rol authenticated. |
| `supabase/tests/document-upload-registration-test.sql` | Operaciones, aislamiento, historial, fallos intermedios e integridad. |
| `supabase/migrations/20261107021617_controlled_document_upload_registration.sql` | Reparación específica descrita abajo, no aplicada. |
| `docs/IQ-DOCUMENT-UPLOAD-REPAIR.md` | Evidencia, límites y procedimiento de aceptación. |

## Contenido exacto de la propuesta SQL

- Una transacción; sin tablas ni columnas nuevas, sin backfill ni reescritura de datos históricos.
- Un índice parcial único `file_objects_controlled_upload_intent` sobre `(uploaded_by, resource_key)`, limitado a `reference_type = 'controlled_document_upload'`. No existen referencias productivas de ese tipo en la comprobación previa.
- Siete funciones nuevas: `iq_document_upload_scope`, `iq_document_upload_key`, `reserve_controlled_document_upload`, `iq_document_scope_values`, `iq_document_record_scope`, `iq_document_original_object` e `iq_document_reserved_object`.
- Siete funciones sustituidas, conservando sus firmas: `iq_document_admin_scope`, `inspect_controlled_document_code`, `register_controlled_document_upload`, `review_document_version`, `submit_document_version`, `iq_can_read_document_file` y `soft_delete_document`.
- Trece políticas RESTRICTIVE adicionales: alcance organizacional de documentos/versiones/eventos/historial; prohibición de DELETE físico documental; bloqueo de escrituras directas de metadatos controlados; reserva obligatoria y prohibición de sobrescritura o borrado de originales y vistas previas en Storage.
- Dos políticas permisivas acotadas: `iq_document_version_authorized_history` y `iq_document_storage_upload`. Ambas requieren los controles restrictivos; no conceden acceso global.
- Las políticas existentes `iq_document_replacement_file_read` y `iq_document_replacement_storage_read` permanecen instaladas. El helper de lectura valida también documentos legacy.
- Funciones con `search_path` vacío y revocación anónima. Los helpers privados de reserva no se conceden a authenticated. No se alteran asignaciones de usuarios ni permisos de módulos.
- Recarga de la caché de esquema PostgREST después del cambio. No se alteran buckets ni archivos físicos.

Las escrituras dentro de las funciones sólo ocurrirán cuando posteriormente una persona autorizada ejecute una operación documental; aplicar el DDL no invoca esas funciones ni modifica documentos existentes.

## Matriz de permisos

| Perfil y alcance | Consulta | Carga / reemplazo | Autorizar / rechazar | Retirar / recuperar |
|---|---|---|---|---|
| Administrador activo, organización interna propia | Vigente, pendientes e historial propios | Sí | Sí, con su propia identidad | Sí, motivo obligatorio para retiro |
| Interno con Documentos → Ver/Modificar y rol modificador en el proceso | Vigente y pendientes propios | Sí, documentos no retirados | No sin rol autorizador | No |
| Autorizador del proceso con permiso de consulta | Vigente, pendientes e historial autorizado | Sólo con permiso de modificación | Sí | No |
| Usuario de consulta | Vigente autorizado | No | No | No |
| Sin permiso, proceso ajeno, organización ajena, perfil inactivo o DEMO | No accede al expediente fuera de alcance | No | No | No |
| Cliente, proveedor o anónimo | Sin acceso documental interno por esta reparación | No | No | No |

El último ajuste del autorizador añade SELECT del historial de versiones únicamente con `iq_document_record_scope(document_id)` y rol autorizador del mismo proceso o permiso explícito de historial. La comprobación restrictiva de organización sigue aplicando aunque otras políticas permisivas se combinen mediante OR.

## Pruebas aisladas

Ejecutadas en GitHub Actions con PostgreSQL 17 efímero, identidades sintéticas, rol `authenticated` y `auth.uid()` por petición. El runner rechaza bases remotas, otro nombre de base y ejecución fuera de CI. No usa producción, service_role ni una cuenta real como sustituto.

| Operación | Resultado SQL aislado |
|---|---|
| Reproducir el error original INSERT RETURNING | PASS, nombre exacto de política |
| Crear documento nuevo en P-35 | PASS, expediente y versión 0 pendiente |
| Código nuevo duplicado sin reemplazo | PASS, rechazado |
| Nueva versión | PASS, numeración automática y vigente conservada hasta aprobar |
| Nueva revisión | PASS, misma versión y archivo previo histórico |
| Autorizar | PASS, una sola versión vigente |
| Rechazar con motivo | PASS, no altera el archivo vigente |
| Historial del autorizador | PASS, sólo dentro de su alcance |
| Retiro lógico con motivo | PASS, archivos y auditoría conservados |
| Recuperación | PASS, requiere autorización; no expone el original prematuramente |
| Reemplazar identidad retirada | PASS, mismo código y expediente, sin duplicados |
| Sin permiso / proceso ajeno / organización ajena | PASS, acceso directo denegado |
| Cliente / proveedor / DEMO / perfil u organización inactivos | PASS, acceso denegado |
| Fallo intermedio y reintento | PASS, rollback del expediente/versión; referencia pendiente identificada |
| Concurrencia de reemplazos | PASS, una propuesta pendiente y una vigente |
| Concurrencia de reserva y recibo idempotente | PASS, misma reserva y recibo sin duplicar expediente, versión ni auditoría |
| DELETE físico y sobrescritura documental directa | PASS, bloqueados incluso al administrador |
| Archivos ajenos al módulo documental | PASS, mantienen sus permisos existentes |

CI completo comprobado: [42334642372](https://github.com/towell2026ia/Towell-IntegraQ/actions/runs/42334642372), commit `f647bad`: typecheck PASS, lint PASS, build PASS, 718 pruebas PASS y 1 omitida; 107 comprobaciones SQL/concurrencia documentales PASS. Las tres pruebas concurrentes verifican reemplazos distintos, reserva idéntica y reintento de recibo final. También pasaron los trabajos SQL aislados de regresión de RNCP y auditorías de proveedores. La prueba omitida requiere un archivo privado de referencia de otro módulo y no sustituye ninguna comprobación documental.

SQL revisado: commit `f647badfd606bc99922e673132c55d64cef791b4`, blob Git `c1d1064bd1284eff49629190a3f79aac7fd400c6`. El informe final no modifica ese contenido SQL.

## Producción: verificación exclusivamente de lectura

Proyecto verificado: `yptrqowmviixlkrxjrqr`. Corte UTC: 2026-11-07, jornada local 2026-11-06.

| Comprobación | Resultado |
|---|---:|
| Referencias de archivos controlled_document | 544 |
| Versiones vinculadas / archivos distintos vinculados | 544 / 544 |
| Objetos ausentes en Storage | 0 |
| Referencias sin versión | 0 |
| SHA-256 registrado con formato válido | 544 |
| Discrepancias documento–proceso–organización | 0 |
| Discrepancias de proceso o identidad entre archivo y versión | 0 |
| Migración 20261107021617 aplicada | 0 |
| Entradas del historial de migraciones | 49 |

Los 544 archivos históricos tienen `workspace_id` NULL: su organización se comprueba mediante el expediente y su proceso existente. De los documentos vinculados, 530 indican TOWELL expresamente y 14 tienen `organization_id` NULL, con proceso TOWELL verificado. La propuesta conserva esos valores; no realiza reasignaciones ni rellenos.

La consulta comprueba referencias, relaciones, presencia de objetos y huellas registradas. **No descarga ni recalcula la huella de los 544 binarios.** No se afirma una inspección byte a byte de todos los archivos.

Instantáneas de metadatos de sólo lectura, MD5 de la concatenación ordenada por ID de cada fila JSONB, separada por `|`: archivos documentales `4a73edc8f9e26ec23906fa8d28fb44c4`; documentos `d54bc1dcb06437594c2a2d298846c9f2`; versiones `3d3e86e4857991ddfc197ef6d828e981`. Sirven para comparar las mismas consultas antes/después de una aplicación autorizada, sin modificar registros.

## Riesgos residuales y aceptación pendiente

- Una captura interrumpida o abandonada puede conservar una reserva privada `upload_pending`, incluso con su binario ya cargado. Está identificada y admite reintento; no es un objeto sin referencia. No se incorpora una limpieza física automática.
- El límite de archivo es 50 MiB, compatible con el bucket existente. Se validan extensión, MIME admitido, tamaño, propietario y ruta; no se añade análisis antivirus ni inspección semántica del contenido.
- Las pruebas ejercen RLS y transacciones reales, pero no equivalen a sesiones Supabase Auth y llamadas HTTP a Storage en una plataforma aislada. No existe una sesión de prueba aislada confirmada para completar ese recorrido visual.
- Antes de declarar resuelto: aplicar sólo la propuesta tras autorización, verificar esquema e integridad, publicar el código preparado y realizar una carga documental real autorizada en IntegraQ, comprobando apertura, descarga, autorización y el flujo documental sin crear datos ficticios productivos.
- El bloqueo de escrituras directas es intencional: la aplicación actual debe actualizarse al flujo de reserva después de la activación. Las pestañas antiguas deben recargarse. No se publicará el código dependiente de la migración antes de autorizarla y verificarla.

## Secuencia controlada propuesta, todavía no ejecutada

1. Autorizar exclusivamente `20261107021617_controlled_document_upload_registration.sql` del commit exacto revisado.
2. Repetir comprobaciones previas de destino, historial, dependencias y ausencia de conflictos. Detenerse ante diferencias no explicadas.
3. Aplicar sólo esa migración con registro de su ejecución en el historial. No usar `db push` ni aplicar otras pendientes.
4. Verificar una sola entrada del historial, funciones/políticas previstas y preservación de los 544 vínculos y objetos mediante las mismas consultas de lectura.
5. Publicar únicamente el código documental preparado y comprobar CI/Netlify.
6. Completar la aceptación funcional con un documento real y permiso autorizado. Hasta entonces, incidencia PENDING; producción documental sin cambios por esta preparación.
