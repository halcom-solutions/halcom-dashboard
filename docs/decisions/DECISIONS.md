# Decision Log

Material technical decisions, newest last. Business rules stay in
[PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](../../PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md);
unresolved items are tracked in [OPEN_QUESTIONS.md](../requirements/OPEN_QUESTIONS.md).

## D-001 Docker-first development and deployment

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** The team must not need Node.js, npm or PostgreSQL on Windows hosts. Install,
  dev server, migrations, seeding, linting and testing must all run through Docker Compose,
  reproducibly.
- **Decision:** One multi-stage [Dockerfile](../../Dockerfile) with `dev`, `migrator` and `runner` targets.
  [compose.yaml](../../compose.yaml) is the development stack (bind-mounted source; named volumes for
  `node_modules`, the npm cache, the Next.js output and PostgreSQL data).
  [compose.prod.yaml](../../compose.prod.yaml) is the production stack, with a different project name so
  its volumes can never mix with development data. Health checks exist for every long-running service.
- **Consequences:** Host editors cannot see `node_modules`; an optional Dev Container config is
  provided. File watching needs polling on Windows drives (D-008).

## D-002 Runtime and image pins

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - `node:24.22.0-bookworm-slim`, pinned by multi-arch index digest. Node 24 is the Active LTS
    (maintenance until April 2028). Node 26 is not LTS until late October 2026.
  - `postgres:18.6-bookworm`, pinned by digest. PostgreSQL 18 images keep data under
    `/var/lib/postgresql/18/docker`, so the volume mounts at `/var/lib/postgresql`.
  - `mcr.microsoft.com/playwright:v1.64.0-noble`, pinned by digest and kept equal to `@playwright/test`.
  - OpenSSL is installed only in stages that run the Prisma CLI. Debian packages are not
    version-pinned; the base image digest bounds them.
- **Consequences:** Upgrades are explicit edits of tag and digest. Renovate or Dependabot can
  automate them later.

## D-003 Dependency pinning and supply-chain policy

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Exact versions (`save-exact`) plus a committed lockfile; containers install with `npm ci`.
  - npm `min-release-age=7` (7-day cooldown) applies to the whole tree. Temporary, dated exemptions
    exist only for security releases:
    - Next.js 16.4.1+ fixes critical advisories (unauthenticated RCE in `use cache` and Image
      Optimization, DoS in Server Actions), so 16.4.0 must not be used.
    - Prisma 7.10.1 upgrades mysql2 and deepmerge-ts (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3,
      GHSA-ggr8-5vv4-36mx).
  - Install scripts run only for version-pinned approvals in `allowScripts`: `prisma` (preinstall),
    `@prisma/engines` (downloads the schema engine), `esbuild` and `unrs-resolver` (native binaries).
    Each script was reviewed before approval.
  - The npm `latest` tag is not trusted blindly. On 2026-10-17, `prisma@latest` pointed to
    `8.0.0-rc.23` while `@prisma/client@latest` was 7.10.1.
- **Evidence (2026-10-17):** `npm audit --omit=dev` reports 0 vulnerabilities. All 569 packages had
  verified registry signatures and 167 had provenance attestations.
- **Consequences:** Remove the exemptions in [.npmrc](../../.npmrc) after 2026-10-23.

## D-004 Framework baseline from the brief

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Next.js 16.4.2 scaffolded with `create-next-app@16.4.2`, keeping its defaults:
    - App Router, `src/`, Turbopack, and `@/*` imports.
    - `cacheComponents: true` and `partialPrefetching: true`.
    - Tailwind CSS 4 loaded through the `@tailwindcss/turbopack` loader, with no PostCSS config.
    - TypeScript 5.9.3 (template range `^5`).
  - `output: "standalone"` for the production image.
  - shadcn/ui 4.21.4 initialised with its defaults: the `base-nova` style on Base UI, neutral base
    color and lucide icons. `cn` comes from the official `cn` package (shadcn-ui/cn); the
    `src/lib/utils.ts` re-export exists only for the shadcn alias. The `shadcn` package is a
    devDependency because only its CSS is imported, at build time.
  - ESLint 9.39.5, which is end-of-life. eslint-config-next 16.4.2 still depends on
    `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, which do not support
    ESLint 10 yet.
  - React Hook Form, Zod, TanStack Table and Recharts are installed per the brief (§13) but not used yet.
    TanStack Table v9 replaces `useReactTable` with `useTable`, and `useLegacyTable` exists for v8-style
    code. shadcn data-table examples still use the v8 API.
- **Consequences:** With Cache Components, routes render at request time unless cached
  explicitly. Request-time route handlers call `connection()` (see `/api/health`).

## D-005 Prisma 7 with the PostgreSQL driver adapter

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - The `prisma-client` generator writes to `src/generated/prisma` (git-ignored, regenerated by the dev
    entrypoint and the image build).
  - The client uses `@prisma/adapter-pg` with a 5 s connection timeout and is created lazily, so
    builds never connect to a database.
  - Configuration lives in `prisma7.config.ts`, the file name Prisma 7.10 looks for first
    (`prisma.config.ts` is its legacy fallback). It does not load `.env`; Docker Compose injects
    `DATABASE_URL`.
  - Project and ticket models are not defined yet. They depend on open business decisions and the
    conceptual model in brief §11. The access models arrived in D-012.
- **Consequences:** `migrate status` exited with code 1 until the first migration existed (D-012).

## D-006 Authentication library not installed

- **Date:** 2026-10-17 · **Status:** Superseded by D-012 for the interim solution
- **Context:** The brief allows "Auth.js or another approved internal authentication solution" and
  Phase 0 requires confirming authentication needs. On 2026-10-17, Auth.js v5 (`next-auth@5`) was
  still a beta (`5.0.0-beta.32`).
- **Decision:** Install nothing until the approach is chosen (OPEN_QUESTIONS T-1). The approach
  determines the users/roles schema, so domain tables wait for it as well.

## D-007 Test isolation

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Unit tests: Vitest, no I/O.
  - Integration tests: Vitest against the `db-test` service, whose data lives in tmpfs. The
    global setup refuses to run unless `APP_ENV=test`, creates a fresh empty database named
    `halcom_it_<random>` for the run (nothing is dropped; the tmpfs is discarded when the service
    stops) and applies all migrations to it. Runs therefore cannot interfere with each other or with
    the data `app-test` seeds into `halcom_test` for E2E.
  - `app-test` applies migrations and seeds synthetic users each time it starts.
  - E2E tests: Playwright in the official image, against `app-test` (a dev server wired to
    `db-test`). The `e2e` container shares the `app-test` network namespace, so the browser loads
    `localhost` and Next.js's cross-origin protection for dev resources stays on.
  - No automatic retries.
- **Consequences:** Tests can never write to the development database, and no test needs a
  database reset.

## D-008 Hot reload by polling on Windows drives

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** A probe confirmed that file changes on a Windows drive produce no inotify events
  inside containers. Next.js advises polling only as a last resort.
- **Decision:** `watchOptions.pollIntervalMs` is enabled only when `NEXT_DEV_POLL_INTERVAL_MS` is set,
  which `compose.yaml` does by default (1000 ms). Measured: edits visible in about 2 s, idle app
  container at about 3 % CPU. A repository inside WSL 2 can turn polling off.

## D-009 Explicit production migrations

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Migrations run only through the `migrate` service (profile `migrate`), never on app
  start (brief §20.2). The app does not depend on the migration service.
- **Consequences:** The `migrator` image contains all development dependencies (1.71 GB) because
  the Prisma CLI is a devDependency. Slimming it is a possible follow-up.

## D-010 Next.js must not edit AGENTS.md

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** Next.js 16.4 `next dev` appends a managed block to `AGENTS.md` when it detects an AI
  coding agent (`dist/server/lib/generate-agent-files.js`).
- **Decision:** `agentRules: false` in `next.config.ts`. With that setting Next.js only removes its
  own marked block, and this project's charter has none. A hash check confirmed AGENTS.md is
  unchanged after `next dev` runs.

## D-011 Accepted residual risks

- **Date:** 2026-10-17 · **Status:** Accepted, review monthly
- **Decision and rationale:**
  - **`braces` ≤ 3.0.3, GHSA-vfj7-8cjw-p6xm (high, stack-exhaustion DoS):** no patched version
    exists. It is reached through `fast-glob`/`micromatch` in development and build tools only
    (eslint-config-next, shadcn CLI, ts-morph). It is absent from the production runtime image, which
    was verified. `npm audit` shows 9 entries for this one advisory.
  - **ESLint 9 end of life:** blocked by eslint-config-next (D-004). It is a development tool only.
  - **Development PostgreSQL published on `127.0.0.1:55432`:** loopback only. Port 55432 avoids
    clashing with locally installed PostgreSQL servers.

## D-012 Interim authentication: database sessions

- **Date:** 2026-10-17 · **Status:** Accepted as interim; replace if OPEN_QUESTIONS T-1 chooses SSO
- **Context:** RBAC and per-role dashboards need a signed-in user, but the approved authentication
  approach (T-1) is undecided. Auth.js v5 was still a beta; Better Auth and Auth.js v4 were not evaluated.
- **Decision:** Email and password sign-in with server-side sessions.
  - Passwords: scrypt (N=2^16, r=8, p=1) via `node:crypto`, salted, cost stored in the hash, NFKC-normalised.
    Unknown emails spend the same time as wrong passwords, and every failure returns one generic message.
  - Sessions: a 32-byte random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production);
    only its SHA-256 is stored; 12 hours absolute; role and active flag are re-read on every request, so
    deactivation and role changes apply immediately.
  - No authentication library was added, so there is no new dependency or install script. All of it sits
    behind `getCurrentUser()`, `requireUser()` and `requirePermission()`, so SSO can replace it without
    touching pages.
- **Known gaps (not acceptable for production):** no login rate limiting or lockout; no password-change
  screen (admins reset passwords); no first-superadmin bootstrap for production (the seed refuses to run
  there); failed sign-ins are not logged. See OPEN_QUESTIONS T-7 to T-9.

## D-013 RBAC model

- **Date:** 2026-10-17 · **Status:** Accepted as a proposal; visibility policy still open (brief §17)
- **Decision:** One role per user (`SUPERADMIN`, `ADMIN`, `SALES`, `SOA`, `PURCHASING`, `FINANCE`,
  `MANAGEMENT`), explicit permissions in one pure module, a dashboard per role plus a shared overview.
  The matrix, rules and assumptions are in [docs/requirements/RBAC.md](../requirements/RBAC.md).
- **Authorization:** every page and server action re-checks the permission on the server; the menu is only
  derived from the same matrix. Account changes run in a transaction with an advisory lock, re-verify the
  actor from the database, and write an audit event in the same transaction. `audit_events` is
  append-only through database triggers, and users are never deleted (deactivated instead).
- **Consequences:** Sales, SOA, Purchasing, Finance and Management dashboards show "no data yet" until
  the project and ticket modules exist. They show no numbers, because the brief forbids fabricated
  analytics.

## D-014 SOA handover email (business decisions from the product owner)

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; the delivery part is superseded by D-017
- **Decision:** After SOA replies to the `[HITBOQ]` email sent to the SOA team, the outgoing message becomes
  `[HITRFQ] {EndUserCompany} - {ProjectName}` or `[HITPO] ...`, addressed to the Purchasing team.
  - SOA may choose either `[HITRFQ]` or `[HITPO]` at handover, as the brief requires (§6.4); neither is assumed.
  - The reply **must stay in the same mail thread** as the `[HITBOQ]` email.
- **Consequence:** a `mailto:` link cannot set threading headers, so `outlook_draft` mode cannot meet the
  threading requirement for this step. A thread-preserving reply needs Microsoft Graph (reply to the original
  message, then address it to Purchasing and change the subject). That depends on tenant consent, mailbox
  identity and the stored original message ID (OPEN_QUESTIONS B-3). Whether Outlook keeps a thread when the
  subject prefix changes must be verified against the real tenant.

## D-016 Superadmin tooling

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; partly implemented
- **Decision:** Admins may add other operational users (already implemented). Superadmin additionally gets
  development and operations tools: switching the UI theme, monitoring application performance, and database
  backup, "and more".
  - Theme switcher and the System monitoring page are implemented, restricted to `SUPERADMIN`
    (permissions `theme.switch` and `system.monitor`).
  - Backup is implemented as D-021 (host folder). Password change for other users already existed (Users page, reset).
- **Notes:** the theme switch is a per-browser preference, so the permission only controls who sees the
  control. The monitoring page reads counts, sizes and timings only; it never shows query text or row data.

## D-015 Next.js rendering rules for signed-in pages

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Pages that read the session render behind `<Suspense>`, and `getCurrentUser()` calls `connection()`
    first so a session check never runs while prerendering.
  - Each page wraps its per-user content in its own `<Suspense>`. A `loading.tsx` was tried and the
    development validator did not count it.
  - `(app)/layout.tsx` exports `instant = false`: the session cannot be cached ahead of time, because a
    deactivated user must lose access immediately, and validation renders without a session.
  - A forbidden or unknown URL renders the not-found UI with none of the page content, but the HTTP
    status stays 200, because Cache Components streams the response before the check runs. E2E tests
    therefore assert on the delivered HTML. `forbidden()` was not used because it is experimental.

## D-017 Email is copy-and-paste only (supersedes the delivery part of D-014)

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; implemented
- **Decision:** The application never sends mail and never opens Outlook. A request page shows **To, Cc,
  Subject and a default text** (containing the request ID) for the user to copy into Outlook.
  - Recipients come from `EMAIL_TO_HITBOQ` / `EMAIL_CC_HITBOQ` (and `HITRFQ`, `HITPO`) in the server
    environment. A missing or invalid list shows a configuration error, never another group's list.
  - Subject: `[HITBOQ|HITRFQ|HITPO] {EndUserCompany} - {ProjectName}` (brief §6.4). The text carries the request
    ID, project ID, requester, needed-by date, the source BOQ on a handover, and a link (`APP_BASE_URL`).
  - Shown only to roles that send these emails (Sales, SOA, admins).
- **Consequence:** the same-thread requirement of D-014 is met by the user replying inside the original
  `[HITBOQ]` thread in Outlook; the handover page tells them to do so. **Microsoft Graph is not needed**, so
  OPEN_QUESTIONS B-3 is withdrawn and the `microsoft_graph_send` mode and the email outbox are not built.
  There is no delivery log, because the application cannot know what was sent.

## D-018 Request and project numbering

- **Date:** 2026-10-17 · **Status:** Confirmed by the user (format); counter scope is an assumption
- **Decision:**
  - Requests: `BOQ-<prefix>-YY0001`, `RFQ-<prefix>-YY0001`, `PO-<prefix>-YY0001`, for example `RFQ-S-260001`.
    The sequence restarts per type, per prefix and per year (assumption, OPEN_QUESTIONS T-13). The two-digit year uses the Asia/Jakarta time zone.
    **The prefix rule was changed by D-035:** it is one letter, no longer the initials of the address parts (the old `ibnu.ardhian@x` gave `IA`, `sales@x` gave `SA`).
  - Projects: `PRJ-001`, `PRJ-002`, ... one unbroken sequence, matching the sales export. The counter continues after the
    highest imported number.
  - Numbers come from the `code_counters` table, taken atomically inside the creating transaction, so concurrent
    creations never share a code.
  - Repeated submits of one form create one record (a per-page-view submission key), and a repeated handover click
    returns the existing RFQ or PO (unique source and type).

## D-019 Project pipeline model, master data and the sales-export import

- **Date:** 2026-10-17 · **Status:** Implemented
- **Decision:** A project carries commercial fields (stage, estimated value, probability, final value, won date, lost
  reason, competitor), general information (customer, principal, solution category, industry, location, stakeholders),
  technical fields (technical PIC, requirement, assessment, solution proposed, architecture, sizing, BOQ, quotation,
  proposal, POC, scope, challenge, blocker, notes) and progress notes (current and next action).
  - `Customer`, `Principal` (brand) and `SolutionCategory` are master tables keyed by a normalised name, so "HPE" and
    " hpe " are one record. Weighted value is computed (value times probability), never stored.
  - Stage and status are separate: stage is where the deal is, status says whether it is live, on hold, won, lost or completed.
  - `npm run db:import-projects` loads the sales-export CSV into the development or test database. It only adds, runs in one
    transaction, skips projects that already exist, never changes an existing user, and refuses other environments.
    The CSV holds real customer data and is git-ignored (`prisma/data/`).
  - The wording BOM became BOQ everywhere (stage "Sizing / BOQ", field "BOQ"); the import still accepts the old "BOM" headings.

## D-020 Project updates (current and next action) and technical fields

- **Date:** 2026-10-17 · **Status:** Implemented for SOA; Sales commercial editing not built yet
- **Decision (current and next action):** these are a **comment-like feed**, not an edited field (clarified by the user).
  - *Current action* is what has been done (this week); the page highlights the **last two**. *Next action* is what will be done
    after the current action; the page highlights the latest one.
  - The log is only **when** each entry was added and by whom: each post is one append-only row in `project_actions`
    (kind, text, author, time). Entries are never edited or deleted; a correction is a new entry. The project keeps the text of
    the latest entry of each kind (`current_action`, `next_action`), written in the same transaction as the entry and an audit event.
  - Permission `projects.post-update`: SOA, admin, superadmin. The export's existing actions became the first entries (no author).
- **Decision (technical fields):** SOA (and admins) may also change the technical fields (requirement, assessment, solution,
  architecture, sizing, BOQ, quotation, proposal, POC, scope, challenge, blocker, notes), permission `projects.edit.technical`,
  per the field-level rules of the spec (SOA edits technical specifications, BOQ details and technical notes). *This goes slightly
  beyond what was asked for Next action; remove the permission from SOA in `permissions.ts` to switch it off.*
  Commercial fields (value, probability, stage, status, owner) are read-only for them.
  - Enforced on the server: the service accepts only the listed field names and rejects any other key, re-reads the actor
    inside the transaction, and locks the project row.
  - Every changed technical field writes one row to the append-only `project_changes` log (who, field, from, to, when) plus an
    audit event, in the same transaction. A save that changes nothing writes nothing.

## D-021 Database backup to a host folder

- **Date:** 2026-10-17 · **Status:** Implemented (answer to OPEN_QUESTIONS T-11: host folder)
- **Decision:** Superadmin creates a custom-format `pg_dump` from the Backups page. The file goes to the folder mounted at
  `/backups` (host folder `BACKUP_HOST_DIR`, default `./backups`, git-ignored). It is written as `.partial`, verified with
  `pg_restore --list`, then renamed; existing files are never overwritten or deleted. Restore stays manual and approved
  (README, Backups). The image carries the PostgreSQL 18 client from the official PGDG repository (signing key fingerprint checked).
- **Not decided:** retention, encryption and off-machine copies; downloading a dump from the UI is not offered.

## D-022 Application shell, branding and responsive layout

- **Date:** 2026-10-17 · **Status:** Implemented
- **Decision:** The product is named **Halcom Dashboard** (tagline: Project Request & Fulfillment Tracker). The sidebar carries the
  Halcom logo and the modules grouped as Dashboards, Work and Administration, derived from the permission matrix. Below the
  `md` breakpoint it becomes a drawer (menu button, closes on navigation and Escape). Colours: primary blue `#1173BA`
  from the logo, white background, grey `#F3F4F6` surfaces, light blue `#E0F2FE` accents, amber `#F59E0B` only for attention states.
  Users can change their own password on the Account page; the Audit log page is open to admins.

