# Chatwoot Dashboard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine campaign records from `disparos` with a read-only Chatwoot PostgreSQL projection so the client can understand delivery, reading, replies, team service, and per-agent performance.

**Architecture:** A server-only synchronizer pulls changed Chatwoot messages on demand into a minimal `dashboard_analytics` projection in the existing dashboard database. Focused campaign and service repositories aggregate that projection, while the API orchestrates synchronization, stale-data fallback, and the existing date filters before the React dashboard renders client-friendly sections.

**Tech Stack:** Bun 1.3, TypeScript, PostgreSQL, `pg`, TanStack Start, React 19, Recharts, Tailwind CSS, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-chatwoot-dashboard-integration-design.md`

## Global Constraints

- The Chatwoot database connection is server-only and strictly read-only.
- Persist IDs, timestamps, classifications, statuses, and author identity only; never copy message content.
- Restrict source reads to the configured Fast Escova account and inbox.
- Synchronize only when the dashboard is opened or refreshed; do not add polling or a scheduler.
- Use an incremental composite cursor `(updated_at, id)` and an idempotent upsert.
- Default to the trailing 30 local calendar days (`30d`, including today) and retain today, yesterday, current month, previous month, and unrestricted custom date ranges.
- Campaign cohorts are selected by send timestamp in the requested local-date range; later delivery/read states and replies within 48 hours still count for that cohort.
- Attribute a reply once, to the most recent preceding campaign send in the same conversation within 48 hours.
- Include only public human replies in team and agent metrics; exclude templates, bots, automations, private notes, and system activity.
- Count response time only Monday through Saturday, 08:00–20:00, in `America/Araguaina`.
- Keep estimated cost at US$ 0.04 per sent message and calculate cost per response.
- If Chatwoot is unavailable, serve the last synchronized projection with a visible stale warning; never replace prior values with zero.
- Keep database credentials and detailed errors out of browser responses and logs.

## Review Focus

- Rows sharing the same `updated_at` at a page boundary must not be skipped; Task 2 pins composite-cursor paging and idempotent replay.
- Simultaneous page loads must perform one source synchronization without deadlocking or duplicating projection rows; Task 2 pins advisory-lock behavior.
- A reply exactly 48 hours after a send, or preceded by a newer send, must have one deterministic campaign owner; Task 3 pins both boundaries.
- Response blocks crossing 20:00, Sunday, and the next 08:00 opening must count only business minutes; Task 4 pins these calendar boundaries.
- A Chatwoot outage after prior success must return stale data, while an outage before the first successful sync must fail clearly; Task 5 pins both states.

---

### Task 1: Add the analytics schema, database boundaries, and test foundation

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `sql/2026-10-12-add-dashboard-analytics.sql`
- Create: `src/lib/database.server.ts`
- Create: `src/lib/chatwoot-types.ts`
- Create: `tests/integration/postgres.ts`
- Create: `tests/integration/analytics-migration.test.ts`

**Interfaces:**
- Produces: `dashboardDatabase(): Pool`, `chatwootDatabase(): Pool`, and `closeDatabasePools(): Promise<void>` from `src/lib/database.server.ts`.
- Produces: `ChatwootCursor`, `ProjectedMessage`, `SyncResult`, and `SyncFreshness` from `src/lib/chatwoot-types.ts`.
- Produces: `dashboard_analytics.chatwoot_messages`, `dashboard_analytics.sync_state`, indexes for inbox/time, conversation/time, author/time, and SQL function `dashboard_analytics.business_seconds(timestamptz, timestamptz)`.
- Test boundary: integration helpers use `TEST_DATABASE_URL` only and apply the migration to an isolated test database.
- Consumes later: Tasks 2–5 use these exact pool functions, types, table names, and SQL function.

- [ ] **Step 1: Add test scripts and database configuration examples**

Add `"test": "bun test"`, `"test:unit": "bun test tests/unit"`, and `"test:integration": "bun test tests/integration"`; keep existing scripts unchanged. Add server-only examples for `CHATWOOT_DATABASE_URL`, `CHATWOOT_DATABASE_SSL`, `CHATWOOT_ACCOUNT_ID=2`, `CHATWOOT_INBOX_ID=1`, and `TEST_DATABASE_URL`. Do not give any new variable a `VITE_` prefix.

- [ ] **Step 2: Write the failing migration integration tests**

Create tests named:

- `creates the projection without a message-content column`;
- `upserts the same Chatwoot message idempotently`;
- `calculates business seconds inside one open day`;
- `excludes nights and Sunday from business seconds`;
- `returns zero for reversed or equal intervals`.

Assert, among other exact cases, that Monday 19:30–Tuesday 08:30 in `America/Araguaina` yields 60 business minutes and Saturday 19:30–Monday 08:30 yields 60 business minutes.

- [ ] **Step 3: Run the migration tests to verify they fail**

Run: `bun test tests/integration/analytics-migration.test.ts`

Expected: FAIL because the migration and database helpers do not exist.

- [ ] **Step 4: Create the analytics migration**

Create schema `dashboard_analytics`, then define `dashboard_analytics.chatwoot_messages` with canonical columns:

- `message_id bigint PRIMARY KEY`;
- `conversation_id bigint NOT NULL`;
- `account_id bigint NOT NULL`;
- `inbox_id bigint NOT NULL`;
- `direction text NOT NULL CHECK (direction IN ('incoming','outgoing'))`;
- `kind text NOT NULL CHECK (kind IN ('customer','human','template','automation','system'))`;
- `private boolean NOT NULL`;
- `delivery_status text CHECK (delivery_status IN ('sent','delivered','read','failed'))`;
- `author_id bigint` and `author_name text`;
- `created_at`, `source_updated_at`, and `projected_at` as `timestamptz`.

Define one `sync_state` row per source stream with cursor timestamp/ID, last success, and sanitized last failure fields. Implement `business_seconds` as a `STABLE` PostgreSQL function using `America/Araguaina`, Monday–Saturday, and the half-open interval `[08:00,20:00)`.

- [ ] **Step 5: Implement server-only pool creation and shared types**

`dashboardDatabase()` uses `DATABASE_URL`; `chatwootDatabase()` uses `CHATWOOT_DATABASE_URL` and configures the session as read-only. Parse account/inbox IDs as positive integers at the source boundary and fail before any query when configuration is missing or invalid. Use strings for all bigint IDs in TypeScript.

- [ ] **Step 6: Run Task 1 verification**

Run: `bun test tests/integration/analytics-migration.test.ts && bun run lint && bun run build`

Expected: all migration tests PASS; lint and build exit 0.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json .env.example sql/2026-10-12-add-dashboard-analytics.sql src/lib/database.server.ts src/lib/chatwoot-types.ts tests/integration/postgres.ts tests/integration/analytics-migration.test.ts
git commit -m "feat: add dashboard analytics foundation"
```

