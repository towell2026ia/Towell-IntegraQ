# IQ-PRD-STABILITY-01 — FINAL GATE REPORT

Fecha: 2026-10-21 · Zona: America/Mexico_City
Repositorio: towell2026ia/Towell-IntegraQ

**Recomendación: DO NOT RELEASE**

El Gate 0 no está aprobado. Se detuvo el desarrollo funcional antes de modificar código de aplicación, migraciones o producción. FAIL significa requisito pendiente o sin evidencia suficiente; no implica que se haya ejecutado una prueba y fallado.

| Gate / control | Resultado |
|---|---|
| Baseline y backup | FAIL — exportación API + Storage verificada; falta dump completo PostgreSQL |
| STB-01 Fechas globales | FAIL — implementación y aceptación pendientes |
| STB-02 Eliminación/sustitución documental | FAIL — implementación y aceptación pendientes |
| STB-03 Administración integral | FAIL — implementación y aceptación pendientes |
| STB-04 Políticas/objetivos en Inicio | FAIL — implementación y aceptación pendientes |
| Indicadores BEFORE/AFTER | 52/52 |
| Resultados BEFORE/AFTER | 70/70 |
| Documentos activos BEFORE/AFTER | 529/529 — definición indicada abajo |
| Versiones preservadas | PASS — 531/531, contenido idéntico en segunda lectura |
| Evidencias y Storage | PASS para copia API de metadatos y descarga de 618 objetos; hashes locales verificados |
| Usuarios y permisos preservados | PASS para datos expuestos: perfiles, roles y permisos sin diferencias; dump interno Auth pendiente |
| RLS | FAIL — no validada con los cuatro actores; la clave administrativa omite RLS |
| Registros reales perdidos | 0 observados: 125 recursos expuestos idénticos; ninguna escritura productiva |
| Tests | 316 PASS / 0 FAIL en CI (65 archivos); pruebas nuevas de STB y aceptación con cuatro actores pendientes |
| Typecheck / lint / build | PASS en CI para el commit evaluado; no ejecutados localmente |
| CI | PASS — ejecución 39650134618, commit 151e2fd6e54f6f25ee28c8cd0df27e20cb3d682f; alcance: código existente y primer reporte |
| Supabase Preview | FAIL — sin ambiente aislado verificado |
| Netlify | FAIL — netlify/towell-integraq/deploy-preview reportó failure |
| Commit y SHA | Base inspeccionada: c9e271808000dbc59b643da442ec3f915dfcaf54; reporte en rama codex/iq-prd-stability-01 |
| Production modified | NO |

## Baseline actual

Inventario por HTTPS administrativo de solo lectura. Se exportaron 125 recursos expuestos por PostgREST, incluyendo vistas, con 9,398 entradas en total; este total no equivale a filas físicas únicas. Una segunda lectura completa comparó todos los campos de cada recurso mediante normalización y SHA-256: 125/125 idénticos. Ambas lecturas son secuenciales y no constituyen un snapshot transaccional PostgreSQL.

- Organizaciones: 62; perfiles: 44; usuarios Auth: 44.
- Indicadores: 52; periodos: 624; resultados: 70.
- Documentos controlados: 531; sin eliminación: 529; versiones: 531.
- Archivos registrados: 618; objetos Storage descargados: 618; bytes: 427677607.
- Documentos activos se contó como controlled_documents sin deleted_at ni document_lifecycle.is_deleted. Este conteo no certifica aprobación/vigencia de cada versión.
- Las tablas documentales reales son controlled_documents y controlled_document_versions, no documents/document_versions.
- Inicio tiene 3 elementos institucionales: todos active=false y document_id=null. No se reactivaron ni sustituyeron archivos.

Clasificación conservadora por workspace_mode explícito: 96 entradas production, 1 demo y 9,301 ambiguas/compartidas, incluyendo vistas. Estas etiquetas describen el workspace; no certifican que los registros sean reales o de prueba. Todos se preservaron. La clasificación semántica real/demo queda pendiente y ningún ambiguo se considera eliminable.

## Backup y verificación

Carpeta local ignorada por Git: outputs/backups/2026-10-21T17-35-37-385Z-stability-01/

- Formato: JSON completo por recurso expuesto, inventario Auth administrativo, esquema OpenAPI, metadata de buckets y binarios Storage.
- Bucket integraq-private: privado.
- Errores de exportación: 0.
- Archivos cotejados contra SHA-256 después de escribir: 747; discrepancias: 0.
- Manifiesto: sha256-manifest.json.
- SHA-256 del manifiesto: 52cf2d96ed7e32bf51d0ed0c0976f3ccda85d699ace84afa20bd19646509eaed.
- Evidencias detalladas locales: outputs/stability-01/backup-summary.json e inventory-report.json.

El paquete contiene información sensible y permanece fuera de Git. No se acredita cifrado ni una copia independiente fuera de esta estación. El export Auth no contiene un respaldo completo del esquema auth ni garantiza conservar hashes de contraseñas. La copia de API no incluye catálogos PostgreSQL, funciones, grants, restricciones ni políticas RLS completas. El esquema OpenAPI y las migraciones del repositorio no prueban el estado DDL real de producción.

## Hallazgos de esquema y operación

Las migraciones incluyen indicator_capture_settings, auditoría de ventanas, soft delete documental, motivos e índices documentales. Se identificaron los archivos relacionados, pero las restricciones y políticas realmente instaladas requieren inspección de catálogos PostgreSQL. No se ejecutó SQL productivo ni se invocaron RPC de escritura.

La estación no tiene pg_dump, psql ni Docker en PATH o las rutas habituales inspeccionadas. El antecedente RECOVERY_TEST.md también documenta una recuperación sin validar. La dependencia @supabase/supabase-js no resolvió en esta instalación local; se usó HTTPS nativo de Node para el inventario y respaldo, sin instalar dependencias ni alterar package.json.

Había cambios locales previos en main, incluidos archivos de administración y respaldo. Se conservaron; no se incorporan al commit documental de este reporte.

## Condiciones para reanudar

1. Habilitar herramientas PostgreSQL compatibles y obtener un dump consistente del esquema y datos requeridos, incluido Auth y la auditoría; verificar sus hashes, cifrado y conservación fuera del origen.
2. Consultar catálogos reales para inventariar tablas, claves, relaciones, índices, triggers, funciones, grants y RLS. Conciliar recursos no expuestos por la API.
3. Preparar Supabase Preview aislado, restaurar/verificar el respaldo y validar la clasificación sin eliminar datos ambiguos.
4. Completar STB-01 a STB-04 en la rama separada; ejecutar pruebas unitarias, integración, RLS, regresión, concurrencia y persistencia con los cuatro actores; typecheck, lint, build y CI.
5. Validar Netlify Preview. Obtener autorización específica del gate antes de merge a main o migraciones productivas.

**DO NOT RELEASE. STOP: no avanzar a otros módulos.**

Evidencia CI: https://github.com/towell2026ia/Towell-IntegraQ/actions/runs/39650134618. Los 316 tests existentes no acreditan los criterios nuevos de STB-01 a STB-04. Esta actualización sólo modifica el reporte; el SHA evaluado se indica explícitamente y no se atribuye un PASS a commits posteriores sin evidencia.

Evidencia Netlify: https://app.netlify.com/projects/towell-integraq/deploys/6ad8ffc9335f0bb18c5e08f6. PR borrador: https://github.com/towell2026ia/Towell-IntegraQ/pull/3. No hubo merge ni despliegue productivo solicitado.