## D-023 Sales Pipeline, Progress and Status, one form, notifications, SOA phase, MailTo and export

- **Date:** 2026-10-18 · **Status:** Implemented
- **Progress and Status replace the old Stage and Status.** Sales' sheet drop-downs are the model: Progress (5% Qualify, 15% Understand,
  30% Propose, 60% Negotiate, 60% Negotiate (FU), 95% Agree, 100% Closed Won, 0% Closed Lost) and Status (On Track, On Hold, Done,
  Block). Choosing a Progress step sets its probability unless the probability is changed by hand in the same save. Existing
  projects were given a starting value from their stage and status (migration `20261018140000`; a guess, Sales correct it). Requests
  can be added only to a project that is **On Track**. *The old `projects.stage` and `projects.status` columns are no longer read or
  written; dropping them is a separate migration that needs the owner's approval, because it deletes the finer-grained old values.*
- **Sales Pipeline** is the one Sales dashboard (Table or Charts view, `?view=`). Request lists leave the Sales menu; a new project and its
  first BOQ, RFQ or PO are created in one form, in one transaction.
- **Commercial fields** (Progress, Status, estimated PO value, probability, target margin %, quote released, target closing) are edited
  by the Sales owner of the project (admins: any project), through a whitelist, with a change log and audit event.
  Estimated gross profit = value (final value once known) × target margin; empty until both are known.
- **Notifications** (`notifications` table, written in the transaction of the change): a new request reaches the team that owns its type;
  status changes and handovers reach the requester and Sales owner; project updates (commercial, technical, current/next action,
  SOA phase) reach the Sales owner, the technical PIC and the team with an open request on the project. The actor is never notified.
  Finance and Management receive none (they own no requests).
- **SOA phase:** a BOQ request is labelled Assessment, Sizing or POC by SOA (permission `requests.work.boq`); a database check keeps
  the label off RFQ and PO. RFQ and PO belong to Purchasing; SOA sees the email text only for BOQ and for what it handed over itself.
- **MailTo:** each request's email panel has a button that opens a draft in the person's mail program with To, Cc, subject and text.
  The application still sends nothing (D-017). A text that would make the link longer than 1900 characters is left out of the link.
- **Export:** the Overview offers a CSV export of the projects with the columns the person ticks (UTF-8 with BOM for Excel; text that
  starts with `= + - @` is neutralised). Each export is written to the audit log. An .xlsx export can follow if Excel formatting is needed.

## D-024 Navbar, collapsible sidebar, tracking view and export modal

- **Date:** 2026-10-18 · **Status:** Implemented (not yet committed)
- **Navbar:** a bar across the top at every width holds the sidebar button, the theme switcher (superadmin), notifications and a profile menu
  (name, role, Account, Sign out). The sidebar now holds only the logo and the modules. On a desktop the button hides and shows the sidebar
  (not remembered between visits); below `md` it opens the drawer as before.
- **Tracking** (Sales Pipeline, third view next to Table and Charts): every project Sales created with its requests, who has each request now
  ("Waiting for SOA to pick it up", "Dewi (Purchasing) is working on it", "Waiting for you"), when it last changed, a search and a filter
  (no request yet, open, waiting for me, all done). No timing rule is applied; SLA is still open (T-16).
- **Charts:** Pipeline by progress names the steps without their percentages; the percentage only feeds the weighted pipeline.
- **Export:** the column picker is a modal that opens from an Export data button on the Overview.

## D-025 PIC reassignment, margin amount, SLA range, email templates and the request flow

- **Date:** 2026-10-19 · **Status:** Implemented
- **Flow:** BOQ -> RFQ -> PO. The BOQ can be skipped (a project may start with an RFQ); **a PO needs a completed RFQ on the project**
  (confirmed by the product owner). A BOQ continues as an RFQ and an RFQ as a PO; the Sales owner of the project, an admin, or SOA (after
  a BOQ) decides. "Do not continue" is recorded with a note and can be undone. A new project cannot start with a PO.
- **Waiting for Sales:** the Sales owner answers (back to In progress, the answer is the reason) or cancels the request; nothing else.
- **SLA:** per receiving team (SOA for BOQ, Purchasing for RFQ and PO), written by the superadmin as one number or a range of days, `2-3`,
  `1-4`, at most 7 (default `2-3`). The first number is when an answer is expected, the last the deadline. **Days are working days**
  (Monday to Friday, Jakarta time, no holiday calendar; confirmed). The clock starts at creation, stands still while the request waits for
  Sales (the dates move by the waiting time) and stops at Completed. States: On track, Due now (from the expected date), Overdue, Paused, Met, Late.
- **Email templates:** per team, subject and text with `{{variables}}`; the subject must contain `{{request_id}}` so a reply carries it. The
  application still sends nothing (D-017). Subject format is now `[HITBOQ] Company - Project [Request ID]`.
- **Superadmin:** can move a project to other Sales, SOA and Purchasing PICs (details, requests and history untouched; the move is logged)
  and can delete a project. Deleting is a soft delete: history tables are append-only, so the project is hidden everywhere instead.
- **Commercial:** probability is no longer entered; it is the percentage of the Progress step. Target margin is an amount (default) or a
  percentage, never both. Money inputs group thousands with dots as they are typed.

## D-026 Persistent login and Switch Account, role modules and dashboards, project source Other

- **Date:** 2026-10-18 · **Status:** Implemented (from `FEATURE_SPEC_LOGIN_ROLE_DASHBOARDS_SOA_OTHER.md`)
- **Sessions:** the server-side session and the opaque HttpOnly cookie of D-012 stay; no new provider. A session lasts **12 hours idle**
  (`SESSION_TTL_HOURS`, 1 to 72) and is **renewed while the person works** (the page asks `POST /api/session/renew` every ten minutes while
  visible; a session in the last half of its lifetime gets a fresh 12 hours), but **never lives past 7 days** after sign-in
  (`SESSION_MAX_HOURS`). This replaces A-5 ("not extended by activity"). The cookie is a persistent cookie, so it survives a browser restart.
  `Secure` in production, `SameSite=Lax`. Nothing about the session is kept in web storage.
- **Switch Account:** ends (revokes) the current session, clears the cookie and shows the sign-in page with the accounts used on this
  browser. Choosing one only fills the email; **the password is always required**. The list (`recent_accounts` cookie: name, email, role;
  HttpOnly; at most five; 30 days) can be cleared per account or entirely. Sign out never signs anyone back in. Signing in revokes the
  browser's previous session. Sign-in, sign-out and switch are written to the audit log (`auth.login`, `auth.logout`, `auth.switch`;
  failed attempts are not logged, T-7). Login, logout and switch revalidate the whole app so no page of the previous user is cached, and every
  page is served `Cache-Control: no-store`.
- **Navigation per role:** Sales: Sales Pipeline, Projects, Sales Targets (`/targets`), Request Center (`/requests`). SOA: Technical
  Dashboard, Projects, New project, BOQ Tickets (list or board), New BOQ request, Purchasing Handoff (`/handoffs`), Technical Reports,
  Principal & Solution Master Data. Purchasing: Purchasing Dashboard, Projects (the shared view) and **RFQ Requests only**; PO requests are not in
  its menu but stay in the data, the lists and the notifications (interpretation of the spec, see OPEN_QUESTIONS T-17). Finance:
  Finance Dashboard, Projects, request lists (read) and Financial Crosscheck. Admin: Administration Dashboard, Users and Roles, Permissions,
  SLA Policies (read-only for admin, editable by superadmin), Master Data, Audit Logs. Backups and System stay superadmin-only.
- **Dashboard numbers** (`src/domain/requests/metrics.ts`, computed from requests and their status history, each linking to the filtered list):
  open (not Completed or Cancelled); backlog (Submitted); overdue (past the SLA deadline, requests waiting for Sales excluded); due now;
  waiting for Sales; past needed-by date; needed in the next 7 days; workload per assignee; bottlenecks (time in the current status);
  over the requests **completed in the last 90 days**: SLA compliance (met over met + late), queue time (created to first response), waiting
  time (in Waiting for Sales), processing time (turnaround minus queue minus waiting) and turnaround. Sales also see their requests by status
  and their target versus achievement. Time is calendar hours; the SLA clock is working days (D-025).
- **Finance crosscheck** (read-only, `src/domain/finance/crosscheck.ts`): value, RFQ and PO references, audit count, and four derived flags
  (Closed Won without final value, without PO, without RFQ; PO completed on a project not Closed Won). No verification or editing exists; it
  would need its own permission and audit trail. CSV export is audited.
- **Project source:** `source_type` (`INTERNAL_SALES`, `OTHER`) on the project, separate from status and request type. `OTHER` has no Sales PIC
  (`sales_owner_id` is now nullable) and needs the external company; contact, reference and notes are optional. A database CHECK and the
  service both enforce the combinations. Legacy rows become `INTERNAL_SALES` (each has a Sales owner; nothing is inferred). **SOA, admin and
  superadmin register `OTHER` projects; Sales register `INTERNAL_SALES`.** SOA may raise a BOQ on an `OTHER` project (not on a Sales
  project, not RFQ or PO) and continue it to Purchasing like any BOQ. SOA/admin edit the external details (change log + audit); an `OTHER`
  project can be handed to an internal Sales PIC, but an internal project cannot become `OTHER` (it would drop its Sales PIC and the targets
  that count it). Source is in the Projects list (column, filter, search), the project page and the exports.
- **Amended after the product owner's answers (T-17):** (1) **PO stays Purchasing's work**: PO requests are back in its menu. (2) **"Other" is
  the Sales side, not the project**: when creating a project, Sales choose themselves or Other and type a *sales name* as a marker; the project is
  otherwise normal, and charts count it under "Other". Sales (and SOA, admin) may register such projects, and **any salesperson may act on an
  Other project** (commercial details, answering Waiting for Sales, deciding the next step); an internal project still belongs to its owner only.
  Sales may also correct the sales name. (3) **Customers page** (`/customers`, Sales and admins): customers are never typed there; they are created from
  the end-user company when a project is created, one customer per name.
- **Tests:** the integration files now run one after another (`fileParallelism: false`) because the dashboard tests compare whole-table counts.

## D-027 One project view, Principal/Solution master data and a Purchasing view of RFQs only

- **Date:** 2026-10-18 · **Status:** Implemented (no migration: the Principal and Solution tables already existed)
- **One view:** the BOQ, RFQ and PO of a project are panels inside the project page; `/request/CODE` stays and shows the same panel. A
  request handed over starts In progress. The email text opens in a modal and the status history is collapsed. Technical fields are
  optional and added on demand; SOA see only BOQ requests in the menu.
- **Master data:** Principal and Solution are separate searchable lists with stable ids. A new name is created only by the explicit
  Create button (SOA, admin, superadmin: `masterdata.manage`); a name that exists, ignoring case and spacing, is selected instead and the
  server refuses a duplicate (unique name key, also under concurrency). Rename keeps the id and so every project; delete is refused while a
  project uses the record. Changes go to the audit log, and a project's classification to its change log.
- **Technical sections:** one that was never saved is dropped at once; a saved one is cleared only after confirmation. Only that field
  changes; the change log keeps what it said (so history is not lost, and no row is deleted).
- **Purchasing:** the menu offers only the Purchasing Dashboard and RFQ requests. All other pages and the PO list are not offered but still
  work by address (nothing was deleted). The dashboard queue is RFQ only. The request lists have search (request, project, End User,
  requester, PIC, Principal, Solution, item details), status filter, sorting (SLA is computed, over the newest 1000) and pages of 20, all in the URL.
- **Not built:** attachments on requests do not exist yet, so the RFQ list has no attachments column. Purchasing no longer sees PO requests in
  its menu or queue; if Purchasing must still work POs, that needs a decision. **Answered 2026-10-18 (T-17): PO is Purchasing's work, so its menu
  now has Purchasing Dashboard, RFQ Requests and PO requests.**

## D-028 Status changes on the board only, Waiting for Sales retired, Revision for a completed BOQ

- **Date:** 2026-10-18 · **Status:** Implemented
- **Board:** SOA (BOQ) and Purchasing (RFQ, PO), and admins, change a status only by dragging the card to another column of the board
  (`/requests/<type>?view=board`, the default view of the team that works on that type; the list is one click away). The status form on the
  request page is gone. Only moves the flow allows are drop targets. A cancellation, or reopening a completed RFQ or PO, asks for a reason.
  The keyboard does the same with Shift + Arrow keys on a focused card. The server checks every move again (`changeRequestStatus`).
  Sales and Finance see the board but cannot move cards; Sales no longer change a status.
