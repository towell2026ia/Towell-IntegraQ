# Runbook de Recovery local de IntegraQ

Código: `IQ-PRD-REC-01B`
Destino exclusivo: Supabase CLI + Docker en loopback
Estrategia: migraciones versionadas, identidades Auth reconstruidas y datos/Storage del paquete lógico

## Regla de seguridad no negociable

El recovery sólo puede ejecutarse con:

```text
APP_ENV=recovery-local
NEXT_PUBLIC_APP_ENV=recovery-local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
```

Los scripts abortan si `APP_ENV` no es `recovery-local` o si el host Supabase no es `127.0.0.1`, `localhost` o `::1`. La misma protección está aplicada a los clientes browser, server, admin y proxy de IntegraQ. No copiar `.env.local` de Producción ni una clave productiva a `.env.recovery.local`.

## 1. Requisitos

- Windows, macOS o Linux con Docker operativo.
- Node.js 24 o una versión compatible con el proyecto.
- pnpm 11.
- Git.
- 3 GB libres como mínimo para imágenes, base local, backup y temporales.
- El paquete de backup fuera de Git.

Instalar dependencias del proyecto:

```powershell
pnpm install
pnpm exec supabase --version
docker --version
docker info
node --version
pnpm --version
git --version
```

El repositorio fija Supabase CLI `2.117.0` como dependencia de desarrollo. En Windows, Docker Desktop debe estar iniciado antes de continuar. No ejecutar el restore si `docker info` falla.

## 2. Backup de referencia

Ubicación local predeterminada:

```text
outputs/backups/2026-09-25-pre-hardening-api/
```

El directorio `outputs/` está ignorado por Git. Para elegir otro paquete:

```powershell
$env:RECOVERY_BACKUP_DIR = "D:\backups\integraq\snapshot-id"
```

Inspeccionar antes de restaurar:

```powershell
pnpm recovery:inspect
```

El comando verifica manifiesto, 111 JSON de tablas, 542 binarios, bytes totales y advertencias. El snapshot actual usa:

| Componente | Contenido |
|---|---|
| Database | Datos JSON de 111 tablas públicas y 5,173 filas |
| Schema | No hay dump utilizable; se reconstruye con `supabase/migrations/` |
| Auth | 42 UUID, emails y metadata; no contiene contraseñas productivas |
| Storage | 542 binarios, rutas, tamaños y SHA-256 |
| Configuración | No incluida |

## 3. Iniciar Supabase local

En PowerShell:

```powershell
$env:APP_ENV = "recovery-local"
pnpm recovery:start
```

El script ejecuta `supabase start`, confirma que la API reportada sea loopback y crea `.env.recovery.local` con las claves locales. El archivo está ignorado por Git. Editarlo y asignar una contraseña temporal exclusiva:

```text
RECOVERY_DEFAULT_PASSWORD=<valor-local-de-al-menos-12-caracteres>
```

No reutilizar una contraseña productiva. Las identidades se crean con email confirmado localmente; no se envían correos.

Los endpoints esperados son:

| Servicio | Endpoint esperado |
|---|---|
| API/Auth/Storage | `http://127.0.0.1:54321` |
| PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |

Confirmar los valores reales con `pnpm exec supabase status`.

## 4. Restaurar schema, Auth, Database y Storage

Ejecución completa:

```powershell
$env:APP_ENV = "recovery-local"
pnpm recovery:restore
```

La secuencia es:

1. `supabase db reset --local` aplica las migraciones del repositorio.
2. Auth local crea o actualiza las 42 identidades con su UUID original, metadata original y contraseña Recovery.
3. Database trunca únicamente las 111 tablas públicas del contenedor `supabase_db_integraq-recovery`, desactiva triggers durante la carga controlada e inserta los 5,173 registros.
4. Storage crea o actualiza cada bucket como privado, valida el SHA-256 local y carga los 542 objetos.

Si el nombre del contenedor difiere:

```powershell
$env:RECOVERY_DB_CONTAINER = "supabase_db_otro-id-local"
```

Etapas individuales:

```powershell
pnpm recovery:reset
pnpm recovery:restore:auth
pnpm recovery:restore:database
pnpm recovery:restore:storage
```

No continuar tras un error. Conservar `outputs/recovery/*.json` como evidencia local y corregir la causa antes de reiniciar desde `recovery:reset`.

## 5. Validación automática

```powershell
$env:APP_ENV = "recovery-local"
pnpm recovery:validate
```

