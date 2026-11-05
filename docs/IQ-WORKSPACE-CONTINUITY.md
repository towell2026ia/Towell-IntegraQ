# Continuidad de trabajo — diagnóstico y corrección

Base revisada: `main` / `2b3b593`. Sin SQL, migraciones, cambios de permisos, datos ni archivos productivos.

## Causa reproducida

`useExternalCompanies` ejecutaba un refetch en cada `focus`, marcando `loading=true` aun después de haber cargado. `CustomersModule` retornaba exclusivamente el estado de carga, retirando del árbol React Reclamos, Certificaciones y sus formularios. Al terminar, los hijos se montaban de nuevo y perdían su estado. El efecto no era una recarga completa del documento.

La reproducción aislada compara los tres archivos originales de Clientes, Reclamos y el hook de empresas de `2b3b593` contra la corrección, usando la misma envoltura y respuestas simuladas. Antes: el formulario desaparece al volver al foco y no regresa al completar la consulta. Después: se conserva estrictamente el mismo nodo DOM del formulario, su texto y su selección, incluso ante un 503 temporal.

También se encontraron comparaciones de identidad `documentLoad.session === session` y `actionLoadedSession === session` en Workspace. Una nueva instancia equivalente de sesión invalidaba esas condiciones, repetía consultas y desmontaba módulos. Se sustituyeron por una clave semántica de identidad y acceso. Los cambios reales de permisos siguen invalidando el contexto.

## Diferenciar los eventos

| Evento | Evidencia y tratamiento |
| --- | --- |
| Recarga completa | No se encontró `window.location.reload()` ni un temporizador de recarga. Las pruebas provocan recargas explícitas y recuperan contexto. Se registra el tipo de navegación de Performance Navigation Timing. |
| `router.refresh()` | Instrumentado en inicio/cierre de sesión explícitos y cambio real de identidad. No se llama por `TOKEN_REFRESHED` ni por un `SIGNED_IN` de la misma cuenta al recuperar foco. |
| Remontaje React | Causa reproducida en Clientes. Los refetch de segundo plano mantienen el árbol. Se registran montajes/desmontajes de Workspace y formularios. |
| Supabase Auth | La suscripción sólo registra el nombre del evento y atiende cierre/cambio real de identidad. No registra sesiones ni tokens. Se mantiene la renovación del SDK y el proxy `getClaims` existente. |
| Foco / visibilidad | Empresas, Reclamos e Indicadores coalescen eventos, evitan solicitudes superpuestas y aplican un mínimo de 60 segundos a los refetch automáticos. No hay polling nuevo. Actualizar manualmente sigue disponible. |
| Red / despliegue | Se registran online/offline y navegación. No hay evidencia para atribuir este incidente a Netlify ni para afirmar que hubo un despliegue o una recarga de producción. |

Diagnóstico local: `window.__integraqContinuityDiagnostics()` devuelve hasta 100 entradas con `type`, `source` y `at`. No incluye textos, IDs de expedientes, usuarios, credenciales, URLs de archivos ni tokens; no transmite telemetría al servidor.

## Recuperación

- Se conserva módulo, destino de navegación y posición; todo módulo restaurado vuelve a pasar por `resolveAuthorizedModule`.
- Clientes conserva pestaña, búsqueda, cliente seleccionado y apertura de alta/edición. Reclamos conserva filtros, expediente y formulario; Certificaciones conserva filtros, expediente y editor. Root2Cause conserva sus cuatro pestañas, navegación y borrador A3, sin cambiar sus reglas ni datos.
- Los IDs de registros sólo se utilizan si siguen presentes en el catálogo autorizado obtenido del servidor. El reclamo que inició un A3 se vuelve a consultar antes de reconstruir ese contexto. Un fallo de verificación ofrece Reintentar y no crea ni sustituye registros.
- Los borradores están en `sessionStorage`, aislados por Auth ID, organización, modo y clave de acceso, con caducidad de ocho horas desde su última escritura. No sustituyen un catálogo productivo ni generan escrituras automáticas en Supabase.
- Se guardan sólo campos explícitos de formulario; no contraseñas, tokens, archivos ni binarios. Tras recargar con adjuntos pendientes se avisa que deben seleccionarse de nuevo, incluso si se sigue editando el texto.
- El identificador de una captura nueva permanece estable tras recargar. Un reclamo ya confirmado con evidencias pendientes se reutiliza; no se duplica. Los cambios posteriores de metadatos requieren el guardado explícito y los permisos existentes del servidor.
- Antes de salir de una captura sucia se pide confirmación; `beforeunload` solicita la advertencia nativa cuando el navegador la permite. Al confirmar el guardado se limpia el borrador. Un error no se presenta como guardado exitoso.
- Cerrar sesión o cambiar identidad, organización o permisos limpia/invalida el contexto. Los antiguos borradores A3 globales sin propietario no se atribuyen automáticamente a la cuenta actual; se retiran en el cierre de sesión. No se toca ningún registro documental existente en localStorage ni en Supabase.
- Si el navegador impide almacenar el borrador se informa en el formulario. Si el servidor devuelve 401/403 se retira la información de la vista; un fallo temporal de red conserva el último catálogo autorizado y muestra error/Reintentar.

## Pruebas

- Suite automatizada: 569 PASS / 108 archivos, incluidas 15 pruebas de continuidad, aislamiento, expiración, permisos, limpieza de sesión, ausencia de credenciales/binarios y deduplicación de consultas.
- Navegador Chrome aislado: 26 comprobaciones PASS. Incluye foco, tormenta de eventos, 20 sesiones equivalentes, `SIGNED_IN` y `TOKEN_REFRESHED` simulados sin `router.refresh`, error 503, recarga completa, recuperación de los cuatro formularios, selección de cliente, filtros, adjuntos, ID estable y cierre de sesión. No se enviaron operaciones de negocio; las respuestas de API y Auth del banco de pruebas son simuladas.
- Tiempo prolongado: reloj simulado de 30 minutos sin consultas periódicas, y coordinación de solicitudes lentas. No equivale a una sesión productiva observada durante 30 minutos.
- Evidencia: `evidence/continuity/results.json`, `diagnostics.json`, `before-focus-loss.png` y `after-draft-recovery.png`. Las capturas contienen exclusivamente datos QA locales.
- Typecheck, lint y build local de producción con webpack: PASS. CI y Netlify se cotejan con el commit publicado, en el reporte de entrega.

## Límites de aceptación

Pendiente comprobar una sesión real prolongada y su renovación efectiva con el usuario, incluyendo una captura auténtica sin guardar. Las pruebas aisladas no demuestran la ausencia de cualquier otra causa en el navegador productivo. Si vuelve a suceder, el registro local permite distinguir navegación completa, refresco de servidor, cambio de acceso y refetch/desmontaje sin recoger datos sensibles.

La recuperación de formularios se inicia con Clientes, Reclamos, Certificaciones y A3. Los formularios de otros módulos conservan sus mecanismos actuales. Cerrar la pestaña elimina su almacenamiento de sesión; el cierre de sesión o la revocación de acceso invalidan la recuperación deliberadamente. No se promete recuperación de archivos seleccionados ni de binarios que aún no se hayan adjuntado.

Referencia de Auth revisada: https://supabase.com/docs/reference/javascript/auth-onauthstatechange y https://supabase.com/docs/guides/auth/sessions.