---

### Task 2: Synchronize Chatwoot messages incrementally on demand

**Files:**
- Create: `src/lib/chatwoot-source.server.ts`
- Create: `src/lib/chatwoot-projection.server.ts`
- Create: `src/lib/chatwoot-sync.server.ts`
- Create: `tests/unit/chatwoot-source.test.ts`
- Create: `tests/integration/chatwoot-sync.test.ts`

**Interfaces:**
- Consumes: pools and canonical types from Task 1.
- Produces: `classifyChatwootMessage(row: ChatwootMessageRow): ProjectedMessage`.
- Produces: `ChatwootSource.fetchPage(cursor: ChatwootCursor | null, limit: number): Promise<ProjectedMessage[]>`.
- Produces: `syncChatwootMessages(): Promise<SyncResult>` where `SyncResult` reports `status: 'updated' | 'current' | 'busy'`, processed row count, and `lastSuccessAt`.
- Produces: `getSyncFreshness(): Promise<SyncFreshness>` for Task 5.

- [ ] **Step 1: Write failing source-classification tests**

Cover Chatwoot's canonical enum values and sender types:

- incoming public contact message → `direction: 'incoming'`, `kind: 'customer'`;
- outgoing public `User` message → `kind: 'human'` with the actual author ID/name;
- template message type → `kind: 'template'`;
- `AgentBot` sender → `kind: 'automation'`;
- activity/system message → `kind: 'system'`;
- private outgoing message remains projected but is marked `private: true`;
- numeric statuses 0/1/2/3 map to `sent/delivered/read/failed`;
- no projected object contains `content`.

