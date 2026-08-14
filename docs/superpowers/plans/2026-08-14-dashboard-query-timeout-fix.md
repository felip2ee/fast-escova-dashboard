# Dashboard Query Timeout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the campaigns-list and dispatch-by-day dashboard queries from hitting the 20s `statement_timeout` in production Postgres.

**Architecture:** Add two `STORED` generated columns (pre-normalized last-8-digits phone numbers) with btree indexes, then rewrite the two slow queries in `src/lib/dashboard-db.ts` to match on those indexed columns instead of computing `regexp_replace`/`right` inline per row. Also collapse a duplicated correlated subquery in the campaigns query into a single `LATERAL` computed once per row.

**Tech Stack:** PostgreSQL (schema `disparos`), Node.js `pg` client, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-14-dashboard-query-timeout-design.md`

## Global Constraints

- Do not change `statement_timeout` or `query_timeout` (`src/lib/dashboard-db.ts:14-15`) — the fix must make the queries fast, not give them more time.
- No new dependencies, no migration framework — the repo has neither today (verified: no `*.sql`, no drizzle/prisma/knex in `package.json`).
- `getDashboardData(period, range): Promise<DashboardData>` signature and the `DashboardData` shape (`src/lib/dashboard-types.ts`) must not change — only the SQL text inside it.
- DB connection string for all steps: `process.env.DATABASE_URL` (Postgres at `n8n.agencianovabr.com:5432/fastescova`, `DATABASE_SSL=disable`).
- `pg` (`^8.16.3`) is already a project dependency — verification scripts may `import { Client } from "pg"` directly, run with plain `node`.

---

### Task 1: Add indexed phone-normalization columns (DB migration)

**Files:**
- Create: `sql/2026-08-14-add-phone-norm-columns.sql`
- Create (temporary, deleted in Task 4): `scripts/verify/apply-migration.mjs`

**Interfaces:**
- Produces: `disparos.contatos.numero_norm` (text, STORED generated), `disparos.campanha_destinatarios.celular_norm` (text, STORED generated), index `idx_contatos_numero_norm` on `disparos.contatos (numero_norm)`, index `idx_destinatarios_conta_celular_norm` on `disparos.campanha_destinatarios (conta_waba_id, celular_norm)`. Tasks 2 and 3 consume these four names exactly.

- [ ] **Step 1: Write the migration SQL file**

```sql
-- sql/2026-08-14-add-phone-norm-columns.sql
-- Adds pre-normalized, indexed phone-number columns so the dashboard's
-- phone-matching queries (src/lib/dashboard-db.ts) can use an index instead
-- of computing regexp_replace/right per row. See
-- docs/superpowers/specs/2026-08-14-dashboard-query-timeout-design.md

ALTER TABLE disparos.contatos
  ADD COLUMN numero_norm text GENERATED ALWAYS AS (
    right(regexp_replace(COALESCE(wa_id, celular, ''), '[^0-9]', '', 'g'), 8)
  ) STORED;

CREATE INDEX CONCURRENTLY idx_contatos_numero_norm
  ON disparos.contatos (numero_norm);

ALTER TABLE disparos.campanha_destinatarios
  ADD COLUMN celular_norm text GENERATED ALWAYS AS (
    right(regexp_replace(COALESCE(celular_snapshot, ''), '[^0-9]', '', 'g'), 8)
  ) STORED;

CREATE INDEX CONCURRENTLY idx_destinatarios_conta_celular_norm
  ON disparos.campanha_destinatarios (conta_waba_id, celular_norm);
```

- [ ] **Step 2: Write the apply script**

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, so each
statement must be sent as its own round trip (not one multi-statement
query string).

```js
// scripts/verify/apply-migration.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

const sql = readFileSync(
  new URL("../../sql/2026-08-14-add-phone-norm-columns.sql", import.meta.url),
  "utf8",
);
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