La validación cubre:

- conteo exacto por cada una de las 111 tablas;
- detección genérica de FK huérfanas;
- 42 usuarios Auth y vínculos por UUID;
- bucket `integraq-private` con `public=false`;
- descarga, tamaño y SHA-256 de los 542 objetos;
- reconciliación `file_objects` ↔ Storage;
- login con cuentas reconstruidas;
- RLS de `workspace_data` entre `production` y `demo`;
- `CREATE`, `UPDATE`, `DELETE` lógico y `RESTORE`;
- eventos correspondientes en `audit_log`;
- Signed URL permitida y denegada con dos identidades distintas;
- `pnpm test`, `pnpm typecheck`, `pnpm lint` y `pnpm build`.

Un error en cualquier etapa produce resultado `FAIL`.

## 6. Levantar IntegraQ contra Recovery

```powershell
$env:APP_ENV = "recovery-local"
pnpm recovery:dev
```

El comando carga `.env.recovery.local` sin modificar `.env.local`. Abrir `http://127.0.0.1:3000` y usar una identidad del snapshot con `RECOVERY_DEFAULT_PASSWORD`.

## 7. Smoke test manual

Registrar PASS/FAIL y evidencia para cada punto:

| Área | Prueba mínima |
|---|---|
| Sesión | Login y logout locales |
| Inicio | Dashboard, navegación y widgets |
| Documentos | Listar, abrir archivo, crear, editar, eliminar y restaurar |
| Riesgos | Listar, crear, editar, eliminar y restaurar |
| Objetivos | Listar, crear, editar, eliminar y restaurar |
| Acciones correctivas | Listar, crear, editar, eliminar y restaurar |
| Auditorías | Listar, crear, editar, eliminar y restaurar |
| Metrología | Consultar |
| Mejora continua | Consultar |
| Revisión por la Dirección | Consultar |
| Clientes | Consultar |
| Proveedores | Consultar |
| Formularios | Consultar |
| Administración de contenido | Activos, Eliminados, Historial y Auditoría |

Durante el smoke test, confirmar en Network que las solicitudes apuntan exclusivamente a loopback.

## 8. RTO, RPO y evidencia

Los scripts registran tiempos por etapa en `outputs/recovery/*.json`. El RTO comienza antes de `recovery:start` y termina cuando la validación automática y el smoke test concluyen. Copiar las duraciones a `RECOVERY_TEST.md`.

El RPO debe basarse en evidencia de frecuencia real. Política recomendada:

| Activo | Frecuencia | RPO máximo objetivo | Retención mínima |
|---|---:|---:|---:|
| Database | Diaria | 24 h | 30 días |
| Storage | Incremental diaria + completa semanal | 24 h | 30 días |
| Auth/identidad | Con Database y antes de cambios de IAM | 24 h | 30 días |
| Configuración | En cada cambio | Último cambio aprobado | 12 versiones |

Si no existe evidencia de automatización y ejecución, reportar `RPO FORMAL = PENDIENTE`; no convertir la recomendación en un RPO demostrado.

## 9. Cierre seguro

```powershell
$env:APP_ENV = "recovery-local"
pnpm recovery:stop
```

El comando conserva volúmenes locales. Para borrarlos, identificar y revisar exclusivamente los volúmenes de `integraq-recovery`; este runbook no automatiza su eliminación. No usar `docker system prune`, `docker volume prune` ni comandos generales de limpieza.

## 10. Diagnóstico

- `Falta la herramienta requerida: docker`: instalar/iniciar Docker y repetir requisitos.
- `APP_ENV debe ser exactamente recovery-local`: definir la variable de sesión.
- `host rechazado`: eliminar cualquier URL cloud y volver a ejecutar `recovery:start`.
- `RECOVERY_DEFAULT_PASSWORD`: asignar un valor temporal de al menos 12 caracteres.
- `Checksum invalido`: el paquete está incompleto o cambió; no cargarlo.
- FK rota o conteo distinto: marcar FAIL, conservar evidencia y reiniciar desde un schema limpio tras corregir la causa.
- Signed URL no produce DENY: revisar RLS y policies; no declarar PASS.

## 11. Git y secretos

```powershell
git status --short
git diff --check
git diff
```

No agregar `.env.recovery.local`, `outputs/`, backups, contraseñas, tokens, claves Supabase, URLs con credenciales ni dumps confidenciales.
