# IQ-PROV-AUD-03 — Resultados de auditorías y efectividad RNCP

## Alcance preparado

Corrección de lectura y cálculo de efectividad RNCP; inventario documental y propuesta de asociación, sin cargas ni migraciones productivas. Las auditorías existentes no se vuelven a importar. La Entrega A de Root2Cause queda fuera del cambio.

## Efectividad RNCP

Cerrados / (Cerrados + Tardíos) × 100. Sin denominador: «Sin RNCP evaluables».

Históricos: se cuentan exclusivamente las categorías originales F-CA-24 «Cerrado» y «Tarde». Una categoría Cerrado no acredita puntualidad; no se sustituyen estados ni fechas.

Nativos: únicamente expedientes cerrados con respuesta completa presentada, validación aceptada y marcas temporales válidas y coherentes. Una respuesta posterior al vencimiento pertenece sólo a Tardíos, aunque el expediente esté cerrado. Sin respuesta completa validada no se presume cumplimiento; queda excluido. Se excluyen borradores, En Proceso, retirados y registros sin datos verificables. Los IDs repetidos no duplican el denominador; las clasificaciones contradictorias quedan excluidas.

La tarjeta muestra el cálculo y el desglose histórico/nativo. Una consulta fallida muestra «No disponible». Esta métrica no determina ni reemplaza la calificación de auditoría F-CO-05.

## Inventario y vista previa

El inventario real, los identificadores, huellas SHA-256, archivos fuente y propuestas se conservan fuera de Git. Se distingue cuestionario cumplimentado, plantilla vacía, programa y documento auxiliar. Tener fecha R en F-CA-58 no acredita calificación.

Antes de cualquier carga deben revisarse proveedor oficial, evento único, fecha, versión del cuestionario, resultado original, evaluador documentado, evidencias, plan e informe PDF original. Una coincidencia propuesta de un evento sin proveedor requiere conciliación y autorización expresa; no se asocia automáticamente.

## Discrepancia de fórmulas F-CO-05

V2, Manufacturers!O1: AVERAGE(J10,J18,J25,J33,J41,J50,J57,J66) omite J74, el noveno rubro.

V2, 'Distribuidores y Servicio'!P1: AVERAGE(J10,J18,J26,J34,J43,J51,J60) omite J69, el octavo rubro.

La versión V1 tiene ocho rubros de fabricante y siete de distribuidor y su promedio los incluye. No debe confundirse una evaluación V1 con V2, ni completar rubros nuevos con cero. Los resultados almacenados se conservan sin recalcular.

El cargador actual exige PDF de hasta 4 MB y proveedor conciliado. La validación actual de puntuaciones exige nueve u ocho rubros V2. No se ejecuta una carga V1 usando ese contrato ni se genera un PDF que se presente como original.

## Verificación y liberación

Casos: 3/4 = 75 %, ausencia de tardíos = 100 %, denominador vacío, estados originales, respuesta nativa tardía cerrada, fechas no verificables, proveedor distinto, retirados, duplicados, fallo de consulta y separación de calificaciones.

Preparación en checkout independiente desde la versión publicada. No contiene SQL. Typecheck, lint, pruebas afectadas y build; publicación sólo tras validación cloud y autorización humana. Cargas, migraciones, correos, cuentas y notificaciones no forman parte de esta entrega.