- [ ] **Step 2: Run the classifier tests to verify they fail**

Run: `bun test tests/unit/chatwoot-source.test.ts`

Expected: FAIL because the source adapter does not exist.

- [ ] **Step 3: Implement the read-only Chatwoot source adapter**

Query standard Chatwoot `messages`, `conversations`, and `users` data for the configured account/inbox. Select only the fields needed by `ProjectedMessage`; never select `messages.content`. Page by `(messages.updated_at, messages.id)`, ordered ascending, with a fixed page size of 500.

- [ ] **Step 4: Write failing synchronization integration tests**

Add tests named:

- `imports every page and stores the terminal composite cursor`;
- `does not skip equal updated_at values across page boundaries`;
- `replaying a page updates rows without duplication`;
- `refreshes delivered and read status after a later source update`;
- `allows only one concurrent synchronizer to own the advisory lock`;
- `preserves the last successfully committed page cursor when a later page fails`;
- `sanitizes the stored failure without SQL text or credentials`.

Use a fake `ChatwootSource` for deterministic pages and the integration PostgreSQL projection for locks, cursor, and upserts.

- [ ] **Step 5: Run synchronization tests to verify they fail**

Run: `bun test tests/integration/chatwoot-sync.test.ts`

Expected: FAIL because projection and synchronization functions do not exist.

- [ ] **Step 6: Implement projection persistence and synchronization**

Use a session-level PostgreSQL advisory lock released in `finally`. Upsert each page and advance its composite cursor in the same dashboard-database transaction. Continue until a page contains fewer than 500 rows. Treat an unavailable lock as `status: 'busy'`; do not wait behind another refresh.

- [ ] **Step 7: Run Task 2 verification**

Run: `bun test tests/unit/chatwoot-source.test.ts tests/integration/chatwoot-sync.test.ts && bun run lint && bun run build`

Expected: all tests PASS; lint and build exit 0.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/lib/chatwoot-source.server.ts src/lib/chatwoot-projection.server.ts src/lib/chatwoot-sync.server.ts tests/unit/chatwoot-source.test.ts tests/integration/chatwoot-sync.test.ts
git commit -m "feat: sync Chatwoot reporting data on demand"
```

---

### Task 3: Build campaign funnel and 48-hour attribution metrics

**Files:**
- Create: `src/lib/dashboard-range.ts`
- Create: `src/lib/campaign-metrics.server.ts`
- Create: `tests/unit/dashboard-range.test.ts`
- Create: `tests/integration/campaign-metrics.test.ts`
- Modify: `src/lib/dashboard-types.ts`

**Interfaces:**
- Produces: `resolveDashboardRange(period: DashboardPeriod, range, now): ResolvedDashboardRange` with inclusive local dates and exclusive UTC end timestamp.
- Produces: `getCampaignMetrics(range: ResolvedDashboardRange): Promise<{overview; campaigns; dispatchesByDay; deliveryBreakdown}>`.
- Extends: `CampaignMetric` with `falhas`, `pendentes`, `resultadosIncertos`, `respondidas`, `taxaEntrega`, `taxaLeitura`, and `taxaResposta`.
- Consumed by: Task 5 composes this result into `DashboardData`; Task 6 renders the fields without recalculating them.

- [ ] **Step 1: Write failing date-range unit tests**

Pin the trailing 30-day default, today, yesterday, current month, previous month, and custom inclusive dates in `America/Araguaina`. Assert invalid calendar dates, reversed ranges, and missing custom endpoints throw a typed validation error.

- [ ] **Step 2: Write failing campaign integration tests**

Seed minimal `disparos` campaign/destination fixtures and projected messages. Assert:

- delivered includes `delivered` and `read`, while read includes only `read`;
- a failed message is separate from sent/delivered/read;
- the first incoming message at exactly `sent_at + interval '48 hours'` counts;
- a message one microsecond later does not count;
- a newer campaign send before the incoming message owns the reply;
- one recipient with multiple incoming messages contributes one response;
- a status updated after the selected period still updates the original send cohort;
- pending confirmation and uncertain results remain separate from confirmed failures;
- delivery, reading, and response rates use the approved denominators;
- estimated cost is `sent * 0.04` and cost per response is nullable when there are no replies.

- [ ] **Step 3: Run Task 3 tests to verify they fail**

Run: `bun test tests/unit/dashboard-range.test.ts tests/integration/campaign-metrics.test.ts`

Expected: FAIL because the range and campaign repositories do not exist.

- [ ] **Step 4: Implement range resolution and campaign queries**

Base the cohort on `template_enviado_em`/projected outgoing creation time inside the resolved range. Join by `chatwoot_message_id` and `chatwoot_conversation_id`; use the indexed normalized phone fields only as a fallback for legacy destinations missing Chatwoot IDs. Return raw counts and precomputed rates, not UI-formatted strings.

- [ ] **Step 5: Run Task 3 verification**

Run: `bun test tests/unit/dashboard-range.test.ts tests/integration/campaign-metrics.test.ts && bun run lint && bun run build`

Expected: all tests PASS; lint and build exit 0.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/dashboard-range.ts src/lib/campaign-metrics.server.ts src/lib/dashboard-types.ts tests/unit/dashboard-range.test.ts tests/integration/campaign-metrics.test.ts
git commit -m "feat: calculate Chatwoot campaign funnel metrics"
```

