# Dashboard Query Timeout Fix — Design

**Status:** Approved
**Related log:** `postgres_postgres_logs (1).txt` (2026-08-14, 14:31–15:20)

## Problem

`src/lib/dashboard-db.ts` runs four queries in parallel via `Promise.all` inside
`getDashboardData()`. Two of them (the campaigns list query and the
dispatch-by-day query) repeatedly hit the pool's 20s `statement_timeout`
(`src/lib/dashboard-db.ts:14-15`), producing this sequence in the Postgres
logs: `ERROR: canceling statement due to statement timeout` immediately
followed by `LOG: could not send data to client: Broken pipe` /
`FATAL: connection to client lost` — the app gives up on the connection once
Postgres cancels the statement, which then shows up as a dropped connection.

## Root cause

Both slow queries match phone numbers between `disparos.mensagens` →
`disparos.contatos` and `disparos.campanha_destinatarios` using:

```sql
right(regexp_replace(COALESCE(<phone column>, ''), '[^0-9]', '', 'g'), 8)
```

computed inline on both sides of the join predicate, with `length(...) >= 8`
as an extra guard. No index supports this expression, so Postgres falls back
to a nested-loop `Seq Scan` for every candidate row.

Confirmed live against the production DB (`EXPLAIN (ANALYZE, BUFFERS)`,
2026-08-14):

- **Campaigns query** (`src/lib/dashboard-db.ts:74-153`): **10.9s**. For each
  of 1776 `campanha_destinatarios` rows, does a `Seq Scan on contatos`
  (2019 rows) — and does this **twice**, because the `conversas` FILTER
  (line 80-99) and the `ctr` FILTER (line 103-122) run the exact same
  correlated `EXISTS` subquery a second time instead of reusing the result.
- **Dispatch-by-day query** (`src/lib/dashboard-db.ts:156-191`): **10.4s**.
  A `LATERAL` join runs a `Seq Scan on campanha_destinatarios` (2526 rows)
  18,662 times (once per contact × incoming-message row), 1.27M buffer hits.

Table sizes are small (mensagens: 3.3k rows, campanha_destinatarios: 2.5k,
contatos: 2.1k) — this is purely a missing-index problem, not a data-volume
problem. Together, these two queries alone exceed the 20s timeout under
normal load, and the app's request de-duplication (`src/server.ts:13-14`)
means concurrent dashboard loads pile up on the same slow query.

## Fix

### 1. Add indexed, pre-normalized phone columns (DB migration)

Add `STORED` generated columns holding the already-normalized last-8-digits
value, plus a btree index on each, so the match becomes a plain indexed
equality instead of a per-row function call with no index support:

- `disparos.contatos.numero_norm` — from `COALESCE(wa_id, celular, '')`
- `disparos.campanha_destinatarios.celular_norm` — from `COALESCE(celular_snapshot, '')`,
  indexed as `(conta_waba_id, celular_norm)` since every match also filters
  on `conta_waba_id`

The existing `length(regexp_replace(...)) >= 8` guard collapses to
`length(numero_norm) = 8` / `length(celular_norm) = 8`, since `right(x, 8)`
never produces more than 8 characters.

### 2. Rewrite the two slow queries to use the indexed columns

Same join logic, same output — just pointed at `numero_norm` /
`celular_norm` instead of computing `regexp_replace`/`right` inline.

### 3. De-duplicate the campaigns query's repeated subquery

The `conversas` and `ctr` FILTERs currently run an identical correlated
`EXISTS` subquery twice per `campanha_destinatarios` row. Compute it once
per row via a `LEFT JOIN LATERAL ... tc ON true` producing a `tem_conversa`
boolean, and reference `tc.tem_conversa` in both FILTERs.

## Non-goals

- Not raising `statement_timeout` — the queries should run in well under 1s
  once indexed; changing the timeout would mask the real issue.
- Not introducing a migration framework (Drizzle/Prisma/etc.) — the repo has
  none today, and one file's schema change doesn't justify adding one. The
  migration ships as a single SQL file applied directly.
- Not adding a test framework — the repo has none. Verification is a
  small standalone Node script (`pg` is already a dependency) that diffs
  `getDashboardData`-equivalent output before/after and checks query timing.

## Verification approach

1. `EXPLAIN (ANALYZE, BUFFERS)` on both rewritten queries directly against
   the live DB — confirm sub-second execution (down from ~11s each).
2. Capture the exact row output of both queries for a **frozen** period
   (`lastMonth` — a closed month's data doesn't change) before touching
   `dashboard-db.ts`, then re-capture after the rewrite and diff for exact
   equality. This proves the rewrite is behavior-preserving, not just faster.
