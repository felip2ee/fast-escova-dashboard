import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { integrationPool, resetAnalyticsSchema } from "./postgres";

describe("dashboard analytics migration", () => {
  beforeAll(resetAnalyticsSchema);
  afterAll(() => integrationPool.end());

  test("creates the projection without a message-content column", async () => {
    const result = await integrationPool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'dashboard_analytics'
        AND table_name = 'chatwoot_messages'
      ORDER BY ordinal_position
    `);

    expect(result.rows.map((row) => row.column_name)).toEqual([
      "message_id",
      "conversation_id",
      "account_id",
      "inbox_id",
      "direction",
      "kind",
      "private",
      "delivery_status",
      "author_id",
      "author_name",
      "created_at",
      "source_updated_at",
      "projected_at",
    ]);
  });

  test("upserts the same Chatwoot message idempotently", async () => {
    const values = [
      "9007199254740990",
      "700",
      "2",
      "1",
      "outgoing",
      "human",
      false,
      "sent",
      "42",
      "Ana",
      "2026-10-12T12:00:00.000Z",
      "2026-10-12T12:00:01.000Z",
    ];
    const sql = `
      INSERT INTO dashboard_analytics.chatwoot_messages (
        message_id, conversation_id, account_id, inbox_id, direction, kind,
        private, delivery_status, author_id, author_name, created_at, source_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (message_id) DO UPDATE
      SET delivery_status = EXCLUDED.delivery_status,
          source_updated_at = EXCLUDED.source_updated_at,
          projected_at = now()
    `;

    await integrationPool.query(sql, values);
    await integrationPool.query(sql, [
      ...values.slice(0, 7),
      "read",
      ...values.slice(8, 11),
      "2026-10-12T12:05:00.000Z",
    ]);

    const result = await integrationPool.query<{ total: string; delivery_status: string }>(`
      SELECT count(*)::text AS total, max(delivery_status) AS delivery_status
      FROM dashboard_analytics.chatwoot_messages
      WHERE message_id = 9007199254740990
    `);
    expect(result.rows[0]).toEqual({ total: "1", delivery_status: "read" });
  });

  test("calculates business seconds inside one open day", async () => {
    const result = await integrationPool.query<{ seconds: string }>(`
      SELECT dashboard_analytics.business_seconds(
        '2026-10-12T12:00:00Z'::timestamptz,
        '2026-10-12T13:30:00Z'::timestamptz
      )::text AS seconds
    `);
    expect(result.rows[0]?.seconds).toBe("5400");
  });

  test("excludes nights and Sunday from business seconds", async () => {
    const result = await integrationPool.query<{ overnight: string; weekend: string }>(`
      SELECT
        dashboard_analytics.business_seconds(
          '2026-10-12T22:30:00Z'::timestamptz,
          '2026-10-13T11:30:00Z'::timestamptz
        )::text AS overnight,
        dashboard_analytics.business_seconds(
          '2026-10-17T22:30:00Z'::timestamptz,
          '2026-10-19T11:30:00Z'::timestamptz
        )::text AS weekend
    `);
    expect(result.rows[0]).toEqual({ overnight: "3600", weekend: "3600" });
  });

  test("returns zero for reversed or equal intervals", async () => {
    const result = await integrationPool.query<{ equal_value: string; reversed_value: string }>(`
      SELECT
        dashboard_analytics.business_seconds(
          '2026-10-12T12:00:00Z'::timestamptz,
          '2026-10-12T12:00:00Z'::timestamptz
        )::text AS equal_value,
        dashboard_analytics.business_seconds(
          '2026-10-12T13:00:00Z'::timestamptz,
          '2026-10-12T12:00:00Z'::timestamptz
        )::text AS reversed_value
    `);
    expect(result.rows[0]).toEqual({ equal_value: "0", reversed_value: "0" });
  });
});
