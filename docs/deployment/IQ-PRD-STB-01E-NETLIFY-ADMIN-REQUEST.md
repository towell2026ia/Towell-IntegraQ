# IQ-PRD-STB-01E — Netlify administrator request

Status: NETLIFY_ADMIN_ACCESS_REQUIRED. PR #4 must remain unmerged.

GitHub reports one failed Netlify Deploy Preview for commit
cd956294ac7b4d58972e60e7f9b155fb71e0f550:
https://app.netlify.com/projects/towell-integraq/deploys/6ad979278e94f05d8d27668f

The published GitHub status supplies a failed state and this deploy link, but no
build error or environment-scope metadata. Redirect rules, Header rules and Pages
changed are not treated as independent failures. No root cause is inferred from
those checks or repository configuration alone.

## Requested evidence and administrator actions

1. Open that deploy in the existing Netlify project. Provide the first actual
   build/plugin/runtime error and about 30 adjacent log lines, with environment
   values, credentials, authorization headers and private content removed. Include
   the commit, deploy context, effective build command, Node/pnpm versions and
   Next.js adapter version reported by that build.
2. Report metadata only for NEXT_PUBLIC_SUPABASE_URL,
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and the backend key used by the app,
   SUPABASE_SECRET_KEY: PRESENT, MISSING or WRONG_SCOPE, effective deploy
   context, and build/function scope. Do not send values. Confirm the URL and
   backend credential belong to Preview project jtegeojkabgdfutlcmnl,
   tied to PR #4 and branch codex/stb-01-global-capture-windows. Never copy the
   parent project's credentials into Preview or change production values.
3. Keep the existing GitHub/Netlify integration connected to this repository and
   PR. Correct only the demonstrated cause in Deploy Preview scope and rebuild
   through that cloud integration. Supply the actual published/failed result
   and public deploy URL.
4. For browser acceptance, make the published Preview available and configure its
   Supabase Preview Auth site/redirect URLs for that deploy. Test identities must
   exist only in Preview. Credentials must use the authorized cloud secret
   mechanism, never chat, source, artifacts or logs.

If API access is necessary, an authorized administrator must configure an
integration credential in GitHub Actions secrets, with minimum read access to
this site's deploy logs/settings. Any demonstrated configuration change should
be made by the administrator or a separately scoped authorized cloud job.
No local CLI, local authentication, production credential or personal token is
requested. Keep service API execution inside GitHub Actions.

## Independent concurrency gate

The GitHub-hosted job resolves PR #4's exact ephemeral Supabase branch before
creating data. It commits a new fixture organization, two administrators, one
authorized internal user and 52 indicators/periods. Actors execute as the
authenticated database role with separate fixture Auth subjects. These are
database/RPC acceptance sessions, not proof of browser login or Netlify E2E.

Each of six races requires two simultaneously active database backends. A third
cloud observer verifies distinct backend IDs and a real blocker/waiter
relationship before releasing the holder. Returned transaction intervals and
authenticated subjects must agree. Scenarios cover competing administrator
global updates, administrator window changes with internal-user capture, global
rule versus stale exception, closing a window during capture, identical-operation
retries, and exception versus obsolete global preview. Unexpected errors or
uncontrolled deadlocks fail; final states and uniqueness are asserted.

Committed fixtures require committed cleanup. A rollback in one actor does not
undo another actor's commit. Cleanup checks generated UUIDs, organization/process
codes and a test-run marker before deleting only that run's fixture data.
An exclusive table lock encloses temporarily disabling and reenabling the
immutable-operation trigger for fixture-history deletion. Transactional DDL
restores the trigger on error. No business function or productive migration is
replaced. Full public/Auth row fingerprints before setup and after cleanup must
match, and the audit guard must be enabled.

A separate request verifies zero fixture rows and removal of the private test
schema. An always() workflow step repeats cleanup. Unknown outcomes fail rather
than reporting zero. The ignored ephemeral runner manifest identifies the run
for cloud recovery. Job cancellation or service outages can interrupt cleanup;
such runs require cloud verification/recovery before PASS. Netlify and browser
E2E remain separate required gates.