- **Waiting for Sales is retired:** it is no longer offered and nobody can move a request into it; questions to Sales are asked and answered by
  email, which keeps the history. The value stays in the database (older requests and their append-only status history use it; PostgreSQL
  cannot drop an enum value without rewriting rows). An older request that still has it is shown in the In progress column and can be moved on.
- **Revision:** a BOQ that is Completed can be dragged to Revision (no reason: the details go by email), and from there back to Completed or to
  Cancelled. An RFQ or PO has no Revision (a completed one is reopened with a reason). A BOQ in Revision is open work, keeps its first
  completion time (the SLA is not re-measured) and cannot be continued to an RFQ until it is completed again.
- **Migrations (additive):** `20261022100000_request_revision` (enum value) and `20261022100100_request_revision_completion` (the completed_at
  check now also allows Revision; it only gets looser, no row is touched).

## D-029 Remembered accounts, one New project form for SOA, Sales ownership, clearable dates, Propose means Submit Quotation

- **Date:** 2026-10-18 · **Status:** Implemented
- **Remembered accounts (Switch Account):** every sign-in of a role other than ADMIN and SUPERADMIN remembers the account on that browser, so
  Switch Account continues as it without the password (`device_credentials`, migration `20261022120000_device_credentials`, additive). The
  cookie `device_accounts` (HttpOnly) holds only `{ id, token }`; no name, email or role. The database stores a salted SHA-256 of the token.
  Each use replaces the token (a copied cookie works once). Every use re-reads the stored user: deactivated, expired, or a role that became
  ADMIN or SUPERADMIN means refusal and the credential is deleted. A password change, an admin reset and deactivation delete all of a user's
  credentials. ADMIN and SUPERADMIN always type the password. Valid for 30 days from sign-in; at most five per browser; "Forget" removes one.
- **SOA:** the menu no longer has New project or New BOQ request. A project and its BOQ are created with one form (the New project button on
  Projects and on BOQ Tickets, BOQ preselected); `/requests/new` without a project leads there. Adding another request to an existing
  project is still done from the project page.
- **Sales ownership:** a Sales project is always Internal Sales with the signed-in salesperson as Sales PIC (any owner sent with the form is
  ignored). Sales no longer hold `projects.create.external` or `projects.edit.source`; only SOA (and administrators, for oversight) classify
  a project as Other or change that classification. Existing Other projects keep working: any salesperson still enters their commercial details.
- **Dates:** every date field has a Clear button shown only while it has a value; an empty date is stored as no date (logged for the
  commercial fields).
- **Progress 30%:** Propose means the quotation was submitted (label "30% - Propose (Submit Quotation)"). Moving to Propose, or creating a
  project at Propose, fills Quote released with today (Jakarta) when it is empty. The date stays editable and clearable at any time.

## D-030 SOA register a project for a registered salesperson, or as Other

- **Date:** 2026-10-18 · **Status:** Implemented (no migration)
- The New project form for SOA has two sources: **Internal Sales** (the Sales PIC is a registered, active salesperson picked from a searchable
  drop-down, required) and **Other** (the external sales name). New permission `projects.assign-sales` (SOA, superadmin). The server
  validates that the chosen account exists, is active and is a Sales account; the salesperson is told (`project.assigned` notification);
  the audit event records who registered it and for whom. SOA may raise the project's BOQ in the same step (not an RFQ or PO, and not a BOQ on
  an existing internal project). Sales still own their own projects and cannot name another owner (any owner sent is ignored).

## D-031 Owner migration, PICs, several principals, Excel import, chart drill-down, Sales dashboard

- **Date:** 2026-10-18 · **Status:** Implemented (migrations `20261023100000_project_principals`, `20261023110000_operational_pics`, both additive)
- **Account and ownership migration** (`npm run db:remap-owners`, dry run by default; `--apply` runs one transaction, development and test only,
  superadmin recorded as the actor). In order: `mas.dzaki@` is renamed to `dzaki@` (name Dzaki; same account id, so every reference follows);
  projects of `soraya@` move to `dzaki@`; projects of `gusti@` move to `satrio@`; every other internal project becomes source **Other**, with
  the earlier owner kept as the external sales name and a note ("Previously owned by ..."). Nothing is deleted. The plan refuses to apply when
  both addresses of the rename exist, a target is missing, inactive or not Sales; an owner who is not a Sales account (the SOA account
  `adityo@`) is reported as a warning, not guessed. Each change is in the project change log and the audit log; the counts are verified
  inside the transaction and a difference rolls everything back. Applied to the development database on 2026-10-18 after a `pg_dump`:
  38 projects: 15 Dzaki, 18 Satrio, 5 Other. Recovery is the dump; there is no automatic revert.
- **PICs** (`pics`, `request_pic_assignments`, `requests.pic_id`): a PIC is an operational assignee of SOA or Purchasing, not a login account.
  Each team keeps one shared login. An administrator creates, renames, deactivates and reactivates PICs (`pics.manage`, `/admin/pics`); a PIC
  is never deleted. SOA or Purchasing hands a request to a PIC of their own team from the request page; every change is an append-only row
  (from, to, by, when) and an audit event. Workload by assignee counts per PIC; starting work no longer makes the login the assignee
  (`requests.assignee_id` stays, deprecated). The migration made a PIC of every SOA or Purchasing account a request had been assigned to
  (Adityo, and the two shared logins by name; the shared ones should be handed on and deactivated). The project-level Technical PIC and
  Purchasing PIC (`projects.technical_pic_id`, `purchasing_pic_id`) still point at accounts: they route notifications, so moving them to PICs is a separate decision.
- **Several principals per project** (`project_principals`, unique per project and principal): SOA picks any number from a searchable list
  and may create a new one (`masterdata.manage`); a name that exists is matched, never duplicated. `projects.principal_id` keeps the first so
  lists, filters and exports keep working. Charts count a project under each of its principals; the folded "Other (n)" slice counts it once.
- **Excel import** (`projects.import`: SOA, Admin, Superadmin; `/projects/import`): upload `.xlsx`, match columns (suggested from the headers),
  check every row, then import. The file is posted again with each step and checked again on the server (5 MB, 5,000 rows, 60 columns; no
  formulas run). Duplicates (same Project ID, or same end user and project name, in the data or earlier in the file) are skipped, never
  updated. All or nothing (default) or valid rows only; the import is one transaction, so any failure leaves no project, principal, code
  number or audit row behind. Explicit Project IDs move the counter past them. Sales do not import: owners are named in the sheet.
- **Overview charts** link to the Projects list filtered to exactly what they count (progress, status, funnel step "reached", principal,
  solution, industry, Sales PIC; the folded "Other" slice carries all of its values; "Not set" is `none`).
- **Projects table** pages of 25, 50, 100 or All (`per`, `page`); All is every match, not capped.
- **Sales Pipeline dashboard**: every number is the signed-in salesperson's own (the request counts were global before); sales performance
  (open pipeline, weighted, margin, won) comes before the BOQ/RFQ/PO numbers; the targets block and its tab are gone (Sales Targets has its own page).

## D-032 Permission editor, one Admin Dashboard, development data cleanup and repeatable seeds

- **Date:** 2026-10-18 · **Status:** Implemented (migration `20261024100000_role_permission_overrides`, additive)
- **Why a superadmin could not manage role permissions.** Permissions were only defined in code (D-013), the Permissions page was a read-only
  matrix, and there was no write path at all (no table, no action, no `permissions.manage`). Nothing was misconfigured; the feature did not exist.
- **Permission editor** (`/admin/permissions`). Permissions stay defined in code. The database stores only **deviations** from the built-in
  defaults (`role_permission_overrides`: role, permission, granted); a permission set back to its default removes its row, and a permission
  added to the code later reaches every role as written there. The effective rules are loaded from the database at the start of every
  signed-in request and held on `globalThis` (Next.js bundles pages, actions and route handlers separately, so a module-level copy would
  diverge), so `can()` stays synchronous and every one of its ~120 call sites follows the stored rules. If that read fails the request fails;
  falling back to the defaults could give back a permission that was taken away.
- **`permissions.manage`** (new): held by Superadmin only. Admin keeps `permissions.view`. Both the page and the action call
  `requirePermission("permissions.manage")`, and `savePermissionChanges` re-reads the stored actor and the stored rules inside a transaction
  (`LOCK TABLE ... SHARE ROW EXCLUSIVE`, so one editor at a time), so a forged form or a session that claims another role changes nothing.
  Changes are all-or-nothing and write one `permissions.updated` audit event per role with the before and after.
- **Guards** (`PERMISSION_GUARDS`, enforced when saving and again when the rules are computed, so even a bad row cannot lock anyone out):
  Superadmin always keeps `permissions.view`, `permissions.manage`, `users.view`, `users.manage`, `users.manage-privileged` and
  `dashboard.superadmin.view`; `permissions.manage` and `users.manage-privileged` can never be granted to another role. Ordinary Admin users
  therefore cannot be given permission management by this screen.
- **Categories.** Every permission is classified exactly once into ten collapsible categories with a readable label and description
  ([permission-catalog.ts](../../src/domain/access/permission-catalog.ts)); identifiers are unchanged. The compiler (`Record<Permission, ...>`)
  and a unit test refuse a permission that is missing or listed twice. Each dashboard permission is its own checkbox.
  Actual behaviour was checked per permission (page, action and service call sites); descriptions say what is enforced, for example
  `requests.handover` decides the step after a completed BOQ or RFQ on any project, while assigning a PIC follows `requests.work.*`;
  `theme.switch` only decides who sees the theme control.
- **One Admin Dashboard.** `/dashboard/admin` and `/dashboard/superadmin` rendered the same widgets and the same data (only the title differed),
  so they now share one page titled **Admin Dashboard**. Both addresses and both permissions (`dashboard.admin.view`, `dashboard.superadmin.view`)
  stay, so existing assignments and links keep working and each can still be granted on its own. A role that holds both is offered one menu entry.
  What only a superadmin can do is unchanged and enforced where it always was (System, Backups, SLA policy edits, admin accounts); the dashboard
  shows those shortcuts only to a viewer who holds the permission. Sales, SOA, Purchasing, Finance and Management dashboards are untouched.
