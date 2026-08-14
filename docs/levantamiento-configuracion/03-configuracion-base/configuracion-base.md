# Configuracion base

## Tipos de usuario

| Tipo | Descripcion | Acceso esperado | Confirmado |
|---|---|---|---|
| Interno administrador | Configura plataforma, catalogos y permisos | Administracion completa | No |
| Interno responsable de proceso | Autoriza registros y consulta indicadores | Su proceso o area | No |
| Interno capturista | Crea y actualiza registros asignados | Formularios autorizados | No |
| Interno auditor | Ejecuta auditorias y registra evidencia | Auditorias asignadas | No |
| Interno consulta | Consulta informacion autorizada | Solo lectura | No |
| Cliente externo | Consulta reclamos y evidencias autorizadas | Solo lectura | No |
| Proveedor externo | Captura causas, acciones y evidencias | Casos asignados | No |

## Datos requeridos por usuario

- Nombre.
- Correo o identificador de acceso.
- Tipo de usuario.
- Empresa u organizacion.
- Area.
- Proceso.
- Puesto.
- Rol.
- Responsable superior.
- Estado de la cuenta.

## Areas y procesos

Por cada area se debe identificar:

- Nombre oficial.
- Responsable.
- Procesos asociados.
- Usuarios pertenecientes.
- Clientes internos.
- Proveedores internos.

## Matriz de permisos

Los permisos se definiran por accion:

- Ver.
- Crear.
- Editar borradores.
- Enviar a revision.
- Revisar.
- Aprobar o rechazar.
- Cerrar.
- Reabrir.
- Exportar.
- Administrar catalogos.
- Consultar dashboard.

## Catalogos iniciales

- Areas.
- Procesos y subprocesos.
- Puestos.
- Tipos de usuario.
- Roles.
- Clientes.
- Proveedores.
- Tipos de documento.
- Estados de registro.
- Prioridades.
- Origenes de no conformidad.
