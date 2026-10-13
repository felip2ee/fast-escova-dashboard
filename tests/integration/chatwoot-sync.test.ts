import { beforeEach, describe, expect, test } from "bun:test";

import type { ChatwootSource } from "../../src/lib/chatwoot-source.server";
import { syncChatwootMessages } from "../../src/lib/chatwoot-sync.server";
import type { ChatwootCursor, ProjectedMessage } from "../../src/lib/chatwoot-types";
import { integrationPool, resetAnalyticsSchema } from "./postgres";

const message = (
  id: number,
  updatedAt: string,
  deliveryStatus: ProjectedMessage["deliveryStatus"] = "sent",
): ProjectedMessage => ({
  messageId: String(id),
  conversationId: "700",
  accountId: "2",
  inboxId: "1",
  direction: "outgoing",
  kind: "human",
  private: false,
  deliveryStatus,
  authorId: "42",
  authorName: "Ana",
  createdAt: "2026-10-12T12:00:00.000Z",
  updatedAt,
});

class MemorySource implements ChatwootSource {
  constructor(
    private readonly rows: ProjectedMessage[],
    private readonly failAtCall: number | null = null,
    private readonly failure = new Error("source failed"),
  ) {}

  calls = 0;

  async fetchPage(cursor: ChatwootCursor | null, limit: number) {
    this.calls += 1;
    if (this.failAtCall === this.calls) throw this.failure;
    return this.rows
      .filter(
        (row) =>
          cursor == null ||
          row.updatedAt > cursor.updatedAt ||
          (row.updatedAt === cursor.updatedAt && BigInt(row.messageId) > BigInt(cursor.id)),
      )
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          (BigInt(left.messageId) < BigInt(right.messageId) ? -1 : 1),
      )
      .slice(0, limit);
  }
}

const state = async () =>
  (
    await integrationPool.query<{
      cursor_updated_at: Date | null;
      cursor_id: string | null;
      last_error_code: string | null;
      last_error_message: string | null;
    }>(`
      SELECT cursor_updated_at, cursor_id::text, last_error_code, last_error_message
      FROM dashboard_analytics.sync_state
      WHERE source = 'chatwoot_messages'
    `)
  ).rows[0];

describe("incremental Chatwoot synchronization", () => {
  beforeEach(resetAnalyticsSchema);

  test("imports every page and stores the terminal composite cursor", async () => {
    const rows = [1, 2, 3, 4, 5].map((id) => message(id, `2026-10-12T12:00:0${id}.000Z`));

    const result = await syncChatwootMessages({
      source: new MemorySource(rows),
      pool: integrationPool,
      pageSize: 2,
    });

    const total = await integrationPool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM dashboard_analytics.chatwoot_messages",
    );
    expect(result).toMatchObject({ status: "updated", processed: 5 });
    expect(total.rows[0]?.total).toBe("5");
    expect(await state()).toMatchObject({ cursor_id: "5" });
  });

  test("does not skip equal updated_at values across page boundaries", async () => {
    const sameTime = "2026-10-12T12:00:00.000Z";
    const rows = [message(1, sameTime), message(2, sameTime), message(3, sameTime)];

    await syncChatwootMessages({
      source: new MemorySource(rows),
      pool: integrationPool,
      pageSize: 2,
    });

    const ids = await integrationPool.query<{ message_id: string }>(`
      SELECT message_id::text FROM dashboard_analytics.chatwoot_messages ORDER BY message_id
    `);
    expect(ids.rows.map((row) => row.message_id)).toEqual(["1", "2", "3"]);
    expect(await state()).toMatchObject({ cursor_id: "3" });
  });

  test("replaying a page updates rows without duplication", async () => {
    const row = message(1, "2026-10-12T12:00:00.000Z");
    await syncChatwootMessages({ source: new MemorySource([row]), pool: integrationPool });
    await integrationPool.query(
      "DELETE FROM dashboard_analytics.sync_state WHERE source = 'chatwoot_messages'",
    );

    await syncChatwootMessages({ source: new MemorySource([row]), pool: integrationPool });

    const total = await integrationPool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM dashboard_analytics.chatwoot_messages",
    );
    expect(total.rows[0]?.total).toBe("1");
  });

  test("refreshes delivered and read status after a later source update", async () => {
    await syncChatwootMessages({
      source: new MemorySource([message(1, "2026-10-12T12:00:00.000Z", "delivered")]),
      pool: integrationPool,
    });
    await syncChatwootMessages({
      source: new MemorySource([message(1, "2026-10-12T12:05:00.000Z", "read")]),
      pool: integrationPool,
    });

    const result = await integrationPool.query<{ delivery_status: string }>(`
      SELECT delivery_status FROM dashboard_analytics.chatwoot_messages WHERE message_id = 1
    `);
    expect(result.rows[0]?.delivery_status).toBe("read");
  });

  test("allows only one concurrent synchronizer to own the advisory lock", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slowSource: ChatwootSource = {
      async fetchPage() {
        entered();
        await paused;
        return [];
      },
    };

    const first = syncChatwootMessages({ source: slowSource, pool: integrationPool });
    await started;
    const second = await syncChatwootMessages({
      source: new MemorySource([]),
      pool: integrationPool,
    });
    release();
    await first;

    expect(second).toEqual({ status: "busy", processed: 0, lastSuccessAt: null });
  });

  test("preserves the last successfully committed page cursor when a later page fails", async () => {
    const rows = [
      message(1, "2026-10-12T12:00:01.000Z"),
      message(2, "2026-10-12T12:00:02.000Z"),
      message(3, "2026-10-12T12:00:03.000Z"),
    ];

    await expect(
      syncChatwootMessages({
        source: new MemorySource(rows, 2),
        pool: integrationPool,
        pageSize: 2,
      }),
    ).rejects.toThrow("Falha ao sincronizar o Chatwoot");

    expect(await state()).toMatchObject({ cursor_id: "2", last_error_code: "SYNC_FAILED" });
  });

  test("sanitizes the stored failure without SQL text or credentials", async () => {
    const secret = "postgresql://admin:super-secret@database/chatwoot SELECT * FROM messages";

    await expect(
      syncChatwootMessages({
        source: new MemorySource([], 1, new Error(secret)),
        pool: integrationPool,
      }),
    ).rejects.toThrow("Falha ao sincronizar o Chatwoot");

    const saved = await state();
    expect(saved).toMatchObject({
      last_error_code: "SYNC_FAILED",
      last_error_message: "Falha ao sincronizar o Chatwoot.",
    });
    expect(JSON.stringify(saved)).not.toContain("super-secret");
    expect(JSON.stringify(saved)).not.toContain("SELECT");
  });
});
