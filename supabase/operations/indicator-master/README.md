# Controlled indicator master bootstrap

`20261009_indicator_master_bootstrap.sql` is a production data operation. It is
intentionally stored outside `supabase/migrations`, so Supabase Preview,
`supabase db push`, and merges to `main` cannot execute it automatically.

The script prepares the approved IntegraQ production master:

- 52 indicator definitions;
- 52 process relations;
- 52 evaluation rules;
- 624 quarterly periods for 2026–2028;
- zero indicator results.

It targets only organization `00000000-0000-0000-0000-000000000001` and
`workspace_mode = production`. It contains no secrets and must never receive
credentials through an edit or committed file.

## Authorization boundary

Do not execute this script merely because it has been reviewed, merged, or
deployed. Execution requires a separate, explicit production authorization
that names this operation. Never run fragments manually or copy individual
inserts into the SQL editor.

## 1. Precheck

Before execution, confirm all of the following using read-only queries:

1. The connected project is the approved IntegraQ production project.
2. The repository revision and script checksum match the approved candidate.
3. `indicator_definitions`, `indicator_definition_processes`,
   `indicator_evaluation_rules`, `indicator_periods`, and `indicator_results`
   contain no production indicator master rows.
4. All process identifiers in the script exist, are active, and belong to the
   target organization. In particular, Recursos Humanos must resolve to
   `P-11`; `AREA-RH` must not be inserted.
5. Migration `202610090001_indicator_rule_expression_engine.sql` is applied.
6. No unreviewed migration or data operation is queued with this execution.

Stop if any precondition differs from the approved baseline.

## 2. Backup and BEFORE evidence

Create and verify a recoverable production backup before execution. Store it
outside the repository. Record, without exposing credentials:

- backup identifier, creation time, and verification result;
- counts for the five indicator tables;
- existing indicator codes, if any;
- profile and Auth-user counts;
- permission counts;
- process IDs used by the master;
- production organization and workspace identifiers.

Do not continue when the backup is missing, incomplete, or unverified.

## 3. Attribution actor

The script resolves an existing profile and aborts unless it finds an actor
with every required property:

- the profile exists;
- `organization_id = 00000000-0000-0000-0000-000000000001`;
- `workspace_mode = production`;
- `user_type = administrator`;
- `status = active`.

Do not create a synthetic user, modify Auth, relax foreign keys, or make
`created_by` nullable. Record the selected actor ID in the protected execution
evidence, not in this repository.

## 4. Explicit execution

Use an approved administrative PostgreSQL runner with credentials supplied by
the execution environment. Enable stop-on-error behavior and execute the file
as a whole. The script owns its transaction with `begin`/`commit`; do not wrap
selected fragments in a different transaction and do not automatically retry
an error.

The operation accepts only two starting states:

- zero definitions for the target production scope on the first execution;
- the exact same 52-code master on an authorized idempotency retry.

Any partial or unexpected state aborts the transaction.

## 5. AFTER validation

After a successful commit, verify:

| Check | Expected |
| --- | ---: |
| Definitions | 52 |
| Process relations | 52 |
| Evaluation rules | 52 |
| Periods | 624 |
| Results | 0 |
| Duplicate codes | 0 |
| Invalid processes | 0 |
| Organization | `00000000-0000-0000-0000-000000000001` |
| Workspace | `production` |

Also verify the authorized canonical values:

- IND-003, IND-004, and IND-005 use the canonical improvement objective;
- IND-028 uses `<=3`, maximum, percent;
- IND-046 uses `>=95`, minimum, percent;
- IND-050 uses `=100`, exact, percent;
- all eleven configured strict ranges keep `>min,<max`.

## 6. Runtime and Home

With an authorized administrator session, validate:

1. `GET /api/indicators/runtime` returns HTTP 200, source `supabase`, 52
   definitions, and zero results.
2. Home obtains quality-objective content from runtime data and does not use
   `public/home/objetivos-calidad.png` as its functional source.
3. Record the number of items rendered by the Home quality-objectives section.
   Do not alter Home grouping during this operation; open a separate gate if
   it renders each of the 52 indicators as an objective.

## 7. STOP and rollback conditions

Stop immediately if:

- the project, organization, workspace, actor, or repository revision differs;
- any initial indicator count is unexpected;
- any process is absent or inactive;
- any SQL statement fails;
- AFTER counts differ from 52/52/52/624/0;
- any result is created;
- runtime or access isolation fails.

An error before `commit` must leave the transaction rolled back. Do not repair
a failed or partially understood execution with ad-hoc SQL. If an already
committed operation must be reversed, preserve evidence and use a separately
reviewed recovery gate backed by the verified backup.
