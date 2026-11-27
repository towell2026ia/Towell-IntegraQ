// Run against the existing embedded PostgreSQL fixture, or the existing isolated CI service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const read = (p) => readFileSync(p, "utf8");
const native = process.argv.includes("--native");
let embedded;
if (native) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.PGHOST, "127.0.0.1");
  assert.equal(process.env.PGDATABASE, "document_replacement_test");
  assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
} else {
  const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
  embedded = await PGlite.create();
}
async function execute(query) {
  if (embedded) {
    try {
      return await embedded.exec(query);
    } catch (error) {
      throw new Error(
        [error.message, error.detail, error.where, error.position]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"]);
    let out = "";
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (out += x));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(out)),
    );
    child.stdin.end(query);
  });
}
const base = read("supabase/tests/document-replacement-fixture.sql");
if (embedded) {
  await execute(base);
  await execute(read("supabase/tests/re03-document-fixture-extension.sql"));
  await execute(read("docs/database/proposals/IQ-RE-03-DOCUMENTACION.sql"));
}
await execute(`alter table public.file_objects add column if not exists created_at timestamptz default now();
 alter table public.profiles add column position_id text, add column position_name text, add column full_name text;
 alter table public.processes add column name text;
 create table public.positions(id text primary key, organization_id uuid, active boolean);
 create table public.management_reviews(id uuid primary key,year integer,generated_by uuid,ai_mode text,period_label text);
 create table public.management_review_source_links(id uuid primary key,review_id uuid references public.management_reviews(id),source_type text);
 create type public.action_item_status as enum('pending','in_progress','completed','cancelled');`);
const baseline = read(
  "supabase/migrations/202608230005_metrology_improvement_management.sql",
);
await execute(
  baseline.match(
    /create table public\.management_review_decisions \([\s\S]*?\n\);/,
  )[0],
);
await execute(`alter table public.management_review_decisions enable row level security;
 grant select on public.management_reviews to authenticated;
 ${baseline.match(/create policy management_decisions_select_scope[\s\S]*?\);/)[0]}
 ${baseline.match(/create policy management_decisions_write_scope[\s\S]*?with check \([\s\S]*?\);/)[0]}
 grant select,insert,update,delete on public.management_review_decisions to authenticated;
 insert into public.positions values('PU-02','00000000-0000-4000-8000-000000000001',true);`);
const user = (n) => "10440000-0000-4000-8000-" + String(n).padStart(12, "0");
const org = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const [admin, director, assignee, viewer, external, other] = [
  1, 2, 3, 4, 5, 6,
].map(user);
for (const [i, role] of [
  "administrator",
  "internal",
  "internal",
  "internal",
  "supplier",
  "administrator",
].entries()) {
  const id = user(i + 1);
  await execute(`insert into public.profiles(id,organization_id,user_type,status,position_id,full_name) values('${id}','${org(i === 5 ? 2 : 1)}','${role}','active',${i === 1 ? "'PU-02'" : "null"},'Persona ${i + 1}');
 insert into public.user_module_action_permissions values('${id}','management-review','view');`);
}
await execute(
  `insert into public.user_module_action_permissions values('${director}','management-review','approve'),('${assignee}','management-review','update');`,
);
const report = randomUUID(),
  legacy = randomUUID();
await execute(`insert into public.management_reviews values('${report}',2025,'${admin}','external','2025');
 insert into public.management_review_decisions(id,review_id,description,priority,due_date) values('${legacy}','${report}','Original','low','2025-01-01');`);
await execute(read("docs/database/proposals/IQ-RE-04-SALIDAS.sql"));
const session = (actor, query) =>
  `begin;set local role authenticated;set local request.jwt.claim.sub='${actor}';${query};commit;`;
async function check(actor, predicate, label) {
  await execute(
    session(actor, `select public.test_assert((${predicate}),'RE04 ${label}')`),
  );
  console.log("PASS", label);
}
const decision = randomUUID(),
  action = randomUUID(),
  second = randomUUID();
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const rpc = (
  cmd,
  revision,
  detail = {},
  act = null,
  id = decision,
  op = randomUUID(),
) =>
  `select public.iq_re04_send('${op}','${id}',${act ? literal(act) : "null"},'${cmd}',${revision},${literal(JSON.stringify(detail))}::jsonb)`;
