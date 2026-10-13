import { syncChatwootMessages } from "../src/lib/chatwoot-sync.server.ts";
import { closeDatabasePools, dashboardDatabase } from "../src/lib/database.server.ts";

async function productionProjectionState() {
  const result = await dashboardDatabase().query(
    `SELECT
       (SELECT count(*)::integer FROM dashboard_analytics.chatwoot_messages) AS projection_rows,
       cursor_updated_at,
       cursor_id::text
     FROM dashboard_analytics.sync_state
     WHERE source = 'chatwoot_messages'`,
  );
  const row = result.rows[0];
  return {
    projectionRows: Number(row?.projection_rows ?? 0),
    cursorUpdatedAt: row?.cursor_updated_at?.toISOString() ?? null,
    cursorId: row?.cursor_id ?? null,
  };
}

export async function runBackfill({
  sync = syncChatwootMessages,
  projectionState = productionProjectionState,
  maxRounds = 10_000,
} = {}) {
  let processed = 0;
  let lastSuccessAt = null;
  for (let round = 0; round < maxRounds; round += 1) {
    const result = await sync();
    if (result.status === "busy") {
      throw new Error("Já existe uma sincronização em andamento.");
    }
    processed += result.processed;
    lastSuccessAt = result.lastSuccessAt;
    if (result.status === "current") {
      return {
        status: "current",
        processed,
        ...(await projectionState()),
        lastSuccessAt,
      };
    }
  }
  throw new Error("O backfill não alcançou o estado atual dentro do limite de segurança.");
}

async function main() {
  try {
    console.log(JSON.stringify(await runBackfill(), null, 2));
  } catch {
    console.error("Não foi possível concluir o backfill do Chatwoot.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePools();
  }
}

if (import.meta.main) await main();
