import { getCampaignMetrics, type CampaignMetricsResult } from "./campaign-metrics.server";
import { getSyncFreshness, syncChatwootMessages } from "./chatwoot-sync.server";
import type { SyncFreshness, SyncResult } from "./chatwoot-types";
import {
  resolveDashboardRange,
  type DashboardRangeInput,
  type ResolvedDashboardRange,
} from "./dashboard-range";
import type { DashboardData, DashboardPeriod } from "./dashboard-types";
import { getServiceMetrics, type ServiceMetricsResult } from "./service-metrics.server";

export class DashboardUnavailableError extends Error {
  constructor(message = "Dashboard analytics unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "DashboardUnavailableError";
  }
}

export type DashboardServiceDependencies = {
  sync: () => Promise<SyncResult>;
  freshness: () => Promise<SyncFreshness>;
  campaigns: (range: ResolvedDashboardRange) => Promise<CampaignMetricsResult>;
  service: (range: ResolvedDashboardRange) => Promise<ServiceMetricsResult>;
  now: () => Date;
};

const productionDependencies: DashboardServiceDependencies = {
  sync: () => syncChatwootMessages(),
  freshness: () => getSyncFreshness(),
  campaigns: (range) => getCampaignMetrics(range),
  service: (range) => getServiceMetrics(range),
  now: () => new Date(),
};

async function freshnessAfterRefresh(dependencies: DashboardServiceDependencies) {
  try {
    await dependencies.sync();
    const freshness = await dependencies.freshness();
    if (!freshness.lastSuccessAt) throw new DashboardUnavailableError();
    return freshness;
  } catch (error) {
    if (error instanceof DashboardUnavailableError) throw error;
    try {
      const freshness = await dependencies.freshness();
      if (freshness.lastSuccessAt) {
        return {
          status: "stale" as const,
          lastSuccessAt: freshness.lastSuccessAt,
          warning: "Os dados do Chatwoot podem estar desatualizados.",
        };
      }
    } catch {
      // The public error below deliberately omits source and database details.
    }
    throw new DashboardUnavailableError("Dashboard analytics unavailable", { cause: error });
  }
}

function composeDashboardData(
  campaigns: CampaignMetricsResult,
  service: ServiceMetricsResult,
  freshness: SyncFreshness,
  now: Date,
): DashboardData {
  return {
    atualizadoEm: now.toISOString(),
    sync: freshness,
    overview: {
      ...campaigns.overview,
      conversas: campaigns.overview.respondidas,
      mensagensRecebidas: campaigns.overview.respondidas,
      ctr: campaigns.overview.taxaResposta,
      primeiraRespostaMin: service.atendimento.primeiraRespostaMediaMin,
      respostaMediaMin: service.atendimento.tempoRespostaMedioMin,
      custoPorOportunidade: campaigns.overview.custoPorResposta,
    },
    atendimento: service.atendimento,
    agents: service.agents,
    campaigns: campaigns.campaigns,
    dispatchesByDay: campaigns.dispatchesByDay,
    deliveryBreakdown: campaigns.deliveryBreakdown,
    messagesByDay: service.messagesByDay,
    responseTimeByDay: service.responseTimeByDay,
  };
}

export function createDashboardService(dependencies: DashboardServiceDependencies) {
  return async function loadDashboardData(
    period: DashboardPeriod = "30d",
    range: DashboardRangeInput = {},
  ): Promise<DashboardData> {
    const resolvedRange = resolveDashboardRange(period, range, dependencies.now());
    const freshness = await freshnessAfterRefresh(dependencies);
    const [campaigns, service] = await Promise.all([
      dependencies.campaigns(resolvedRange),
      dependencies.service(resolvedRange),
    ]);
    return composeDashboardData(campaigns, service, freshness, dependencies.now());
  };
}

export const getDashboardData = createDashboardService(productionDependencies);
