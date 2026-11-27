// Uses the populated RE-04 fixture and its SQL executor; no connection to production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
export async function testReviewReports(
  {
    execute,
    session,
    admin,
    director,
    viewer,
    external,
    other,
    org,
    check,
    native,
  },
) {
  await execute(
    "do $$begin if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin;end if;end$$;",
  );
  await execute(
    readFileSync("docs/database/proposals/IQ-RE-05-INFORMES.sql", "utf8"),
  );
  await check(
    admin,
    "not public.iq_re05_available()",
    "RE05 presupuesto inicial cero",
  );
  await check(
    admin,
    "exists(select from public.iq_review_periods() y where y=2025)",
    "Actas RE-03 disponibles después de la migración",
  );
  await check(
    admin,
    "exists(select from public.iq_re04_years())",
    "Acuerdos RE-04 disponibles después de la migración",
  );
  const organization = org(1), year = 2025, model = "gpt-4.1-mini-2025-04-14";
  const snap = {
    year,
    organization,
    actor: admin,
    fingerprint: "a".repeat(64),
  };
  const reserve = (id, s = snap) =>
    "select public.iq_re05_reserve('" + id + "','" + JSON.stringify(s) + "','" +
    model + "','RE-05.1')";
  const service = (q) =>
    execute("begin;set local role service_role;" + q + ";commit;");
  const run = randomUUID();
  await assert.rejects(service(reserve(run)), /UNAVAILABLE/);
  // Roll back the explicit transaction left open by the embedded SQL driver after errors.
  async function reset() {
    if (!native) await execute("rollback");
  }
  await reset();
  await execute(
    "insert into public.review_report_allowances values('" + organization +
      "',now()+interval '1 day',3,'openai','" + model + "')",
  );
  await assert.rejects(
    execute(session(admin, reserve(run))),
    /permission denied/,
  );
  await reset();
  await Promise.all([service(reserve(run)), service(reserve(randomUUID()))]);
  await check(
    admin,
    "(select count(*)=1 from public.review_report_runs)",
    "RE05 reserva concurrente única",
  );
  // Locate the winner without assuming which connection acquired the lock.
  const win = "(select id from public.review_report_runs limit 1)";
  await execute(
    "select public.iq_re05_finish(" + win +
      ',\'completed\',\'{"sections":[],"proposals":[{"id":"P1","finding":"F1","title":"Revisar recurso","description":"Verificar la necesidad documentada"}]}\',100,50)',
  );
  const change = (cmd, seq, id = randomUUID()) =>
    "select public.iq_re05_review('" + id + "'," + win + "," + seq + ",'" +
    cmd + "','Motivo de prueba','Conclusión revisada',null)";
  await assert.rejects(
    execute(session(viewer, change("authorize", 0))),
    /DENIED/,
  );
  await reset();
  await Promise.all([
    service(reserve(randomUUID())),
    service(reserve(randomUUID())),
  ]);
  await check(
    admin,
    "(select count(*)=1 from public.review_report_runs)",
    "RE05 resultado existente al recuperar la sesión",
  );
  for (const actor of [external, other, viewer]) {
    await check(
      actor,
      "not exists(select from public.review_report_runs)",
      "RE05 aislamiento",
    );
  }
  if (native) {
    const competing = () =>
      execute(session(admin, change("edit", 0) + ";select pg_sleep(.15)"));
    const writes = await Promise.allSettled([competing(), competing()]);
    assert.equal(writes.filter((w) => w.status === "fulfilled").length, 1);
    assert.match(
      writes.find((w) => w.status === "rejected").reason.message,
      /CHANGED/,
    );
  } else await execute(session(admin, change("edit", 0)));
  await execute(session(admin, change("submit", 1)));
  await execute(session(admin, change("validate", 2)));
  await assert.rejects(
    execute(session(admin, change("authorize", 3))),
    /DENIED/,
  );
  await reset();
  await execute(session(director, change("authorize", 3)));
  await assert.rejects(execute(session(admin, change("edit", 4))), /DENIED/);
  await reset();
  await check(
    director,
    "(select count(*)=1 from public.review_report_events where stage='authorized' and length(content_hash)=64)",
    "RE05 aprobación con huella y atribuciones",
  );
  const proposalId = randomUUID();
  const convert = "select public.iq_re05_review('" + proposalId + "'," + win +
    ",4,'proposal','Revisión humana',null,'P1')";
  await execute(session(admin, convert));
  await execute(session(admin, convert));
  await check(
    admin,
    "(select count(*)=1 from public.review_report_events e join public.management_review_decisions d on d.id=e.decision_id where e.proposal='P1' and d.auth_state='draft')",
    "Una propuesta explícita crea un solo borrador RE-04",
  );
  await check(
    admin,
    "exists(select from public.iq_re05_years() y where y=2025)",
    "Expediente oficial catalogado por año",
  );
  await service(
    reserve(randomUUID(), { ...snap, fingerprint: "b".repeat(64) }),
  );
  await execute(
    "select public.iq_re05_finish(id,'completed','{}',90,30) from public.review_report_runs where state='processing'",
  );
  await check(
    admin,
    "(select count(*)=2 and min(revision)=1 and max(revision)=2 from public.review_report_runs where state='completed')",
    "Una fotografía distinta conserva ambas versiones",
  );
  await service(
    reserve(randomUUID(), { ...snap, fingerprint: "d".repeat(64) }),
  );
  await execute(
    "select public.iq_re05_finish(id,'uncertain',null,null,null) from public.review_report_runs where state='processing'",
  );
  await service(
    reserve(randomUUID(), { ...snap, fingerprint: "c".repeat(64) }),
  );
  await check(
    admin,
    "(select count(*)=3 from public.review_report_runs)",
    "RE05 sin repetición tras fallo incierto",
  );
  console.log(
    "RE05: COMMIT, aislamiento, reserva, recuperación, edición y autorización comprobados.",
  );
  // Keep the complete RE-05 transition tests above, then install IA-01 on the same fixture.
  await execute(readFileSync("docs/database/proposals/IQ-IA-01-MODELO.sql", "utf8"));
  await execute("update public.review_report_allowances set model='gpt-6-luna',monthly_generations=20");
  const annual = { ...snap, year: 2024 };
  const luna = (id, fingerprint = annual.fingerprint) =>
    reserve(id, { ...annual, fingerprint }).replace(model, "gpt-6-luna");
  const available = "public.iq_ia01_available(2024,'gpt-6-luna')";
  const first = randomUUID();
  await assert.rejects(service(luna(first)), /PROCESSING_NOT_AUTHORIZED/);
  await reset();
  await check(admin, "not " + available, "IA01 tratamiento pendiente");
  await execute("update public.review_report_allowances set luna_processing_authorized_at=now()");
  await check(admin, available, "IA01 presupuesto, tratamiento y cupo ordinario");
  await Promise.all([service(luna(first)), service(luna(first))]);
  const complete = (id) => execute("select public.iq_re05_finish('" + id + "','completed','{}',100,40)");
  await complete(first);
  await check(admin, "not " + available, "IA01 cupo anual agotado");
  await service(luna(first));
  await assert.rejects(service(luna(randomUUID(), "e".repeat(64))), /ANNUAL_LIMIT/);
  await reset();
  const grant = "insert into public.review_report_extra_approvals(organization_id,year,generation_number,authorized_by,reason) values('" +
    organization + "',2024,2,'" + admin + "','Autorización expresa de prueba aislada')";
  await assert.rejects(execute(session(admin,grant)), /permission denied/);
  await reset();
  await execute(grant);
  await check(admin, available, "IA01 autorización extraordinaria de un solo uso");
  const extra = randomUUID();
  await Promise.all([service(luna(extra)),service(luna(extra))]);
  await complete(extra);
  await service(luna(extra));
  await check(admin, "(select count(*)=2 and count(cost_usd)=0 and sum(input_tokens)=200 from public.review_report_runs where year=2024)",
    "IA01 dos operaciones únicas sin imputar la tarifa anterior");
  await assert.rejects(service(luna(randomUUID(), "f".repeat(64))), /ANNUAL_LIMIT/);
  await reset();
  await check(admin, "not " + available, "IA01 autorización extraordinaria agotada");

}