const send = (actor, ...args) => execute(session(actor, rpc(...args)));
async function denied(actor, query, pattern) {
  try {
    await execute(session(actor, query));
  } catch (e) {
    if (embedded) await execute("rollback;");
    assert.match(e.message, pattern);
    return;
  }
  assert.fail("Expected a rejected operation");
}
const payload = {
  year: 2025,
  date: "2025-02-01",
  classification: "improvement",
  section: "suppliers",
  priority: "high",
  title: "Revisar el programa de auditorías",
  description: "Revisar la cobertura de los procesos en el programa anual.",
  actionable: true,
  due: "2025-10-01",
  owner: assignee,
  review: report,
};
const create = rpc("create", 0, payload);
await execute(session(admin, create));
await execute(session(admin, create));
await check(
  admin,
  `(select count(*)=1 from public.management_review_decisions where id='${decision}' and folio='RPD-2025-0001' and revision=1)`,
  "folio y reintento conservan identidad",
);
await check(
  admin,
  `exists(select from public.management_review_decisions where id='${legacy}' and origin_year is null and description='Original')`,
  "compatibilidad con históricos",
);
await check(
  admin,
  "jsonb_array_length(public.iq_re04_context()->'people')>0",
  "catálogo autorizado",
);
await denied(
  admin,
  rpc("create", 0, { ...payload, title: "" }, null, randomUUID()),
  /constraint/i,
);
await denied(
  admin,
  rpc("create", 0, { ...payload, historic: true }, null, randomUUID()),
  /HISTORIC/,
);
await denied(assignee, rpc("create", 0, payload, null, randomUUID()), /DENIED/);
await check(
  other,
  `not exists(select from public.management_review_decisions where id='${decision}')`,
  "aislamiento entre organizaciones",
);
await check(external, "public.iq_re04_org() is null", "exclusión externa");
await check(
  admin,
  "exists(select from public.iq_re04_years() y where y=2025)",
  "años de origen disponibles",
);
await send(
  admin,
  "action",
  1,
  {
    description: "Revisar la cobertura por proceso",
    start: "2025-03-01",
    due: "2025-06-01",
    owner: assignee,
  },
  action,
);
await send(
  admin,
  "action",
  2,
  {
    description: "Revisar la disponibilidad de auditores",
    start: "2025-03-01",
    due: "2025-06-01",
    owner: viewer,
  },
  second,
);
await send(admin, "submit", 3);
await denied(admin, rpc("authorize", 4), /APPROVAL/);
await send(director, "authorize", 4);
await check(
  assignee,
  `(select count(*)=2 from public.review_output_actions where decision_id='${decision}')`,
  "responsable principal consulta el plan completo",
);
await check(
  viewer,
  `(select count(*)=1 from public.review_output_actions where decision_id=\'${decision}\')`,
  "responsable de acción sólo consulta su actividad",
);
await denied(
  viewer,
  rpc("progress", 5, { progress: 30, note: "Parcial" }, second),
  /PROGRESS/,
);
await send(
  assignee,
  "progress",
  5,
  { progress: 35, note: "Primera actualización" },
  action,
);
await denied(
  admin,
  rpc("assign", 5, { owner: viewer, note: "Modificación obsoleta" }),
  /CHANGED|unique constraint/,
);
await send(
  assignee,
  "progress",
  6,
  {
    progress: 100,
    note: "Terminada",
    result: "Resultado",
    actual: "2025-05-01",
  },
  action,
);
await denied(
  admin,
  rpc("close", 7, { note: "Cierre anticipado" }),
  /INCOMPLETE/,
);
await send(admin, "validate_action", 7, { note: "Resultado revisado" }, action);
await send(admin, "cancel_action", 8, { note: "Motivo documentado" }, second);
await send(director, "close", 9, { note: "Conclusión documentada" });
await send(admin, "reopen", 10, { note: "Revisar de nuevo" });
await check(
  admin,
  `(select count(*)=11 from public.review_output_events where decision_id='${decision}')`,
  "historial conserva conclusión y reapertura",
);
await check(
  assignee,
  `exists(select from public.management_review_decisions where id='${decision}' and revision=11)`,
  "consulta en nueva transacción",
);
await execute(
  session(
    admin,
    `update public.management_review_decisions set title='No permitido' where id='${decision}'`,
  ),
);
await check(
  admin,
  `exists(select from public.management_review_decisions where id='${decision}' and title='Revisar el programa de auditorías')`,
  "escritura directa protegida",
);
await execute(
  `update public.profiles set status='inactive' where id='${assignee}';`,
);
await check(
  assignee,
  `not exists(select from public.management_review_decisions where id='${decision}')`,
  "el cambio de permisos surte efecto",
);
const info = randomUUID();
await send(
  admin,
  "create",
  0,
  {
    ...payload,
    classification: "resources",
    title: "Decisión informativa",
    actionable: false,
    due: null,
    owner: viewer,
  },
  null,
  info,
);
await send(admin, "submit", 1, {}, null, info);
await send(director, "authorize", 2, {}, null, info);
await send(
  admin,
  "close",
  3,
  { note: "Resolución validada sin plan" },
  null,
  info,
);
await check(
  admin,
  `exists(select from public.management_review_decisions where id='${info}' and execution='completed')`,
  "cierre informativo documentado",
);
const cancelled = randomUUID();
await send(
  admin,
  "create",
  0,
  { ...payload, classification: "change", owner: viewer },
  null,
  cancelled,
);
await denied(admin, rpc("cancel", 1, {}, null, cancelled), /CANCEL/);
await send(admin, "cancel", 1, { note: "Motivo documentado" }, null, cancelled);
await check(
  admin,
  `exists(select from public.management_review_decisions where id='${cancelled}' and folio='RPD-2025-0003' and auth_state='cancelled')`,
  "cancelación mantiene folio y motivo",
);
const minutes = randomUUID(),
  captured = randomUUID();
