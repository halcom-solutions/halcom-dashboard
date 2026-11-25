# CLAUDE.md: project memory

Concise working context for the next session. It is not a substitute for the code, the brief or test
evidence; reconcile it with `git status`, `git log` and a fresh test run before trusting it
(AGENTS.md §2, §10). Last reconciled: 2026-10-20 (after D-034; see RESUME HERE below).

Canonical documents: [AGENTS.md](AGENTS.md) (charter) ·
[PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md) ·
[README.md](README.md) · [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md) ·
[docs/requirements/OPEN_QUESTIONS.md](docs/requirements/OPEN_QUESTIONS.md) ·
[docs/requirements/RBAC.md](docs/requirements/RBAC.md) · [docs/requirements/PIPELINE.md](docs/requirements/PIPELINE.md)

## RESUME HERE (rewritten 2026-10-20, after D-035)

**State:** branch `wip/single-view-master-data`. The E2E clean-up listed here before is **done**: every spec passes (last full run 127/130; the three that failed were one stale
locator, fixed, and two sign-in/count flakes under parallel workers that pass alone). Typecheck and lint clean, unit 328/328, integration 317/317, `next build` ok.

**Done in D-035 and D-036 (see DECISIONS.md):** request code prefix is one letter (two only if the letter is taken; `users.code_prefix`); RFQ tracker CSV imported
(`npm run db:import-rfq`, `--rebuild` for tickets loaded earlier; 27 requests and 27 projects in the dev DB); one SQL file for a new database (`npm run db:rfq-sql`, verified against the importer on an empty DB);
three FK indexes. D-036 (asked by the product owner): dropped `requests.email_link`, `email_message_id`, `email_conversation_id`, `responded_at` (the response date is an In progress step in the history),
and the deprecated `projects.stage`, `projects.status`, `requests.assignee_id`; Adityo and Ibnu are SOA PICs (`requests.raised_by_pic_id`, raised through the shared SOA login; their projects name them as Technical PIC (SOA), not as Sales name); the SOA and Purchasing dashboards share a summary with status and per-PIC charts, Purchasing counting RFQ and PO. Migrations through
`20261027110000_drop_deprecated_columns` are applied to the dev DB (run `db:migrate:deploy` and `docker compose restart app` on another device; back up first: the last two drop data).

**D-037 (2026-10-23):** the seed, the RFQ importer and the tests use the Neon accounts (`@halcominovasi.co.id`: `support@` for SOA, Satrio and Dzaki for Sales, no `sales@`; PICs Adityo, Ibnu, Gita, Soraya); minimum password 8; a superadmin can set a request's created and completed dates (`requests.edit-dates`); the Sales Pipeline puts sales numbers first and the request parts in two sections that open and close. `compose.neon-local.yaml` runs the app on the local copy of Neon (`halcom_neon_v2`, from `pg_dump` of Neon); `compose.neon.yaml` runs it on Neon itself.

**D-038 (2026-10-23):** Pipeline conversion tile (replaces Weighted pipeline) and the **Pipeline Growth** line chart (weekly/monthly/quarterly) on the Sales Pipeline, backed by a new append-only `project_progress_history` written by a database trigger; history starts at migration `20261028100000` (earlier stages were never stored), so the chart shows no point before that.

**D-039 (2026-10-24):** the three production blockers are done. T-7 sign-in throttle (`login_attempts`, 5 per e-mail and 25 per address in 15 minutes, lock 15 to 60 minutes), T-8 `npm run db:bootstrap-superadmin` (once, while no superadmin exists), T-9 `users.must_change_password` + `/password-change` and audited refusals. Migration `20261029100000_login_throttle_and_password_change`. (The Vercel deployment and its runbook were removed in D-078; the live system is the Hostinger VPS.) Branches: `main` is production, `development` replaced the old `wip/single-view-master-data`, which is deleted.

**Still open / asked:** deploying to a Hostinger KVM VPS (Ubuntu 26.04) with Docker: one `app` and one `db` container, Caddy on the host for HTTPS, Neon as the nightly backup copy, images built in GitHub Actions and the repository moved to a company organization (D-065; plan agreed in chat, no deployment files written yet). The Oracle Cloud plan and its audit files were removed. Production blockers T-7, T-8 and T-9 are **done** (D-039). Whether the Request and Project lists should also merge is undecided. `prisma/data/hit_rfq_tickets_import.sql` and the CSV hold customer data: never commit them.
The user's git identity is not configured on the first device: commits used `git -c user.name=Ibnuardhian -c user.email=ibnuardhian@gmail.com`.

