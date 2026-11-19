# P0-04 — Plan de acción simplificado

**Fecha:** 19 de noviembre de 2026
**Paquete:** Root2Cause P0-04
**Estado:** PASS TÉCNICO; pendiente de validación funcional de Calidad. No está ACEPTADA ni CERRADA.

## Cambios realizados

- El plan muestra únicamente los cuatro datos solicitados: descripción de la acción correctiva, categoría M del Ishikawa, responsable seleccionado del catálogo interno y fecha compromiso. La relación con una causa concreta se conserva internamente sólo si ya existe.
- «Agregar acción» aparece junto al encabezado y crea una acción editable. Las acciones adicionales se pueden retirar por su ID, preservando las restantes.
- El catálogo del servidor sólo devuelve nombre e ID de usuarios internos/administradores activos de la organización. Para un proceso, limita los usuarios internos a quienes tienen asignación al proceso o son responsables de éste; los administradores permanecen limitados a la organización.
- El borrador conserva `ownerUserId`, causa, causa ID y clasificación M. Al finalizar, el servidor revalida organización, perfil activo, asignación al proceso y concordancia entre causa y M; después vincula el usuario a `corrective_action_plans.owner_id` existente.
- Una propuesta de IA aceptada registra una clave de origen para impedir que el mismo resultado se incorpore dos veces. Las acciones siguen siendo editables y pueden vincularse a una causa 6M coincidente.
- Los tres campos retirados dejan de mostrarse y de formar parte de la validación frontend. Sus columnas y valores históricos no se modifican.

## Casos de aceptación

| Caso | Resultado | Evidencia |
|---|---|---|
| T04.1 — Acción manual con M, usuario de catálogo y fecha, sin los tres campos retirados | **PASS técnico con mocks**: un plan válido no requiere causa individual ni los campos retirados; el mock guarda y recupera descripción, M, responsable y fecha. **Validación real autenticada pendiente** para confirmar el usuario del catálogo y persistencia en Supabase. | `src/lib/root2cause/action-plan.test.ts`; `src/lib/root-cause-draft-storage.test.ts`; pruebas del endpoint con mocks |
| T04.2 — Agregar acción editable junto al encabezado | **PASS automatizado** para inserción, estructura renderizada y control «Agregar acción». **Validación visual funcional pendiente**. | `src/lib/root2cause/action-plan.test.ts` |
| T04.3 — Retirar una acción adicional sin alterar las demás | **PASS automatizado** mediante prueba de aislamiento por ID. **Validación visual funcional pendiente**. | `src/lib/root2cause/action-plan.test.ts` |
| T04.4 — Aceptar propuesta IA una sola vez y conservar edición | **PASS con mocks** para deduplicación, conservación del ID y edición. **Generación real y aceptación con GPT-5 nano pendientes**; no se realizó llamada facturable. | `src/lib/root2cause/action-plan.test.ts` |

Las pruebas de servicio usan fixtures locales/mocks; no se crearon ni modificaron registros en IntegraQ, Preview o producción. No se usó navegador ni se generaron capturas; por tanto no hay evidencia de interacción visual autenticada ni se consultó un catálogo real de usuarios. El mock de T04.1 verifica el ciclo de guardar/reabrir el payload en el cliente, no la persistencia real de Supabase.

## Validación técnica

- Pruebas enfocadas: **11 aprobadas en 4 archivos** (plan, selector M, catálogo/permisos, borrador guardar/reabrir con mock).
- Suite completa: **PASS, 1,316 aprobadas, 1 omitida** en 173 archivos.
- Typecheck: **PASS**.
- ESLint: **PASS**, sin errores ni advertencias. La primera ejecución detectó un error sólo en la ruta temporal local; se eliminó esa ruta propia y el lint completo volvió a aprobar.
- Build: **PASS** (Next.js 16.2.12/Turbopack).
- `git diff --check`: **PASS**.
- SQL/migraciones: **sin cambios ni ejecución**.

## Dependencia de activación

El contrato FLOW instalado todavía exige `expectedResult`, `completionEvidence` y `effectivenessMethod` al crear el expediente. La interfaz y validación del plan ya no los exigen; por ello la finalización real permanece bloqueada hasta corregir el contrato `iq_root2cause_create_action` en el paquete P0-05. No se agregaron valores ficticios ni se modificó SQL en P0-04.

## Siguiente validación

Calidad debe probar, con una sesión interna autorizada y un proceso real, que el catálogo muestra a la persona correcta, el plan se guarda y vuelve a abrir con su responsable y M; también debe verificar visualmente agregar y retirar acciones. P0-04 no se considera aceptado/cerrado hasta recibir esa aceptación expresa. La corrección del contrato FLOW corresponde a P0-05 y no se inició aquí. El cambio se prepara para el commit local `fix(root2cause): simplify A3 action plan P0-04`; sin push ni despliegue.