await execute(`insert into public.file_objects(id,module_id,resource_type,resource_key,original_name,uploaded_by,workspace_id)
 values('${minutes}','management-review','management_review_minutes','2025','F-SGC-34.pdf','${admin}','${org(1)}');`);
await check(
  admin,
  "exists(select from public.iq_review_periods() y where y=2025)",
  "RE-03 conserva la consulta de actas tras instalar RE-04",
);
const historical = {
  ...payload,
  owner: viewer,
  historic: true,
  item: "Pág. 2, inciso A",
  file: minutes,
};
await send(admin, "create", 0, historical, null, captured);
await denied(
  admin,
  rpc("create", 0, historical, null, randomUUID()),
  /unique constraint/,
);
await check(
  admin,
  `exists(select from public.management_review_decisions where id='${captured}' and historic and auth_state='draft' and evidence_file_id='${minutes}')`,
  "conciliación por referencia al acta sin duplicar ni autorizar automáticamente",
);
const restricted = randomUUID();
await send(
  admin,
  "create",
  0,
  { ...payload, process: "P-TEST", owner: viewer },
  null,
  restricted,
);
await send(admin, "submit", 1, {}, null, restricted);
await denied(director, rpc("authorize", 2, {}, null, restricted), /DENIED/);
await execute(
  `insert into public.user_process_permissions(user_id,process_id,document_role) values('${director}','P-TEST','viewer');`,
);
await send(director, "authorize", 2, {}, null, restricted);
await check(
  viewer,
  `not exists(select from public.management_review_decisions where id='${restricted}')`,
  "la asignación no concede permiso sobre el proceso",
);
if (embedded) {
  const same = rpc("assign", 11, {
    owner: viewer,
    note: "Cambio de responsable",
  });
  await Promise.all([
    execute(session(admin, same)),
    execute(session(admin, same)),
  ]);
  await check(
    admin,
    `(select revision=12 from public.management_review_decisions where id='${decision}')`,
    "dos reintentos desde el cliente local conservan un recibo",
  );
}
if (native) {
  const identical = rpc("assign", 11, {
    owner: viewer,
    note: "Responsable vigente",
  });
  const run = (q) => execute(session(admin, q + ";select pg_sleep(0.15)"));
  await Promise.all([run(identical), run(identical)]);
  await check(
    admin,
    `(select revision=12 from public.management_review_decisions where id='${decision}')`,
    "dos conexiones con la misma operación",
  );
  const competing = () =>
    run(rpc("assign", 12, { owner: viewer, note: "Confirmación documentada" }));
  const results = await Promise.allSettled([competing(), competing()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /CHANGED|unique constraint/,
  );
  await check(
    admin,
    `(select revision=13 from public.management_review_decisions where id='${decision}')`,
    "dos conexiones con la misma revisión",
  );
  const newIds = [randomUUID(), randomUUID()];
  await Promise.all(
    newIds.map((id) =>
      run(rpc("create", 0, { ...payload, owner: viewer }, null, id)),
    ),
  );
  await check(
    admin,
    `(select count(distinct folio)=2 from public.management_review_decisions where id in ('${newIds.join("','")}'))`,
    "folios concurrentes independientes",
  );
}
if (embedded && process.argv.includes("--visual-fixture")) {
  await execute(
    `set role authenticated; set request.jwt.claim.sub=\'${admin}\';`,
  );
  const [result] = await embedded
    .query(
      `select jsonb_build_object(
  'rows',(select jsonb_agg(to_jsonb(d)) from public.management_review_decisions d where d.origin_year is not null),
  'actions',(select jsonb_agg(to_jsonb(a)) from public.review_output_actions a),
  'events',(select jsonb_agg(to_jsonb(e) order by expected_revision) from public.review_output_events e),
  'ctx',public.iq_re04_context()) as fixture`,
    )
    .then((x) => x.rows);
  console.log(JSON.stringify(result.fixture));
}
await embedded?.close();
