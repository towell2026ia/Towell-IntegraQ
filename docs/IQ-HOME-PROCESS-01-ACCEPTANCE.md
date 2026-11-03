# IQ-HOME-PROCESS-01 — evidencia de aceptación parcial

Fecha: 2026-11-03. PR #21, implementación `684961d1caa106d7fb85c257f23ed55b58dc0d4c`, base main `91430b6aec3507478d10a30c2c45284d5fc5f6e1` (confirmada mediante GitHub).

## Resultado

**Aceptación funcional con usuarios reales: PENDING. Aceptación visual de la plataforma autenticada: PENDING.** No se modificó código productivo para obtener las evidencias de este cierre. Se agregan pruebas, un script de captura y este informe. No se ejecutó SQL, no se accedió a registros mediante credenciales privilegiadas y no se modificaron datos, permisos, usuarios, Storage ni configuración cloud.

## Preview y aislamiento comprobados en modo de lectura

- [Deploy Preview #21](https://deploy-preview-21--towell-integraq.netlify.app): existe. [Deploy `6aea06eaf594609ed0dc48a1`](https://app.netlify.com/projects/towell-integraq/deploys/6aea06eaf594609ed0dc48a1) en estado `ready`, contexto `deploy-preview`, commit `684961d`. No se lanzó ningún despliegue durante esta verificación.
- Variables del sitio inspeccionadas con el conector Netlify: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` sólo tienen contexto `production`. La URL pública identifica el proyecto productivo `yptrqowmviixlkrxjrqr`. No hay valor de estas variables para `deploy-preview` en la configuración del sitio consultada.
- La consulta de la variable compartida de equipo `NEXT_PUBLIC_SUPABASE_URL` responde que no existe. No hay `netlify.toml` en la rama inspeccionada.
- Existe configuración de secreto de servidor para `deploy-preview`; su presencia NO acredita aislamiento ni permite simular usuarios. No se utilizaron ni publicaron sus valores.
- [Comentario de Supabase en PR #21](https://github.com/towell2026ia/Towell-IntegraQ/pull/21#issuecomment-6608834429): el PR fue ignorado por branching porque no cambió el directorio `supabase`. Esto no prueba que no exista otra base de pruebas, pero no aporta ninguna rama aislada para este PR.
- **No se confirmó destino aislado ni sesiones autorizadas de Calidad/Ventas.** El estado `ready` sólo acredita el build, no la autenticación ni el acceso a datos. No se iniciaron sesiones ni se hicieron consultas de expedientes reales en ese Preview.

Falta exactamente: identificar una base Supabase aislada ya autorizada; configurar las variables de autenticación del contexto `deploy-preview` para ese destino; confirmar que tanto servidor como cliente apuntan allí; disponer de sesiones autorizadas de Calidad y Ventas y registros de prueba con organización, proceso y responsabilidad verificables. Este trabajo no crea esa infraestructura, usuarios ni copias de información productiva.

## Comparación visual aislada

El navegador integrado y el runtime alternativo fallan al inicializar con `failed to write kernel assets ... os error 3`. Se utilizó Chrome headless ya instalado, con perfiles temporales nuevos, sin credenciales, sin instalar herramientas y sin abrir la plataforma productiva. Vite ya estaba disponible como dependencia de Vitest.

Reproducción: `node scripts/capture-home-acceptance.mjs 91430b6`. Un segundo argumento permite indicar la ruta de Chrome. El script importa los componentes originales de main y los de PR #21, aplica el mismo CSS, fija reloj, perfil, resolución y entradas, y rechaza capturas que no hayan renderizado Inicio o tengan errores JavaScript.

| Condición | Valor |
|---|---|
| Resolución / escala | 1440 × 3200 / 1 |
| Contenedor | 1200 px, margen y padding idénticos |
| Perfil | Administrador de prueba, idéntico en ambas capturas |
| Fecha fija | 2026-11-03T16:00:00Z |
| Datos | Fixtures sintéticos; sin expedientes reales |
| Imágenes | Cuatro SVG idénticos marcados como no productivos |
| Resultado | PNG completos idénticos, SHA-256 `3dd3c8431cf8a53ea98ce97b51af045d65c2c6350cff189425c71502a9c5d4c6` |

[Captura main](../artifacts/home-acceptance/main.png) · [Captura PR #21](../artifacts/home-acceptance/pr21.png) · [Metadatos](../artifacts/home-acceptance/capture.json)

Las capturas fueron inspeccionadas: muestran las cuatro imágenes de prueba, cinco objetivos, tarjetas, gráficos y actividad. Demuestran equivalencia de renderizado de **HomeModule con entradas iguales**, además de las seis pruebas estáticas de JSX/CSS. No representan una sesión real: no incluyen el shell completo, configuración global de apariencia autenticada ni los archivos institucionales originales. La respuesta del nuevo endpoint se sustituye por el mismo dashboard de referencia para aislar el renderizado; esta comparación no prueba los cálculos del endpoint ni la corrección de los textos operativos del fixture anterior. Esos cálculos se comprueban por separado con pruebas automatizadas.

## Datos, frecuencias y permisos

| Caso | Evidencia disponible | Aceptación real |
|---|---|---|
| Administrador | API simulada restringe procesos a su organización | PENDING |
| Calidad / Ventas | Filtro de procesos y responsabilidad; documentos de Calidad excluidos al seleccionar Ventas | PENDING |
| Varios procesos | Un KPI con dos relaciones se contabiliza una sola vez | PENDING |
| Sin pendientes | Un usuario diferente al responsable recibe lista vacía | PENDING |
| Sin mediciones | Sin porcentaje ni puntos fabricados; cero real se conserva | PENDING |
| Información institucional | Misma imagen para interno sin edición y administrador; cinco objetivos conservados | PENDING para archivos reales |
| Cliente / proveedor | API rechaza antes de usar cliente privilegiado | PENDING contra RLS real |
| Riesgos / Revisión por la Dirección | Con permiso y sin fuente validada: `Sin datos` / `Sin fuente conectada a Inicio` | PENDING en sesión real |

Caso de cálculo automatizado: regla >=90, Q1=0 y Q2=95 producen cumplimiento 0% y 100%; Q3 sin medición no agrega punto. Se conserva el timestamp original `2026-07-03T09:08:07Z`. Una evaluación histórica almacenada prevalece sobre una regla actual diferente.

Frecuencias `monthly`, `annual` y `yearly`: pruebas verifican que no crean tendencia trimestral, porcentaje ni tarea trimestral de captura, y que los registros originales del fixture permanecen presentes. El esquema de periodos inspeccionado representa año/trimestre. **No existe aquí una regla de agregación no trimestral documentada**; esos KPI se excluyen de los cálculos en vez de reinterpretarlos. Su aceptación queda pendiente de confirmar frecuencias y periodos reales; no se afirma soporte mensual/anual completo. Las capturas de actividad y sus referencias se conservan independientemente del cálculo.

## Pruebas y límites

- Pruebas focalizadas: **31 PASS**, tres archivos (datos, API y preservación de layout).
- Suite local: **428 PASS**, 83 archivos.
- Typecheck y lint locales: **PASS**.
- [CI del commit de implementación `684961d`](https://github.com/towell2026ia/Towell-IntegraQ/actions/runs/41671047984): **PASS**, incluidos typecheck, lint, 424 pruebas y build. El resultado CI de este cierre se enlaza en el cuerpo del PR cuando finalice.
- Build del Preview de `684961d`: **PASS**. No equivale a aceptación autenticada.

No se puede cotejar todavía ningún conteo operativo contra expedientes reales de Calidad/Ventas ni confirmar identidad de las imágenes originales entre esas sesiones. Esas comprobaciones requieren el entorno aislado descrito arriba. No se utilizó `service_role` para simular usuarios y no se desactivó RLS.

**Producción sin modificaciones. Sin SQL, migraciones, merge ni despliegue solicitado. STOP para revisión; no declarar recuperación o aceptación completa.**
