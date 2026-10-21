# IQ-PRD-RISK-02 release and cleanup

The migration changes schema and guards only. It never cleans production data.

## Before release

1. Keep the existing general production backup. Run the read-only operation below and retain its full JSON, SHA-256, reopen result, timestamp, inventory and counts outside Git.
2. Apply `202610150001_risk_lifecycle_notifications.sql` to the Supabase Preview branch, then deploy this same commit to a Netlify deploy preview. Never point Preview at production Supabase.
3. Inspect deployment configuration **names only** for an existing transactional provider. The repository has no existing email sender. The supplied adapter uses server-only `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM` and `NEXT_PUBLIC_SITE_URL`. A real provider account, verified sender and credentials are required. Without them the worker returns `EMAIL_PROVIDER_CONFIG_REQUIRED`, leaves deliveries queued, and does not claim EMAIL PASS. Reuse an existing production provider if discovered before enabling this adapter.
4. Confirm active, internal, same-organization Direction users have effective `risks:view` and are linked to `P-03` through the effective `user_process_permissions` assignment. Do not infer membership from names or job titles. The production inventory on 2026-10-15 found zero such users; provisioning requires the authorized organization administrator's actual selection.
5. Pass local tests, typecheck, lint, build and GitHub CI for the final commit. Complete the Preview E2E matrix below before merging or releasing. Do not bypass failed checks.

## Preview E2E acceptance evidence (mandatory, currently not executed)

Use active Preview fixtures in one organization: administrator, process editor with `risks:update`, Direction member with `risks:view` on P-03, internal user without risk access, external customer/supplier, inactive user, different-organization user and demo user. Use a real authorized mailbox for at least one included user, resolved from Preview Auth. Do not copy email addresses into frontend fixtures.

1. Create a risk with an action and select an authorized user as responsible. Save the initial `updatedAt`, notification counts and unread counts.
2. Verify process editor, administrator and Direction each receive exactly their event notifications. Excluded fixtures receive none. Direction must receive the process event even when it does not own that process.
3. Read the actual mailbox and retain provider message id plus receipt evidence. An API `sent` response alone proves submission, not mailbox delivery. Check event, risk/opportunity, process, responsible person, required action, due date and the direct link.
4. Open the Bell, confirm the unread delta, open the risk via the link, and mark a notification read. Reload and confirm persistence. As an administrator try reading/updating another recipient's notification: zero rows / denied. Try updating notification content or recipient: denied.
5. Replay the same event identity and run the reminder worker twice: no additional inbox rows or emails for the same recipient/event/resource/occurrence. Provider failure must preserve the inbox and schedule a logged retry.
6. Soft-delete the Preview risk as administrator with category `test` and a reason. Verify it leaves matrix/KPIs/actions/alerts, retains the complete record and actions, records actor/time/previous value/process/type/reason/category/event, and notifies Admin + Direction. Restore and verify the reverse, including append-only audit. Then soft-delete it again to leave Preview clean.
7. Save Preview URL, Supabase branch id, tested commit, screenshots, receipt evidence, database assertions and cleanup audit ids. The local PGlite tests do not substitute for this acceptance test.

Netlify scheduled functions only run automatically on published deploys. Use **Run now** in a deploy preview for acceptance. Workers: `risk-deadline-notifications` daily at 12:00 UTC and `risk-notification-email` every minute. The email worker claims two rows per invocation to stay within scheduled execution limits and provider rate limits.

## Controlled production operation

Provide server configuration in a local, ignored environment file. No secret belongs in a command argument, report, frontend or Git.

```sh
node --env-file=.env.local supabase/operations/risks/cleanup.mjs --output /secure-backups/iq-prd-risk-02
```

The default is read-only. A full backup is written and reopened before candidates are considered. It classifies records as REAL, EXPLICIT_DEMO_TEST or AMBIGUOUS using the same classifier as the application tests. An edited historical `RYO-2025-002` is always AMBIGUOUS. IDs or suspicious titles alone never authorize deletion. `RYO-2025-001` and `RYO-2025-003` retain their historical matrix provenance unless distinct explicit evidence exists. Actions, including ACT-RYO-002 if present, are retained and hidden operationally through their deleted parent.

After all release conditions pass, create a release evidence JSON based on `release-gates.example.json`; each PASS needs independently verified evidence, and CI/deployment must identify the same commit. Set server-only `RISK_OPERATION_ACTOR_ID` to the authenticated, active administrator performing the operation.

```sh
node --env-file=.env.local supabase/operations/risks/cleanup.mjs --output /secure-backups/iq-prd-risk-02-release --apply --gates /secure-backups/release-evidence.json
```

The operator rechecks the current complete workspace and classifications immediately before each compare-and-swap transaction. Any drift stops the operation. Each retirement is a soft delete through the same atomic audited RPC as the UI. Keep BEFORE/AFTER and all real/ambiguous records. No records were retired in the 2026-10-15 dry run: three active real risks, zero opportunities, zero explicit demo candidates.

## Implementation and recovery

- Existing notification fields are reused: `module_id` is the module, `message` is the body and `action_url` is the target URL. `resource_id` is text so it can carry risk/action folios; `workspace_id` retains the containing form record UUID. Unique event identities also include organization, workspace mode, workspace id and occurrence, permitting distinct legitimate updates.
- Mutating workspace state, audit and inbox/outbox enqueue is one PostgreSQL transaction. Stale saves return conflict; PUT cannot remove risk/action history or forge tombstones. Direct form-record updates/deletes are guarded.
- Email addresses come from Auth inside the database at enqueue, and are revalidated server-side at delivery. Missing addresses produce in-app inbox plus `blocked_missing_address`. Delivery rows are inaccessible to authenticated frontend roles.
- The worker checks account status/type/organization/mode again, locks rows, records attempts, retries transient failures with backoff, and uses one provider idempotency key per notification. It never rolls back inbox data on provider failure. Changed addresses require review rather than changing an already attempted provider payload.
- Resend retains idempotency keys for 24 hours; automatic retries stop at 23 hours after the first attempt and require review thereafter. Old **unattempted** queued email remains eligible when configuration is supplied. Five attempts is the automatic ceiling. Inspect failed/expired rows; never reset attempts or use a new idempotency key without confirming provider delivery history first.
- Restore through **Registros eliminados**, with a reason. Restore changes only tombstone fields; the audit preserves deletion and restoration history. Never disable audit guards or restore the complete production snapshot over newer edits without a separately reviewed recovery operation.

Provider/runtime references: [Resend idempotency](https://resend.com/changelog/idempotency-keys), [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/).
