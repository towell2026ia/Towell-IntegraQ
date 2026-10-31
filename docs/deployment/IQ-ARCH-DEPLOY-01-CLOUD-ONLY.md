# IQ-ARCH-DEPLOY-01 — Cloud only / STB-01

This policy supersedes local PostgreSQL, pooler, Docker, db push and production DB URL instructions in older runbooks. Do not execute those instructions from a developer/user computer. AGENTS.md records the standing rule.

## Release flow

1. Independent branch, commit, push and PR; GitHub CI must pass tests, typecheck, lint and build.
2. Supabase/GitHub applies versioned schema migrations to the isolated PR Preview. Do not apply migrations from a PC.
3. The STB-01 CI integration job runs only on GitHub-hosted Linux. Store a suitably scoped Supabase management access token as the GitHub Actions secret SUPABASE_ACCESS_TOKEN. Never put it in code, logs, a PC environment file or a browser variable. The runner verifies the exact Git branch, parent project, non-default status and ephemeral Preview identity before sending any SQL. Missing credentials or ambiguous identity FAIL the gate; there is no local fallback.
4. The integration SQL creates 52 explicit fixtures in a new fixture organization inside a transaction and rolls back all fixture data. It checks global scope, exceptions, inheritance, stale previews, idempotency, rollback on failure, result/evidence metadata preservation, authorization, RLS, capture windows and required administrator override reasons. These are Preview fixtures, not a copy of real productive records.
5. Netlify Deploy Preview must use the corresponding Preview Supabase URL, publishable key and server-only key, in Build/Functions scopes as appropriate. No production project keys or URLs may be copied into Preview. Validate real frontend/backend flows and session persistence there.
6. STOP on a failed critical gate. Obtain explicit human authorization before merge to main. After authorized merge, only configured cloud integrations deploy schema and application to production.
7. A real administrator executes the desired global change from IntegraQ, after reviewing scope, confirming and supplying a reason. No migration invokes the change automatically.

## Administrative operation

Open Configuración → Indicadores → Fechas de captura. Choose year, quarters and dates in America/Mexico_City. The default is days 1–15 of the following month. Generate the preview; it lists every indicator/period, old/new windows and preserved exceptions. Review counts rather than assuming the production catalog still has 52 items.

Supply a reason and confirm Aplicar a todos. The backend derives actor, organization and workspace from authenticated server context. The RPC checks the administrator again, serializes concurrent changes and rejects stale previews. A retry of the same operation ID does not duplicate the operation. Only the selected active indicators' period windows and new global rule records change; results and evidence are not written.

Existing dates are classified as legacy on schema installation and remain untouched. Applying a reviewed global scope explicitly adopts those selected windows. New indicators inherit all configured global periods. Catalog edits preserve stored windows, including sub-millisecond precision and exceptions.

An individual exception has its own selection, explicit confirmation and mandatory reason. It prevails over global changes unless the administrator explicitly chooses to replace exceptions in the reviewed global operation. Volver a regla global removes the exception through the same guarded/audited path.

After commit, Realtime invalidates authorized clients' snapshots; focus/visibility refresh and polling provide fallback. Capture authorization always uses current database windows, with row locking against concurrent window changes; administrator capture outside the window still requires a reason.

## Audit and recovery

indicator_capture_operations is append-only and readable only by scoped administrators. It records actor/time/reason/scope and complete before/after rule/window snapshots. The existing audit log also receives a summary event. Ordinary authenticated clients cannot write the ledger or the global rule table directly.

Use Historial protegido → Vista previa de restauración. Recovery requires a new reason/confirmation and refuses to overwrite any changed scope or windows. It restores the prior rule/window values in one transaction and appends a separate recovery event. Periods newly created by an applied scope remain present and return to the prior inherited/default window; they are never physically deleted, so any subsequently captured results/evidence stay intact.

No backup payload, real directory, secret or fixture credential belongs in Git. Productive BEFORE/AFTER verification and recovery approval must be obtained through the administrative flow; no production operation is authorized by this PR.

## Acceptance still required before release

Verify the current catalog of 52 real indicators through protected Preview acceptance, all four actors, repeated operations, concurrency, complete window visibility after session restart, exception precedence, late-capture blocking and administrator override. Validate a real Netlify Preview deployment. A passing provisioning step is not passing functional acceptance. No merge or actual productive global date change is authorized until these gates pass and a human explicitly approves.
