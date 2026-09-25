# Evidencia de Recovery local

Código: `IQ-PRD-REC-01B`
Fecha: 2026-09-25
Zona horaria: America/Mexico_City
Máquina: `LAP-GCALIDAD` (`AMD64`)
Revisión inicial: `b7cb8bc439c88487dd06762ccf7264b00dce5df2`

## Dictamen

```text
RECOVERY LOCAL: FAIL
PRODUCCIÓN MODIFICADA: NO
RECOVERY TYPE: SUPABASE LOCAL / DOCKER
```

El resultado es `FAIL` porque la máquina no tiene Docker, WSL ni PostgreSQL tools. Supabase CLI quedó instalado, pero sin motor Docker no puede iniciar los servicios locales. La Definition of Ready no se cumple y no se inició un restore parcial ni se escribió en Producción. El backup sí fue localizado e inspeccionado y la implementación reproducible quedó preparada.

## Herramientas observadas

| Herramienta | Resultado |
|---|---|
| Docker | FAIL — comando no encontrado; Docker Desktop no está en rutas conocidas |
| Supabase CLI | PASS — `2.117.0` |
| PostgreSQL `psql` | FAIL — comando no encontrado en el host |
| WSL | FAIL — no instalado |
| Node.js | PASS — `v24.19.0` |
| pnpm | PASS — `11.19.0` |
| Git | PASS — `2.53.0.windows.3` |
| Supabase CLI versionada | PASS — `2.117.0` en `devDependencies` y `node_modules` |

## Protección de Producción

- Project Ref: `yptrqowmviixlkrxjrqr`.
- Host origen del manifiesto: `yptrqowmviixlkrxjrqr.supabase.co`.
- Acciones contra Producción: ninguna.
- No se ejecutaron `DROP`, `TRUNCATE`, restore, migraciones, cambios RLS/Auth/Storage ni escrituras remotas.
- Sólo se inspeccionaron archivos locales, se implementó automatización y se ejecutaron suites del repositorio.

## Backup utilizado

| Campo | Valor |
|---|---|
| Backup ID | `2026-09-25-pre-hardening-api` |
| Fecha UTC | `2026-09-25T16:52:22.660Z` |
| Formato | JSON por tabla + inventario Auth + binarios Storage + manifiesto |
| Archivos del paquete | 655 |
| Tamaño total | 400,954,041 bytes (382.38 MiB) |
| SHA-256 `manifest.json` | `f426e0641cccdd3f38c88af9a115fe7be39f0d3d3d850385a1b74392477ead76` |
| Migración del snapshot | `202609250001_production_hardening.sql` |
| Warnings | 0 |

### Clasificación comprobada

| Componente | Disponible | Observación |
|---|---|---|
| Database | Parcial | 111 JSON y 5,173 filas; no es dump PostgreSQL nativo |
| Schema | Sí, por repositorio | 26 migraciones; `public-schema.sql` tiene 0 bytes |
| Auth | Parcial/reconstruible | 42 UUID y metadata; sin contraseñas productivas |
| Storage | Sí | 542 binarios, 398,544,257 bytes y SHA-256 por objeto |
| Migraciones | Sí | Hasta `202609250003_workspace_soft_delete_guard.sql` |
| Configuración | No | Se reconstruye con `supabase/config.toml` y variables locales |

`pnpm recovery:inspect` obtuvo PASS para estructura, conteos, bytes y cero warnings.

## Estrategia seleccionada

```text
MIGRACIONES
    ↓
AUTH LOCAL CON UUID PRESERVADO
    ↓
DATOS JSON
    ↓
STORAGE PRIVADO
```

Se eligió “Migraciones → Datos” porque el backup no contiene un schema dump utilizable. Las migraciones son la fuente del schema; no se creó una estructura paralela.

## Automatización entregada

- `supabase/config.toml` con puertos locales dedicados.
- `pnpm recovery:inspect` para clasificar y verificar el paquete.
- `pnpm recovery:start` para iniciar Supabase y generar configuración local no versionada.
- `pnpm recovery:restore` para schema, Auth, Database y Storage.
- Scripts individuales para repetir cada etapa.
- `pnpm recovery:validate` para conteos, FK, Storage, reconciliación, RLS, Signed URLs, Audit Log, Soft Delete/Restore y suite técnica.
- `pnpm recovery:dev` para levantar IntegraQ usando `.env.recovery.local`.
- `pnpm recovery:stop` sin limpieza general de volúmenes.
- Guardas que abortan Recovery frente a cualquier host no loopback.

## Resultados

