import type { Pool, PoolClient } from "pg";

import type { ChatwootCursor, ProjectedMessage, SyncFreshness } from "./chatwoot-types";

const sourceName = "chatwoot_messages";
const lockName = "fast_escova_dashboard_chatwoot_sync";

export async function tryAcquireSyncLock(client: PoolClient) {
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    [lockName],
  );
  return result.rows[0]?.acquired === true;
}

export async function releaseSyncLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
}

export async function loadSyncCursor(client: PoolClient): Promise<ChatwootCursor | null> {
  const result = await client.query<{ cursor_updated_at: Date; cursor_id: string }>(
    `SELECT cursor_updated_at, cursor_id::text
    FROM dashboard_analytics.sync_state
    WHERE source = $1 AND cursor_updated_at IS NOT NULL AND cursor_id IS NOT NULL`,
    [sourceName],
  );
  const row = result.rows[0];
  return row ? { updatedAt: row.cursor_updated_at.toISOString(), id: row.cursor_id } : null;
}

export async function loadLastSuccessAt(client: PoolClient) {
  const result = await client.query<{ last_success_at: Date | null }>(
    `SELECT last_success_at
    FROM dashboard_analytics.sync_state
    WHERE source = $1`,
    [sourceName],
  );
  return result.rows[0]?.last_success_at?.toISOString() ?? null;
}

export async function persistProjectionPage(
  client: PoolClient,
  messages: ProjectedMessage[],
  cursor: ChatwootCursor,
) {
  const rows = messages.map((message) => ({
    message_id: message.messageId,
    conversation_id: message.conversationId,
    account_id: message.accountId,
    inbox_id: message.inboxId,
    direction: message.direction,
    kind: message.kind,
    private: message.private,
    delivery_status: message.deliveryStatus,
    author_id: message.authorId,
    author_name: message.authorName,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  }));
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO dashboard_analytics.chatwoot_messages (
        message_id, conversation_id, account_id, inbox_id, direction, kind, private,
        delivery_status, author_id, author_name, created_at, source_updated_at, projected_at
      )
      SELECT r.message_id::bigint, r.conversation_id::bigint, r.account_id::bigint,
        r.inbox_id::bigint, r.direction, r.kind, r.private, r.delivery_status,
        r.author_id::bigint, r.author_name, r.created_at::timestamptz,
        r.updated_at::timestamptz, now()
      FROM jsonb_to_recordset($1::jsonb) AS r(
        message_id text, conversation_id text, account_id text, inbox_id text,
        direction text, kind text, private boolean, delivery_status text,
        author_id text, author_name text, created_at text, updated_at text
      )
      ON CONFLICT (message_id) DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        account_id = EXCLUDED.account_id,
        inbox_id = EXCLUDED.inbox_id,
        direction = EXCLUDED.direction,
        kind = EXCLUDED.kind,
        private = EXCLUDED.private,
        delivery_status = EXCLUDED.delivery_status,
        author_id = EXCLUDED.author_id,
        author_name = EXCLUDED.author_name,
        created_at = EXCLUDED.created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        projected_at = now()`,
      [JSON.stringify(rows)],
    );
    await client.query(
      `INSERT INTO dashboard_analytics.sync_state (source, cursor_updated_at, cursor_id)
      VALUES ($1, $2::timestamptz, $3::bigint)
      ON CONFLICT (source) DO UPDATE SET
        cursor_updated_at = EXCLUDED.cursor_updated_at,
        cursor_id = EXCLUDED.cursor_id`,
      [sourceName, cursor.updatedAt, cursor.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function markSyncSuccess(client: PoolClient) {
  const result = await client.query<{ last_success_at: Date }>(
    `INSERT INTO dashboard_analytics.sync_state (
      source, last_success_at, last_error_code, last_error_message
    ) VALUES ($1, now(), NULL, NULL)
    ON CONFLICT (source) DO UPDATE SET
      last_success_at = EXCLUDED.last_success_at,
      last_error_code = NULL,
      last_error_message = NULL
    RETURNING last_success_at`,
    [sourceName],
  );
  return result.rows[0]!.last_success_at.toISOString();
}

export async function markSyncFailure(client: PoolClient) {
  await client.query(
    `INSERT INTO dashboard_analytics.sync_state (
      source, last_failure_at, last_error_code, last_error_message
    ) VALUES ($1, now(), 'SYNC_FAILED', 'Falha ao sincronizar o Chatwoot.')
    ON CONFLICT (source) DO UPDATE SET
      last_failure_at = EXCLUDED.last_failure_at,
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message`,
    [sourceName],
  );
}

export async function getSyncFreshnessFromPool(pool: Pool): Promise<SyncFreshness> {
  const result = await pool.query<{
    last_success_at: Date | null;
    last_error_code: string | null;
  }>(
    `SELECT last_success_at, last_error_code
    FROM dashboard_analytics.sync_state
    WHERE source = $1`,
    [sourceName],
  );
  const row = result.rows[0];
  const stale = !row?.last_success_at || row.last_error_code != null;
  return {
    status: stale ? "stale" : "fresh",
    lastSuccessAt: row?.last_success_at?.toISOString() ?? null,
    warning: stale ? "Os dados do Chatwoot podem estar desatualizados." : null,
  };
}
