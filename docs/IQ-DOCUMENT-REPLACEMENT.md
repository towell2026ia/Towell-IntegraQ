# Controlled document replacement

## Scope and numbering

The upload dialog has one replacement section: new document, new version, or new revision. Discovery displays the existing identity, including retired documents. A replacement must match its process, document type and verified internal organization. It never creates a second identity for the code or renames/reclassifies the matched document.

`controlled_document_versions.revision` remains the immutable legacy/technical sequence and its existing unique constraint remains in place. **No historical rows are renumbered or backfilled.** New rows additionally record:

| Field | Meaning |
| --- | --- |
| `version_number` | Explicit version number for newly managed versions. New documents start at 0. |
| `revision_sequence` | Correction within the selected explicit version or identified historical revision. |
| `legacy_revision` | Original historical revision being corrected, when no explicit version exists. |
| `replacement_kind` | Initial upload, new version, correction, or restoration request. |
| `replaces_version_id` | Preserved antecedent, including its original file reference. |

A new version reserves the largest historical identifier/explicit version as its lower bound and allocates the next number under lock. This does not relabel historical revisions as versions. A correction to historical revision 0 remains **Rev. histórica 0 · revisión 1**; a correction to explicit version 1 remains **Versión 1 · revisión 1**. Technical record numbers continue increasing independently. Rejected proposals do not change the current version used as the correction's antecedent.

## Authorization and atomicity

- `inspect_controlled_document_code` performs authenticated, active-administrator/organization checks before discovery.
- `register_controlled_document_upload` repeats those checks, validates the private file and process/type, serializes normalized codes and locks the original document. The caller must confirm the latest record ID; a concurrent stale upload fails instead of creating another candidate.
- Existing current-version uniqueness is retained. A normalized-code unique index also rejects case/whitespace duplicate identities.
- Approval/submission lock the parent document before the candidate. Pending/rejected candidates never replace the authorized current file. Earlier drafts/rejections remain historical when superseded.
- New private Storage paths are unique and use `upsert: false`. No file is physically removed as compensation for a failed registration. Unregistered originals remain administrator-only; retrying a committed operation is blocked by the pending/stale checks.
- Direct REST writes cannot forge explicitly managed versions or alter their identity, numbering, antecedent or file. New RPCs are not executable by `anon`. Five intentional authenticated SECURITY DEFINER entry points/helpers appear in the security advisor; each checks identity/scope or returns an authorization Boolean. Their fixed search paths and explicit grants are versioned.
- Restrictive file/Storage SELECT guards protect retired/replaced originals. Existing unrelated file resource policies remain unchanged. Historical originals require authorized history access; ordinary readers receive the current original only. Signed URLs last 60 seconds; an already-issued URL expires normally.
- Restoring a retired document creates a pending request referencing the preserved original. It does **not** clear retirement or publish the file. Approval of a managed replacement/restoration reactivates the identity while preserving the retirement reason, actor and original date in lifecycle/audit records. Rejection keeps it retired.

## Migration and preservation evidence

Only `20261106020459_controlled_document_replacement.sql` was applied through Supabase's migration mechanism to `yptrqowmviixlkrxjrqr`. Its history entry exists exactly once. The earlier draft filename was synchronized to the timestamp actually registered by Supabase; the SQL content was not changed after application. No other pending migrations ran.

Before/after counts **and row hashes** match for all checked data:

| Existing entity | Before | After |
| --- | ---: | ---: |
| Controlled documents | 544 | 544 |
| Document versions | 544 | 544 |
| File metadata | 634 | 634 |
| Lifecycle records | 530 | 530 |
| User profiles | 45 | 45 |
| Organizations | 95 | 95 |

All 544 historical versions retain NULL in the new numbering fields. `AV-SGC-06` remains its original P-35 identity, titled **Política Ambiental**, retired, with its one existing original located in private Storage. The implementation did not upload or substitute a real file on the administrator's behalf.

## Verification

- 590 automated application tests pass, including 21 new upload/numbering/display/approval regressions.
- Typecheck, lint and production compilation with Webpack pass locally. Linux CI runs the standard production build.
- 30 database checks pass in an **ephemeral PostgreSQL 17 GitHub Actions service**, with synthetic fixtures only. They cover new/duplicate codes, automatic numbering, corrections, retirement/recovery, approval/rejection, current/history file access, direct forged approval, inactive/internal/customer/supplier/cross-organization denial, and two concurrent uploads.
- SQL validation evidence: [GitHub Actions run 42147387337](https://github.com/towell2026ia/Towell-IntegraQ/actions/runs/42147387337).
- Six isolated browser checks pass at 1366×1000 and 390×844: identity match, duplicate guard, absence of manual number controls, confirmed replacement payload, responsive controls, and a single replacement section. No production authentication or writes were used in those browser fixtures.
- [Desktop screenshot](evidence/controlled-document-replacement/desktop.png), [mobile screenshot](evidence/controlled-document-replacement/mobile.png), [browser assertions](evidence/controlled-document-replacement/browser-results.json), [data preservation](evidence/controlled-document-replacement/data-preservation.json).

## Acceptance still requiring a real session

An administrator must select the intended **real** replacement file for AV-SGC-06, choose version/revision, submit it, and have the authorized reviewer approve or reject it. Confirm its preview/download and historical original in that authenticated session. No fictitious document, approval or production test upload was created. Deployment success alone is not evidence that this real acceptance step has occurred.
