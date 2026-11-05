# IQ-CLIENTES-01 — Aplicación controlada

Proyecto: `yptrqowmviixlkrxjrqr`.

- SQL histórico recuperado de `supabase_migrations.schema_migrations.statements`, versión `202610120001`, sin volver a ejecutarlo. Archivo original: 2936 bytes; MD5 `7e0577cf694d06eaec30769f3640fef4`. Cuerpo de función y cuatro políticas cotejados con producción.
- Sincronización automática detenida mediante `[db.migrations] enabled = false`. Commit de control `74aca7a`, checks GitHub Actions y Supabase PASS antes de publicar el archivo histórico.
- Única aplicación: contenido de `202611030001_av_pl_01_customer_catalog.sql`, mediante el servicio de migraciones Supabase. El servicio asignó la versión real `20261105180006`, nombre `av_pl_01_customer_catalog`; el archivo se renombró a esa versión sin cambiar el SQL. No se reparó ni insertó artificialmente historial.
- Historial posterior: sólo una entrada nueva. Las migraciones generales de borrado y las demás pendientes no se ejecutaron.
- Catálogo: 33 pares oficiales exactos, activos, UUID reales y titular TOWELL. Campos opcionales sin datos se conservan nulos. No se creó Clientes Varios.
- Proveedores: 61 antes y después. MD5 del contenido histórico (excluidas las nuevas columnas nulas): `01c1789e78223170e706d2ca3ff9b26f`, idéntico.
- Usuarios Auth: 45 antes y después; huella de IDs `b3e41867e47fff3ff14019700cf0c5aa`, idéntica. Perfiles: huella `2c52af5f85ed33654e5f3202a53e05a3`, idéntica. No se habilitaron accesos externos.
- Reclamaciones: la clave foránea real es `quality_cases.external_organization_id -> organizations.id`. El selector y la validación al guardar A3 usan esa relación después de verificar la titularidad del cliente; no consultan la columna inexistente `quality_cases.organization_id`.

Aceptación autenticada: el administrador confirmó el 2026-11-05, después del despliegue `5c41ccd`, que Gestión de Clientes muestra el catálogo sin error y que la búsqueda/selección de clientes reales en Nuevo análisis A3 funciona. Esta evidencia procede de su sesión real; las herramientas de navegador del agente no estuvieron disponibles. No se guardó un análisis de prueba.