---

### Task 4: Build general and per-agent service metrics

**Files:**
- Create: `src/lib/service-metrics.server.ts`
- Create: `tests/integration/service-metrics.test.ts`
- Modify: `src/lib/dashboard-types.ts`

**Interfaces:**
- Consumes: `ResolvedDashboardRange` from Task 3 and `dashboard_analytics.business_seconds` from Task 1.
- Produces: `getServiceMetrics(range: ResolvedDashboardRange): Promise<{atendimento; agents; messagesByDay; responseTimeByDay}>`.
- Produces: `AgentMetric` with `id`, `nome`, `conversas`, `mensagensEnviadas`, and `tempoRespostaMedioMin`.
- Consumed by: Task 5 composes the result; Task 6 renders it.

- [ ] **Step 1: Write failing response-block integration tests**

Assert that:

- consecutive incoming customer messages followed by one human reply form one response block;
- private, template, automation, and system messages neither close nor create a block;
- the response is credited to the actual outgoing human author;
- two agents in one conversation each receive one distinct-conversation credit;
- the same conversation counts once per agent even when an agent sends multiple messages;
- a missing/deleted agent name uses the stable label `Atendente #<id>` instead of dropping the activity;
- average response time includes only blocks closed by a human reply in the selected period;
- first response time uses the first customer block per conversation beginning in the selected period;
- a Monday 19:30 customer block answered Tuesday 08:30 measures 60 minutes;
- a Saturday 19:30 block answered Monday 08:30 measures 60 minutes;
- unanswered blocks do not enter response-time averages.

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `bun test tests/integration/service-metrics.test.ts`

Expected: FAIL because the service repository does not exist.

- [ ] **Step 3: Implement service aggregation queries**

Build response blocks from only canonical `customer` and public `human` messages ordered by `(created_at, message_id)` within each conversation. Use `dashboard_analytics.business_seconds` for durations. Count incoming messages by their creation period, public human messages by their creation period, and attended conversations by at least one public human message in the period.

- [ ] **Step 4: Run Task 4 verification**

Run: `bun test tests/integration/service-metrics.test.ts && bun run lint && bun run build`

