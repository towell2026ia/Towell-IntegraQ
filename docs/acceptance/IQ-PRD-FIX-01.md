# IQ-PRD-FIX-01 — integración y aceptación pendiente

Fecha: 2026-10-27. PR existentes: #5 (documentos) y #6 (Inicio).

## Migraciones y orden

1. Mantener las migraciones históricas aplicadas con sus identificadores actuales.
2. Aplicar primero las dependencias versionadas de cada rama. El PR #5 conserva su base existente en PR #4; esta revisión no reconstruye STB-01.
3. 202610220001_document_retention_code_reuse.sql permanece en PR #5.
4. 202610270001_home_image_slots.sql sustituye únicamente el nombre anterior de imágenes 202610220001_home_image_slots.sql en PR #6.
5. El historial de migraciones se consultó mediante Supabase, solo lectura, en el proyecto principal y los dos Preview existentes: ninguna contiene 202610220001 ni 202610270001. No se renombra ninguna versión aplicada.
6. El SQL de imágenes conserva exactamente el blob ebcdd26712e62f9398252d392d42aef9f8ccba95 antes y después del cambio de nombre. No se añade, recorta ni sustituye contenido.
7. En el SQL documental se repararon seis delimitadores incompletos de dollar quoting, necesarios para analizarlo/aplicarlo. Se conservan sus sentencias, funciones y reglas existentes.

Ambas secuencias son únicas y el orden integrado sitúa documentos antes de imágenes. El parser valida sintaxis SQL y cuerpos PL/pgSQL; no acredita compatibilidad con el catálogo ni comportamiento transaccional.

## Cobertura del código

- Eliminación documental con motivo obligatorio y confirmación explícita; se conserva la ruta de eliminación lógica, archivos, versiones, validaciones y auditoría.
- Reutilización de código eliminado y bloqueo de duplicado activo/restore conflictivo mediante los guardas e índices del PR #5. Las pruebas SQL existentes se conservan como fixtures pendientes.
- Cuatro espacios de imágenes con carga, sustitución, lectura vigente, consulta histórica y recuperación como una nueva revisión. No se borran imágenes anteriores.
- Inicio presenta todos los indicadores autorizados, sin el límite anterior de seis tarjetas.
- Las 52 definiciones versionadas se conservan intactas: 29 tienen asignación a cinco objetivos reales (2, 16, 7, 1 y 3); 23 permanecen sin objetivo. No se escribe ninguna asignación ni resultado.

## PENDING: aceptación en entorno aislado

- Aplicación real de las migraciones y verificación de catálogo, RLS, RPC, concurrencia y rollback.
- Reemplazo documental con código reutilizado, restauración conflictiva/segura y verificación BEFORE/AFTER de versiones y archivos del entorno de prueba.
- Carga de las cuatro imágenes, consulta vigente fuera de Editar inicio, persistencia tras recarga y nuevo inicio de sesión, consulta y recuperación histórica.
- Validación de la configuración específica de Supabase y Netlify Preview.
- Verificación de los 52 indicadores del runtime y sus asignaciones en el entorno autorizado.

Los Preview existentes pertenecen a otros PR. No se reutilizan ni alteran en esta intervención, no se crean ramas nuevas y no se introducen credenciales de producción en Preview. La ejecución SQL permanece PENDING. No hay merge ni modificaciones productivas.
