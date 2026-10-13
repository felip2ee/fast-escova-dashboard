import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DashboardData } from "../../src/lib/dashboard-types";
import { DashboardReport } from "../../src/routes/index";

const fixture: DashboardData = {
  atualizadoEm: "2026-10-12T15:05:00.000Z",
  sync: {
    status: "fresh",
    lastSuccessAt: "2026-10-12T15:04:00.000Z",
    warning: null,
  },
  overview: {
    campanhasAtivas: 1,
    enviadas: 100,
    entregues: 80,
    lidas: 60,
    respondidas: 20,
    falhas: 5,
    pendentes: 3,
    resultadosIncertos: 2,
    taxaEntrega: 80,
    taxaLeitura: 75,
    taxaResposta: 25,
    conversas: 20,
    mensagensRecebidas: 20,
    ctr: 25,
    primeiraRespostaMin: 8,
    respostaMediaMin: 12,
    custoEstimado: 4,
    custoPorOportunidade: 0.2,
    custoPorResposta: 0.2,
  },
  atendimento: {
    totalConversas: 18,
    mensagensRecebidas: 45,
    respostasHumanas: 30,
    mediaConversasDia: 2.25,
    mediaEnviadasDia: 3.75,
    mediaRecebidasDia: 5.63,
    tempoRespostaMedioMin: 12,
    primeiraRespostaMediaMin: 8,
  },
  campaigns: [
    {
      id: "1",
      nome: "Retorno Outubro",
      tipo: "chatwoot",
      data: "10/10/2026",
      status: "finalizada",
      enviadas: 100,
      entregues: 80,
      lidas: 60,
      respondidas: 20,
      falhas: 5,
      pendentes: 3,
      resultadosIncertos: 2,
      taxaEntrega: 80,
      taxaLeitura: 75,
      taxaResposta: 25,
      conversas: 20,
      mensagensRecebidas: 20,
      ctr: 25,
      primeiraRespostaMin: 8,
    },
  ],
  agents: [
    {
      id: "42",
      nome: "Ana",
      conversas: 12,
      mensagensEnviadas: 22,
      tempoRespostaMedioMin: 9,
    },
    {
      id: "43",
      nome: "Bia",
      conversas: 8,
      mensagensEnviadas: 8,
      tempoRespostaMedioMin: 16,
    },
  ],
  dispatchesByDay: [
    {
      dia: "10/10",
      disparadas: 100,
      oportunidades: 20,
      recebidas: 20,
      entregues: 80,
      lidas: 60,
      respondidas: 20,
      falhas: 5,
    },
  ],
  messagesByDay: [{ dia: "10/10", conversas: 18, enviadas: 30, recebidas: 45 }],
  responseTimeByDay: [{ dia: "10/10", primeira: 8, media: 12 }],
  deliveryBreakdown: [
    { nome: "Lidas", valor: 60, cor: "#7c3aed" },
    { nome: "Falhas", valor: 5, cor: "#dc2626" },
  ],
};

function text(data: DashboardData) {
  return renderToStaticMarkup(<DashboardReport data={data} />).replace(/\u00a0/g, " ");
}

describe("client-facing dashboard report", () => {
  test("shows the campaign funnel, rates, costs, and operational details", () => {
    const html = text(fixture);

    for (const label of [
      "Resumo do período",
      "Mensagens enviadas",
      "Mensagens entregues",
      "Mensagens lidas",
      "Pessoas que responderam",
      "Falhas confirmadas",
      "Taxa de resposta",
      "Custo estimado",
      "Custo por resposta",
      "Resultado das campanhas",
      "Taxa de entrega",
      "Taxa de leitura",
      "Detalhes operacionais",
      "Aguardando confirmação",
      "Resultados incertos",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Retorno Outubro");
    expect(html).toContain("80,0%");
    expect(html).toContain("75,0%");
    expect(html).toContain("25,0%");
    expect(html).toContain("US$ 4,00");
    expect(html).toContain("US$ 0,20");
  });

  test("shows general service and actual agent performance", () => {
    const html = text(fixture);

    for (const label of [
      "Atendimento geral da equipe",
      "Conversas atendidas",
      "Mensagens recebidas",
      "Respostas humanas",
      "Primeira resposta média",
      "Tempo médio para responder",
      "Desempenho por atendente",
      "Ana",
      "Bia",
      "Conversas",
      "Mensagens enviadas",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("9,0 min");
    expect(html).toContain("16,0 min");
  });

  test("shows freshness without exposing technical vocabulary", () => {
    const html = text(fixture);
    expect(html).toContain("Dados atualizados em 12/10/2026, 12:04");
    for (const forbidden of ["WABA", "WAMID", "checkpoint", "raw SQL", "schema"])
      expect(html).not.toContain(forbidden);
  });

  test("keeps metrics visible when data is stale", () => {
    const html = text({
      ...fixture,
      sync: {
        status: "stale",
        lastSuccessAt: "2026-10-11T15:04:00.000Z",
        warning: "Os dados do Chatwoot podem estar desatualizados.",
      },
    });

    expect(html).toContain("Os dados do Chatwoot podem estar desatualizados.");
    expect(html).toContain("Pessoas que responderam");
    expect(html).toContain("Retorno Outubro");
  });
});