**Environment notes:** Docker Desktop may be off (start `C:\Program Files\Docker\Docker\Docker Desktop.exe`); run no other Docker command during an E2E run; after editing source the test
server must be recreated (`--force-recreate app-test`); stop `app` before a long E2E run; a bash heredoc that contains backslashes or apostrophes can fail silently, write scripts with the Write tool.
The scratch database `halcom_fresh_check` in the `db-test` container is a throwaway used to check the seed and the SQL file; it may be removed.

## Latest progress

- **Committed:** `66e07fe` Docker-first foundation; `276aa46` RBAC, interim sign-in, per-role dashboards.
- **Done, not yet committed** (the user approved only those two commits; ask before committing):
  - Superadmin tools (D-016, D-021): System page, theme switcher, **Backups** (pg_dump to a host folder).
  - **Halcom Dashboard** branding, responsive sidebar shell (D-022), logo and favicon generated from the supplied image.
  - Projects and requests: BOQ / RFQ / PO with numbered IDs (D-018), status history, SOA to Purchasing handover,
    **copy-and-paste email text** (D-017, no sending, Graph question B-3 withdrawn), Audit log, own-password change.
  - Pipeline model and master data (customers, principals, solution categories), the **sales-export import**
    (`npm run db:import-projects`; the 34 projects and 9 named accounts are in the development database) (D-019, PIPELINE.md).
  - **Project updates feed** (D-020): *Current action* (what was done; the page highlights the last two) and *Next action* (what
    follows) are comment-like entries in the append-only `project_actions` (kind, text, author, time); the project keeps the latest
    text of each kind. SOA, admin and superadmin post them. **SOA technical-field editing** with a from/to change log
    (`project_changes`) also exists (slightly beyond what was asked; switch off by removing `projects.edit.technical` from SOA).
    Commercial fields stay read-only. BOM was renamed BOQ everywhere.
- **Migrations (all additive, applied to the dev DB):** `20261017120000_projects_requests`,
  `20261017180000_pipeline_master_data`, `20261017200000_project_change_log` (includes two renames, data kept),
  `20261017220000_project_action_feed` (copies the 60 existing current/next actions into the feed).
- **Checks on the final code:** typecheck and lint (0 warnings) exit 0; unit 97/97; integration 90/90 (includes real `pg_dump`);
  E2E: see the last line of this section. Earlier: production image smoke test passed, `npm audit --omit=dev` 0 vulnerabilities
  (not re-run after the image gained the PostgreSQL client).
- **Not built (asked for in the large dashboard/ticketing spec of 2026-10-17):** SLA tracking, SOA tasks and Kanban, ticket
  priority/comments/attachments/dependencies, Sales targets and pipeline dashboards, KPI charts with drill-down, Finance
  crosscheck, Excel export, Sales editing of commercial fields, customers/principals pages. They need decisions in OPEN_QUESTIONS T-16.

- **Added 2026-10-18 (D-023, not yet committed):** Sales Pipeline dashboard (Table/Charts), Progress and Status (replacing the old stage and
  status, whose columns are deprecated but not dropped), target margin and commercial editing by Sales, one form for project plus
  first request, notifications (bell and `/notifications`), SOA phase on BOQ requests, MailTo button, CSV export with column picker.
  Migrations `20261018100000`, `20261018140000`, `20261018180000` (all additive).

- **Added 2026-10-19 (D-025):** project soft delete (superadmin), XLSX export, sales funnel, clickable pipeline tiles, PIC reassignment, margin as amount or percent, SLA range and email templates per team (`/admin/settings`), Waiting-for-Sales answer, BOQ -> RFQ -> PO decisions (a PO needs a completed RFQ). Migrations through `20261020140000_sla_range`. The Turbopack dev cache is off for dev servers (it caused endless reloads).

