import { getCampaignMetrics } from "../src/lib/campaign-metrics.server.ts";
import { closeDatabasePools } from "../src/lib/database.server.ts";
import { resolveDashboardRange } from "../src/lib/dashboard-range.ts";
import { getServiceMetrics } from "../src/lib/service-metrics.server.ts";

export function parseRangeArguments(argumentsList) {
  const startIndex = argumentsList.indexOf("--start");
  const endIndex = argumentsList.indexOf("--end");
  const start = startIndex >= 0 ? argumentsList[startIndex + 1] : undefined;
  const end = endIndex >= 0 ? argumentsList[endIndex + 1] : undefined;
  try {
    resolveDashboardRange("custom", { start, end });
  } catch {
    throw new Error("Período inválido. Use --start AAAA-MM-DD --end AAAA-MM-DD.");
  }
  return { start, end };
}

export async function reconcileDashboard({ start, end }) {
  const range = resolveDashboardRange("custom", { start, end });
  const [campaigns, service] = await Promise.all([
    getCampaignMetrics(range),
    getServiceMetrics(range),
  ]);
  return {
    period: { start, end },
    campaigns: {
      sent: campaigns.overview.enviadas,
      delivered: campaigns.overview.entregues,
      read: campaigns.overview.lidas,
      replied: campaigns.overview.respondidas,
      failed: campaigns.overview.falhas,
      pending: campaigns.overview.pendentes,
      uncertain: campaigns.overview.resultadosIncertos,
    },
    team: {
      conversations: service.atendimento.totalConversas,
      incomingMessages: service.atendimento.mensagensRecebidas,
      humanReplies: service.atendimento.respostasHumanas,
      firstResponseMinutes: service.atendimento.primeiraRespostaMediaMin,
      responseMinutes: service.atendimento.tempoRespostaMedioMin,
    },
  };
}

async function main() {
  try {
    const range = parseRangeArguments(process.argv.slice(2));
    console.log(JSON.stringify(await reconcileDashboard(range), null, 2));
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith("Período inválido")
        ? error.message
        : "Não foi possível reconciliar os totais do dashboard.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabasePools();
  }
}

if (import.meta.main) await main();
