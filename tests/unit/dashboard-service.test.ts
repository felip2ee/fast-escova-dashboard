import { describe, expect, test } from "bun:test";

import { createDashboardService, DashboardUnavailableError } from "../../src/lib/dashboard-db";
import type { CampaignMetricsResult } from "../../src/lib/campaign-metrics.server";
import type { ServiceMetricsResult } from "../../src/lib/service-metrics.server";

const campaignMetrics: CampaignMetricsResult = {
  overview: {
    campanhasAtivas: 0,
    enviadas: 2,
    entregues: 2,
    lidas: 1,
    respondidas: 1,
    falhas: 0,
    pendentes: 0,
    resultadosIncertos: 0,
    taxaEntrega: 100,
    taxaLeitura: 50,
    taxaResposta: 50,
    custoEstimado: 0.08,
    custoPorResposta: 0.08,
  },
  campaigns: [],
  dispatchesByDay: [],
  deliveryBreakdown: [],
};

const serviceMetrics: ServiceMetricsResult = {
  atendimento: {
    totalConversas: 1,
    mensagensRecebidas: 2,
    respostasHumanas: 1,
    mediaConversasDia: 1,
    mediaEnviadasDia: 1,
    mediaRecebidasDia: 2,
    tempoRespostaMedioMin: 5,
    primeiraRespostaMediaMin: 4,
  },
  agents: [],
  messagesByDay: [],
  responseTimeByDay: [],
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    sync: async () => ({
      status: "updated" as const,
      processed: 2,
      lastSuccessAt: "2026-10-12T12:00:00.000Z",
    }),
    freshness: async () => ({
      status: "fresh" as const,
      lastSuccessAt: "2026-10-12T12:00:00.000Z",
      warning: null,
    }),
    campaigns: async () => campaignMetrics,
    service: async () => serviceMetrics,
    now: () => new Date("2026-10-12T12:01:00.000Z"),
    ...overrides,
  };
}

describe("dashboard refresh orchestration", () => {
  test("synchronizes before loading metrics and returns fresh data", async () => {
    const events: string[] = [];
    const getDashboardData = createDashboardService(
      dependencies({
        sync: async () => {
          events.push("sync");
          return {
            status: "updated" as const,
            processed: 2,
            lastSuccessAt: "2026-10-12T12:00:00.000Z",
          };
        },
        campaigns: async () => {
          events.push("campaigns");
          return campaignMetrics;
        },
        service: async () => {
          events.push("service");
          return serviceMetrics;
        },
      }),
    );

    const result = await getDashboardData("30d");

    expect(events[0]).toBe("sync");
    expect(events.slice(1).sort()).toEqual(["campaigns", "service"]);
    expect(result.sync).toEqual({
      status: "fresh",
      lastSuccessAt: "2026-10-12T12:00:00.000Z",
      warning: null,
    });
    expect(result.overview).toMatchObject({ respondidas: 1, custoPorResposta: 0.08 });
  });

  test("reads the existing projection during a concurrent busy sync", async () => {
    const getDashboardData = createDashboardService(
      dependencies({
        sync: async () => ({
          status: "busy" as const,
          processed: 0,
          lastSuccessAt: "2026-10-12T11:00:00.000Z",
        }),
      }),
    );

    const result = await getDashboardData("today");
    expect(result.sync).toEqual({
      status: "fresh",
      lastSuccessAt: "2026-10-12T12:00:00.000Z",
      warning: null,
    });
  });

  test("returns stale metrics with a safe warning after a source failure", async () => {
    const getDashboardData = createDashboardService(
      dependencies({
        sync: async () => {
          throw new Error("password=secret postgresql://admin@internal/raw SQL");
        },
        freshness: async () => ({
          status: "stale" as const,
          lastSuccessAt: "2026-10-11T12:00:00.000Z",
          warning: "Os dados do Chatwoot podem estar desatualizados.",
        }),
      }),
    );

    const result = await getDashboardData("30d");
    expect(result.sync).toEqual({
      status: "stale",
      lastSuccessAt: "2026-10-11T12:00:00.000Z",
      warning: "Os dados do Chatwoot podem estar desatualizados.",
    });
    expect(JSON.stringify(result)).not.toContain("password=secret");
    expect(result.overview.enviadas).toBe(2);
  });

  test("fails clearly when synchronization never succeeded", async () => {
    let queried = false;
    const getDashboardData = createDashboardService(
      dependencies({
        sync: async () => {
          throw new Error("source offline");
        },
        freshness: async () => ({
          status: "stale" as const,
          lastSuccessAt: null,
          warning: "Os dados do Chatwoot podem estar desatualizados.",
        }),
        campaigns: async () => {
          queried = true;
          return campaignMetrics;
        },
      }),
    );

    await expect(getDashboardData("30d")).rejects.toBeInstanceOf(DashboardUnavailableError);
    expect(queried).toBe(false);
  });
});