| Validación | Estado | Evidencia |
|---|---|---|
| Backup local | PASS | 111 tablas, 5,173 filas, 42 usuarios, 542 archivos, 398,544,257 bytes |
| Supabase local inició | FAIL | Docker/Supabase CLI no disponibles |
| Schema restaurado | FAIL | No ejecutado |
| Database restaurada | FAIL | No ejecutado |
| Auth | FAIL | Procedimiento implementado, no ejecutado |
| Storage | FAIL | Procedimiento implementado, no ejecutado |
| Bucket privado | FAIL | No verificable sin Recovery activo |
| RLS | FAIL | Prueba implementada, no ejecutada |
| Workspace isolation | FAIL | Prueba implementada, no ejecutada |
| Signed URL | FAIL | Prueba ALLOW/DENY implementada, no ejecutada |
| Audit Log | FAIL | Prueba CREATE/UPDATE/DELETE/RESTORE implementada, no ejecutada |
| Soft Delete | FAIL | Prueba implementada, no ejecutada |
| Restore lógico | FAIL | Prueba implementada, no ejecutada |
| IntegraQ contra Recovery | FAIL | No levantado contra backend local |
| Smoke test | FAIL | No ejecutado |
| Tests de código | PASS | 214/214 |
| Typecheck | PASS | `tsc --noEmit` |
| Lint | PASS | ESLint, sin errores |
| Build | PASS | Next.js 16.2.12, build productivo |
| Runbook | PASS | `RECOVERY_RUNBOOK.md` creado |

## Comparación con el snapshot

| Elemento | Backup | Recovery Local | Estado |
|---|---:|---:|---|
| Tablas | 111 | 0 verificadas | FAIL |
| Filas | 5,173 | 0 verificadas | FAIL |
| Usuarios | 42 | 0 verificados | FAIL |
| Archivos | 542 | 0 verificados | FAIL |
| Tamaño Storage | 398,544,257 bytes | 0 verificados | FAIL |

Los ceros significan “no restaurado/no verificado”; no describen corrupción del paquete.

## RTO y RPO

```text
RTO = NO MEDIDO
RPO FORMAL = PENDIENTE
RPO OBJETIVO RECOMENDADO = 24 HORAS
```

El reloj RTO no comenzó porque el ambiente local no pudo iniciarse. Los scripts guardarán duraciones por etapa en `outputs/recovery/*.json`.

| Etapa | Duración |
|---|---:|
| Supabase local | No medida |
| Database restore | No medida |
| Auth | No medida |
| Storage | No medida |
| Configuración app | No medida |
| Validación | No medida |
| Total | No medido |

El repositorio documenta política diaria para Database y Storage, pero esta ejecución no obtuvo evidencia de automatización activa ni historial. Las 24 horas son objetivo recomendado, no RPO demostrado. Auth debe respaldarse con Database y antes de cambios IAM.

## Warnings

- El backup lógico no contiene dump de schema, tablas completas de `auth` ni configuración del proyecto.
- Los usuarios se reconstruirán con UUID y metadata originales, pero con contraseña temporal exclusiva de Recovery.
- La migration head del backup antecede a dos migraciones del repositorio; se aplicarán antes de importar datos.
- Artefactos y evidencias runtime permanecen fuera de Git.

## Blockers

1. Instalar e iniciar Docker Desktop o motor Docker compatible.
2. Confirmar `docker info`.
3. Ejecutar el runbook y actualizar conteos, RTO y smoke test reales.

## Reporte obligatorio

```text
RECOVERY LOCAL: FAIL
PRODUCCIÓN MODIFICADA: NO
RECOVERY TYPE: SUPABASE LOCAL / DOCKER
DATABASE: FAIL
AUTH: FAIL
STORAGE: FAIL
RLS: FAIL
WORKSPACE ISOLATION: FAIL
SIGNED URL: FAIL
SOFT DELETE: FAIL
RESTORE: FAIL
AUDIT LOG: FAIL
SMOKE TEST: FAIL
TESTS: 214 PASS / 0 FAIL
TYPECHECK: PASS
LINT: PASS
BUILD: PASS
TABLES: 0 / 111
ROWS: 0 / 5,173
USERS: 0 / 42
FILES: 0 / 542
RESTORED SIZE: 0 MB
RTO: NO MEDIDO
RPO: FORMAL PENDIENTE; OBJETIVO 24 HORAS
RECOVERY RUNBOOK: CREATED
WARNINGS: backup lógico sin schema/Auth passwords/configuración
BLOCKERS: Docker no instalado
COMMIT: PENDIENTE
PUSH: PENDIENTE
```
