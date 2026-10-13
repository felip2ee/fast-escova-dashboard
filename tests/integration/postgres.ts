import { readFile } from "node:fs/promises";

import { Pool } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL must point to an isolated PostgreSQL database");
}

export const integrationPool = new Pool({ connectionString, max: 2 });

export async function resetAnalyticsSchema() {
  await integrationPool.query("DROP SCHEMA IF EXISTS dashboard_analytics CASCADE");
  const migration = await readFile(
    new URL("../../sql/2026-10-12-add-dashboard-analytics.sql", import.meta.url),
    "utf8",
  );
  await integrationPool.query(migration);
}