Expected: all tests PASS; lint and build exit 0.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/service-metrics.server.ts src/lib/dashboard-types.ts tests/integration/service-metrics.test.ts
git commit -m "feat: add team and agent service metrics"
```

---

### Task 5: Orchestrate refreshes, stale fallback, and the dashboard API

**Files:**
- Modify: `src/lib/dashboard-db.ts`
- Modify: `src/server.ts`
- Create: `tests/unit/dashboard-service.test.ts`
- Create: `tests/unit/server-dashboard.test.ts`

**Interfaces:**
- Consumes: `syncChatwootMessages`, `getSyncFreshness`, `resolveDashboardRange`, `getCampaignMetrics`, and `getServiceMetrics` from Tasks 2–4.
- Produces: `getDashboardData(period, range): Promise<DashboardData>` with `sync: SyncFreshness`.
- Produces: `GET /api/dashboard` responses with `cache-control: no-store` and typed 400/503 errors.
- Consumed by: Task 6 uses the final `DashboardData` contract.

- [ ] **Step 1: Write failing service and endpoint tests**

Inject fake synchronizer/repositories and assert:

- successful refresh synchronizes before querying metrics and returns `sync.status: 'fresh'`;
- a concurrent `busy` sync reads the existing projection without a warning when another successful cursor exists;
- a source failure after previous success returns metrics with `sync.status: 'stale'` and a client-safe warning;
- a source failure before any successful sync returns HTTP 503;
- invalid custom dates return HTTP 400;
- repeated API requests are request-deduplicated only while in flight and are not served from the old 30-second result cache;
- responses contain `cache-control: no-store` and never include a connection string or raw SQL error.

- [ ] **Step 2: Run Task 5 tests to verify they fail**

Run: `bun test tests/unit/dashboard-service.test.ts tests/unit/server-dashboard.test.ts`

Expected: FAIL against the current cached, single-database implementation.

- [ ] **Step 3: Refactor `dashboard-db.ts` into the orchestration boundary**

Remove its monolithic SQL. Resolve the range, attempt synchronization, load both metric groups in parallel from the projection, and attach freshness metadata. Preserve the prior projection on failures. Keep no module capable of writing to the Chatwoot pool.

- [ ] **Step 4: Update the endpoint refresh behavior**

Remove the 30-second completed-result cache. Retain in-flight request coalescing so one page burst does not launch duplicate work. Use `no-store`, retain the existing health endpoint, and map typed validation/unavailable errors to safe Portuguese messages.

- [ ] **Step 5: Run Task 5 verification**

Run: `bun test tests/unit/dashboard-service.test.ts tests/unit/server-dashboard.test.ts && bun run lint && bun run build`

Expected: all tests PASS; lint and build exit 0.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/lib/dashboard-db.ts src/server.ts tests/unit/dashboard-service.test.ts tests/unit/server-dashboard.test.ts
git commit -m "feat: refresh dashboard analytics on demand"
```

---

### Task 6: Present campaign, team, and agent results to the client

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/components/dashboard/Charts.tsx`
- Modify: `src/components/dashboard/CampaignTable.tsx`
- Create: `src/components/dashboard/AgentTable.tsx`
- Create: `src/components/dashboard/SyncStatus.tsx`
- Create: `tests/unit/dashboard-view.test.tsx`

**Interfaces:**
- Consumes: the final `DashboardData`, `CampaignMetric`, and `AgentMetric` contracts from Tasks 3–5.
- Produces: the client-facing page sections “Resumo do período”, “Resultado das campanhas”, “Atendimento geral da equipe”, and “Desempenho por atendente”.

- [ ] **Step 1: Write failing component tests**

Render a complete fixture and assert visible labels/values for:

- sent, delivered, read, replied, failures, response rate, estimated cost, and cost per response;
- campaign table counts and delivery/reading/response rates;
- pending and uncertain campaign records in a secondary “Detalhes operacionais” disclosure, never merged into confirmed failures;
- team conversations, incoming messages, human replies, first response, and average response;
- each agent's distinct conversations, sent messages, and average response;
- “Dados atualizados em …” for fresh data;
- a visible stale-data warning that does not hide existing metrics;
- absence of “WABA”, “WAMID”, “checkpoint”, raw SQL, and technical schema names.

- [ ] **Step 2: Run the view tests to verify they fail**

Run: `bun test tests/unit/dashboard-view.test.tsx`

Expected: FAIL because the current page lacks the new funnel, agent table, and freshness state.

- [ ] **Step 3: Implement the summary and campaign presentation**

Replace “oportunidades” with “pessoas que responderam”. Show the complete funnel and failures, preserve US-dollar formatting for costs, and expand the campaign table with approved counts/rates. Components must display values supplied by the API rather than recomputing business rules.

- [ ] **Step 4: Implement team, agent, and freshness presentation**

Add the agent table, keep the general service charts, and show the last successful synchronization plus a non-blocking stale warning. Make “Últimos 30 dias” (`30d`) the initial filter and preserve all approved date choices. Add a secondary “Detalhes operacionais” disclosure for pending/uncertain campaign records. Do not add automatic timers.

- [ ] **Step 5: Run Task 6 verification**

Run: `bun test tests/unit/dashboard-view.test.tsx && bun run lint && bun run build`

Expected: view tests PASS; lint and build exit 0.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/routes/index.tsx src/components/dashboard/Charts.tsx src/components/dashboard/CampaignTable.tsx src/components/dashboard/AgentTable.tsx src/components/dashboard/SyncStatus.tsx tests/unit/dashboard-view.test.tsx
git commit -m "feat: present campaign and service results"
```

