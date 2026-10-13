import {
  chatwootDatabase,
  closeDatabasePools,
  parseChatwootScope,
} from "../src/lib/database.server.ts";

export const requiredChatwootColumns = {
  messages: {
    id: ["bigint", "integer"],
    conversation_id: ["bigint", "integer"],
    account_id: ["bigint", "integer"],
    message_type: ["integer", "smallint"],
    private: ["boolean"],
    status: ["integer", "smallint"],
    sender_type: ["character varying", "text"],
    sender_id: ["bigint", "integer"],
    created_at: ["timestamp without time zone", "timestamp with time zone"],
    updated_at: ["timestamp without time zone", "timestamp with time zone"],
  },
  conversations: {
    id: ["bigint", "integer"],
    inbox_id: ["bigint", "integer"],
  },
  users: {
    id: ["bigint", "integer"],
    name: ["character varying", "text"],
  },
};

export function assessChatwootSchema(columns, unsupportedEnumRows) {
  const available = new Map(
    columns.map((item) => [`${item.table}.${item.column}`, item.dataType ?? null]),
  );
  const missing = [];
  for (const [table, definitions] of Object.entries(requiredChatwootColumns)) {
    for (const [column, allowedTypes] of Object.entries(definitions)) {
      const key = `${table}.${column}`;
      if (!available.has(key)) {
        missing.push(key);
        continue;
      }
      const dataType = available.get(key);
      if (dataType && !allowedTypes.includes(dataType)) missing.push(`${key} (${dataType})`);
    }
  }
  return { compatible: missing.length === 0 && unsupportedEnumRows === 0, missing };
}

export async function verifyChatwootSchema(pool = chatwootDatabase()) {
  const { accountId, inboxId } = parseChatwootScope();
  const columnsResult = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])`,
    [Object.keys(requiredChatwootColumns)],
  );
  const enumResult = await pool.query(
    `SELECT count(*)::integer AS unsupported
     FROM messages message
     JOIN conversations conversation ON conversation.id = message.conversation_id
     WHERE message.account_id = $1
       AND conversation.inbox_id = $2
       AND (
         message.message_type NOT IN (0, 1, 2, 3)
         OR (message.status IS NOT NULL AND message.status NOT IN (0, 1, 2, 3))
       )`,
    [accountId, inboxId],
  );
  const columns = columnsResult.rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    dataType: row.data_type,
  }));
  return assessChatwootSchema(columns, Number(enumResult.rows[0]?.unsupported ?? 0));
}

async function main() {
  try {
    const result = await verifyChatwootSchema();
    for (const table of Object.keys(requiredChatwootColumns)) {
      const incompatible = result.missing.filter((item) => item.startsWith(`${table}.`));
      console.log(`${table}: ${incompatible.length ? "incompatível" : "compatível"}`);
    }
    console.log(`valores de status: ${result.compatible ? "compatíveis" : "incompatíveis"}`);
    if (!result.compatible) process.exitCode = 1;
  } catch {
    console.error("Não foi possível verificar o schema do Chatwoot.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePools();
  }
}

if (import.meta.main) await main();
