-- IQ-HOTFIX-IND-MASTER-01B: controlled production master bootstrap.
-- Prepared only. Applying this migration requires separate explicit authorization.
-- Inserts no indicator_results and imports no browser/localStorage data.

begin;

create temporary table indicator_master_bootstrap (
  code text primary key,
  source_row integer not null,
  process_id text not null,
  area text not null,
  direction_objective text,
  direction_metric text,
  quality_objective text,
  name text not null,
  leader_name text,
  metric_label text not null,
  description text,
  rule_type public.indicator_rule_type not null,
  target_min numeric,
  target_max numeric,
  target_value numeric,
  unit text not null,
  compliant_rule text not null,
  marginal_rule text not null,
  noncompliant_rule text not null
) on commit drop;

insert into indicator_master_bootstrap (
  code, source_row, process_id, area, direction_objective, direction_metric,
  quality_objective, name, leader_name, metric_label, description,
  rule_type, target_min, target_max, target_value, unit,
  compliant_rule, marginal_rule, noncompliant_rule
) values
  ('IND-001', 6, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Mantener y mejorar continuamente nuestro Sistema de Gestión de la Calidad.', 'Acciones Correctivas', 'SGC', '≥90% de cierre', 'De Las acciones que se tienen en tiempo en el indicador de redbooth.', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-002', 7, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Mantener y mejorar continuamente nuestro Sistema de Gestión de la Calidad.', 'Cumplimiento con el programa de auditorías', 'SGC', '≥90% de realización', 'El porcentaje se obtiene de sacar el numero de auditorias completadas en el mes entre el numero de auditorias programadas.', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-003', 8, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Cumplimiento al programa de calibraciones', 'SGC PROCESO', '≥80% de cumplimiento', 'Se obtiene de sacar el numero de calibraciones y verificaciones completadas en el mes entre el numero de calibraciones y verificaciones programadas.', 'minimum', 80, null, null, 'percent', '>=80', '>=76,<80', '<76'),
  ('IND-004', 9, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Porcentaje de segundas', 'PROCESO', '≤2%', 'Porcentaje de segundas obtenido en el mes', 'maximum', null, 2, null, 'percent', '<=2', '>2,<=2.5', '>2.5'),
  ('IND-005', 10, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Acciones inmediatas de corrección', 'PROCESO / PROVEEDORES', '≥ 90% de cierre', 'De los reportes levantados en al matriz se toman los del mes que estén cerrado con menos 30 días como buenos (1), fuera de 30 días como malos (0)', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-006', 11, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Reclamaciones de clientes', 'IWM/AUDITOR CALIDAD CLIENTES', '<= 3', 'Tener máximo una reclamación mensual', 'maximum', null, 3, null, 'value', '<=3', '>3,<=4', '>4'),
  ('IND-007', 12, 'P-08', 'Calidad', 'Calidad', '<= 2%', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Cierre de acciones de RNCP', 'PROCESO / PROVEEDORES', '≥90% de cierre', 'De los reportes levantados en al matriz se tomar los del mes que estén cerrado con menos 15 días como buenos (1), fuera de 15 días como malos (0)', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-008', 13, 'P-08', 'Calidad', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Reprocesos de laboratorios', 'IWM/AUDITOR CALIDAD CLIENTES', '≤ 2', 'Tener máximo 2 reprocesos mensuales', 'maximum', null, 2, null, 'value', '<=2', '>2,<=3', '>3'),
  ('IND-009', 14, 'P-08', 'Calidad', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Reinspecciones', 'IWM/AUDITOR CALIDAD CLIENTES', '≤ 2', 'Tener máximo 2 reinspecciones mensuales', 'maximum', null, 2, null, 'value', '<=2', '>2,<=3', '>3'),
  ('IND-010', 15, 'P-09', 'Almacén', null, null, 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Rotación de materia prima', 'JEFE DE ALMACEN', '≤2.9%', 'En función de los consumos programados vs la entrada de MP', 'maximum', null, 2.9, null, 'percent', '<=2.9', '>2.9,<=3.4', '>3.4'),
  ('IND-011', 16, 'P-09', 'Almacén', null, null, 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Cumplimiento De inventario', 'JEFE DE ALMACEN', '≥95%', 'Cumplimiento de inventario de MP para producción', 'minimum', 95, null, null, 'percent', '>=95', '>=90.25,<95', '<90.25'),
  ('IND-012', 17, 'P-09', 'Almacén', null, null, 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Rotación de refacciones', 'JEFE DE ALMACEN', '≤1.01%', 'En función del costo de refacciones utilizadas en el periodo entre el promedio del inventario de refacciones', 'maximum', null, 1.01, null, 'percent', '<=1.01', '>1.01,<=1.51', '>1.51'),
  ('IND-013', 18, 'P-13', 'Tejido', null, null, null, 'Reducción de merma', 'JEFE DE PRODUCCIÓN', '≤2.5%', 'En función de la merma inicial menos la merma final', 'maximum', null, 2.5, null, 'percent', '<=2.5', '>2.5,<=3', '>3'),
  ('IND-014', 19, 'P-13', 'Tejido', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Porcentaje de segundas', 'JEFE DE PRODUCCIÓN', '≤1%', 'Porcentaje de segundas obtenido en el mes', 'maximum', null, 1, null, 'percent', '<=1', '>1,<=1.5', '>1.5'),
  ('IND-015', 20, 'P-13', 'Tejido', 'Utilidades', '$ 1M', null, 'Eficacia de producción', 'JEFE DE PRODUCCIÓN', '≥80%', 'En función de multiplicar la disponibilidad por rendimiento por calidad durante el mes.', 'minimum', 80, null, null, 'percent', '>=80', '>=76,<80', '<76'),
  ('IND-016', 21, 'P-13', 'Tejido', 'Utilidades', '$ 1M', null, 'Acciones inmediatas de corrección', 'JEFE DE PRODUCCIÓN', '≥90%', 'Cumplimiento de acciones inmediatas', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-017', 22, 'P-13', 'Tejido', 'Utilidades', '$ 1M', null, 'Inventario de julios urdidos en piso', 'JEFE DE PRODUCCIÓN', '>6000, <14000', 'Promedio diario del inventario de julios urdidos en piso', 'range', 6000, 14000, null, 'value', '>6000,<14000', '>=5300,<=6000;>=14000,<=14700', '<5300;>14700'),
  ('IND-018', 23, 'P-13', 'Tejido', 'Utilidades', '$ 1M', null, 'Inventario de Telas en Telares', 'JEFE DE PRODUCCIÓN', '>8000, <32000', 'Promedio diario del inventario de telas en telares', 'range', 8000, 32000, null, 'value', '>8000,<32000', '>=6400,<=8000;>=32000,<=33600', '<6400;>33600'),
  ('IND-019', 24, 'P-13', 'Tejido', 'Utilidades', '$ 1M', null, 'Inventario de telas engomadas en piso', 'JEFE DE PRODUCCIÓN', '>12000, <50000', 'Promedio diario del inventario de telas engomadas en piso', 'range', 12000, 50000, null, 'value', '>12000,<50000', '>=9500,<=12000;>=50000,<=52500', '<9500;>52500'),
  ('IND-020', 25, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Eficiencia de producción', 'JEFE DE TEÑIDO', '≥80%', 'En función de multiplicar la disponibilidad por rendimiento por calidad durante el mes.', 'minimum', 80, null, null, 'percent', '>=80', '>=76,<80', '<76'),
  ('IND-021', 26, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Reprocesos', 'JEFE DE TEÑIDO', '<= 2%', 'Tener máximo 2% reprocesos mensuales', 'maximum', null, 2, null, 'percent', '<=2', '>2,<=2.5', '>2.5'),
  ('IND-022', 27, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Porcentaje de segundas', 'JEFE DE TEÑIDO', '≤0.4%', 'Porcentaje de segundas obtenido en el mes', 'maximum', null, 0.4, null, 'percent', '<=0.4', '>0.4,<=0.9', '>0.9'),
  ('IND-023', 28, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Acciones inmediatas de corrección', 'JEFE DE TEÑIDO', '≥90%', 'Cumplimiento de acciones inmediatas', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-024', 29, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Inventario de tela humeda', 'JEFE DE TEÑIDO', '>1000, <12000', 'Promedio diario del inventario de tela humeda', 'range', 1000, 12000, null, 'value', '>1000,<12000', '>=400,<=1000;>=12000,<=12600', '<400;>12600'),
  ('IND-025', 30, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Inventario de telas en crudo', 'JEFE DE TEÑIDO', '>10000, <33000', 'Promedio diario del inventario de telas en crudo', 'range', 10000, 33000, null, 'value', '>10000,<33000', '>=8350,<=10000;>=33000,<=34650', '<8350;>34650'),
  ('IND-026', 31, 'P-17', 'Tintorería', 'Utilidades', '$ 1M', null, 'Inventario de telas en teñido', 'JEFE DE TEÑIDO', '>1000, <6000', 'Promedio diario del inventario de telas en teñido', 'range', 1000, 6000, null, 'value', '>1000,<6000', '>=700,<=1000;>=6000,<=6300', '<700;>6300'),
  ('IND-027', 32, 'P-22', 'Costura', 'Utilidades', '$ 1M', null, 'Eficiencia de producción', 'GERENTE DE COSTURA', '≥75%', 'En función de multiplicar la disponibilidad por rendimiento por calidad durante el mes.', 'minimum', 75, null, null, 'percent', '>=75', '>=71.25,<75', '<71.25'),
  ('IND-028', 33, 'P-22', 'Costura', 'Utilidades', '$ 1M', null, 'Composturas', 'GERENTE DE COSTURA', '≤3%', 'Porcentaje de composturas realizadas', 'maximum', null, 3, null, 'percent', '<=3', '>3,<=3.5', '>3.5'),
  ('IND-029', 34, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Porcentaje de segundas', 'GERENTE DE COSTURA', '≤0.5%', 'Porcentaje de segundas obtenido en el mes', 'maximum', null, 0.5, null, 'percent', '<=0.5', '>0.5,<=1', '>1'),
  ('IND-030', 35, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Acciones inmediatas de corrección', 'GERENTE DE COSTURA', '≥90%', 'Cumplimiento de acciones inmediatas', 'minimum', 90, null, null, 'percent', '>=90', '>=85.5,<90', '<85.5'),
  ('IND-031', 36, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Inventario de felpa en acabado', 'GERENTE DE COSTURA', '>1000, <16000', 'Promedio diario del inventario de felpas en acabado', 'range', 1000, 16000, null, 'value', '>1000,<16000', '>=200,<=1000;>=16000,<=16800', '<200;>16800'),
  ('IND-032', 37, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Inventario de felpa en corte de bata', 'GERENTE DE COSTURA', '>1000, <18000', 'Promedio diario del inventario de felpas en corte de bata', 'range', 1000, 18000, null, 'value', '>1000,<18000', '>=100,<=1000;>=18000,<=18900', '<100;>18900'),
  ('IND-033', 38, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Inventario de kg de bata', 'GERENTE DE COSTURA', '>1000, <12000', 'Promedio diario de felpa en corte de bata', 'range', 1000, 12000, null, 'value', '>1000,<12000', '>=400,<=1000;>=12000,<=12600', '<400;>12600'),
  ('IND-034', 39, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Inventario de toalla en acabado', 'GERENTE DE COSTURA', '>8000, <36000', 'Promedio diario de toalla en acabado', 'range', 8000, 36000, null, 'value', '>8000,<36000', '>=6200,<=8000;>=36000,<=37800', '<6200;>37800'),
  ('IND-035', 40, 'P-22', 'Costura', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', null, 'Inventario de toalla en taller', 'GERENTE DE COSTURA', '>7000, <20000', 'Promedio diario de toalla en taller', 'range', 7000, 20000, null, 'value', '>7000,<20000', '>=6000,<=7000;>=20000,<=21000', '<6000;>21000'),
  ('IND-036', 41, 'P-12', 'Mantenimiento', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Cumplimiento con el programa de mantenimiento', 'JEFE DE MANTTO', '≥ 95%', 'El porcentaje se obtiene de sacar el numero de mantenimientos realizados en el mes entre el numero de mantenimientos programados.', 'minimum', 95, null, null, 'percent', '>=95', '>=90.25,<95', '<90.25'),
  ('IND-037', 42, 'P-34', 'PT', 'Calidad', '<= 2%', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Cumplimiento de inventario', 'GERENTE DE LOGISTICA Y DISTRIBUCIÓN', '≥95%', 'Cumplimiento de inventario real vs inventario en sistema ax', 'minimum', 95, null, null, 'percent', '>=95', '>=90.25,<95', '<90.25'),
  ('IND-038', 43, 'P-01', 'Ventas', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Número de nuevos clientes', 'Coordinador de ventas', '≥3', 'Total de nuevos clientes adquiridos en un mes', 'minimum', 3, null, null, 'value', '>=3', '>=2,<3', '<2'),
  ('IND-039', 44, 'P-01', 'Ventas', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Retención de clientes', 'Coordinador de ventas', '≥80%', 'Porcentaje de clientes que continuan comprando en comparación con el periodo anterior', 'minimum', 80, null, null, 'percent', '>=80', '>=76,<80', '<76'),
  ('IND-040', 45, 'P-01', 'Ventas', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Errores en Flogs', 'Coordinador de ventas', '≤ 10', 'No más de 10 errores en la captura de datos en flogs', 'maximum', null, 10, null, 'value', '<=10', '>10,<=11', '>11'),
  ('IND-041', 46, 'P-01', 'Ventas', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Encuestas de Satisfacción', 'Coordinador de ventas', '≥9', 'Tener al menos 9 encuestas de satisfacción contestadas por el cliente', 'minimum', 9, null, null, 'value', '>=9', '>=8,<9', '<8'),
  ('IND-042', 47, 'P-11', 'Recursos Humanos', 'Reduccion de costos de Operación', '<= $ 5.00MXN / Kg', 'Capacitar y desarrollar a nuestro equipo para que alcance su máximo potencial.', 'Cumplimiento del programa de capacitación', 'Gerente de RRHH', '≥95%', 'Cumplir con al menos el 95% de los cursos programados', 'minimum', 95, null, null, 'percent', '>=95', '>=90.25,<95', '<90.25'),
  ('IND-043', 48, 'P-11', 'Recursos Humanos', 'Reduccion de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Vacantes administrativas', 'Gerente de RRHH', '≤ 2 semanas', 'Cubrir la vacante en un periodo menor a dos semanas', 'maximum', null, 2, null, 'weeks', '<=2', '>2,<=3', '>3'),
  ('IND-044', 49, 'P-11', 'Recursos Humanos', 'Reduccion de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Vacantes operativas', 'Gerente de RRHH', '≤ 1 semanas', 'Cubrir la vacante en un periodo menor a una semana', 'maximum', null, 1, null, 'weeks', '<=1', '>1,<=2', '>2'),
  ('IND-045', 50, 'P-11', 'Recursos Humanos', 'Reduccion de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Rotación del personal', 'Gerente de RRHH', '≤15%', 'No exceder del 15% la rotación del personal', 'maximum', null, 15, null, 'percent', '<=15', '>15,<=15.75', '>15.75'),
  ('IND-046', 51, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Auditorías 5 B s', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '≥95%', 'Cumplimiento al programa de auditorias de 5Bs', 'minimum', 95, null, null, 'percent', '>=95', '>=90.25,<95', '<90.25'),
  ('IND-047', 52, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', '0 Accidentes de trabajo incapacitantes', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '0', '0 Accidentes incapacitantes', 'exact', null, null, 0, 'value', '=0', '>=-1,<0;>0,<=1', '<-1;>1'),
  ('IND-048', 53, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.', 'Amonestaciones de seguridad', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '≥15', 'Vigilar las condiciones inseguras, tener al menos 15 reportes al trimestre.', 'minimum', 15, null, null, 'value', '>=15', '>=14,<15', '<14'),
  ('IND-049', 54, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Implementar prácticas sostenibles que protejan el medio ambiente.', 'Consumo energético', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '≥37500', 'Registrar el consumo energético de las operaciones de towel', 'minimum', 37500, null, null, 'value', '>=37500', '>=35625,<37500', '<35625'),
  ('IND-050', 55, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Implementar prácticas sostenibles que protejan el medio ambiente.', 'Mantener el cumplimiento normativo en materia de GEI', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '=100%', 'Mantener el cumplimiento normativo en materia de GEI', 'exact', null, null, 100, 'percent', '=100', '>=95,<100;>100,<=105', '<95;>105'),
  ('IND-051', 56, 'P-05', 'SMA', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Implementar prácticas sostenibles que protejan el medio ambiente.', 'Huella de carbono', 'JEFE DE SEGURIDAD E HIGIENE Y MEDIO AMBIENTE', '<2000', 'Registrar el CO2e en las operaciones de towel', 'maximum', null, 2000, null, 'value', '<2000', '>=2000,<=2100', '>2100'),
  ('IND-052', 57, 'P-04', 'Planeación', 'Reducción de costos de Operación', '<= $ 5.00MXN / Kg', 'Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.', 'Ordenes de cambio entregadas por día', 'Jefe de Planeación', '≥5', 'Entrega de ordenes diarias', 'minimum', 5, null, null, 'value', '>=5', '>=4,<5', '<4');

do $$
declare
  target_organization_id constant uuid := '00000000-0000-0000-0000-000000000001';
  bootstrap_actor_id uuid;
  existing_definition_count integer;
  invalid_process_ids text[];
begin
  if (select count(*) from indicator_master_bootstrap) <> 52 then
    raise exception 'Expected exactly 52 indicator master rows.';
  end if;

  if not exists (
    select 1 from public.organizations where id = target_organization_id
  ) then
    raise exception 'Target production organization does not exist.';
  end if;

  select count(*)
  into existing_definition_count
  from public.indicator_definitions
  where organization_id = target_organization_id
    and workspace_mode = 'production';

  if existing_definition_count not in (0, 52) then
    raise exception
      'Expected zero definitions before first bootstrap or the exact 52-row master on retry; found %.',
      existing_definition_count;
  end if;

  if existing_definition_count = 52 and exists (
    select code
    from (
      select code
      from public.indicator_definitions
      where organization_id = target_organization_id
        and workspace_mode = 'production'
      except
      select code from indicator_master_bootstrap
    ) unexpected
    union all
    select code
    from (
      select code from indicator_master_bootstrap
      except
      select code
      from public.indicator_definitions
      where organization_id = target_organization_id
        and workspace_mode = 'production'
    ) missing
  ) then
    raise exception 'Existing production indicator codes do not match the controlled master.';
  end if;

  select pg_catalog.array_agg(master.process_id order by master.process_id)
  into invalid_process_ids
  from (
    select distinct source.process_id
    from indicator_master_bootstrap source
    left join public.processes process
      on process.id = source.process_id
     and process.organization_id = target_organization_id
     and process.active
    where process.id is null
  ) master;

  if invalid_process_ids is not null then
    raise exception 'Invalid production process ids: %', invalid_process_ids;
  end if;

  select id
  into bootstrap_actor_id
  from public.profiles
  where organization_id = target_organization_id
    and workspace_mode = 'production'
    and user_type = 'administrator'
    and status = 'active'
  order by created_at, id
  limit 1;

  if bootstrap_actor_id is null then
    raise exception 'An active production administrator is required for bootstrap attribution.';
  end if;

  insert into public.indicator_definitions (
    code, source_row, process_id, area, direction_objective, direction_metric,
    quality_objective, name, leader_name, owner_name_snapshot, metric_label,
    description, periodicity, active, organization_id, area_id, workspace_mode,
    created_by, updated_by
  )
  select
    source.code, source.source_row, source.process_id, source.area,
    source.direction_objective, source.direction_metric, source.quality_objective,
    source.name, source.leader_name, source.leader_name, source.metric_label,
    source.description, 'quarterly', true, target_organization_id, process.area_id,
    'production', bootstrap_actor_id, bootstrap_actor_id
  from indicator_master_bootstrap source
  join public.processes process on process.id = source.process_id
  on conflict (organization_id, workspace_mode, code) do update set
    source_row = excluded.source_row,
    process_id = excluded.process_id,
    area = excluded.area,
    direction_objective = excluded.direction_objective,
    direction_metric = excluded.direction_metric,
    quality_objective = excluded.quality_objective,
    name = excluded.name,
    leader_name = excluded.leader_name,
    owner_name_snapshot = excluded.owner_name_snapshot,
    metric_label = excluded.metric_label,
    description = excluded.description,
    periodicity = excluded.periodicity,
    active = true,
    area_id = excluded.area_id,
    updated_by = bootstrap_actor_id;

  insert into public.indicator_definition_processes (indicator_id, process_id)
  select definition.id, source.process_id
  from indicator_master_bootstrap source
  join public.indicator_definitions definition
    on definition.organization_id = target_organization_id
   and definition.workspace_mode = 'production'
   and definition.code = source.code
  on conflict (indicator_id, process_id) do nothing;

  insert into public.indicator_evaluation_rules (
    indicator_id, rule_type, target_min, target_max, target_value,
    marginal_tolerance_percent, unit, compliant_rule, marginal_rule,
    noncompliant_rule, updated_by
  )
  select
    definition.id, source.rule_type, source.target_min, source.target_max,
    source.target_value, 5, source.unit, source.compliant_rule,
    source.marginal_rule, source.noncompliant_rule, bootstrap_actor_id
  from indicator_master_bootstrap source
  join public.indicator_definitions definition
    on definition.organization_id = target_organization_id
   and definition.workspace_mode = 'production'
   and definition.code = source.code
  on conflict (indicator_id) do update set
    rule_type = excluded.rule_type,
    target_min = excluded.target_min,
    target_max = excluded.target_max,
    target_value = excluded.target_value,
    marginal_tolerance_percent = excluded.marginal_tolerance_percent,
    unit = excluded.unit,
    compliant_rule = excluded.compliant_rule,
    marginal_rule = excluded.marginal_rule,
    noncompliant_rule = excluded.noncompliant_rule,
    updated_by = bootstrap_actor_id;

  insert into public.indicator_periods (
    indicator_id, year, quarter, scheduled_date, opens_at, closes_at,
    created_by, updated_by
  )
  select
    definition.id,
    calendar.year,
    calendar.quarter::public.quarter_code,
    calendar.scheduled_date,
    calendar.opens_at,
    calendar.closes_at,
    bootstrap_actor_id,
    bootstrap_actor_id
  from indicator_master_bootstrap source
  join public.indicator_definitions definition
    on definition.organization_id = target_organization_id
   and definition.workspace_mode = 'production'
   and definition.code = source.code
  cross join lateral (
    select
      requested_year as year,
      quarter_data.quarter,
      pg_catalog.make_date(
        requested_year,
        quarter_data.scheduled_month,
        quarter_data.scheduled_day
      ) as scheduled_date,
      pg_catalog.make_timestamptz(
        requested_year + quarter_data.capture_year_offset,
        quarter_data.capture_month,
        1, 0, 0, 0, 'America/Mexico_City'
      ) as opens_at,
      pg_catalog.make_timestamptz(
        requested_year + quarter_data.capture_year_offset,
        quarter_data.capture_month,
        15, 23, 59, 59.999999, 'America/Mexico_City'
      ) as closes_at
    from pg_catalog.generate_series(2026, 2028) requested_year
    cross join (
      values
        ('Q1', 3, 31, 4, 0),
        ('Q2', 6, 30, 7, 0),
        ('Q3', 9, 30, 10, 0),
        ('Q4', 12, 31, 1, 1)
    ) quarter_data(quarter, scheduled_month, scheduled_day, capture_month, capture_year_offset)
  ) calendar
  on conflict (indicator_id, year, quarter) do update set
    scheduled_date = excluded.scheduled_date,
    opens_at = excluded.opens_at,
    closes_at = excluded.closes_at,
    updated_by = bootstrap_actor_id;

  if (
    select count(*)
    from public.indicator_definitions
    where organization_id = target_organization_id
      and workspace_mode = 'production'
  ) <> 52 then
    raise exception 'Indicator bootstrap postcondition failed: definitions.';
  end if;

  if (
    select count(*)
    from public.indicator_definition_processes relation
    join public.indicator_definitions definition on definition.id = relation.indicator_id
    where definition.organization_id = target_organization_id
      and definition.workspace_mode = 'production'
  ) <> 52 then
    raise exception 'Indicator bootstrap postcondition failed: process relations.';
  end if;

  if (
    select count(*)
    from public.indicator_evaluation_rules rule
    join public.indicator_definitions definition on definition.id = rule.indicator_id
    where definition.organization_id = target_organization_id
      and definition.workspace_mode = 'production'
  ) <> 52 then
    raise exception 'Indicator bootstrap postcondition failed: evaluation rules.';
  end if;

  if (
    select count(*)
    from public.indicator_periods period
    join public.indicator_definitions definition on definition.id = period.indicator_id
    where definition.organization_id = target_organization_id
      and definition.workspace_mode = 'production'
  ) <> 624 then
    raise exception 'Indicator bootstrap postcondition failed: periods.';
  end if;

  if exists (
    select 1
    from public.indicator_results result
    join public.indicator_periods period on period.id = result.period_id
    join public.indicator_definitions definition on definition.id = period.indicator_id
    where definition.organization_id = target_organization_id
      and definition.workspace_mode = 'production'
  ) then
    raise exception 'Indicator bootstrap must not create or alter results.';
  end if;
end;
$$;

commit;