---

### Task 7: Gate deployment with schema verification, CI, and reconciliation

**Files:**
- Modify: `.github/workflows/publish-image.yml`
- Modify: `README.md`
- Create: `scripts/verify-chatwoot-schema.mjs`
- Create: `scripts/backfill-chatwoot.mjs`
- Create: `scripts/reconcile-dashboard.mjs`
- Create: `docs/runbooks/chatwoot-dashboard-rollout.md`

**Interfaces:**
- Consumes: migration, source adapter, synchronizer, and metric APIs from Tasks 1–6.
- Produces: repeatable schema check, resumable initial backfill, sanitized reconciliation report, and a deployment runbook.

- [ ] **Step 1: Add a failing CI validation job**

Add a PostgreSQL service and validation job that runs `bun install --frozen-lockfile`, unit/integration tests, lint, and build. Make image publication depend on this job. Verify the workflow fails before test database setup applies the analytics migration.

- [ ] **Step 2: Implement the Chatwoot schema verifier**

Check the required standard columns and enum values used by `chatwoot-source.server.ts` in `messages`, `conversations`, and `users`. Print table/column compatibility only; never print message content, connection strings, tokens, or sample payloads. Exit nonzero on an incompatible deployed schema.

- [ ] **Step 3: Implement resumable backfill and reconciliation scripts**

`backfill-chatwoot.mjs` repeatedly calls the same production synchronizer until current and reports row counts/cursor only. `reconcile-dashboard.mjs` accepts a date range and reports aggregate sent/delivered/read/replied/team totals without message content or personal phone numbers.

- [ ] **Step 4: Document rollout and rollback**

The runbook must require: database backup; analytics migration; read-only Chatwoot role; schema verification; backfill; known-period reconciliation; deployment; smoke test; and rollback that preserves the analytics schema for diagnosis. Document all new environment variables and the fact that no scheduler/polling exists.

- [ ] **Step 5: Run complete local verification**

Run: `bun run test && bun run lint && bun run build && git diff --check`

Expected: every test PASS; lint/build exit 0; `git diff --check` has no output.

- [ ] **Step 6: Run the production-readiness checks with approved credentials**

Run:

```bash
bun scripts/verify-chatwoot-schema.mjs
bun scripts/backfill-chatwoot.mjs
bun scripts/reconcile-dashboard.mjs --start 2026-09-01 --end 2026-09-30
```

Expected: compatible schema; backfill reaches `current`; reconciliation totals match the manually selected Chatwoot/campaign sample. Do not deploy if any check differs without an explained, documented reason.

- [ ] **Step 7: Commit Task 7**

```bash
git add .github/workflows/publish-image.yml README.md scripts/verify-chatwoot-schema.mjs scripts/backfill-chatwoot.mjs scripts/reconcile-dashboard.mjs docs/runbooks/chatwoot-dashboard-rollout.md
git commit -m "chore: gate Chatwoot dashboard rollout"
```

---

## Final Acceptance

- [ ] Run `bun run test`, `bun run lint`, `bun run build`, and `git diff --check` from a clean checkout.
- [ ] Apply the analytics migration in the intended dashboard database.
- [ ] Verify the deployed Chatwoot schema with the read-only account.
- [ ] Backfill the Fast Escova inbox and record the terminal cursor/row count.
- [ ] Reconcile one closed campaign, one campaign with a reply exactly on a boundary, one multi-agent conversation, and one overnight response.
- [ ] Confirm opening/refreshing the page performs incremental work and that no background polling occurs.
- [ ] Temporarily block the Chatwoot connection and confirm the UI serves prior data with a stale warning.
- [ ] Confirm the production dashboard never displays message content, raw SQL errors, credentials, WABA/WAMID terminology, or schema names.
