import type { ChatwootCursor, ProjectedMessage } from "./chatwoot-types";
import { chatwootDatabase, parseChatwootScope } from "./database.server";

export type ChatwootMessageRow = {
  message_id: string;
  conversation_id: string;
  account_id: string;
  inbox_id: string;
  message_type: number;
  private: boolean;
  status: number | null;
  sender_type: string | null;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ChatwootSource = {
  fetchPage(cursor: ChatwootCursor | null, limit: number): Promise<ProjectedMessage[]>;
};

const statusByCode = {
  0: "sent",
  1: "delivered",
  2: "read",
  3: "failed",
} as const;

const iso = (value: string | Date) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function classifyChatwootMessage(row: ChatwootMessageRow): ProjectedMessage {
  const direction = row.message_type === 0 ? "incoming" : "outgoing";
  const kind =
    row.message_type === 3
      ? "template"
      : row.message_type === 2
        ? "system"
        : row.sender_type === "AgentBot"
          ? "automation"
          : direction === "incoming"
            ? "customer"
            : row.sender_type === "User"
              ? "human"
              : "system";
  const deliveryStatus =
    row.status == null ? null : (statusByCode[row.status as keyof typeof statusByCode] ?? null);

  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    accountId: row.account_id,
    inboxId: row.inbox_id,
    direction,
    kind,
    private: row.private,
    deliveryStatus,
    authorId: row.sender_id,
    authorName: row.sender_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export const postgresChatwootSource: ChatwootSource = {
  async fetchPage(cursor, limit) {
    const { accountId, inboxId } = parseChatwootScope();
    const result = await chatwootDatabase().query<ChatwootMessageRow>(
      `SELECT m.id::text AS message_id,
        m.conversation_id::text,
        m.account_id::text,
        c.inbox_id::text,
        m.message_type,
        m.private,
        m.status,
        m.sender_type,
        m.sender_id::text,
        CASE WHEN m.sender_type = 'User' THEN u.name ELSE NULL END AS sender_name,
        m.created_at,
        m.updated_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN users u ON m.sender_type = 'User' AND u.id = m.sender_id
      WHERE m.account_id = $1
        AND c.inbox_id = $2
        AND ($3::timestamptz IS NULL OR (m.updated_at, m.id) > ($3::timestamptz, $4::bigint))
      ORDER BY m.updated_at, m.id
      LIMIT $5`,
      [accountId, inboxId, cursor?.updatedAt ?? null, cursor?.id ?? "0", limit],
    );
    return result.rows.map(classifyChatwootMessage);
  },
};