async function main() {
  await client.connect();
  for (const statement of statements) {
    console.log("Running:", statement.split("\n").find((l) => !l.startsWith("--")));
    await client.query(statement);
    console.log("OK");
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run the migration against the live DB**

Run: `node scripts/verify/apply-migration.mjs`
Expected: four "OK" lines, one per statement, no errors.

- [ ] **Step 4: Verify columns and indexes exist**

```js
// scripts/verify/check-migration.mjs
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  await client.connect();

  const cols = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='disparos' AND column_name IN ('numero_norm','celular_norm')
    ORDER BY table_name
  `);
  console.table(cols.rows);
  if (cols.rows.length !== 2) throw new Error(`expected 2 columns, got ${cols.rows.length}`);

  const idx = await client.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname='disparos'
      AND indexname IN ('idx_contatos_numero_norm','idx_destinatarios_conta_celular_norm')
    ORDER BY indexname
  `);
  console.table(idx.rows);
  if (idx.rows.length !== 2) throw new Error(`expected 2 indexes, got ${idx.rows.length}`);

  const sample = await client.query(`
    SELECT wa_id, celular, numero_norm FROM disparos.contatos
    WHERE numero_norm IS NOT NULL LIMIT 3
  `);
  console.table(sample.rows);

  console.log("Migration verified OK");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `node scripts/verify/check-migration.mjs`
Expected: 2 columns, 2 indexes, 3 sample rows where `numero_norm` is the
last 8 digits of `wa_id`/`celular`, and "Migration verified OK".

- [ ] **Step 5: Commit the migration file**

```bash
git add sql/2026-08-14-add-phone-norm-columns.sql
git commit -m "feat: add indexed phone-normalization columns for dashboard queries"
```

(`scripts/verify/*.mjs` stays unstaged — it's deleted in Task 4.)

---

### Task 2: Rewrite the campaigns query to use indexed columns and dedupe the conversas/ctr subquery

**Files:**
- Modify: `src/lib/dashboard-db.ts:74-153`
- Create (temporary, deleted in Task 4): `scripts/verify/campaigns-query.mjs`

**Interfaces:**
- Consumes: `disparos.contatos.numero_norm`, `disparos.campanha_destinatarios.celular_norm` (from Task 1).
- Produces: same `campaignsRaw` row shape consumed by the `campaigns` mapping in `dashboard-db.ts` (search for `campaignsRaw.map`) — no change to column names returned by the query.

- [ ] **Step 1: Capture baseline output with the current (unmodified) query**

```js
// scripts/verify/campaigns-query.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

const periodStart =
  "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 month'";
const periodEnd =
  "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 day'";

const OLD_SQL = `SELECT c.id::text, c.nome, COALESCE(c.tipo, 'avulsa') AS tipo,
    to_char(COALESCE(c.iniciada_em, c.criado_em) AT TIME ZONE 'America/Araguaina', 'DD/MM/YYYY') AS data,
    c.status,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS enviadas,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('entregue','lido')) AS entregues,
    count(cd.id) FILTER (WHERE cd.status_atual = 'lido') AS lidas,
    count(cd.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM disparos.mensagens mo
      JOIN disparos.contatos cto ON cto.id=mo.contato_id
      WHERE mo.escopo='conversa' AND mo.direcao='entrada'
        AND mo.conta_waba_id=cd.conta_waba_id
        AND right(regexp_replace(COALESCE(cto.wa_id,cto.celular,''),'[^0-9]','','g'),8)
          = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
        AND length(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g')) >= 8
        AND COALESCE(mo.wa_timestamp,mo.criado_em)
          BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
        AND NOT EXISTS (
          SELECT 1 FROM disparos.campanha_destinatarios cd2
          WHERE cd2.conta_waba_id=cd.conta_waba_id AND cd2.enviado_em>cd.enviado_em
            AND cd2.enviado_em<=COALESCE(mo.wa_timestamp,mo.criado_em)
            AND right(regexp_replace(COALESCE(cd2.celular_snapshot,''),'[^0-9]','','g'),8)
              = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
        )
        AND (COALESCE(mo.wa_timestamp,mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${periodStart} AND ${periodEnd}
    )) AS conversas,
    (SELECT count(*) FROM disparos.mensagens mr
      JOIN disparos.campanha_destinatarios cdr ON cdr.id=mr.atribuida_destinatario_id
      WHERE cdr.campanha_id=c.id AND mr.escopo='conversa' AND mr.direcao='entrada') AS mensagens_recebidas,
    round(100.0 * count(cd.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM disparos.mensagens mo
      JOIN disparos.contatos cto ON cto.id=mo.contato_id
      WHERE mo.escopo='conversa' AND mo.direcao='entrada'
        AND mo.conta_waba_id=cd.conta_waba_id
        AND right(regexp_replace(COALESCE(cto.wa_id,cto.celular,''),'[^0-9]','','g'),8)
          = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
        AND length(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g')) >= 8
        AND COALESCE(mo.wa_timestamp,mo.criado_em)
          BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
        AND NOT EXISTS (
          SELECT 1 FROM disparos.campanha_destinatarios cd2
          WHERE cd2.conta_waba_id=cd.conta_waba_id AND cd2.enviado_em>cd.enviado_em
            AND cd2.enviado_em<=COALESCE(mo.wa_timestamp,mo.criado_em)
            AND right(regexp_replace(COALESCE(cd2.celular_snapshot,''),'[^0-9]','','g'),8)
              = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
        )
        AND (COALESCE(mo.wa_timestamp,mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${periodStart} AND ${periodEnd}
    ))
      / nullif(count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')), 0), 2) AS ctr,
    round(avg(cd.tempo_resposta_segundos) FILTER (WHERE cd.engajou) / 60.0, 2) AS primeira_resposta_min
  FROM disparos.campanhas c
  LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
  WHERE EXISTS (
    SELECT 1 FROM disparos.campanha_destinatarios cdf
    WHERE cdf.campanha_id=c.id AND (
      (cdf.enviado_em AT TIME ZONE 'America/Araguaina')::date BETWEEN ${periodStart} AND ${periodEnd}
      OR EXISTS (
        SELECT 1 FROM disparos.mensagens mf
        JOIN disparos.contatos ctf ON ctf.id=mf.contato_id
        WHERE mf.escopo='conversa' AND mf.direcao='entrada'
          AND mf.conta_waba_id=cdf.conta_waba_id
          AND right(regexp_replace(COALESCE(ctf.wa_id,ctf.celular,''),'[^0-9]','','g'),8)
            = right(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g'),8)
          AND length(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g')) >= 8
          AND COALESCE(mf.wa_timestamp,mf.criado_em)
            BETWEEN cdf.enviado_em AND cdf.enviado_em + interval '48 hours'
          AND NOT EXISTS (
            SELECT 1 FROM disparos.campanha_destinatarios cdf2
            WHERE cdf2.conta_waba_id=cdf.conta_waba_id AND cdf2.enviado_em>cdf.enviado_em
              AND cdf2.enviado_em<=COALESCE(mf.wa_timestamp,mf.criado_em)
              AND right(regexp_replace(COALESCE(cdf2.celular_snapshot,''),'[^0-9]','','g'),8)
                = right(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g'),8)
          )
          AND (COALESCE(mf.wa_timestamp,mf.criado_em) AT TIME ZONE 'America/Araguaina')::date
            BETWEEN ${periodStart} AND ${periodEnd}
      )
    )
  )
  GROUP BY c.id ORDER BY COALESCE(c.iniciada_em, c.criado_em) DESC`;

const NEW_SQL = `SELECT c.id::text, c.nome, COALESCE(c.tipo, 'avulsa') AS tipo,
    to_char(COALESCE(c.iniciada_em, c.criado_em) AT TIME ZONE 'America/Araguaina', 'DD/MM/YYYY') AS data,
    c.status,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS enviadas,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('entregue','lido')) AS entregues,
    count(cd.id) FILTER (WHERE cd.status_atual = 'lido') AS lidas,
    count(cd.id) FILTER (WHERE tc.tem_conversa) AS conversas,
    (SELECT count(*) FROM disparos.mensagens mr
      JOIN disparos.campanha_destinatarios cdr ON cdr.id=mr.atribuida_destinatario_id
      WHERE cdr.campanha_id=c.id AND mr.escopo='conversa' AND mr.direcao='entrada') AS mensagens_recebidas,
    round(100.0 * count(cd.id) FILTER (WHERE tc.tem_conversa)
      / nullif(count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')), 0), 2) AS ctr,
    round(avg(cd.tempo_resposta_segundos) FILTER (WHERE cd.engajou) / 60.0, 2) AS primeira_resposta_min
  FROM disparos.campanhas c
  LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM disparos.mensagens mo
      JOIN disparos.contatos cto ON cto.id = mo.contato_id
      WHERE mo.escopo = 'conversa' AND mo.direcao = 'entrada'
        AND mo.conta_waba_id = cd.conta_waba_id
        AND cto.numero_norm = cd.celular_norm
        AND length(cd.celular_norm) = 8
        AND COALESCE(mo.wa_timestamp, mo.criado_em)
          BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
        AND NOT EXISTS (
          SELECT 1 FROM disparos.campanha_destinatarios cd2
          WHERE cd2.conta_waba_id = cd.conta_waba_id AND cd2.enviado_em > cd.enviado_em
            AND cd2.enviado_em <= COALESCE(mo.wa_timestamp, mo.criado_em)
            AND cd2.celular_norm = cd.celular_norm
        )
        AND (COALESCE(mo.wa_timestamp, mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${periodStart} AND ${periodEnd}
    ) AS tem_conversa
  ) tc ON true
  WHERE EXISTS (
    SELECT 1 FROM disparos.campanha_destinatarios cdf
    WHERE cdf.campanha_id=c.id AND (
      (cdf.enviado_em AT TIME ZONE 'America/Araguaina')::date BETWEEN ${periodStart} AND ${periodEnd}
      OR EXISTS (
        SELECT 1 FROM disparos.mensagens mf
        JOIN disparos.contatos ctf ON ctf.id=mf.contato_id
        WHERE mf.escopo='conversa' AND mf.direcao='entrada'
          AND mf.conta_waba_id=cdf.conta_waba_id
          AND ctf.numero_norm = cdf.celular_norm
          AND length(cdf.celular_norm) = 8
          AND COALESCE(mf.wa_timestamp,mf.criado_em)
            BETWEEN cdf.enviado_em AND cdf.enviado_em + interval '48 hours'
          AND NOT EXISTS (
            SELECT 1 FROM disparos.campanha_destinatarios cdf2
            WHERE cdf2.conta_waba_id=cdf.conta_waba_id AND cdf2.enviado_em>cdf.enviado_em
              AND cdf2.enviado_em<=COALESCE(mf.wa_timestamp,mf.criado_em)
              AND cdf2.celular_norm = cdf.celular_norm
          )
          AND (COALESCE(mf.wa_timestamp,mf.criado_em) AT TIME ZONE 'America/Araguaina')::date
            BETWEEN ${periodStart} AND ${periodEnd}
      )
    )
  )
  GROUP BY c.id ORDER BY COALESCE(c.iniciada_em, c.criado_em) DESC`;

const mode = process.argv[2]; // "old" or "new"
if (mode !== "old" && mode !== "new") {
  console.error("Usage: node campaigns-query.mjs old|new");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  await client.connect();
  await client.query("SET statement_timeout = '20s'");
  const t0 = Date.now();
  const result = await client.query(mode === "old" ? OLD_SQL : NEW_SQL);
  const elapsed = Date.now() - t0;
  console.log(`[${mode}] rows=${result.rows.length} elapsed=${elapsed}ms`);

  const outPath = new URL(`./campaigns-${mode}.json`, import.meta.url);
  writeFileSync(outPath, JSON.stringify(result.rows, null, 2));

  if (mode === "new") {
    if (elapsed >= 2000) throw new Error(`NEW query took ${elapsed}ms, expected < 2000ms`);
    const oldPath = new URL("./campaigns-old.json", import.meta.url);
    if (!existsSync(oldPath)) throw new Error("Run with 'old' first to capture baseline");
    const oldRows = JSON.parse(readFileSync(oldPath, "utf8"));
    const newRows = JSON.parse(readFileSync(outPath, "utf8"));
    if (JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
      throw new Error("Row output differs between old and new query — see campaigns-old.json / campaigns-new.json");
    }
    console.log("MATCH: old and new query output identical, new query is fast. OK");
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `node scripts/verify/campaigns-query.mjs old`
Expected: prints `[old] rows=N elapsed=<~10000-11000>ms`, writes `campaigns-old.json`.

- [ ] **Step 2: Edit `src/lib/dashboard-db.ts` — replace the campaigns query**

In `src/lib/dashboard-db.ts`, replace the entire SQL template string for the
campaigns query (currently `src/lib/dashboard-db.ts:74-153`, the first
argument to `rows<...>(...)` in the `Promise.all` array) with the `NEW_SQL`
text from Step 1 above (the version using `tc.tem_conversa`, `cto.numero_norm`,
`cd.celular_norm`, `cdf.celular_norm`, `ctf.numero_norm`, `cdf2.celular_norm`).
Keep the `queryValues` argument and the `rows<{...}>(...)` wrapper and result
type unchanged — only the SQL string inside the backticks changes.

- [ ] **Step 3: Re-run the verify script in "new" mode against the edited query**

Run: `node scripts/verify/campaigns-query.mjs new`
Expected: `[new] rows=N elapsed=<well under 2000>ms` then
`MATCH: old and new query output identical, new query is fast. OK`.
If it throws, fix the query (do not change the assertion) and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboard-db.ts
git commit -m "perf: use indexed phone-normalization columns in campaigns query"
```

---

### Task 3: Rewrite the dispatch-by-day query to use indexed columns

**Files:**
- Modify: `src/lib/dashboard-db.ts` — the dispatch-by-day query (the second
  argument to `rows<...>(...)` in the `Promise.all` array, immediately after
  the campaigns query edited in Task 2; its exact line numbers shifted when
  Task 2 changed the file, so locate it by content — it starts with
  `` `WITH dias AS ( `` and is the only query with an `oportunidades` CTE —
  not by the original `156-191` line numbers from before Task 2's edit).
- Create (temporary, deleted in Task 4): `scripts/verify/dispatch-query.mjs`

**Interfaces:**
- Consumes: `disparos.contatos.numero_norm`, `disparos.campanha_destinatarios.celular_norm` (from Task 1).
- Produces: same `dispatchRaw` row shape (`dia`, `disparadas`, `oportunidades`, `recebidas`) consumed by the `dispatchesByDay` mapping in `dashboard-db.ts` (search for `dispatchRaw.map`).

- [ ] **Step 1: Capture baseline output with the current (unmodified) query**

```js
// scripts/verify/dispatch-query.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

const periodStart =
  "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 month'";
const periodEnd =
  "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 day'";

const OLD_SQL = `WITH dias AS (
    SELECT generate_series(${periodStart}, ${periodEnd}, interval '1 day')::date AS dia
  ), oportunidades AS (
    SELECT DISTINCT ON (cand.id) cand.id AS destinatario_id,
      (e.recebida_em AT TIME ZONE 'America/Araguaina')::date AS dia
    FROM (
      SELECT m.conta_waba_id,
        regexp_replace(COALESCE(ct.wa_id,ct.celular,''),'[^0-9]','','g') AS numero,
        COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em
      FROM disparos.mensagens m
      JOIN disparos.contatos ct ON ct.id=m.contato_id
      WHERE m.escopo='conversa' AND m.direcao='entrada'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${periodStart} AND ${periodEnd}
    ) e
    JOIN LATERAL (
      SELECT cd.id FROM disparos.campanha_destinatarios cd
      WHERE cd.conta_waba_id=e.conta_waba_id AND cd.enviado_em IS NOT NULL
        AND length(e.numero) >= 8
        AND right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)=right(e.numero,8)
        AND e.recebida_em BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
      ORDER BY cd.enviado_em DESC LIMIT 1
    ) cand ON true
    ORDER BY cand.id,e.recebida_em
  ) SELECT to_char(d.dia, 'DD/MM') AS dia,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS disparadas,
    (SELECT count(*) FROM oportunidades o WHERE o.dia=d.dia) AS oportunidades,
    (SELECT count(*) FROM disparos.mensagens mr
      WHERE mr.escopo='conversa' AND mr.direcao='entrada' AND mr.atribuida_destinatario_id IS NOT NULL
        AND (COALESCE(mr.wa_timestamp,mr.criado_em) AT TIME ZONE 'America/Araguaina')::date=d.dia) AS recebidas
  FROM dias d LEFT JOIN disparos.campanha_destinatarios cd
    ON (cd.enviado_em AT TIME ZONE 'America/Araguaina')::date = d.dia
  GROUP BY d.dia ORDER BY d.dia`;

const NEW_SQL = `WITH dias AS (
    SELECT generate_series(${periodStart}, ${periodEnd}, interval '1 day')::date AS dia
  ), oportunidades AS (
    SELECT DISTINCT ON (cand.id) cand.id AS destinatario_id,
      (e.recebida_em AT TIME ZONE 'America/Araguaina')::date AS dia
    FROM (
      SELECT m.conta_waba_id,
        ct.numero_norm,
        COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em
      FROM disparos.mensagens m
      JOIN disparos.contatos ct ON ct.id=m.contato_id
      WHERE m.escopo='conversa' AND m.direcao='entrada'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${periodStart} AND ${periodEnd}
    ) e
    JOIN LATERAL (
      SELECT cd.id FROM disparos.campanha_destinatarios cd
      WHERE cd.conta_waba_id=e.conta_waba_id AND cd.enviado_em IS NOT NULL
        AND length(e.numero_norm) = 8
        AND cd.celular_norm = e.numero_norm
        AND e.recebida_em BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
      ORDER BY cd.enviado_em DESC LIMIT 1
    ) cand ON true
    ORDER BY cand.id,e.recebida_em
  ) SELECT to_char(d.dia, 'DD/MM') AS dia,
    count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS disparadas,
    (SELECT count(*) FROM oportunidades o WHERE o.dia=d.dia) AS oportunidades,
    (SELECT count(*) FROM disparos.mensagens mr
      WHERE mr.escopo='conversa' AND mr.direcao='entrada' AND mr.atribuida_destinatario_id IS NOT NULL
        AND (COALESCE(mr.wa_timestamp,mr.criado_em) AT TIME ZONE 'America/Araguaina')::date=d.dia) AS recebidas
  FROM dias d LEFT JOIN disparos.campanha_destinatarios cd
    ON (cd.enviado_em AT TIME ZONE 'America/Araguaina')::date = d.dia
  GROUP BY d.dia ORDER BY d.dia`;

const mode = process.argv[2]; // "old" or "new"
if (mode !== "old" && mode !== "new") {
  console.error("Usage: node dispatch-query.mjs old|new");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  await client.connect();
  await client.query("SET statement_timeout = '20s'");
  const t0 = Date.now();
  const result = await client.query(mode === "old" ? OLD_SQL : NEW_SQL);
  const elapsed = Date.now() - t0;
  console.log(`[${mode}] rows=${result.rows.length} elapsed=${elapsed}ms`);

  const outPath = new URL(`./dispatch-${mode}.json`, import.meta.url);
  writeFileSync(outPath, JSON.stringify(result.rows, null, 2));

  if (mode === "new") {
    if (elapsed >= 2000) throw new Error(`NEW query took ${elapsed}ms, expected < 2000ms`);
    const oldPath = new URL("./dispatch-old.json", import.meta.url);
    if (!existsSync(oldPath)) throw new Error("Run with 'old' first to capture baseline");
    const oldRows = JSON.parse(readFileSync(oldPath, "utf8"));
    const newRows = JSON.parse(readFileSync(outPath, "utf8"));
    if (JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
      throw new Error("Row output differs between old and new query — see dispatch-old.json / dispatch-new.json");
    }
    console.log("MATCH: old and new query output identical, new query is fast. OK");
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `node scripts/verify/dispatch-query.mjs old`
Expected: prints `[old] rows=N elapsed=<~10000-11000>ms`, writes `dispatch-old.json`.

- [ ] **Step 2: Edit `src/lib/dashboard-db.ts` — replace the dispatch-by-day query**

Replace the entire SQL template string for the dispatch-by-day query
(currently `src/lib/dashboard-db.ts:156-191`, the second argument to
`rows<...>(...)` in the `Promise.all` array) with the `NEW_SQL` text from
Step 1 above (the version selecting `ct.numero_norm` and matching
`cd.celular_norm = e.numero_norm`). Keep the `queryValues` argument and the
`rows<{...}>(...)` wrapper and result type unchanged.

- [ ] **Step 3: Re-run the verify script in "new" mode against the edited query**

Run: `node scripts/verify/dispatch-query.mjs new`
Expected: `[new] rows=N elapsed=<well under 2000>ms` then
`MATCH: old and new query output identical, new query is fast. OK`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboard-db.ts
git commit -m "perf: use indexed phone-normalization columns in dispatch-by-day query"
```

---

### Task 4: End-to-end verification and cleanup

**Files:**
- Read only: `src/lib/dashboard-db.ts`
- Delete: `scripts/verify/` (entire directory, including the `*.json` snapshots — throwaway verification artifacts, not part of the app)

**Interfaces:**
- Consumes: the full `getDashboardData()` query set (both rewritten queries from Tasks 2–3, plus the two untouched queries in the same `Promise.all`).
- Produces: nothing new — this task only proves the combined result and cleans up.

- [ ] **Step 1: Run all four dashboard queries together for multiple periods and check combined timing**

```js
// scripts/verify/full-check.mjs (temporary — deleted in Step 3 below)
import { Client } from "pg";

const periods = {
  today: {
    start: "(now() AT TIME ZONE 'America/Araguaina')::date",
    end: "(now() AT TIME ZONE 'America/Araguaina')::date",
  },
  thisMonth: {
    start: "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date",
    end: "(now() AT TIME ZONE 'America/Araguaina')::date",
  },
  lastMonth: {
    start: "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 month'",
    end: "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 day'",
  },
};

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

async function timeQuery(sql) {
  const t0 = Date.now();
  await client.query(sql);
  return Date.now() - t0;
}

async function main() {
  await client.connect();
  await client.query("SET statement_timeout = '20s'");

  for (const [name, { start, end }] of Object.entries(periods)) {
    const campaignsElapsed = await timeQuery(`
      SELECT count(*) FROM disparos.campanhas c
      LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1 FROM disparos.mensagens mo
          JOIN disparos.contatos cto ON cto.id = mo.contato_id
          WHERE mo.escopo = 'conversa' AND mo.direcao = 'entrada'
            AND mo.conta_waba_id = cd.conta_waba_id
            AND cto.numero_norm = cd.celular_norm
            AND length(cd.celular_norm) = 8
            AND COALESCE(mo.wa_timestamp, mo.criado_em)
              BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
            AND (COALESCE(mo.wa_timestamp, mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
              BETWEEN ${start} AND ${end}
        ) AS tem_conversa
      ) tc ON true
    `);
    const dispatchElapsed = await timeQuery(`
      SELECT count(*) FROM disparos.mensagens m
      JOIN disparos.contatos ct ON ct.id=m.contato_id
      WHERE m.escopo='conversa' AND m.direcao='entrada'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
          BETWEEN ${start} AND ${end}
    `);
    console.log(`[${name}] campaigns-shape=${campaignsElapsed}ms dispatch-shape=${dispatchElapsed}ms`);
    if (campaignsElapsed >= 2000) throw new Error(`${name}: campaigns query too slow (${campaignsElapsed}ms)`);
    if (dispatchElapsed >= 2000) throw new Error(`${name}: dispatch query too slow (${dispatchElapsed}ms)`);
  }

  console.log("All periods well under the 20s statement_timeout. OK");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `node scripts/verify/full-check.mjs`
Expected: one line per period, all well under 2000ms, then
"All periods well under the 20s statement_timeout. OK".

- [ ] **Step 2: Manually confirm the app still starts and serves the dashboard**

Run: `bun install && bun run dev` (or `npm install && npm run dev` if `bun`
isn't available), then open the dashboard page in a browser and confirm the
campaigns table and the dispatch-by-day chart render without errors, for at
least the default period and "Mês passado" (last month).

- [ ] **Step 3: Delete the temporary verification scripts**

```bash
rm -rf scripts/verify
```

- [ ] **Step 4: Confirm nothing temporary is staged, then final status check**

```bash
git status
```

Expected: working tree clean except for whatever was already committed in
Tasks 1–3 (`sql/2026-08-14-add-phone-norm-columns.sql`,
`src/lib/dashboard-db.ts`, plus the spec/plan docs) — `scripts/verify/`
must not appear.
