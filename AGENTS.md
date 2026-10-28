# IQ-ARCH-DEPLOY-01 — CLOUD ONLY

Applies to all IntegraQ PRDs immediately.

- Never connect developer/user computers directly to Supabase PostgreSQL. No local Session Pooler, direct DB connections, psql, supabase db push, Docker/tunnels into production, or scripts using a production SUPABASE_DB_URL.
- Develop on an independent branch. Commit, push, PR and complete GitHub CI.
- Validate versioned migrations, SQL functions, RLS and integration tests through the Supabase/GitHub integration in isolated Preview. Validate UI/backend/user flows in Netlify Preview using Preview-specific configuration.
- STOP on a failed critical gate. Never merge main without explicit human authorization. Production deployment follows the authorized merge through configured cloud integrations.
- Existing production records may change only through secure backend/RPC actions invoked from IntegraQ's administrative UI, with real administrator authorization, explicit confirmation, a reason where applicable, transaction, immutable audit, BEFORE/AFTER verification, recovery and preservation of unrelated data.
- Automatic migrations must never run production cleanup, reseeding, master replacement or bulk productive-record replacement. Schema migrations may define guarded administrative RPCs but must not invoke them automatically.
- Never print secrets or copy production project credentials into Preview. Keep real data, backups, test credentials and personal directory inventories outside Git.
- Preserve existing local changes. Do not work on unrelated modules or merge PRs as part of a gate.
