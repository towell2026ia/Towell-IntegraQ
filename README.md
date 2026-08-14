# Towell IntegraQ

IntegraQ es la plataforma web de Towell para centralizar la operacion del
Sistema de Gestion de Calidad. El proyecto organiza procesos, informacion
documentada, indicadores, auditorias, acciones correctivas y relaciones con
clientes y proveedores desde una sola interfaz.

> Estado actual: prototipo funcional de frontend. La autenticacion y la
> persistencia definitiva en Supabase se conectaran en una siguiente etapa.

## Modulos disponibles

- Inicio y bandeja de pendientes.
- Metro Map de procesos y subprocesos.
- Organizacion, puestos, usuarios y acceso por proceso.
- Informacion documentada por proceso y tipo documental.
- Formularios digitales con dashboard, estructura y exportacion de datos.
- Objetivos e indicadores trimestrales.
- Root2Cause, CAPA y reporte A3.
- Gestion de calidad de clientes y portal del cliente.
- Gestion de calidad de proveedores y portal de proveedores.
- Calibraciones y verificaciones.
- Asistencia de IA para analisis de causa raiz mediante integracion server-to-server.

## Control documental

La informacion documentada se consulta con la jerarquia:

```text
Proceso -> Tipo documental -> Documento -> Revision
```

Cada tipo documental tiene su propia tabla. No existe un listado maestro que
mezcle procesos o categorias. Las tablas muestran documento, codigo, revision,
responsable de carga, validador, fecha de modificacion, estado y acciones.

El flujo soportado en frontend es:

```text
Borrador -> En validacion -> Vigente
                     |-> Rechazado -> En validacion
```

La aprobacion publica la nueva revision y vuelve obsoleta la revision vigente
anterior. El historial completo de versiones se reserva al administrador.

## Permisos

Existen dos tipos base de usuario:

- `Administrador`: acceso total a modulos, procesos, catalogos, validacion e
  historial documental.
- `Usuario`: acceso unicamente a procesos y acciones asignados. Consultar,
  cargar, editar, enviar y validar son permisos independientes.

Estas reglas ya se aplican en el frontend. Cuando se conecte Supabase tambien
deberan aplicarse en el servidor mediante politicas RLS y validaciones de API.

## Tecnologia

- Next.js 16 y React 19.
- TypeScript.
- Lucide React para iconografia.
- Vitest para pruebas unitarias.
- ESLint.
- PWA con manifiesto web.

## Requisitos

- Node.js 20 o superior.
- pnpm 11.

## Instalacion

```powershell
git clone https://github.com/towell2026ia/Towell-IntegraQ.git
cd Towell-IntegraQ
pnpm install
```

Crea `.env.local` a partir de `.env.example` y configura solamente las
integraciones que vayas a utilizar:

```text
INTEGRAQ_AI_ENDPOINT=
INTEGRAQ_AI_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Nunca publiques `.env.local` ni credenciales reales en Git.

## Desarrollo local

```powershell
pnpm dev
```

La aplicacion queda disponible en [http://localhost:3000](http://localhost:3000).

## Verificacion

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Estructura principal

```text
src/app/                  App Router, estilos globales y API server-to-server
src/components/           Shell, navegacion y modulos de la aplicacion
src/lib/                  Catalogos, reglas de acceso, dominio y datos de demo
public/                   Logotipos y activos publicos
data/metromap/            Fuente editable del Metro Map
docs/                     Arquitectura y notas tecnicas
```

## Integracion de IA

La API key nunca se entrega al navegador. IntegraQ envia solicitudes desde
`/api/ai/root-cause`, normaliza la respuesta y presenta las sugerencias como
borradores sujetos a validacion humana. Si no hay un endpoint configurado, el
modulo utiliza una respuesta local identificada como demostracion.

## Persistencia

El prototipo utiliza datos de demostracion y, en algunos modulos,
`localStorage`. Supabase sera responsable de autenticacion, Postgres, Storage,
historial, notificaciones y politicas de acceso cuando comience la etapa de
backend.

## Uso

Proyecto de uso interno de Towell. La publicacion del codigo no concede derechos
de uso sobre marcas, documentos, procesos o informacion operativa de la empresa.