- **Added 2026-10-18 (D-026, from `FEATURE_SPEC_LOGIN_ROLE_DASHBOARDS_SOA_OTHER.md`):** session renewal (12 h idle, 7 days at most,
  `POST /api/session/renew`), **Switch Account** (revokes the session, quick-pick of accounts used on this browser, password always required),
  audit of sign-in/out/switch; real SOA, Purchasing and Finance dashboards (`src/domain/requests/metrics.ts`, `src/server/dashboards`), Sales
  dashboard additions, Request Center, Sales Targets page, BOQ board view, Purchasing Handoff, Technical Reports, Financial Crosscheck (read-only,
  CSV), Permissions page, read-only SLA Policies for admin; **project source `OTHER`** (migration `20261021100000_project_source`: nullable
  `sales_owner_id`, CHECK constraint; SOA registers these and raises their BOQ). Nav labels changed per role. Amended same day after T-17 answers: PO back in the Purchasing menu, `/customers` page, Sales can register "Other" (sales name; any salesperson acts on such a project; charts show "Other"). Remaining open: T-17 b to d. Merged with the remote commit f28d6bd (search/sort/pages on request lists, master data tests; its decision is now D-027). Final checks: tsc and lint clean, unit 215/215, integration 207/208 (PostgreSQL 18 assertion only), build ok, E2E full run 79/84 before the last test fixes, then the failing specs re-run green except the System page (PostgreSQL 18).
  Integration test files now run one after another (`fileParallelism: false`).
  **Checks run on the final code (2026-10-18, outside Docker: Node 22, PostgreSQL 16 with a `uuidv7()` shim in template1):** typecheck and lint
  (0 warnings) exit 0; unit 208/208; integration 183/184 (the one failure asserts PostgreSQL 18 and cannot pass on 16); `next build` passes;
  E2E rbac + modules + smoke 39/39, and work/superadmin specs pass except the System page (also asserts PostgreSQL 18) and "Sales answer a
  request that waits for them", which **fails on the baseline commit too** (not caused by D-026). Not re-run in Docker: do that before merging.

- **Added 2026-10-18 (D-031):** ownership correction script `npm run db:remap-owners` (dry run first; applied to the dev DB: 15 Dzaki, 18 Satrio, 5 Other),
  operational **PICs** (`pics`, `/admin/pics`; SOA and Purchasing share one login each, requests are handed to PICs, workload counts PICs),
  several principals per project (`project_principals`), Excel import (`/projects/import`), Overview charts that drill down to the Projects
  list, Projects table pages (25/50/100/All), Sales Pipeline numbers scoped to the salesperson and ordered sales first.
  Migrations `20261023100000_project_principals`, `20261023110000_operational_pics` (applied to the dev DB). `DEV_ACCOUNTS.md` is now generated
  without a password. Heredocs that contain some quote patterns fail as a whole in this shell: write a script file with the Write tool instead.

- **Added 2026-10-18 (D-032):** **permission editor** on `/admin/permissions` (Superadmin only, new `permissions.manage`; categories, labels, guards; the database holds
  only deviations in `role_permission_overrides`, loaded at the start of every signed-in request into a `globalThis` snapshot so `can()` stays synchronous),
  one **Admin Dashboard** for Admin and Superadmin (both addresses and permissions kept), `npm run db:cleanup-dev` (applied to the dev DB: PRJ-035/036 and their
  three requests marked deleted, 18 notifications removed, 5 obsolete accounts deleted, `gusti` and `adityo` deactivated), repeatable seeds (`db:seed`, `db:seed:sample`).
  Migration `20261024100000_role_permission_overrides`. Backup before the cleanup: `backups/pre-dev-cleanup-2026-10-18.dump`.

- **Added 2026-10-20 (D-035):** one-letter request code prefix, RFQ tracker import and its SQL file, indexes (see RESUME HERE).

## Architecture decisions

D-012 interim auth, D-013 RBAC, D-014 handover email (delivery part superseded by D-017), D-015 Cache Components rules,
D-016 superadmin tooling, D-017 email copy-paste, D-018 numbering, D-019 pipeline and import, D-020 field-level edits and log,
D-021 backup, D-022 shell and branding, D-023 to D-025 pipeline/flow/SLA, D-026 sessions, dashboards and project source.
Layering: pure rules in `src/domain` (`access`, `requests`, `projects`), use cases in `src/server`
(`requests`, `projects`, `import`, `system`, `auth`, `users`), UI in `src/features` and `src/app`.
Permissions are checked only through `can()` / `requirePermission()`; services re-check the stored actor inside the transaction.
A page that needs a field-level rule (SOA edits) goes through a service that whitelists field names and rejects other keys.

## Outstanding issues

- Interim sign-in has no rate limiting, no forced first-login change, no production bootstrap for the first
  superadmin (T-7, T-8, T-9). Not safe for real users.
