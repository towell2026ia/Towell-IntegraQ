# Alcance de procesos

Fuente inicial: F-SGC-36 MetroMapTowel Rev. 0.

Este inventario incluye unicamente los nombres colocados junto a circulos en el Metro Map. No incluye triangulos de actividades ni ovalos de conexion.

Para cada proceso se debe definir: `Incluido`, `Solo referencia`, `Integracion` o `Fuera de alcance`.

| ID | Nivel | Proceso padre | Nombre | Tipo visual | Alcance | Responsable | Observaciones |
|---|---|---|---|---|---|---|---|
| P-01 | Proceso | | Ventas | Circulo de inicio | Por definir | | |
| P-02 | Proceso | | Diseño | Circulo de inicio | Por definir | | |
| P-03 | Proceso | | Dirección | Circulo de inicio | Por definir | | |
| P-04 | Proceso | | Planeación | Circulo de inicio | Por definir | | |
| P-05 | Proceso | | SMA | Circulo de inicio | Por definir | | |
| P-06 | Proceso | | Contabilidad | Circulo de inicio | Por definir | | |
| P-07 | Proceso | | Tecnologías de Información | Circulo de inicio | Por definir | | |
| P-08 | Proceso | | Calidad | Circulo de inicio | Por definir | | |
| P-09 | Proceso | | Almacén | Circulo de inicio | Por definir | | |
| P-10 | Proceso | | Compras | Circulo de inicio | Por definir | | |
| P-11 | Proceso | | Patrimonial | Circulo de inicio | Por definir | | |
| P-12 | Proceso | | Mantenimiento | Circulo de inicio | Por definir | | |
| P-13 | Proceso | | Tejido | Circulo de inicio | Por definir | | |
| P-14 | Subproceso | P-13 Tejido | Manufactura Urdido | Circulo de manufactura | Por definir | | |
| P-15 | Subproceso | P-13 Tejido | Manufactura Engomado | Circulo de manufactura | Por definir | | |
| P-16 | Subproceso | P-13 Tejido | Manufactura de Tejido | Circulo de manufactura | Por definir | | |
| P-17 | Proceso | | Tintorería | Circulo de inicio | Por definir | | Rotulo en el mapa: Tintoreria / Crudo. |
| P-18 | Proceso | | Laboratorio | Circulo de inicio | Por definir | | |
| P-19 | Subproceso | P-13 Tejido | Manufactura de rollo rasurado | Circulo de manufactura | Por definir | | |
| P-20 | Subproceso | P-17 Tintorería | Manufactura de Toalla teñida | Circulo de manufactura | Por definir | | |
| P-21 | Subproceso | P-17 Tintorería | Manufactura de Toalla seca | Circulo de manufactura | Por definir | | |
| P-22 | Proceso | | Costura | Circulo de inicio | Por definir | | Rotulo en el mapa: Costura/Acabado. |
| P-23 | Proceso | | Corte de Bata | Circulo de inicio | Por definir | | |
| P-24 | Proceso | | Confección de Bata | Circulo de inicio | Por definir | | |
| P-25 | Subproceso | P-22 Costura | Manufactura de Confección de la toalla | Circulo de manufactura | Por definir | | |
| P-26 | Subproceso | P-22 Costura | Manufactura de Toalla estampada | Circulo de manufactura | Por definir | | |
| P-27 | Subproceso | P-22 Costura | Manufactura de Confección de Toalla | Circulo de manufactura | Por definir | | |
| P-34 | Proceso | | PT | Agrupador de proceso | Por definir | | ID provisional para el proceso padre. |
| P-28 | Subproceso | P-34 PT | PT Cubo | Circulo de inicio | Por definir | | |
| P-29 | Subproceso | P-22 Costura | Manufactura de Empaque final | Circulo de manufactura | Por definir | | |
| P-30 | Subproceso | P-34 PT | PT Preparación | Circulo de inicio | Por definir | | |
| P-31 | Proceso | | Mesa de Control | Circulo de inicio | Por definir | | |
| P-32 | Subproceso | P-34 PT | PT Embarques | Circulo de inicio | Por definir | | |
| P-33 | Subproceso | P-01 Ventas | Satisfacción al cliente | Circulo terminal | Por definir | | |

## Jerarquia confirmada

- `Tejido`: P-14, P-15, P-16 y P-19.
- `Tintoreria`: P-20 y P-21.
- `Costura`: P-25, P-26, P-27 y P-29.
- `Ventas`: P-33.
- `PT`: P-28, P-30 y P-32.

## Circulo pendiente de identificar

En la zona izquierda del Metro Map aparece un circulo sin rotulo. Su primera actividad visible es `Control de documentacion dada de alta en el Sistema de Gestion`. El nombre del proceso debe confirmarse antes de incorporarlo al catalogo.

## Criterio sugerido

- `Incluido`: IntegraQ administra el registro, flujo, evidencia y trazabilidad.
- `Solo referencia`: IntegraQ muestra o vincula informacion de otro sistema.
- `Integracion`: existe intercambio de datos con ERP, MES u otra plataforma.
- `Fuera de alcance`: no se implementa en esta fase.
