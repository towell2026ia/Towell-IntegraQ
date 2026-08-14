# Revisión funcional de auditorías y calificación de proveedores

## Fuentes revisadas

- `%NIVEL DE CALIDAD 3.xlsx`: desempeño por periodo, entregas, RNCP y Pareto.
- `F-CO-05_Evaluación de proveedores_V2 (esp).xlsm`: plantilla vigente del checklist.
- `F-CO-05_Evaluación de proveedores_V1 (esp) United Dragon.xlsm`: ejemplo contestado, evidencias y plan de acciones.
- `F-CA-58_Programa de auditoría a Proveedores_V0.xlsx`: programa semestral con fechas planeadas y realizadas.

## Reglas confirmadas

### Nivel de calidad

El nivel de calidad del proveedor se calcula por periodo:

`Nivel de calidad = 1 - (RNCP / entregas)`

La participación usada para el Pareto se calcula como:

`Participación RNCP = RNCP del proveedor / RNCP totales del periodo`

El programa F-CA-58 incluye en el alcance a proveedores con nivel de calidad menor o igual a 95%. Los proveedores por encima de 95% conservan visible su porcentaje, aunque no requieran auditoría.

### Calificación del checklist

Los criterios definidos son:

| Respuesta | Puntos |
| --- | ---: |
| Conformidad | 10 |
| No conformidad menor | 3 |
| No conformidad mayor | 0 |
| Oportunidad de mejora | 6 |

Cada pregunta debe admitir una sola respuesta. El resultado de cada rubro debe dividirse entre `número de preguntas aplicables × 10`. La calificación final debe promediar todos los rubros aplicables.

### Clasificación final propuesta

| Calificación | Clasificación |
| --- | --- |
| 90% a 100% | Proveedor confiable |
| 80% a menos de 90% | Proveedor parcialmente confiable |
| 70% a menos de 80% | Proveedor condicionado |
| Menos de 70% | Proveedor poco confiable |

## Hallazgos que no deben replicarse

1. En las hojas de cuestionario, los encabezados de no conformidad menor y mayor están invertidos frente a las ponderaciones y al resumen. La plataforma debe usar valores semánticos, no posiciones de columnas.
2. La plantilla V2 redujo la cantidad de preguntas, pero conserva denominadores de la V1. Aun con todas las respuestas conformes, varios rubros no pueden alcanzar 100%.
3. Los promedios finales de la V2 omiten el último rubro agregado tanto en Manufacturers como en Distribuidores y Servicio.
4. La fórmula de clasificación actual deja sin tratamiento correcto el intervalo de 70% a menos de 71%, que puede terminar como proveedor confiable.
5. La etiqueta `% FPY` realmente representa participación de RNCP para el Pareto; debe renombrarse para evitar confusión.
6. Los archivos contienen valores `#VALUE!` en las celdas de encabezado usadas para elementos gráficos. La aplicación debe almacenar logotipo y metadatos como recursos independientes.
7. Los nombres de proveedores cambian entre libros. Se debe vincular todo por el identificador del proveedor y mantener alias para conciliación histórica.
8. El programa asigna a United Dragon el cuestionario de distribuidores o servicio, mientras que el ejemplo contestado usa la hoja Manufacturers. El tipo de checklist debe definirse en el expediente del proveedor y validarse al programar la auditoría.

## Flujo recomendado en IntegraQ

### 1. Desempeño semestral

- Capturar o importar entregas del periodo.
- Contar RNCP del mismo proveedor y periodo.
- Calcular nivel de calidad y Pareto.
- Marcar automáticamente como auditable cuando el nivel sea menor o igual a 95%.
- Permitir una excepción justificada y autorizada, sin ocultar el porcentaje.

### 2. Programa de auditoría

- Crear dos periodos operativos: febrero-julio y agosto-enero.
- Mostrar proveedor, tipo de checklist, método, auditores, fecha planeada, fecha realizada y estado.
- Estados mínimos: programada, confirmada, realizada, reprogramada, cancelada y pendiente.
- Editar el evento desde un panel lateral; no editar directamente una matriz de celdas.
- Conservar observaciones, riesgos, acciones de mitigación y recursos a nivel del programa semestral.

### 3. Ejecución del checklist

- Seleccionar ruta: manufacturero o distribuidor/servicio.
- Presentar preguntas agrupadas por rubro.
- Registrar una respuesta, observación y múltiples evidencias por pregunta.
- Calcular el rubro en tiempo real y mostrar el impacto de cada respuesta.
- Congelar la versión del checklist usada al cerrar la auditoría.

### 4. Resultado y seguimiento

- Generar portada con calificación, clasificación y resumen por rubro.
- Crear hallazgos desde no conformidades mayores, menores u oportunidades seleccionadas.
- Registrar acción, responsable, fecha compromiso, fecha real y estado.
- Permitir al proveedor capturar acciones y evidencias desde su portal.
- Notificar al responsable interno al recibir respuestas o evidencias.
- Evaluar cumplimiento del plazo con fecha de envío, vencimiento y días de atraso.

## Modelo mínimo de datos

- `supplier_quality_period`: proveedor, periodo, entregas, RNCP, nivel de calidad, participación RNCP, Pareto y decisión de auditoría.
- `supplier_audit_program`: semestre, alcance, observaciones, riesgos, mitigaciones y recursos.
- `supplier_audit_event`: proveedor, criterio, método, auditores, fecha planeada, fecha realizada, estado y motivo de cambio.
- `audit_template_version`: tipo de proveedor, versión, rubros, preguntas y ponderaciones.
- `supplier_audit`: evento, plantilla congelada, calificación, clasificación y estado.
- `audit_answer`: pregunta, resultado, observación y puntuación.
- `audit_evidence`: respuesta o hallazgo, archivo, autor y fecha.
- `supplier_action_plan`: hallazgo, acción, responsable, fechas, estado, evidencias y cumplimiento del plazo.

## Límite entre gestión interna y portal

Calidad de proveedores es la fuente única. El portal no crea una copia de la auditoría: muestra únicamente los RNCP, resultados, hallazgos, compromisos y evidencias asociados al proveedor autenticado. La cuenta del proveedor solo puede editar sus respuestas y evidencias mientras el periodo de respuesta esté abierto.