- **Development data cleanup** (`npm run db:cleanup-dev`, dry run by default, `--apply` in one transaction, development and test only). Applied
  to the development database on 2026-10-18 after a `pg_dump` (`backups/pre-dev-cleanup-2026-10-18.dump`):
  - *Test projects of 2026-10-17* (the day read in the application's time zone, UTC; the database computes the half-open day): a project is
    test data only if it was created that day through the project form (has a submission key), was not imported from the sales export and its
    company is a placeholder (`PT` and four capital letters). PRJ-035 "PT ABCD" and PRJ-036 "PT EFGH" with BOQ-MD-260001, RFQ-SO-260001 and
    RFQ-SA-260001 matched. The 34 projects of the sales export (PRJ-001..034) were looked at and left. PRJ-037 and PRJ-038 look like test data but
    were created on 2026-10-18, so they are only reported. A project is removed the way the application removes one (marked deleted, hidden from
    lists, charts and exports); its requests, status history, change log and audit events stay, because those tables are append-only and
    foreign keys restrict a hard delete. Notifications that only led to the hidden pages were deleted (18). The customers PT ABCD and PT EFGH
    stay as master data.
  - *Obsolete accounts* (the registry in `prisma/seed-users.ts`, synthetic `@example.invalid` accounts only, never an administrator, never one with a
    live session): found by scanning every foreign key to `users` in the catalog. No reference at all: deleted (`soraya`, `hendi.batam`,
    `jihan.batam`, `mira.batam`, `tim.batam`). Referenced by history: **deactivated and signed out, not deleted** (`gusti`: 2 audit events;
    `adityo`: 32 projects as Technical PIC, a request, its status history, an audit event), because deleting would break the audit trail and
    pointing 32 projects at another person would be a guess. Each action is an audit event.
  - The apply step recomputes the plan inside the transaction and stops if it differs from the reviewed one; a failing step rolls everything back.
- **Seeds.** `npm run db:seed` creates the role accounts, the Dzaki and Satrio Sales accounts, principals, solutions and PICs (through the
  application's services). `npm run db:seed:sample` adds five sample projects with BOQ, RFQ and PO requests at different stages and one project
  from an outside source. Every record has a fixed name or an idempotency key (`seed-dev-v1:...`), so repeating either command adds nothing and
  never overwrites a change made in the application. Routine seeding never deletes, resets or truncates. Migrations stay separate
  (`db:migrate:deploy`). The sales export is not part of the seed: it is real data and stays git-ignored.

## D-033 User Guide: interactive workflow chart and role-by-role steps

- **One page, every role.** `/guide` (header link "User Guide") needs only a signed-in session, no permission. Nothing on it is data: it describes the workflow,
  and what it highlights and links to follows the viewer's permissions.
- **One definition.** `src/domain/guide/workflow.ts` holds every step once (role, kind, action, input, output, recipient, grid position, step-by-step
  instructions, page links) and the arrows between them. The flowchart, its popovers, the list for small screens and the role tabs are all drawn from it.
  `role-guides.ts` keeps "Can read", "Can edit" and "Cannot" apart for each role (everyone reads, only the owner edits).
- **Highlighting from permissions.** A role's lane is highlighted when the account's own role is that role, or when the account holds every permission in
  `GUIDE_ROLE_CAPABILITY` for it (an Admin therefore lights Sales, SOA, Purchasing, Finance, Management and Admin, not Superadmin). The function takes a
  list of roles, so an account with several roles is highlighted for all of them. Colour has one meaning on the chart, the viewer's roles; a step's role,
  kind and next recipient are text and icons, and arrows differ by line style (handoff thick, within a role thin, information or setup dashed).
- **Interaction.** Hover, focus, click, tap or Enter open a step's details; Escape, the close button, a click on empty chart or a second click closes them.
  The popover is fixed to the screen (never clipped by the chart's scrolling). The chart scrolls, drags and zooms (50% to 150%, fit to width); below `md` a
  list of the same steps replaces it.
- **Restricted detail.** The step-by-step instructions of Admin and Superadmin are not sent to the browser of anyone who does not hold those roles; links
  appear only for pages the viewer may open (each link lists the permission its page requires; a unit test compares it with the page's `requirePermission`).
- **Checked.** `tests/unit/guide.test.ts` pins each stated rule to the code that enforces it (flow order, who decides after a BOQ or RFQ, who works which
  request, read-only roles, reasons for cancelling and reopening) and checks the chart geometry (no overlapping steps, no arrow through a third step).
  `tests/e2e/guide.spec.ts` covers highlighting for all seven roles, hover, click, keyboard, zoom, tabs, role-specific links and the small-screen list.
- **Not covered.** The guide describes what exists today. Request attachments are not built, so the guide does not mention them. The BOQ,
  quotation and PO documents themselves are prepared outside the application; the guide says so.

## D-034 Gross-profit-only targets, customer industry, Sales revision requests

- **Sales Targets take gross profit only.** The target form has no revenue box. Revenue stays on the Sales Targets scorecard as **won (after the PO)** and
  **weighted forecast**, with no target and no "reached" column. `sales_targets.revenue_target` is kept (no data is dropped): a value saved by an
  earlier version is never shown, changed or lost, and clearing the gross profit target keeps a row that still holds one. A save is an update or a create,
  not an upsert: an upsert proposes an insert first, and a row with no target at all breaks the table's check.
- **Customer industry.** `customers.industry` (nullable text, migration `20261025100000_customer_industry`) is filled in on the Customers page: the customer's
  name opens a window with an Industry box that suggests the industries already in use. New permission `customers.edit` (Sales, Admin, Superadmin: the roles
  that open the page). Charts, filters, the project page and exports use the customer's industry first and fall back to the free text a project carried from
  the sales export (`effectiveIndustry`). Any role with `customers.edit` may edit any customer's industry (a customer is shared master data, not one salesperson's).
- **Sales revision requests.** New permission `requests.revise` (Sales, Admin, Superadmin). On a **Completed BOQ** the request page shows "Request a revision"
  with a required reason (up to 500 characters). The BOQ moves straight to Revision (the first completion date is kept, so the SLA does not run late), the reason
  is in the status history and the audit log, and SOA (the team and the project's technical PIC) is notified. A salesperson may do it only on a project they act on
  (their own, or one from another source). RFQ and PO have no Revision status: Purchasing reopens them. Revision notifications (this one, and SOA moving a BOQ to
  Revision on the board) are red in the list with the word Revision, and the bell badge turns red while one is unread; a banner on the request page keeps
  "In revision" and the reason in view.

## D-035 One-letter code prefix, RFQ tracker import, SQL for a new database, indexes

> Amended by D-036: the mail-id columns and `responded_at` described below were dropped a day later, and the SOA senders are PICs, not accounts.

- **Date:** 2026-10-20 · **Status:** Implemented (migrations `20261026100000_code_prefix_and_request_email`, `20261026110000_code_prefix_max_length`, additive)
- **Request code prefix** (`users.code_prefix`, unique). The prefix is the **first letter of the person's e-mail address** (`satrio.akbar@` gives `S`, `adityo.prabowo@` gives `A`, as in the
  tracker's own `RFQ-A-260002`). If another person already holds that letter, the next person takes the **first two letters** (`soraya@` gives `SO`), then three; a code has room for three
  characters only (`requests_code_format_chk`), so after that comes two letters and a digit. It is chosen the first time the person raises a request, under an advisory lock, and kept, so a code never
  changes. Requests that already exist keep their codes (`BOQ-SA-...`); a person's numbering for the new prefix starts at 1.
- **RFQ tracker import** (`npm run db:import-rfq`, dry run with `--dry-run`; development and test only; one transaction; only adds; safe to repeat). The sheet's 27 tickets became 27 RFQ
  requests with their status history, PIC assignment and projects. Rules, all in `src/server/import/rfq-tickets.ts`:
  - Status: Done is Completed, Failed is Cancelled (the note is the reason), On Going is In progress, Baru is Submitted. Dates in the sheet carry no time: a ticket came in at 09:00, was answered
    at 15:00 and an undated outcome is set at 17:00 (Asia/Jakarta); these times are assumptions. `Tanggal Response` is stored as `requests.responded_at` (new), set by the application the first time a
    request is taken up or completed. `LinkEmail`, `MessageID` and the conversation id are stored on the request (`email_link`, `email_message_id`, `email_conversation_id`).
  - Every RFQ belongs to a project, so each ticket made one (one per customer and project name). A sender who is a Sales account owns it; Gusti's go to Satrio (D-031); an SOA or admin sender (Adityo,
    Ibnu) has no Sales PIC, so the project is source Other with their name. A sender with no account is created **inactive, with a password nobody knows**, only so history can name them.
  - "Gita & Soraya" is two people but a request has one PIC: the first is assigned and the whole text is kept in the description. Tickets that already have an id keep it.
  - Applied to the development database on 2026-10-20 after a `pg_dump` (`backups/pre-rfq-import-2026-10-20.dump`): 27 requests, 27 projects (3 source Other), 5 code prefixes.
- **SQL for a new database** (`npm run db:rfq-sql`, writes `prisma/data/hit_rfq_tickets_import.sql`, touches no database). It is generated from the same plan, so it cannot disagree with the importer:
  loaded into an empty database (migrations, `db:seed`, then the file) it produced rows identical to the importer's on every compared column. One transaction, only adds, repeatable.
  It holds customer names and e-mail addresses, so it stays in the git-ignored `prisma/data/`.
- **Database review and optimisation.** The tables already follow the business flow (project, then BOQ, RFQ, PO with their history), so the schema was not rebuilt: a rebuild would mean dropping
  tables that hold history, which the safety rules forbid, and nothing in the flow required it. What was added: the e-mail and response columns above and three indexes on foreign keys that had none
  (`requests.requester_id`, `projects.solution_category_id`, `audit_events.actor_id`). Measured on 80,000 requests and 120,000 audit events (rolled back afterwards): the requests of one person
  6.4 ms to 0.3 ms, the audit events of one actor 6.2 ms to 0.4 ms. Left alone on purpose, as candidates for a later reviewed migration: the deprecated columns `projects.stage`, `projects.status`,
  `requests.assignee_id` and their indexes.

## D-036 SOA PICs raise tickets, response date as a status step, columns taken out

- **Date:** 2026-10-20 · **Status:** Implemented (migrations `20261027100000_request_trim_and_raiser`, `20261027110000_drop_deprecated_columns`). The product owner asked for the column removals; both migrations drop data, so a `pg_dump` was taken first (`backups/pre-column-cleanup-2026-10-20.dump`, `backups/pre-rfq-rebuild-2026-10-20.dump`).
- **Dropped from `requests`:** `email_link`, `email_message_id`, `email_conversation_id` (the mail ids are not kept) and `responded_at`. The sheet's `Tanggal Response` is now what it means: the request moved to **In progress** on that date, a row of the status history (Submitted to In progress at 15:00 Jakarta time, then the outcome at 17:00 the same day; both times are assumptions, the sheet has dates only). The note is the reason of the last move. A Failed ticket without a response date goes straight from Submitted to Cancelled.
- **Dropped as deprecated:** `projects.stage` and `projects.status` (replaced by `progress` and `track_status`; the export's values had been mapped into those at import, 65 projects held stage and status values that are now gone), `requests.assignee_id` (replaced by `pic_id`; 3 requests still held a value), their indexes and foreign key, and the enum types `ProjectStage` and `ProjectStatus`. The CSV reader still understands the export's Stage and Status columns (`src/domain/projects`), because the sales-export import maps them into progress and track status.
- **SOA people are PICs, not accounts.** Adityo and Ibnu are SOA PICs. A ticket they send is raised through the shared SOA login (`soa@`) and names the person in the new `requests.raised_by_pic_id` (a PIC of team SOA; shown as "Requested by Adityo (SOA PIC, through the shared SOA login)"). Their projects have source Other, no Sales PIC and no Sales name: the person is the project's **Technical PIC (SOA)** (`projects.technical_pic_id`; Adityo's account exists, Ibnu got an inactive SOA account with a password nobody knows, only so the column can name him). The database wants a name for source Other, so it reads `Internal SOA request`. `adityo@` stays inactive because 32 projects name it as Technical PIC. There is no form field for the SOA PIC yet, and SOA still may not raise an RFQ in the application (`requests.create.rfq` belongs to Purchasing and Admin; Sales raise any request with `requests.create`): the data allows it, the permission is a separate decision.
- **Code prefix for a SOA ticket.** The shared login has one prefix like any account (`SO`, because `S` is Satrio's), so a SOA ticket without a code in the sheet is `RFQ-SO-...`. A code the sheet already has (`RFQ-A-260002`) is kept and its number is counted, but the login does not take the letter `A`. Prefix per PIC instead of per login is possible but would need a prefix on the PIC; not done.
- **Rebuilding tickets that were loaded before.** The status history is append-only, so tickets of the first load could not simply be corrected. `npm run db:import-rfq -- --rebuild` (dry run first) replaces the history and PIC assignments of the requests this import made, and only those, inside one transaction in which the two append-only triggers are switched off and on again; it refuses a request that anything other than the import touched, keeps the codes the tickets already have while they fit their prefix, and writes an `import.rfq_tickets_rebuilt` audit event. Applied to the development database: 52 history rows replaced, 1 ticket recoded (`RFQ-I-260001` became `RFQ-SO-260002`), the prefixes `A` and `I` released.
- **Projects for tickets without one.** Confirmed by the product owner: a ticket whose project does not exist gets a new project (one per customer and project name), as the importer already did.
- The SQL file for a new database follows the same rules and was loaded into an empty database and compared with the development database: identical except the number `RFQ-SO-260002`, which is 260001 in an empty database.

- **Purchasing and SOA dashboards (D-036).** Both teams show the same summary above their SLA numbers: Total, Done, Completion rate (done over total; cancelled requests count in the total), On going (In progress), a donut of requests by status and a bar chart of requests per PIC. Every active PIC of the team has a row, with 0 if none (Purchasing's Gita and Soraya), and unassigned requests are a last row. The difference is what each counts: SOA its BOQ requests, **Purchasing its RFQ and PO requests together** (before, Purchasing counted RFQ only and mentioned the open POs in a sentence). The request list takes `?types=RFQ,PO`, so every Purchasing number links to the list behind it.

## D-037: Seed, importer and tests use the Neon accounts (2026-10-23)

The Neon and local databases had been edited by hand to company accounts. The product owner asked that the seed that still created `@example.invalid` accounts be updated to `@halcominovasi.co.id`.

- **Accounts (`src/domain/devdata/accounts.ts`).** `DEV_EMAIL_DOMAIN = "halcominovasi.co.id"`. One account per role named by its label (Superadmin, Admin, SOA, Purchasing, Finance, Management); SOA signs in as `support@`; Sales are Dzaki and Satrio, and there is no generic `sales@`: the Sales role of the tests is Satrio. The seed never runs against Neon (it refuses outside development or test).
- **PICs.** The seed creates Adityo and Ibnu (SOA) and Gita and Soraya (Purchasing), the PICs Neon has; "SOA PIC 1/2" and "Purchasing PIC 1" are gone.
- **RFQ import.** Gusti, Adityo and Ibnu have no account any more: a Gusti ticket is Satrio's (requester and owner); a SOA person's ticket is raised through `support@` with the person as SOA PIC, and the Technical PIC (SOA) column holds `support@` (it takes an account). The shared SOA login keeps the request letters `SO` (it takes them from "soa", because `S` is Satrio's). Nobody is created only for history now; the support for it stays in the importer.
- **Not changed.** The development clean-up (`db:cleanup-dev`) still recognises synthetic `@example.invalid` accounts, so it can never delete a company account. Test fixtures that only need an address keep `@example.invalid`; the fake distribution lists in `compose.yaml` too.
- **Password.** The minimum length is 8 (it was 12), so the 9-character password set directly in the databases is valid.
- **Sign-in sheet.** `DEV_ACCOUNTS.md` is generated from the database; the Sales role account is listed with the Sales people, and the "obsolete accounts" registry is empty.

## D-038: Sales Pipeline analytics: Pipeline Conversion and Pipeline Growth (2026-10-23)

**Audit result.** Before this, the application stored no history of a project's stage. `projects.progress` is overwritten in place; `project_changes` logs only some edits (one `progress` row in the development database) and `audit_events` has no stage events for most paths. Imported projects have none at all. So a chart of past stage distributions could not be made truthfully, and none is made up.

- **KPI cards.** Open projects, Open pipeline, **Pipeline conversion**, Estimated gross profit, Won. The Weighted pipeline tile is gone (the weighted numbers are still in the exports and the "Weighted value by salesperson" chart, and `?show=weighted` still works for old links).
- **Pipeline Conversion = open projects at Propose or beyond / open projects x 100.** Open is the dashboard's definition: not Closed Won, not Closed Lost, Status not Done. Propose or beyond = Propose, Negotiate, Negotiate (FU), Agree. Closed Won and Closed Lost leave both sides (Won has its own tile). A zero denominator shows N/A. It is the share of *today's* open pipeline that has reached the quotation step. It is **not** a historical conversion rate: that needs stage history and a cohort definition, which the data cannot give yet. The tile opens `/projects?show=quoted`.
- **Stage history (migration `20261028100000_project_progress_history`).** Append-only table `project_progress_history` (project, from, to, time, person if known, source). A **trigger on `projects`** writes a row when a project is created and whenever `progress` changes, in the same transaction, so every path is covered (forms, imports, the SQL load files) and none can forget. The time is the database clock at the moment of the change, never a backdated value. The person comes from the transaction setting `app.actor_id` (`setActor`), set when Sales or SOA edit a project and when a project is created; elsewhere it stays empty. The migration also wrote one **baseline** row per existing project (its stage at that moment). The history therefore starts at the migration: **the earliest reliable date is the migration time of each database**, shown in the chart as "stage history starts on ...". Periods that ended before it have no point and the line breaks there.
- **Pipeline Growth.** Three exclusive groups: Opportunity (Qualify, Understand), Quoted (Propose, Negotiate, Negotiate (FU), Agree), Closed Won; Closed Lost is in none and a stage the code does not know is not guessed into a group. Each point is the number of projects in each group at the **end of the period** (the running period: now). Eligible total = Opportunity + Quoted + Closed Won at that moment; percentage = count / eligible total, 0 for an empty total. Weekly (ISO weeks, Monday first, 12), Monthly (calendar months, 12), Quarterly (calendar quarters, 8). Boundaries are midnight **Asia/Jakarta** (UTC+7, no daylight saving). The three cards under the chart are the last period against the one before it, made from the same points as the chart ("N/A" without earlier data, "New" from zero; a fall is not called bad).
- **Query.** One parameterised statement (`src/server/projects/growth.ts`): per period moment, `DISTINCT ON (project_id)` the latest history row at or before it (ties broken by the row id, which is time-ordered), keeping projects not deleted at that moment, counted in the database. No join to a table with several rows per project, so nothing is counted twice. The only index is the one the lookup needs on the new table (`project_id, changed_at DESC`). A salesperson's scope is the project's owner today (a later owner change is not replayed).
- **Endpoint.** `GET /api/pipeline-growth?granularity=weekly|monthly|quarterly` (no-store, 401 without a session, 400 for another value). A salesperson gets only their own projects; the server decides the scope. The chart is a client component that fetches on a change of period without reloading the page, aborts the earlier request and ignores a late answer to an older choice, and shows loading, empty and error states and a table of the same numbers.
- **Kept.** The value-by-progress column chart ("Pipeline by progress") and the funnel stay: they show money per step, which this chart does not.
- **Limits.** Until history has built up, the chart is mostly the present distribution plus whatever has changed since the migration; it must not be read as a trend before that. A project hard-deleted in the future would fail the foreign key (projects are soft-deleted).

## D-039: The three production blockers, and a deployment to Vercel (2026-10-24)

T-7, T-8 and T-9 were the reasons this application could not be put in front of real users. All three are built, and the deployment they were blocking is prepared for Vercel with the database on Neon.

- **T-7, slowing down guessing.** A new table `login_attempts` counts failed sign-ins twice: against the e-mail that was typed and against a SHA-256 of the client address. Five failures on one e-mail, or twenty-five from one address, inside a fifteen-minute window lock it; the lock starts at fifteen minutes and doubles for every further block of failures, up to an hour, and never longer. A permanent lockout was rejected on purpose: it would let anyone keep a colleague out by typing a wrong password often enough. The count is kept for addresses that belong to nobody as well, so being locked out never tells an outsider which addresses are real, and the rules are pure functions in `src/domain/access/login-throttle.ts` with the state in the database, not in memory, because the application runs as several instances (on Vercel, as short-lived functions).
- **T-8, the first superadmin.** `npm run db:bootstrap-superadmin` (`src/server/auth/bootstrap.ts`) creates exactly one account, and only while the database has no superadmin at all; a second run reports who already has the role and writes nothing. The password is read from the environment, never from the command line, the account is created under an advisory lock so two runs cannot both succeed, and the creation is audited as `user.bootstrapped`.
- **T-9, a password somebody else chose.** `users.must_change_password` is set when an administrator creates an account, when an administrator resets a password, and by the bootstrap. While it is set, `requireUser` sends every page and every server action to `/password-change`, a page outside the application shell, so the flag cannot be walked around by calling an action directly; choosing a password clears it. Every refused sign-in is now audited (`auth.login_failed`, `auth.login_locked`), which was the second half of the question.
- **Deployment.** [deployment/VERCEL.md](../../deployment/VERCEL.md) is the runbook: environment variables, migrations run from a machine (never from the build, so a failed build cannot half-apply a schema), the bootstrap, the project settings, a first-deployment checklist, and what to do when the schema changes. `vercel.json` fixes the framework and the Singapore region; `prisma generate` runs both in `postinstall` and in `build`, because Vercel's dependency cache would otherwise reuse a client generated against an older schema.
- **Backups do not work there.** The Backups page shells out to `pg_dump` and writes to a host folder, which a serverless function has neither of. The page now says so and the action refuses, rather than offering a button that fails; Neon's point-in-time restore takes its place. Retention (T-11) is still undecided.
- **Plan (decided 2026-10-25).** Hobby, with the owner's eyes open: Vercel's plan terms say Hobby is non-commercial and personal, and an internal company tool is a grey area Vercel has not settled publicly. The cost of being wrong is a suspension, not a bill, and the way out is an upgrade to Pro; nothing in the code is Vercel-specific beyond `vercel.json` and the Backups notice. Hobby also keeps Deployment Protection to preview deployments only, so previews of `development` are put behind Vercel Authentication and the production domain stays public, which is harmless because the application shows nothing without a sign-in.
- **Throttle numbers (confirmed 2026-10-25).** Five failures per e-mail, twenty-five per client address, a fifteen-minute window and a lock of fifteen to sixty minutes, as proposed. They are five constants in `src/domain/access/login-throttle.ts`.
- **Branches.** `main` is what Vercel deploys to production; `development` replaced `wip/single-view-master-data` and gives a preview deployment with its own URL and its own environment variables.

## D-040: Dates by day, stage dates tied to Progress, whole-list sorting, Indonesian guidance (2026-10-25)

Four changes the product owner asked for after the Vercel deployment.

- **Dates are shown as a day.** `formatDay` (`src/features/dashboards/format.ts`) shows `17-10-2026`, the calendar day in Asia/Jakarta, instead of `2026-10-17 04:03 UTC`. Only the display changed: stored timestamps, columns, APIs and exports are untouched.
- **Three stage dates, one meaning each.** Opportunity date is `projects.created_at` (Sales correct it on their own projects, never empty, never in the future); Quoted is the quote released date (reaching 30% - Propose); Closed Won is the won date (100%). They follow Progress in both directions: moving Progress fills today's date as before, and entering a Quoted or Won date by hand moves Progress forward (Opportunity to Propose, anything to Closed Won). A date never moves Progress back. Every change is in the change log.
- **Pipeline Growth counts from the creation date**, so every period has numbers. A project's group at a moment is its latest stage-history row at or before it; before its first history row it is Quoted from its quote released date and Closed Won from its won date when the first recorded stage agrees, otherwise Opportunity. The chart says so under it. (This supersedes "no point before the history starts" of D-038.)
- **Overview: Pipeline conversion by salesperson** replaces "Weighted value by salesperson": each Sales PIC's open projects at Propose or beyond over their open projects, highest first, bars on a fixed 0-100 scale, the note says "n of m open", and the bar opens that person's open projects. People with no open project are left out. The weighted numbers stay in the exports and the table.
- **Sorting covers the whole list.** The Projects table's heading links sort every matching project (`searchProjects`: Project ID, End user, Project, Progress, Status, Source, Sales PIC, Technical PIC, Estimated, Target closing; blanks last) before a page is cut out, so Rows per page only changes how many are shown. Before, the generic click-to-sort of `Table` reordered only the rows on screen. A heading that is a link is never sorted that way.
- **Indonesian guidance, English names.** Explanations (module descriptions, field hints, placeholders, validation and refusal messages, empty states, chart and tile notes, the User Guide) are Indonesian. Module, page, field, button, status and role names, identifiers and `where`/`editable` paths in the guide stay English, so a step can be followed on screen word for word. Success confirmations ("Saved and logged", "Password changed.") and a few status words are still English.

## D-041: The SOA phase belongs to the project, not to a BOQ request (2026-10-26)

SOA phases (Assessment, Sizing, POC and any an Admin or Superadmin added, see the technical-sections work) described the stage of the technical work, yet the phase sat on a BOQ request. A project with no open BOQ, or with a BOQ that was completed or cancelled, could not show it, and a second BOQ on the same project could contradict the first. The product owner decided the phase is a project fact.

- **Where it lives.** `projects.phase` (a key of `soa_phases`, foreign key `RESTRICT`) replaces `requests.phase`, which is dropped together with its BOQ-only check. Migration `20261101100000_soa_phase_on_project` first copies, for each project, the phase of its most recently updated BOQ that had one, so nothing already recorded is lost. Switching a phase off in the list still keeps it on the projects that hold it.
- **Who sets it.** The same people as before (`requests.work.boq`: SOA, Admin, Superadmin), through `setProjectPhase` (was `setRequestPhase`), in the Technical tab of the project (a "SOA phase" block); everyone else sees it read-only. A phase can be set on a project with no request at all, and it stays when a BOQ is cancelled. The request page, the request table and the BOQ board no longer show a phase.
- **What it no longer does.** Setting a phase used to start an untouched BOQ (Submitted to In progress). It no longer does: a BOQ changes status only through its own status control, since the phase is not about one request.
- **Audit and notifications.** `project.phase_changed` (entity `project`) replaces `request.phase_changed`; Sales owner and teams are told with a link to the project. Old audit rows and notifications of the earlier kind are left as they are.
- **Tests.** Integration (`notifications`, `flow`, `technical-sections`) and E2E (`work`, `technical-sections`) were rewritten for the project-level phase; the "BOQ nobody touched starts" and "database keeps a phase off RFQ/PO" cases were removed with the behaviour.

## D-042: Superadmin, Admin and SOA can rename a project (2026-10-26)

A project's name was written once, at creation, and nobody could correct it (only the end user, by a Superadmin, through the customer). The product owner asked that Superadmin, Admin and SOA can change it, and that it be a permission.

- **Permission.** `projects.rename` (category project management, "Rename projects") is in the default set of SUPERADMIN, ADMIN and SOA; it shows on `/admin/permissions` and a Superadmin can change it there like any other.
- **Behaviour.** `renameProject` (`src/server/projects/rename.ts`) trims and single-spaces the name (1 to 160 characters), rechecks the stored role inside the transaction, writes one change-log row (field `name`, shown as "Project name", old and new value), the audit event `project.renamed` and a notification to the project's people. Saving the same name writes nothing. The request codes, the project code and the end user are untouched.
- **Where.** A "Nama project" box in the Overview of the project page, shown only with the permission.
- **Also.** The forms that kept showing the old value after a successful save (React 19 clears a form after its action) were rebuilt from the saved value (key on the form), and the PIC Workload chart says it counts only open projects.

## D-043: Change a user's e-mail, export projects in the import format, one Edit window per account (2026-10-27)

- **E-mail.** `users.change-email` (Superadmin only, locked for Superadmin, cannot be granted to another role) lets a Superadmin change the address an account signs in with: `changeUserEmail` lowercases and validates it, refuses an address another account has and the Superadmin's own account (a typo would lock them out), and audits the old and new address (`user.email_changed`). Password and sessions are untouched.
- **Export in the import format.** `/export/projects?format=import` (the Export data window and the Import window both offer it) writes the projects into the import template: same columns and order as `templateHeaders()`, values written the way the import reads them (`importRowOf`). The margin is written as the percentage or the amount, whichever was entered, never both. The file imports back as it is: every Project ID exists, so every row is a duplicate and is skipped. Each export is audited.
- **Users page.** The Actions column has one button, Edit, which opens a window with e-mail (Superadmin), role, password and activate/deactivate. The window stays open after each change so the message can be read.

## D-044: Bulk update of projects from an Excel sheet (2026-10-27)

The product owner asked that the import, given a Project ID, act as a bulk update, including the Sales PIC, the end user and the principals (several per project).

- **Mode.** The Export/Import window offers "Update existing projects" next to "Import new projects" to those holding `projects.bulk-update` (Superadmin and Admin; the permission is in the editor). The intended use: export in the import format, edit, upload. Rows are matched by Project ID; a row with no ID or an unknown one is skipped (it is not created), the same ID twice in a file is a problem.
- **What changes.** A filled cell that differs from the project is a change; an empty cell changes nothing (it never clears a value). End user (moves the project to that customer), project name, description, Sales PIC (an active Sales account, by e-mail or an unambiguous name; the cell that names the current owner is no change), Progress, Status, estimated value, target margin (percentage or amount), quote released and target closing (planned with the same stage-date rules as the project form, `planCommercialChanges`), principals (the cell replaces the whole list; the first is the main one), solution, industry and location. Never changed here: Project ID, project source and its external sales name, the Current and Next action feeds.
- **Safety.** The file is applied whole or not at all, and any problem row refuses it. A project whose Last updated differs from the sheet's new "Last updated" column (written by the export, ISO timestamp) is refused as changed since the export; an empty cell skips that check. A customer, principal or solution that does not exist yet is listed and needs an explicit confirmation before it is created, so a typo cannot add one unnoticed.
- **Trail.** One change-log row per changed field and an audit event per project (`project.commercial_updated` for the commercial fields, `project.bulk_updated` for the rest), one audit event for the file (`import.projects_update`); a Sales PIC change notifies the old and the new owner.
- **Permission note.** Admin may change a Sales PIC through this door only; `projects.reassign` (the Owners card) stays with the Superadmin.
- **Template.** The import template gained a last column, "Last updated" (ignored when importing new projects).

## D-045: SLA as two modules in Indonesian, with the e-mail recipients; the import window in Indonesian (2026-10-30)

- **Two modules.** "SLA Policies" is split into **SLA SOA** (`/admin/settings/soa`) and **SLA Purchasing** (`/admin/settings/purchasing`), one menu entry each, both behind `settings.view` (read for Admin, change for Superadmin, as before). `/admin/settings` redirects to the first. The page, its form, the messages and the template-variable labels are Indonesian; the variable names (`{{request_id}}`) and the template text itself are unchanged.
- **Where the e-mail goes.** Each team has a **To** and a **Cc** in its module (`team_settings.email_to`, `email_cc`, migration `20261102100000_team_email_recipients`). They are validated (an invalid address refuses the save), de-duplicated, and an address in To is not repeated in Cc; the change is audited with the old and new addresses. They are the recipients of the request e-mail panel and the mail draft for every request the team receives (SOA: BOQ; Purchasing: RFQ and PO). An empty To keeps the earlier behaviour: the server's `EMAIL_TO_HIT*` / `EMAIL_CC_HIT*` settings apply, so nothing configured before changes.
- **Form keeps its message.** The page no longer rebuilds the form on every save (the saved message disappeared with it); the form rebuilds its boxes from the saved values instead.
- **Import window.** The Export/Import window (title, steps, column help, results, confirmations) is Indonesian. The column names of the template stay in English because they are the names the importer matches.

## D-046: A customer's industry is chosen from a list that Admin and Superadmin edit (2026-10-30)

The industry was free text, so one industry came in several spellings. It is now a dropdown on the customer window.

- **The list.** Table `industries` (migrations `20261103100000_industries`, `20261103110000_default_industries`). It starts with the ten industries the product owner gave (Public Sector & Government, Manufacturing, Retail & E-Commerce, Healthcare (Kesehatan), Telecommunications, Financial Services, Logistics & Transportation, Education, Hospitality & Tourism, Oil & Gas) and every industry already in use, so no customer is left on a name that is not listed.
- **Who edits it.** Permission `industries.manage`, default Admin and Superadmin (it can be changed in the permission editor). It is on the Master Data page, "Industri customer": add, rename, delete. A name that exists (ignoring case and spacing) is refused; renaming moves every customer and project that carries the name; deleting is refused while a customer or project still uses it. All audited.
- **Who chooses.** Whoever may edit customers picks from the dropdown. `setCustomerIndustry` refuses a name that is not on the list and writes the list's spelling; a customer already on a name that left the list keeps it (saving the same value changes nothing). The customer keeps the name as text, so charts, filters and exports are unchanged.
- **Not covered.** The Excel import and bulk update still take any industry text for a project; they do not check it against the list.

## D-047: Master data page as tabs, with searchable paged tables and one Edit window per name (2026-10-30)

The master data page had grown long (every list, every rename and delete form in the open). It is now tabs: Principal, Solution, Industri, Technical sections and SOA phases (the last three where the permission allows), each with a count.

- **Lists.** Principal, Solution and Industri are tables with a search box and pages of ten. A row shows the name, how many projects use it (customers, for an industry) as a badge or "Belum dipakai", and one **Edit** button.
- **Edit window.** Rename (with a note that it changes everywhere the name is used) and delete in one window; Hapus is off, with the reason, while the name is in use. Same services and rules as before; the window stays open after a rename so its message can be read.
- **Not changed.** Technical sections and SOA phases keep their own row forms inside their tabs.

## D-048: Charts that count projects rank by count (2026-10-30)

The Solution mix is a count of projects, but the slices were chosen by estimated value, so "Component" (the most projects, 21, with little money) fell into "Other". `topSlices` now takes a ranking: the Solution mix and Projects by principal (`byPrincipalCount`) rank by number of projects; Value by principal and Value by industry keep ranking by value. At most seven names show, the rest fold into "Other", and every slice still opens the Projects list.

## D-049: SOA SLA in two tiers, and freeze of the SLA clock for urgent tenders (2026-10-30, decided, not built)

The latest SOA SOP says the BOQ SLA is longer when a project spans many brands (mixed), and that the SLA of the BOQs in hand may be held (frozen) when a tender must be finished fast. This records the design agreed with the product owner. Nothing is implemented yet.

- **Two tiers.** Standard: 1 to 3 working days. Mixed (several brands): 4 to 5 working days. The tier comes from the project's principals (`project_principals`), not from the PIC's judgement: one brand is Standard, two or more is Mixed. Inside a tier the range is set in the SLA SOA module, as the range already is. The tier and the SLA days used are stored on the BOQ when it is created and again when the principals change, so reports do not shift later.
- **Freeze pauses the clock, it does not move the date.** Each freeze is an append-only interval (frozen at, resumed at, reason, the tender BOQ that caused it, who approved). Remaining time = SLA days minus the working time used before the freeze; the new due date = resume time plus the remaining time. Weekends and holidays are skipped, as in the current SLA. Example: a 5-day Mixed BOQ opened Monday, due next Monday; frozen Wednesday 09:00 (2 days used), resumed Friday 09:00: due Wednesday, two working days later, exactly the length of the freeze.
- **Who.** Superadmin, Admin and the SOA team may freeze and resume (a new permission, in the permission editor). **Scope: the whole SOA team**: every open BOQ of the team is frozen together, except the urgent tender's own. A freeze has a maximum length; past it, it escalates to Admin and the owning Sales. The freeze ends by itself when the tender BOQ is completed or put on hold.
- **When a tender needs it.** Slack = tender deadline minus now minus the work left. At zero or below, the SOA lead and Admin are notified with the list of BOQs that can be frozen. With slack above zero no freeze is needed.
- **Escalation ladder** (share of SLA used, frozen time not counted): 50% reminder to the PIC; 80% warning to the PIC and the SOA lead; 100% breach to Admin and the owning Sales with the reason.
- **Honest reporting.** Turnaround and SLA compliance show two figures, calendar and net of freezes, and the frozen days as their own column, so a freeze cannot hide a breach. A Mixed BOQ is judged against its own tier.
- **Open before building:** the longest freeze allowed, and the exact number of working days a Standard BOQ gets by default inside 1 to 3 (and 4 or 5 inside Mixed, for example by the number of brands).

## D-050: Each role fills in its own part of the Excel sheet (2026-10-30)

The Export/Import window was for Admin and Superadmin (update) and Admin and SOA (add). It now serves every role that works on projects, and the sheet is cut by role.

- **Who.** `projects.bulk-update` is also held by Sales and SOA (Admin and Superadmin as before); adding projects (`projects.import`) is unchanged: Admin, SOA and Superadmin. A role that may only update sees one template, "Unduh data project Anda". Project source Other is registered by SOA, Admin or Superadmin, never by Sales.
- **Scope from permissions** (`src/domain/projects/import-scope.ts`, so the permission editor changes the sheet). Everyone gets Project ID, End user, Project name, Description, Current/Next action and Last updated. Commercial columns (Progress to Target closing, including the money) go to `projects.edit.commercial`: Sales, Admin, Superadmin. Principals and Solution go to `projects.edit.technical`; Sales PIC, source and external name to `projects.edit.source`; End user, Project name and Description are changed by `projects.rename` holders. Industry and Location go to Sales and SOA both (and Admin).
- **SOA does not see the money.** Its template and export carry none of the commercial columns, so the estimated value and the margin never reach an SOA file. This applies to the sheet only; the project page is unchanged.
- **Sales sees only its own rows.** The export holds the projects they act on (their own and Other), and the update refuses any other Project ID.
- **Enforced on the server.** A column outside the role's part may be added to the sheet by hand; if its cell differs from the stored value the row is refused with the column named, and nothing changes. A cell equal to the stored value is no change.
- **Industry is the customer's.** The update sets the customer's industry (it wins over the project's), the name must be on the list (any spelling of case and spacing is matched, the list's spelling is written), two rows may not give one customer two industries, and each change is audited as `customer.industry_set`. This replaces the earlier behaviour of writing a project-level industry. The create import still takes any industry text.
- **Tests.** Integration: scope of the columns, SOA refused a commercial change, Sales own rows only and refused a technical column, industry on the customer. E2E: Sales updates its own project from a sheet; SOA is refused a commercial column; the SOA and Sales export headers.

**D-050 addendum, Technical PIC column (2026-10-30).** The sheet gained **Technical PIC (SOA)**, in the technical part (SOA, Admin, Superadmin). The cell holds the name of an active person of the SOA PIC list (any letter case); the cell naming the current PIC is no change; a name not on the list refuses the row; Sales are refused a change. Each change is logged as Technical PIC (SOA). This lets SOA set the Technical PIC, which was Superadmin only (`projects.reassign`) on the project page; the page itself is unchanged. The create import ignores the column.

## D-051: PIC Workload leaves out projects with no SOA PIC (2026-10-30)

Not every project involves SOA, so "Not set" in the SOA PIC Workload chart counted projects that never needed a PIC and hid the real workload. `bySoaPic` now counts only open projects that have an SOA PIC; the card text says projects without one are not shown. Every other chart, and the Projects list filter for "Technical PIC: Not set", are unchanged.

## D-052: The industry is the customer's alone (2026-10-30)

Industry was kept on two levels: the customer (chosen from the list) and a free text on the project that came from the sales export, used when the customer had none. Seventy of 71 projects carried the text while only 1 of 42 customers had an industry, so the customer pages and the dashboards disagreed. The industry is now the customer's only.

- **One source.** Charts (Value by industry), the Projects filter, the project page and every export read the customer's industry. The project's own text is no longer read or written; its column stays (nothing deleted) as a record.
- **Backfill** (migration `20261104100000_customer_industry_from_projects`, applied on Neon): a customer with no industry takes its projects' industry when all its projects name the same one and it is on the list, written in the list's spelling. 29 customers were filled (30 of 42 now have one). Customers whose projects disagree (9), or whose single name is not on the list ("Telecommunications", "Healthcare": the list holds "IT & Telecommunications" and "Healthcare (Kesehatan)"), or with none (1), are left for a person to choose from the customer window.
- **Excel.** The update sets the customer's industry (D-050). The add-projects import no longer writes a project industry: a customer that has none takes the sheet's industry when it is on the list; otherwise it is ignored.
- **Removed** `effectiveIndustry` (customer first, then project) and its test.

## D-053: Projects table columns set by the Superadmin, row click, Sales PIC badge, container-responsive table, stale projects on the Overview (2026-11-02)

- **Columns for everyone.** A Superadmin (permission `settings.manage`) opens "Kolom tabel" above the Projects table and ticks which of End user, Project, Progress, Status, Principals, Sales PIC, Technical PIC, Last updated and Open requests show. Project ID always shows (it is the link). One choice for all users, stored in the new table `app_settings` (key `projects.columns`, migration `20261105100000_app_settings`), audited as `settings.project_columns`; an empty choice is refused, unknown names are dropped.
- **Whole row opens the project.** A click anywhere on a row goes to the project; links and buttons inside keep their own action and a text selection does not navigate. The Project ID link stays the keyboard way in.
- **Other is a badge.** The Sales PIC cell of a project from source Other showed "Name (external)" and "(Other)" together. It now shows the external name with an "Other" badge; internal projects show the Sales PIC alone.
- **The table follows the width of the page.** Columns are hidden by the width of the table's container (container queries), not of the window, so opening the sidebar no longer drops columns that would fit; text cells wrap instead of being cut. Status shows from 36 rem of content, the other optional columns from 48 rem.
- **Overview: 5 projects left longest without an update.** Open projects only, oldest "last update" first (the newest activity on the project: edit, action or request), showing project name (a link), end user and last update.

## D-054: One permission to change a project's description (2026-11-02)

The description of a project could only be filled in when it was created. Permission `projects.edit.description` (Superadmin, Admin and Sales by default; changeable in the permission editor) now lets those roles change it.

- **Page.** On the project page the description is a text box with "Simpan deskripsi" for holders of the permission; others read it as before. Sales may change it only on the projects they act on (their own and the Other ones); Admin and Superadmin on any. An empty text clears it; at most 2000 characters.
- **Log.** The old and new text go to the project change log and the audit log (`project.description_changed`), and the people on the project are notified. Service: `setProjectDescription`, which re-checks the stored account and permission.
- **Excel.** The Description column of the bulk update follows this permission instead of the rename permission (D-050): SOA, which may rename, is refused a description change in a sheet; Sales (own projects), Admin and Superadmin may.

## D-055: PPN basis of the value and the margin, set by the Superadmin (2026-11-02)

Sales enter the Estimated PO value with PPN and think of the margin and gross profit without it. The system treated both as one base: a margin percentage was taken of the value with PPN (10% of 111,000,000 gave 11,100,000, while the gross profit without PPN is 10,000,000), and a gross profit amount without PPN was divided by the value with PPN (10,000,000 / 111,000,000 showed 9.01% instead of 10%). Every margin figure was therefore off by the PPN rate.

- **Setting.** A Superadmin (`settings.manage`) chooses, on **Basis PPN** (`/admin/settings/ppn`, in the Administration menu; Admin reads it), whether Estimated PO value and Final value include PPN (default: include), whether Target margin and Estimated gross profit include PPN (default: exclude), and the PPN rate (default 11%, 0 to 30). Stored in `app_settings` (`pricing.tax-basis`), audited as `settings.tax_basis`.
- **Calculation.** The value is put on the margin's basis before the margin is worked out (`marginFactor`: value with PPN and margin without gives 1/1.11). A margin percentage is taken of that value; a gross profit amount is divided by it to give the percentage. With both on the same basis the factor is 1 and nothing changes. Used by the project page, the pipeline analytics (open target margin, pipeline rows) and the exports.
- **Stored data.** Nothing stored is rewritten: the entered value, percentage and amount stay as they were; only the figures derived from them change.
- **Labels.** The project page says which basis each figure has ("Estimated PO value (incl. PPN)", "Estimated gross profit (excl. PPN)"). The Excel columns and the commercial form keep their names (the import matches columns by name).
- **Not changed.** Sales targets and the Finance crosscheck compare values as entered; they do not know the basis, and the Final value is assumed to be on the same basis as the Estimated PO value.

## D-056: Email draft opens after Continue, Outlook .eml draft, margin typed as an amount, Tab in the name picker (2026-11-02)

- **Draft opens by itself.** "Continue to RFQ / PO" now leads to the new request with `?email=1`; the project page opens that request's email dialog ([HITRFQ] or [HITPO]) once, and the parameter is dropped from the address so a reload does not reopen it. Nothing is sent (D-017).
- **Outlook draft.** The dialog gets "Download Outlook draft (.eml)": a file with `X-Unsent: 1`, To, Cc, subject (RFC 2047) and the whole text (base64, UTF-8). Outlook opens it as an unsent message. A MailTo link cannot carry more than about 1900 characters, so a long request text came without its body; the file has no such limit. The MailTo button stays.
- **Target margin is an amount only.** The Percent choice is gone from the project forms; the box takes a number in rupiah and sends it as the fixed amount. A margin stored as a percentage is shown as the amount it comes to, so saving the form loses nothing. The percentage is still shown, computed from the value. The Excel import keeps its Target margin (%) column.
- **Tab in the name picker.** In the salesperson picker, Tab takes the highlighted match for what was typed (as Enter does) and moves on; with nothing typed it leaves the choice alone.

## D-057: One Email & SLA page for all teams (2026-11-02)

The SLA, the To / Cc and the email template of SOA and Purchasing were two pages ("SLA SOA", "SLA Purchasing"). They are now one page, **Email & SLA** (`/admin/settings`, menu Administration): the variables once, then a section per team (`#soa`, `#purchasing`) with its SLA range, To, Cc, subject and text, and a preview. Same permissions (Admin reads, Superadmin saves); same storage and audit. The old addresses `/admin/settings/soa` and `/purchasing` redirect to their section. Where To is left empty the server variables `EMAIL_TO_HIT*` still apply.

## D-058: Email and SLA are two separate pages (2026-11-02, replaces the one page of D-057)

- **Email** (`/admin/settings/email`): per team (SOA, Purchasing) the To, Cc, subject and text of the email, with a preview. **SLA** (`/admin/settings/sla`): per team the SLA range. Two menu entries under Administration. Permissions and audit are as before (Admin reads, Superadmin saves).
- **Saving is partial.** `saveTeamSetting` takes whichever parts the form sends and keeps the rest, so saving the SLA never touches the recipients or the template, and the other way round. An empty To / Cc sent on purpose still clears them. "Kembalikan template bawaan" now restores only the subject and text.
- `/admin/settings` leads to Email; `/admin/settings/soa` and `/purchasing` lead to their section of the Email page.

## D-059: No Summary on a request; it takes the project name (2026-11-02)

The Summary box is gone from the request form and from "new project with a request". A request is titled with the name of its project (the service fills it in; a caller may still send a title, which the importers do). The text of what is needed goes in Details. In the Neon copy 37 of 44 requests already carried the project name as their title. Consequences: board cards, tables and notifications show the project name; the default email template no longer has a "Summary" block (saved templates are not changed, and `{{summary}}` still works in them); a second request on the same project is told apart by its code, type and Details. Details stays optional.

## D-060: "SOA dashboard" everywhere; no dead links in Customers by location (2026-11-02)

- The SOA role's menu entry and page title said "Technical dashboard" while a Superadmin saw "SOA dashboard" for the same page. Both are now "SOA dashboard".
- On the Overview, the bars of "Customers by location" link to the Customers page. SOA, Purchasing, Finance and Management see that chart but may not open Customers (`customers.view`), so every bar (the folded "Other" one included) led them to an error page. The bars are now plain for those roles and links for the others (`customerLinks`). Whether those roles should be allowed to open Customers is a separate question.

## D-061: Note when Purchasing completes an overdue request; overdue table; lighter board (2026-11-03)

- **Note.** Moving an RFQ or PO to Completed on the board after its SLA deadline opens a dialog that asks why it was late. The server refuses the move without it (a BOQ is not asked). The text is stored in the new `requests.overdue_note` (migration `20261106100000_request_overdue_note`) and in the status history, and is shown to every role on the request card, the request list and the request panel. Moving the request out of Completed again clears the note; a request completed on time has none.
- **Overdue days.** Counted in working days (the SLA's own unit): the smallest number of working days after the deadline that reaches now (open request) or the completion time. A card shows the days next to its SLA badge, as "+N days" (the badge already says Overdue or Completed late).
- **Purchasing dashboard.** Under "RFQ & PO per PIC" a table lists the requests past their deadline: still open, and completed late in the last 90 days, longest first, with Customer, Project, PIC, Request in, Overdue (days) and Notes (empty for an open request).
- **Board.** Completed shows its cards in two columns and is twice as wide; Revision and Cancelled are folded to their name and number, open with a click, and still accept a dropped card; cards are tighter.
- The merge of development into main kept main's old menu lines ("SLA SOA", "SLA Purchasing"); the Email and SLA entries of D-058 are put back.

## D-062: One Import / Export dialog; one upload adds and updates; columns found by name; pick lists in the sheet (2026-11-03)

- **Button and dialog.** "Import projects" is now **Import / Export**. Step 1 downloads the current projects (the role's own columns) or the blank template; step 3 is one upload with no "add or update" choice.
- **One upload, decided per row by the Project ID.** A Project ID that exists updates that project (the rules of D-044 and D-050 stay: empty cell changes nothing, the Last updated check, the role's own columns, a salesperson only on their projects). An empty Project ID is a new project (the rules of the import stay: Sales PIC, master data, nomor otomatis; an end user and project name that already exist is a duplicate and is skipped). A Project ID that does not exist is **skipped with a warning**, never created, so a typo cannot add a project. A sheet without a Project ID column makes every row new. A row of a kind the role may not do (a new row for Sales, who hold only the bulk update) is a problem of that row.
- **Written in one transaction** (`src/server/import/xlsx-projects-sync.ts`, which runs the two existing planners side by side on their own rows and then their write steps, now exported as `writeNewProjects` and `writeUpdates`). The choice for problem rows covers both: nothing is saved while any row has a problem (default), or the valid rows are saved. New customers, principals and solutions need a confirmation.
- **Report before and after saving.** Counts (new, updated, unchanged, skipped, problem), then each new project and each updated one with what changes (from to), and the same lists on the result screen. Each Sales owner gets one notification (`project.imported`) listing the projects added for them and the ones changed.
- **Columns are found by name.** A header is compared without spaces and punctuation, so ProjectID, project_id and "Project ID *" are one, and the position does not matter (Project ID in A and End user in C works). Some Indonesian names were added (Nama Project, Nama Customer, ID Project). Only what could not be found is asked: a required column that is missing, the columns not recognised (each can be given a field or ignored), and a missing Project ID (as a warning). Everything else is listed as recognised, one click away, and the check runs by itself when nothing is missing.
- **Pick lists in the Excel file.** The export and the template give Progress (5% - Qualify up to 100% - Closed Won, then 0% - Closed Lost) and Status (On Track, On Hold, Done, Block) a drop-down on rows 2 to 5001, so a value is chosen, not typed. Excel refuses anything else. The lists are written by `toXlsx` as data validations, from the same texts the import reads; a column the role does not have gets no list. Verified in the file's XML, not in Excel itself.

## D-063: A salesperson's uploaded new projects are owned by the signed-in account (2026-11-03)

When a salesperson (role Sales, with the permission to add projects from a sheet) uploaded rows without a Project ID, every row with an empty Sales PIC cell was refused ("Sales PIC wajib diisi untuk proyek Internal Sales"). A salesperson always owns what they add (as on the project form), so for that role the Sales PIC is the signed-in account whatever the cell says: empty, or another name, which is ignored. A row whose source is Other is untouched (no Sales PIC, external sales name required). SOA, Admin and the other roles that add projects still have to name the salesperson.

## D-064: Gross Profit replaces the target margin, and Estimated PO value is no longer typed (2026-11-03)

- **Name.** "Target margin" is **Gross Profit** everywhere it is shown: the forms, the project page, the Sales pipeline (tile, table, reminder), the export columns, the Excel template and export, the guide and the permission texts. The change log reads "Gross Profit". Sheets that still say Target margin, Target margin (amount) or Margin are read as Gross Profit.
- **Entry.** Estimated PO value is gone from the new-project form, the commercial form on the project page and the Excel template and export. Gross Profit alone is enough: an amount in rupiah (D-056). The Final value stays (it is what a won project closed at, and the target tracking uses it). The Estimated PO value already stored is kept, not shown when empty, and still counts where it exists (open value, weighted value, a percentage on older projects); nothing was deleted. A save of the commercial form leaves it alone.
- **Excel.** The columns "Estimated PO value" and "Target margin (%)" are no longer in the sheet; a sheet that still has them sees them listed as columns that are not recognised, and they are ignored. The Gross Profit column of an export holds the amount, also for an older project whose margin was entered as a percentage.
- **Numbers that no longer wait for a value.** The Gross Profit tile and its list, the "set a Gross Profit" reminder, the order of the Sales table and the quarter forecast of the target tracking count a project by its Gross Profit alone (the forecast is weighted by Progress). A percentage is shown only when the project has a value to compare it with.
- **Not changed, and worth knowing.** The money charts and tiles that sum the Estimated PO value (open pipeline, weighted value, value by principal, solution and industry) fall quiet for projects added from now on, since they have no value; the counts and the Gross Profit numbers keep working. Whether those charts should add up Gross Profit instead is a separate decision. The PPN basis setting (D-055) still applies to the Final value and the Gross Profit.

## D-065: Deployment target is a Hostinger VPS, not Oracle Cloud; Neon becomes the backup copy (2026-11-04)

**Decided by the owner.** The Oracle Cloud Always Free (Ampere ARM) plan is dropped, and its audit files (`deployment/ARCHITECTURE.md`, `deployment/CHECKLIST.md`, branch `deploy/oracle-cloud`) are removed; they stay in git history. The production target is a Hostinger KVM VPS running Ubuntu 26.04 LTS (x86_64, so the ARM checks no longer apply):

- Docker Compose with two services, `app` and `db` (PostgreSQL 18). The `app` image is built in GitHub Actions and pulled from GHCR, never built on the VPS. Caddy runs on the host for HTTPS.
- The database on the VPS is the primary. Neon is the second copy: a nightly dump is restored into a separate Neon database, which also proves the dump restores. A superadmin can also download a dump from the Backups page.
- One environment (no staging). KVM 1 is enough; move up if load grows.
- The repository moves from a personal account to the company GitHub organization, and the workflows use no personal tokens.

Not yet built: the Hostinger files, the backup job, the download button, CI and the organization move. `deployment/VERCEL.md` describes the earlier plan with Neon as the primary and is to be retired once the VPS is live.

## D-066: The pipeline charts and tiles are in Gross Profit (2026-11-03, settles the open point of D-064; numbered D-066 because D-065 is the deployment decision)

The money measure of the pipeline is the Gross Profit of a project, not its Estimated PO value. A project's Gross Profit is the amount entered; an older project whose margin was entered as a percentage keeps counting through its stored value. A project without a Gross Profit adds to the counts but not to the money.

- **Tiles (Sales pipeline, Overview, Finance):** Open Gross Profit, Weighted Gross Profit (times the probability of the project's Progress) and Won Gross Profit replace Open pipeline, the old Gross Profit tile and Won. The first two open the list of open projects with a Gross Profit; the third opens the won projects.
- **Charts:** the Sales funnel, Pipeline by progress, Gross Profit by principal and Gross Profit by industry add up Gross Profit. The charts that count projects (by principal, solution, status, location, conversion) are as before.
- **Won** is the Gross Profit of Closed Won projects (the amount; for an older percentage margin, of the final value).
- Revenue in the target tracking is still the final value (revenue targets are not in Gross Profit); its Gross Profit rows follow D-064.

## D-067: Estimated PO value and Weighted value are no longer shown on the project page (2026-11-03)

The project page, like the forms and the dashboards, no longer shows the Estimated PO value or the Weighted value, even for an older project that has them stored (the data is kept, and still feeds a percentage of an older project). The page shows Progress, Status, Probability, Gross Profit, the Final value, and the dates.

## D-068: Backups run every day and are kept for one month; Neon stays live until the VPS is live (2026-11-03)

**Decided by the owner**, as detail to D-065.

- **Daily:** an automatic backup once a night on the Hostinger VPS (a systemd timer, not the Backups page button).
- **Retention:** one month (30 days). The nightly job deletes dumps older than that; the application itself still never deletes a file. This replaces the 7 daily, 4 weekly, 6 monthly idea in the security checklist.
- **Neon now and later:** until the application is live on the VPS, the Neon database stays the live (primary) database, as today. After the cut-over, Neon stops being live and becomes the backup copy that the nightly dump is restored into (D-065). Vercel keeps using its own database until then and is retired or turned into a demo afterwards; it must not share the Neon database that receives the restore.
- **Until then** the live version on Vercel has no backup button (the Backups page says so); its backup is Neon's point-in-time restore.

Not yet built: the timer, the cleanup of old dumps, the restore into Neon and the alert (checklist section 8).

## D-069: Shorter default email text; Weighted Gross Profit tile removed (2026-11-03)

**Asked by the owner.** The default email body for SOA and Purchasing is short: greeting, one line of what is asked (now in Indonesian, for example "Mohon diberikan informasi Cost / harga item untuk kebutuhan berikut."), End user, Project, Needed by, Source BOQ (left out when empty), Detail, one line asking for a reply before the due date with the Request ID kept in the subject, the link, and the thanks. Request ID, Project ID, request type, requester team, the SLA days and the next action are no longer in the default text (the Request ID stays in the subject and in the reply line). All variables remain available to the template editor.

A template a superadmin has already saved is not changed; "restore defaults" on `/admin/settings/email` loads the new text. The Weighted Gross Profit tile is removed from the pipeline tiles (four tiles remain); the weighted figure is still computed in the analytics but not shown.

## D-070: The email preview and the draft are in Indonesian (2026-11-04)

**Asked by the owner.** The email panel (labels Kepada, Cc, Subjek, Isi email; the buttons "Buka di Outlook (MailTo)", "Unduh draf Outlook (.eml)", "Salin"; the notices) and the text of the draft are in Indonesian: the greeting names "Tim SOA" / "Tim Purchasing", the ask line and the next action are Indonesian, dates use Indonesian month abbreviations (Mei, Agu, Okt, Des), a missing date reads "Belum ditentukan", and a source BOQ reads "(selesai)". The template editor's examples follow. `{{summary}}` is the request title, which is the project name (D-059); the default text does not use it because it only repeats the project name. It stays a valid variable so a template saved earlier that contains it still renders.

## D-071: Board cards are listed newest status first (2026-11-04)

**Asked by the owner.** In every column of the request board (BOQ, RFQ, PO and the combined view) the cards are ordered by when they last moved into their current status, newest on top. `RequestRow.statusChangedAt` is the latest status-history step into the current status (the creation for a request never moved; a reopened request counts from the reopening). A card dropped on a column goes to its top at once. The folded Revision and Cancelled columns and the two-column Completed column of D-061 are unchanged.

## D-072: Continuing a request asks for a confirmation with an optional note; per-type email drafts (BOQ, RFQ, HITPO); board columns scroll (2026-11-04)

**Asked by the owner.**

- **Confirmation on Continue.** "Continue to RFQ" (after a BOQ) and "Continue to PO" (after an RFQ) open a modal with an optional Notes field and a confirm button. The note (at most 500 characters) is added under the details of the new request as `Catatan: ...`, so it shows on the request page and in the email text with no change to the template. No migration: the note is part of the description, not a new column. "Do not continue" keeps its own note field (the reason).
- **Drafts per type.** The default text for BOQ, RFQ and PO is the same short body, with the ask line in each type's words and the end user in it: BOQ "Mohon dibuatkan BOQ / solusi teknis untuk kebutuhan {end user} dengan detail:", RFQ "Mohon diberikan informasi Cost untuk kebutuhan {end user} dengan detail:", PO (HITPO, Sales to Purchasing) "Mohon diproses pembelian (PO) untuk kebutuhan {end user} dengan detail:". The details follow the ask line directly, then Project, Needed by and Sumber (the BOQ or RFQ it was continued from), the reply line and the thanks. The templates stay per team (SOA, Purchasing): a separate saved template for the PO would need a third template; not built, say so if it is wanted.
- **Board.** Each column scrolls inside itself (at most the height of the screen minus the header), so the page stays short.

## D-073: A separate email template for the PO (HITPO), written by Sales; the preview is a modal (2026-11-04)

**Asked by the owner.** HITPO is the PO that Sales send to Purchasing, so it has its own editable template, apart from the Purchasing one (RFQ). It is a third row of `team_settings` with role `SALES` (the SLA of that row is not used: a PO is timed by the Purchasing SLA). The Email page has a third section, "Tim Sales (HITPO)", with To, Cc, subject and text; leave To empty and the server setting `EMAIL_TO_HITPO` applies. A PO's email panel reads this template; a BOQ reads SOA's and an RFQ reads Purchasing's, as before. The default text asks Purchasing to confirm once the PO is processed (no reply-by date).

**Migration `20261107100000_team_settings_sales_template`:** the CHECK on `team_settings.role` allowed only SOA and PURCHASING and now allows SALES. It is applied to the local and test databases. **Neon needs `db:migrate:deploy` before this code reaches `main`**, or saving the HITPO template fails there (reading it falls back to the default, so nothing else breaks).

The preview of each template (filled with sample data) is no longer a long block under the form: a "Pratinjau" button opens it in a modal. The copy on the Email page is shorter and plainer (labels To and Cc, one line of hint each).

## D-074: A superadmin deletes a BOQ, RFQ or PO request; the Request ID may sit in the subject or the text (2026-11-04)

**Asked by the owner.**

- **Delete a request (superadmin only, permission `requests.delete`, superadmin-only guard).** The request page ends with a "Hapus request" button; a modal asks for the request code. The status history is append-only (the database refuses DELETE), so the request is soft-deleted: `requests.deleted_at` and `deleted_by_id` (migration `20261108100000_request_soft_delete`). A deleted request is left out of every list, board, count, dashboard, export, finance crosscheck, PIC workload and email, and any change to it is refused as not found. A request that was continued (a BOQ with its RFQ, an RFQ with its PO) can be deleted only after its continuation. A deleted continuation lets go of its source (`source_request_id` is cleared), so the BOQ or RFQ can be continued again. The audit event `request.deleted` keeps the code, type, status, project, title, details and source. There is no restore button; a restore is a manual database step.
- **`{{request_id}}` in the subject or the text.** A template is accepted when the Request ID is in the subject or in the text (before: the subject only). The subject is still the safer place, since a reply keeps it; the Email page says so.

**Neon needs `db:migrate:deploy` before this code reaches `main`** (with `20261107100000_team_settings_sales_template` of D-073).

## D-075: A continued request has its own Needed by; the Email settings page is tabbed (2026-11-04)

**Asked by the owner.**

- **Needed by and SLA of a continued request.** Continuing a BOQ to an RFQ or an RFQ to a PO no longer copies the earlier request's Needed by: that date belonged to the earlier step (example: an RFQ needed by 2 Nov gave its PO the same 2 Nov). The confirmation modal has an optional Needed by for the new request. The SLA was already counted from the new request's own creation (an RFQ raised on 2 Nov and completed on 3 Nov, continued to a PO on 4 Nov: the PO's SLA of 3 working days runs from 4 Nov); a test now pins that. Requests continued before this change keep the date they copied.
- **Email settings in tabs.** The Email page has one tab per template (SOA (BOQ), Purchasing (RFQ), Sales (HITPO)) and one for the variables, with the same tab component as the project page, so one form is on screen at a time. `#soa`, `#purchasing` and `#sales` open their tab.

## D-076: Toasts for every save, Ctrl+Enter in long text, one "Save" label; per-type email preview; taller board; Projects as cards on a phone (2026-11-04)

**Asked by the owner.**

- **Toasts.** Every form result shows as a toast in the bottom corner (a small component of our own, no library): a success is announced politely, a failure is also kept under its form as an alert while the person fixes the input. While a modal dialog is open the toast is shown inside it, since the dialog covers the page and makes it inert. `FormStatus` raises the toast, so every form got it without being changed.
- **Enter saves.** In a one-line field Enter already submits its form (browser behaviour). In a long text box Enter makes a new line, so Ctrl+Enter (Cmd+Enter) saves there; the box carries a tooltip and `aria-keyshortcuts`. Done once in the shared `Textarea`.
- **"Save" everywhere a field is saved.** The buttons that save fields read "Save" (before: "Ubah nama", "Simpan deskripsi", "Save commercial details", "Simpan SLA SOA", and so on). Each keeps a specific accessible name that starts with "Save" (for example "Save commercial details"), since one page can have several. Buttons that do something else keep their words (Move project, Create user, Post update, Change password, Hapus request).
- **Email preview per type.** The preview of each template uses sample data of its own type: the HITPO tab shows a PO code, `[HITPO]`, the PO ask and an RFQ as the source (before: one RFQ sample for every tab). The values come from the same function as the real email.
- **Board.** Each column scrolls inside itself up to twice the screen height (before: once).
- **Projects on a phone.** Below 768 px the Projects list is a column of cards with the columns the superadmin turned on; the status is a coloured dot (blue On Track, green Done, red Block, yellow On Hold) with its name in a tooltip and for screen readers, and a one-line legend above. A new `success` colour token (green) serves Done.

**Amended (same day), after the E2E run.** The specific name of a Save button is hidden text inside the button (`SaveText`), not an `aria-label`: an aria-label such as "Save commercial details" also matched the label of the field "Details" (and "Save industry" the field "Industry"), for screen readers and tests alike. The Toaster is in the root layout, so the sign-in and password pages show results too. A toast with the same message as one on screen replaces it. Stale E2E tests were brought in line with the tabs, the translated messages and the removed Summary field.

## D-077: Name and description are edited on purpose, in a modal; Save buttons are all primary; Done is green on the desktop table (2026-11-05)

**Asked by the owner.** The project page shows the name and the description as text; an Edit button (shown only to those who may edit) opens the form in a modal, and the modal closes by itself when the save succeeds (the toast says so). The two kinds of Save button (blue for big forms, white for small inline ones) had no meaning, so every button that saves a field is now the primary (blue) one. Buttons that do something else stay white (Reset password, Restore default template, Do not continue, Export, Move project). The Done chip in the Projects table is green like the dot on a phone.

**Amended (2026-11-05): one form.** The name and the description are one block, a title with its explanation, with one Edit button and one modal with one Save (`saveProjectTitleAction`; each field still goes through its own service and permission, and a field the person may not change is not shown). SOA, who may rename but not describe, sees only the name in the modal.

## D-078: Vercel is gone; the Hostinger VPS is the only deployment (2026-11-05)

**Asked by the owner.** The application is live on the VPS at https://halcom-dashboard.site, so everything for Vercel was removed: `vercel.json` (including the temporary 307 redirect to the VPS), `deployment/VERCEL.md`, the Vercel check in `backupsSupported()` and the Backups page notice (the backup button is now always shown; the Docker image has `pg_dump` and a `/backups` volume), and the Vercel wording in the README, the security checklist and code comments. Earlier decisions that mention Vercel (D-039 and others) are left as they were: they are the record of what was decided then.

**Kept on purpose.** `postinstall: prisma generate` stays: `npm ci` in the Docker image and in CI needs the generated client. Neon stays as the nightly backup copy (`deploy/db-sync.sh`).

**To do outside the repository.** Delete or disconnect the Vercel project, so that nothing deploys from `main` there, and revoke its tokens and environment variables.

## D-079: Caddy reads a Caddyfile: security headers and the www redirect (2026-11-05)

**Why.** The Caddy container ran `caddy reverse-proxy --from ${DOMAIN} --to app:3000`, which sets no response headers and does not serve `www`. `deploy/Caddyfile` (now for the container, with `{$DOMAIN}` from `/opt/halcom/.env`) sets HSTS (one year, this host only), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, drops `Server`, writes an access log to stdout, and redirects `www.<domain>` to the plain domain.

**Safe to deploy.** The workflow copies the Caddyfile next to the compose file; `deploy-vps.sh` validates it with the `caddy:2` image before anything is replaced (a bad file would stop the proxy), then reloads Caddy after the app is healthy. X-Forwarded-For still comes from Caddy (it does not trust the one a client sends), which the sign-in throttle depends on. A CSP is not set yet: Next.js needs a nonce setup first (checklist P2).

## D-080: A daily backup on the server, and a download link on the Backups page (2026-11-05)

**Asked by the owner.** Backups were manual. `deploy/backup-daily.sh` (cron on the VPS, instructions in HOSTINGER-DOCKER-MANAGER.md) pipes `pg_dump` from the `db` container into the `app` container's `/backups` volume, so no password or dump touches the host disk, checks the file with `pg_restore --list` and only then gives it its name `halcom-auto-YYYYMMDD-HHMMSSZ.dump` (mode 600). It removes its own files older than 30 days, never the newest 3 and never a file made from the page; the application still never deletes a backup (D-068).

**Download.** Each backup in the list has a plain link (not `next/link`, whose prefetch would be audited as a download) to `/admin/backups/download/<name>`: only `system.backup` (the superadmin), only the two backup name patterns (so `../x` never reaches the file system), the file is streamed with `Cache-Control: no-store`, and each download writes `system.backup_downloaded` to the audit log. `listBackups` lists both name patterns.

**Not solved.** The daily dump sits on the same VPS as the database, so it does not protect against losing the server: the owner downloads copies, and the nightly Neon copy (`db-sync.sh`) continues.

## D-081: Every completed request can be sent back for revision, with a reason and a fresh SLA clock (2026-11-06)

**Asked by the owner** (after a check showed revision was one-way, Sales to SOA, for a BOQ only).

- **Revision for BOQ, RFQ and PO.** A Completed request goes to Revision only (the old "reopen to In progress" of an RFQ or PO is gone, since it made the request overdue at once: the clock still counted from the creation). Sales on their project, Admin and Superadmin send it back from the request page; the owning team (SOA for a BOQ, Purchasing for an RFQ or PO) can also drag the card to the Revision column, which every board now has. The owning team is notified, in red.
- **A reason is always required** (`reasonRequired(_, "REVISION")`), on the request page and on the board. It is kept in the status history and the notification.
- **SLA per round.** The first completion is scored once and never again. Each revision starts a new clock at the moment it was sent back, with the same range as the team's SLA (owner's choice); a second revision starts another. While the request is in Revision the SLA badge, the overdue counts and the "late completion needs a note" rule use that round; once it is completed again the badge shows the first result and a second line, "SLA revisi terakhir", shows the round's result (Met or Late). `slaOf` returns `revision` (`startedAt`, `targetAt`, `dueAt`, `state`) for this. No migration.
- **Notes on a late revision.** An RFQ or PO that finishes its revision after the round's deadline needs a late note, like a first completion; the first completion's note is kept unless the revision's replaces it.
- **Not built:** an in-app "ask Sales" from SOA or Purchasing (questions stay in email); a separate dashboard figure for revision SLA.

**Amended (2026-11-06): one SLA figure on the dashboards.** The SOA and Purchasing dashboards (and the monthly report) show a single SLA compliance figure. A completion and a finished revision are each scored once: the revision counts in the window where it ended (`RevisionSla.endedAt`). In the data the two stay apart: `slaOf` gives the first result (`state`) and the revision round (`revision`) separately, and the request page shows both.

## D-082: A person can also see what Management sees (2026-11-10)

**Asked by the owner** for the director, who is a salesperson and also wants the overview Management has, read only.

- **One flag, not a second role.** `users.also_management` (default false, migration `20261111100000_user_also_management`). The working role stays the single `users.role`, so every role check in the code (ownership, scoping, notifications, the request code prefix) is unchanged. `canHold(person, permission)` is `can(role)` or, when the flag is on, `can("MANAGEMENT")`; `requirePermission`, the menu (`navLinksFor(role, alsoManagement)`) and the two Management-only queries (technical report, financial crosscheck) use it. The flag adds only what Management has and Sales lacks: the Management dashboard, technical reports and the crosscheck; nothing that changes data.
- **Who and how.** Only a superadmin (`users.manage-privileged`) turns it on, in the user's Edit window ("Tampilan Management"); it is audited (`user.also_management_changed`). It is for Sales, SOA, Purchasing and Finance only; changing the role to Admin, Superadmin or Management clears it.
- **Not done:** a general list of extra roles (a second working role such as Sales + SOA would need the identity checks of D-081's neighbours changed one by one, about thirty places); Admin functions for the director (not asked: view only).

## D-083: Notifications have three levels, and a scan warns the team before an SLA deadline and again after it (2026-11-07)

**Asked by the owner:** the team that handles requests should be told when a request is close to its SLA and when it is past it, and those alerts must not mix with the news of a new request. Phase 2 of the same plan (the Management dashboard) is a separate decision.

- **Levels.** `notifications.severity` (`INFO`, `WARNING`, `DANGER`; migration `20261112100000_notification_severity_sla_alerts`, additive). A writer that names no level gets it from the kind (`defaultSeverityFor`): a revision is Danger (it was already red), everything else Info, so the fifteen existing `notify()` callers did not change. Existing revision rows were back-filled to Danger.
- **Rule.** The level is the SLA state that the badge shows (`slaOf`): Due now (past the expected date, or under a day to the deadline) is **Warning**, Overdue is **Danger**; paused, met, late, none and finished requests say nothing. A revision round has its own clock and its own alert. `slaAlertLevel` in `src/domain/notifications/sla-alerts.ts` is the only place that decides.
- **Who.** Warning goes to the accounts of the team that works the request (SOA for a BOQ, Purchasing for an RFQ or PO; the PICs are not accounts). Danger goes to that team and to Admin and Management (owner's choice). Paused (Waiting for Sales, retired) requests are not alerted.
- **Once per level.** `notifications.dedupe_key` = `sla:<request id>:<start of the SLA round>:<level>`, unique per recipient: running the scan again adds nothing, a revision starts a new round and may alert again, and a request first seen already overdue gets only the Danger. `notifications.request_id` ties an alert to its request (no foreign key, so a cleaned-up request does not block it).
- **No flood on the first scan.** A deadline that passed more than 7 calendar days ago is not alerted (`SLA_ALERT_MAX_AGE_DAYS`, owner's choice): the first scan on the live database, or one after a long outage of the cron job, would otherwise send a Danger for every request that was ever late. Inside the week it alerts; a Warning is never affected.
- **Closing.** Completing or cancelling a request reads its SLA alerts for every recipient (`closeSlaAlerts`, in the status transaction); the scan also reads the alerts of requests that are finished or deleted.
- **The scan.** An SLA deadline passing is nobody's action, so `scanSlaAlerts` (`src/server/notifications/sla-alerts.ts`) runs from cron: `deploy/sla-scan.sh` posts to `/api/internal/sla-scan` inside the app container with `Authorization: Bearer $CRON_SECRET`. The production image has no `tsx` scripts and no curl, hence an HTTP route called with Node's fetch. No `CRON_SECRET` (or under 16 characters) answers 404, a wrong one 401 (constant-time comparison); the answer holds counts only. Schedule: every 30 minutes, 08:00 to 18:00 WIB on weekdays (owner's choice); instructions in `deploy/HOSTINGER-DOCKER-MANAGER.md`, the workflow copies the script. An alert can therefore be up to 30 minutes late.
- **Screen.** `/notifications` has tabs Semua / Info / Warning / Danger with unread counts (`?level=`), the level written in words on each card (not colour alone) and "Mark all Danger as read" per tab. The bell takes its colour from the loudest unread level (blue, amber, red) and its accessible name lists the counts ("Notifications, 7 unread (2 danger, 1 warning, 4 info)"). `hasUnreadRevision` is gone (`countUnreadBySeverity`).
- **Checks.** Unit: levels, round keys, weekends, texts. Integration: warning to the team only, no duplicate on a second run, Danger to team + Admin + Management after the Warning, closing on completion and on deletion, cancelled request silent, by-level listing and reading, and the route's 404/401/200. E2E: the Info and Danger tabs; the revision spec reads the new bell name.
- **To do outside the repository.** Put `CRON_SECRET` (`openssl rand -hex 24`) in `/opt/halcom/.env` on the VPS, deploy, and install the cron line. Without them nothing is written.
- **Not built:** e-mail or push alerts; alerting a request that is past its needed-by date (only the SLA is covered); a setting for the Warning window (it is the badge's "Due now").

## D-084: Sales open on the charts, and Purchasing names a PIC when it starts an RFQ or PO on the board (2026-11-07)

**Asked by the owner.**

- **Sales pipeline opens on Charts.** `/dashboard/sales` shows the charts unless the address says `?view=table` (it was the other way round). The Table / Charts switch is unchanged and both views stay one click apart.
- **PIC modal on the board.** Dragging an RFQ or PO card from Submitted to In progress (or Shift + arrow) opens a window "Siapa PIC untuk <code>?" with the active Purchasing PICs; nothing moves until one is chosen and "Mulai dikerjakan" is pressed, and "Batal" leaves the card where it was. The PIC is saved first (`assignRequestPic`, with its history and audit event), then the status changes, in one action (`moveRequestAction(…, picId)`). A card that already has a PIC starts with it chosen. Rule: `startAsksForPic(type, from, to)` in `src/domain/pics/teams.ts`. A BOQ does not ask: SOA still hands a BOQ to its PIC from the request page. A request that arrives In progress by itself (handed over from a BOQ) is not affected.
- **Not enforced on the server:** the service still lets a request start without a PIC (the request page, imports and older flows do); only the board asks. Making a PIC mandatory for In progress everywhere would be a separate decision.

## D-085: The Management dashboard shows what each team struggles with, ranked like the notifications (2026-11-07)

**Asked by the owner** (phase 2 of the plan that began with D-083): a management view of the concerns of each team, such as bottlenecks. It replaces the four planned widgets (no data) and the plain "Open requests" list that `/dashboard/management` showed; read only, for Management, Admin and Superadmin, and for the people who hold the view of D-082.

- **Perlu perhatian (on top).** A ranked list of concerns, Danger then Warning then Info, with the same words and colours as the notifications (`severity-style.ts` is shared with `/notifications`). Each links to the list behind it. The rules are plain functions with constants in `src/domain/management/concerns.ts`, covered by unit tests (changing a threshold is a code change with a test, not a setting):
  - per team (SOA on BOQ, Purchasing on RFQ and PO): overdue (Danger); close to the deadline, oldest Submitted request waiting more than 72 hours, requests without a PIC, a PIC with 8 or more open requests, needed-by date passed (Warning); SLA compliance of the last 90 days under 90% (Warning) or under 70% (Danger);
  - between teams: completed BOQs nobody continued or stopped, Info, Warning once the oldest has waited more than 3 days; open projects not touched for more than 30 days, Info, Warning from 5; projects Finance flags, Warning (only for a viewer who may read the crosscheck).
- **A block per team** (open, backlog, overdue, due now, without PIC, past needed-by, SLA compliance, turnaround; bottleneck per status; load per PIC; the last six months; the late requests with the reason the team wrote), and a block "Antar tim" (handoffs waiting, stale projects, Finance flags). The numbers come from the same functions as the SOA and Purchasing dashboards (`getTeamDashboard`, `listOverdueRequests`; `getTeamMonthly` is new), so a figure here can be checked against the team's own page.
- **Same words as the alerts.** The overdue and close-to-deadline concerns are the states that raise the Danger and Warning notifications (D-083), so Management sees on this page what the team was told.
- **Removed:** `ROLE_DASHBOARDS` and `RoleQueue` (the placeholder and the plain list). No migration.
- **Not built (asked for in the plan):** a weekly SLA compliance line (the six months table is the trend for now), Sales target attainment and pipeline conversion on this page (they stay on Sales pipeline and Targets), and thresholds that a superadmin can change.

## D-086: The domain and the VPS host name are both served (2026-11-09)

**Why.** The domain `halcom-dashboard.site` was suspended at the registrar, and the application was unreachable until `DOMAIN` was changed by hand. `deploy/Caddyfile` now has one site block per address, sharing one snippet (headers, compression, proxy, log): `{$DOMAIN}` (main, also `APP_BASE_URL`) and `{$FALLBACK_DOMAIN}` (default `srv2127418.hstgr.cloud`, the host name Hostinger keeps for the VPS). Each gets its own certificate, so a failure on one address (suspension, DNS, a certificate error) does not touch the other. The `www` redirect is fixed to the company domain, since the VPS host name has no `www`.

**Rules.** The two names must differ (Caddy refuses a duplicate address); `deploy-vps.sh` says so before it changes anything and also validates the file with `caddy:2`. A session cookie belongs to one host, so people sign in again when they switch. To make the VPS host name the main address for a while (links in the e-mail text), swap `DOMAIN` and `FALLBACK_DOMAIN` in `/opt/halcom/.env`.


## D-083: A superadmin can view the application as another user, read only (2026-11-12)

**Asked by the owner**, to check what a user sees without asking for their password.

- **Who and whom.** Only a superadmin (`users.impersonate`, superadmin-only and locked like the other superadmin permissions). The target must be an active account that is not Admin or Superadmin, and not the superadmin's own. The button is "Lihat sebagai" in the user's Edit window.
- **How.** The superadmin's session is closed and a session of the target is opened that names the superadmin (`sessions.impersonator_id`, migration `20261112100000_session_impersonator`). It lasts one hour and is never renewed. It dies with the target (deactivated, password reset) or with the superadmin (deactivated, deleted). "Keluar dari mode ini" in the banner ends it and opens a new normal session for the superadmin without asking for the password: the server knows who opened it.
- **Read only.** `requireUser` refuses every server action made through such a session (the `next-action` header), so no form can change data as someone else. The first-sign-in password gate does not apply while viewing. Pages, lists and exports are read as the target sees them.
- **Audit.** `user.impersonation_started` and `user.impersonation_ended`, with the superadmin as actor and the viewed user as the entity. Nothing else is written, since nothing can be changed.
- **Not done:** viewing as an Admin or another Superadmin; a reason field when opening; making changes on behalf of someone.

## D-087: Purchasing keeps a master list of distributors, named on each RFQ (2026-11-13)

**Asked by the owner:** Purchasing manages the distributors it buys from, each with its registered name, an alias, and how it is paid (CBD, TOP of 7, 14, 30 days and so on); the distributor can be chosen on an RFQ. Then: the list can be imported (add and edit) and exported like projects.

- **Data.** `distributors` (name, `name_key` unique, optional alias, `payment_type` CBD | COD | TOP, `top_days`, `is_active`) and `requests.distributor_id` (nullable, ON DELETE RESTRICT). Migration `20261113100000_distributors`, additive. A database check keeps `top_days` for TOP only (1 to 365) and requires it for TOP. COD is added next to the two named types because "dll" left the list open; it costs nothing to leave unused.
- **Who.** `distributors.manage`: Purchasing, Admin, Superadmin. Page `/distributors` (Purchasing's menu has it). Choosing the distributor of an RFQ needs the right to work RFQs (`requests.work.purchasing`). Sales and others read it on the RFQ page only.
- **One distributor per RFQ, RFQ only.** It is a single choice made in a searchable drop-down (the same `SearchSelect` as the project and Sales PIC pickers; typing the name, the alias or the terms finds it), shown with its terms ("PT Name (Alias) · TOP 14 hari"). The RFQ shows the distributor's current terms, so editing a distributor's terms changes how its RFQs read; no copy of the terms is kept on the RFQ. A distributor is deactivated, never deleted; one already on an RFQ stays there when turned off, but cannot be newly chosen. Every change is audited (`distributor.*`, `request.distributor_set`).
- **Excel.** One layout for export, template and upload (`src/domain/distributors/sheet.ts`): Distributor ID, Nama, Alias, Pembayaran, TOP (hari), Status. A row with an ID changes that distributor, a row without adds one; a name that already exists without an ID is refused with a hint to use the ID. The upload is checked row by row first (button "Periksa berkas") and saved only when every row is valid. Export as .xlsx or CSV, audited as `export.distributors`.
- **Known limit.** Rows are saved one by one, not in one transaction; a name taken at the same moment can stop the save halfway. The earlier rows stay saved and read as unchanged when the file is uploaded again.
- **Not built:** several distributors on one RFQ (for comparing quotes), a distributor on a PO, contact details and notes per distributor, and the distributor in the RFQ e-mail text and in the exports of requests.

**Amendment to D-087 (2026-11-13), asked by the owner after seeing it:** (1) On an RFQ the PIC and the distributor are one card and one form with one Save (`AssignPicForm` takes an optional `distributor`; the action saves the PIC first, then the distributor, each re-checked by its own service). (2) On `/distributors` the list is a table, and add, edit and delete are buttons that open modals; Import / Export is one modal like the projects page. The on/off switch moved into the Edit modal (a checkbox). (3) Delete is real but only for a distributor no request has ever named (hidden RFQs count); otherwise the server refuses and says to turn it off in Edit, because the RFQ and its history must stay readable. Audited as `distributor.deleted`. No migration.
