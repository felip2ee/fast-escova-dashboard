import type { Pool } from "pg";

import {
  getSyncFreshnessFromPool,
  loadLastSuccessAt,
  loadSyncCursor,
  markSyncFailure,
  markSyncSuccess,
  persistProjectionPage,
  releaseSyncLock,
  tryAcquireSyncLock,
} from "./chatwoot-projection.server";
import { postgresChatwootSource, type ChatwootSource } from "./chatwoot-source.server";
import type { ChatwootCursor, SyncResult } from "./chatwoot-types";
import { dashboardDatabase } from "./database.server";

type SyncOptions = {
  source?: ChatwootSource;
  pool?: Pool;
  pageSize?: number;
};

export async function syncChatwootMessages(options: SyncOptions = {}): Promise<SyncResult> {
  const source = options.source ?? postgresChatwootSource;
  const pool = options.pool ?? dashboardDatabase();
  const pageSize = options.pageSize ?? 500;
  const client = await pool.connect();
  let ownsLock = false;

  try {
    ownsLock = await tryAcquireSyncLock(client);
    if (!ownsLock) {
      const lastSuccessAt = await loadLastSuccessAt(client);
      return { status: "busy", processed: 0, lastSuccessAt };
    }

    let cursor = await loadSyncCursor(client);
    let processed = 0;

    while (true) {
      const page = await source.fetchPage(cursor, pageSize);
      if (page.length > 0) {
        const last = page[page.length - 1]!;
        const nextCursor: ChatwootCursor = { updatedAt: last.updatedAt, id: last.messageId };
        await persistProjectionPage(client, page, nextCursor);
        cursor = nextCursor;
        processed += page.length;
      }
      if (page.length < pageSize) break;
    }

    const lastSuccessAt = await markSyncSuccess(client);
    return { status: processed > 0 ? "updated" : "current", processed, lastSuccessAt };
  } catch (error) {
    if (ownsLock) await markSyncFailure(client);
    throw new Error("Falha ao sincronizar o Chatwoot.", { cause: error });
  } finally {
    if (ownsLock) await releaseSyncLock(client);
    client.release();
  }
}

export function getSyncFreshness(pool: Pool = dashboardDatabase()) {
  return getSyncFreshnessFromPool(pool);
}