- Open with the product owner (OPEN_QUESTIONS): T-10 remaining RBAC assumptions (A-9 visibility, A-10 commercial values,
  A-11 admin support), T-11 backup retention/encryption, T-12 further superadmin tools, T-13 numbering scope, T-14 currency,
  T-15 Purchasing PICs and roles of the people named in the export, T-16 SLA / sales target / progress rules.
- The export names no Purchasing person, so no Purchasing account was created beyond the role account.
- Two temporary images from the production smoke test remain: `halcom-prod-smoke-app` and `halcom-prod-smoke-migrate`.
  A safety check blocked `docker image rm`; the user may remove them.
- `npm audit` still lists one advisory in dev tooling (`braces`, no patch upstream; D-011).

## Next steps

1. Ask the user to confirm T-16 (SLA rules, sales target definition, project progress, commercial visibility), then build in
   this order, each with tests: Sales commercial fields and targets, SOA tasks and Kanban with SLA timing, dashboards and charts
   with drill-down, Finance crosscheck, Excel export.
2. Get the user's approval to commit the uncommitted work (suggest several commits: shell and branding, requests and email,
   pipeline and import, SOA editing).
3. Production blockers: T-7, T-8, T-9.

## Working notes (non-obvious, verified)

- Everything runs through Docker Compose; the host has no usable Node setup. Never use `down -v`.
- Host PostgreSQL 17 owns port 5432, so the container is published on 55432.
- **After a migration the running dev server holds the old Prisma client** (`reading 'findMany'` of undefined): run
  `docker compose restart app`. Same after `npm run build` in the `app` container (404 for new routes).
- **`app-test` has file polling turned off** (`NEXT_DEV_POLL_INTERVAL_MS: ""`). With polling, Next dev restart-looped under
  Docker Desktop and every page reloaded endlessly, so E2E sign-in failed. After editing source or adding routes, recreate it:
  `docker compose --profile test up -d --force-recreate app-test`. The dev `app` had polling too until 2026-10-18, when it started reloading the user's open page every second ("Compiled in 1ms" + GET in the log; menus and buttons reset), so it is off there as well: after editing code run `docker compose restart app`.
- **Run nothing else in Docker during an E2E run** (not even `docker compose run app npm audit`): every `docker compose run app`
  executes `prisma generate`, which rewrites `src/generated` on the shared bind mount and made `app-test` reload pages, so
  25 sign-ins timed out. Also do not edit source while it runs: `app-test` compiles pages lazily. A full E2E run takes about 4 minutes
  (use a background command; foreground commands stop at 10 minutes). If a run is aborted, `test-results/` can be owned by root:
  delete `test-results` and `playwright-report` (generated output) before the next run.
- Prefer the Edit tool for edits. Node edit scripts that contain nested backticks fail silently, and heredocs with some quoting
  fail as a whole in this shell; check `git diff --stat` after a scripted edit.
- `docker compose logs --since` needs a timezone suffix (`...Z`); the host is UTC+7.
- Hostnames ending in `.app` (such as the service `app`) are HSTS-preloaded in Chromium; use the container name.
- Browse the dev server only at http://localhost:3000: other host names are blocked for dev resources, so the page is not
  interactive. Playwright needs the same (use the `e2e` service, which shares `app-test`'s network).
- A form clicked before hydration is ignored or becomes a plain reload; E2E retries sign-in (`signInAs`) and theme picks.
  React 19 clears a form's fields after every submit, so tests refill them.
- Project numbers are one sequence (`PRJ-001`...); the import raises the counter to the highest imported number, so integration
  tests that share a database must not assert "previous + 1" for project codes.
- Next.js `agentRules: false` keeps `next dev` from editing AGENTS.md. Do not edit AGENTS.md unless asked.
- Session start: `.claude/settings.json` runs a read-only SessionStart hook (git status and recent commits).
  It prints state only; it never migrates, seeds or deletes.
- `prisma/data/` (the sales export, real customer data) and `backups/` and `DEV_ACCOUNTS.md` are git-ignored and Docker-ignored.

- **Added 2026-11-25 (D-100):** Purchasing continues a completed RFQ as a PO (`requests.continue.rfq`, default Purchasing, set by the Superadmin in `/admin/permissions`); new guide step `pur.continue`, RACI row and the three User Guide PDFs reprinted. Unit 445/445 on a scratch copy; integration (`flow.test.ts`) not run: it needs the database container.
