# IA-01 · Decisiones de migración

IntegraQ mantiene dos agentes independientes con el SDK de OpenAI y la clave de servidor existente. El alcance autorizado comprende la implementación y las pruebas simuladas. Se conserva el presupuesto cero para las pruebas de generación.

| Recorrido | Transporte y configuración | Evidencia |
|---|---|---|
| Root2Cause, análisis integral y asistencia por etapa | Responses, GPT-6 Luna, esfuerzo bajo. Conserva ambos esquemas, instrucciones, límite de 27 segundos y deduplicación. | Pruebas de ruta y controles A3. |
| Revisión por la Dirección | Responses, GPT-6 Luna, esfuerzo medio. Respuesta estructurada de quince apartados, hasta 4.000 tokens de salida. | Prueba de ruta con proveedor simulado y validación de la respuesta. |
| Seguimiento y consulta de informes | Lectura central, edición y aprobación con las funciones de RE-05. | Los reintentos recuperan la operación existente. PostgreSQL reserva por organización y año. |

Los contratos históricos y registros anteriores conservan el modelo y costo originales. La propuesta SQL de IA-01 admite Luna en el presupuesto y exige autorización de tratamiento. Cada generación posterior a la ordinaria requiere aprobación para su ordinal, organización y año. Las reservas fallidas o inciertas consumen el ordinal. Los tokens se registran y el importe de Luna queda pendiente de conciliación. Instalar la propuesta no asigna presupuesto ni emite autorizaciones.

Ambos agentes envían sus instrucciones especializadas en cada petición, con esquema estricto y almacenamiento de respuesta deshabilitado. El backend propio mantiene el estado, la auditoría, el presupuesto y la recuperación. Los dos flujos requieren la respuesta completa para validar antes de aplicarla. Continúan usando HTTP, sin transmisión incremental, WebSockets, herramientas del proveedor, sesiones compartidas, compacción ni reanudación automática. Se conservan la verbosidad, la selección de tier y la caché predeterminadas. No se solicita residencia, retención extendida ni se presupone una política contractual de retención cero.

El catálogo oficial documenta Responses y salidas estructuradas. La consulta de metadatos desde el proceso local obtuvo HTTP 401. El acceso con la credencial del despliegue y la latencia real de generación requieren verificación independiente. [Ficha del modelo](https://developers.openai.com/api/docs/models/gpt-6-luna)
