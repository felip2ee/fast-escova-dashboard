import type { Pool } from "pg";

import { dashboardDatabase } from "./database.server";
import type { ResolvedDashboardRange } from "./dashboard-range";
import type { CampaignMetric } from "./dashboard-types";

export const MESSAGE_COST_USD = 0.04;

type CampaignRow = {
  id: string;
  nome: string;
  tipo: string;
  data: string;
  status: string;
  enviadas: string;
  entregues: string;
  lidas: string;
  falhas: string;
  pendentes: string;
  resultados_incertos: string;
  respondidas: string;
};

type DailyRow = {
  day: string;
  enviadas: string;
  entregues: string;
  lidas: string;
  respondidas: string;
  falhas: string;
};

export type CampaignFunnelMetric = CampaignMetric & {
  falhas: number;
  pendentes: number;
  resultadosIncertos: number;
  respondidas: number;
  taxaEntrega: number;
  taxaLeitura: number;
  taxaResposta: number;
};

export type CampaignMetricsResult = {
  overview: {
    campanhasAtivas: number;
    enviadas: number;
    entregues: number;
    lidas: number;
    respondidas: number;
    falhas: number;
    pendentes: number;
    resultadosIncertos: number;
    taxaEntrega: number;
    taxaLeitura: number;
    taxaResposta: number;
    custoEstimado: number;
    custoPorResposta: number | null;
  };
  campaigns: CampaignFunnelMetric[];
  dispatchesByDay: Array<{
    dia: string;
    disparadas: number;
    oportunidades: number;
    recebidas: number;
    entregues: number;
    lidas: number;
    respondidas: number;
    falhas: number;
  }>;
  deliveryBreakdown: Array<{ nome: string; valor: number; cor: string }>;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0);
const percent = (numerator: number, denominator: number) =>
  denominator ? Number(((numerator * 100) / denominator).toFixed(2)) : 0;
const money = (value: number) => Number(value.toFixed(2));

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function eachDate(startDate: string, endDate: string) {
  const days: string[] = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    days.push(toIsoDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

export async function getCampaignMetrics(
  range: ResolvedDashboardRange,
  pool: Pool = dashboardDatabase(),
): Promise<CampaignMetricsResult> {
  const baseSql = `
    WITH all_sends AS (
      SELECT
        cd.id,
        cd.campanha_id,
        cd.contato_id,
        cd.conta_waba_id,
        cd.celular_norm,
        cd.chatwoot_message_id,
        cd.chatwoot_conversation_id,
        cd.estado_chatwoot,
        cd.status_atual,
        cd.revisao_chatwoot,
        COALESCE(cd.template_enviado_em, outgoing.created_at) AS sent_at,
        outgoing.delivery_status
      FROM disparos.campanha_destinatarios cd
      LEFT JOIN dashboard_analytics.chatwoot_messages outgoing
        ON outgoing.message_id = cd.chatwoot_message_id
       AND outgoing.direction = 'outgoing'
    ), cohort AS (
      SELECT
        sends.*,
        CASE
          WHEN sends.delivery_status IS NOT NULL THEN sends.delivery_status
          WHEN sends.status_atual = 'lido' OR sends.estado_chatwoot = 'read' THEN 'read'
          WHEN sends.status_atual = 'entregue' OR sends.estado_chatwoot = 'delivered' THEN 'delivered'
          WHEN sends.status_atual = 'falha' OR sends.estado_chatwoot = 'permanent_failure' THEN 'failed'
          ELSE 'sent'
        END AS effective_status,
        sends.revisao_chatwoot OR sends.estado_chatwoot = 'resultado_incerto' AS uncertain,
        sends.estado_chatwoot IN ('waiting_confirmation', 'context_pending', 'retryable_failure', 'pendente') AS pending,
        COALESCE(projected_reply.responded, legacy_reply.responded, false) AS responded
      FROM all_sends sends
      LEFT JOIN LATERAL (
        SELECT true AS responded
        FROM dashboard_analytics.chatwoot_messages incoming
        WHERE sends.chatwoot_conversation_id IS NOT NULL
          AND incoming.conversation_id = sends.chatwoot_conversation_id
          AND incoming.direction = 'incoming'
          AND incoming.kind = 'customer'
          AND incoming.private = false
          AND incoming.created_at BETWEEN sends.sent_at AND sends.sent_at + interval '48 hours'
          AND NOT EXISTS (
            SELECT 1
            FROM all_sends newer
            WHERE newer.chatwoot_conversation_id = sends.chatwoot_conversation_id
              AND newer.sent_at > sends.sent_at
              AND newer.sent_at <= incoming.created_at
          )
        ORDER BY incoming.created_at, incoming.message_id
        LIMIT 1
      ) projected_reply ON true
      LEFT JOIN LATERAL (
        SELECT true AS responded
        FROM disparos.mensagens incoming
        JOIN disparos.contatos contact ON contact.id = incoming.contato_id
        WHERE sends.chatwoot_conversation_id IS NULL
          AND sends.chatwoot_message_id IS NULL
          AND incoming.escopo = 'conversa'
          AND incoming.direcao = 'entrada'
          AND incoming.conta_waba_id = sends.conta_waba_id
          AND contact.numero_norm = sends.celular_norm
          AND sends.celular_norm IS NOT NULL
          AND COALESCE(incoming.wa_timestamp, incoming.criado_em)
            BETWEEN sends.sent_at AND sends.sent_at + interval '48 hours'
          AND NOT EXISTS (
            SELECT 1
            FROM all_sends newer
            WHERE newer.conta_waba_id = sends.conta_waba_id
              AND newer.celular_norm = sends.celular_norm
              AND newer.sent_at > sends.sent_at
              AND newer.sent_at <= COALESCE(incoming.wa_timestamp, incoming.criado_em)
          )
        ORDER BY COALESCE(incoming.wa_timestamp, incoming.criado_em), incoming.id
        LIMIT 1
      ) legacy_reply ON true
      WHERE sends.sent_at >= $1::timestamptz
        AND sends.sent_at < $2::timestamptz
    )`;

  const values = [range.startAt, range.endAtExclusive];
  const [campaignQuery, dailyQuery] = await Promise.all([
    pool.query<CampaignRow>(
      `${baseSql}
       SELECT
         campaign.id::text,
         campaign.nome,
         COALESCE(campaign.tipo, 'avulsa') AS tipo,
         to_char(COALESCE(campaign.iniciada_em, campaign.criado_em)
           AT TIME ZONE 'America/Araguaina', 'DD/MM/YYYY') AS data,
         campaign.status,
         count(cohort.id) AS enviadas,
         count(cohort.id) FILTER (WHERE cohort.effective_status IN ('delivered', 'read')) AS entregues,
         count(cohort.id) FILTER (WHERE cohort.effective_status = 'read') AS lidas,
         count(cohort.id) FILTER (WHERE cohort.effective_status = 'failed' AND NOT cohort.uncertain) AS falhas,
         count(cohort.id) FILTER (WHERE cohort.pending AND NOT cohort.uncertain) AS pendentes,
         count(cohort.id) FILTER (WHERE cohort.uncertain) AS resultados_incertos,
         count(cohort.id) FILTER (WHERE cohort.responded) AS respondidas
       FROM cohort
       JOIN disparos.campanhas campaign ON campaign.id = cohort.campanha_id
       GROUP BY campaign.id
       ORDER BY COALESCE(campaign.iniciada_em, campaign.criado_em) DESC, campaign.id DESC`,
      values,
    ),
    pool.query<DailyRow>(
      `${baseSql}
       SELECT
         to_char(cohort.sent_at AT TIME ZONE 'America/Araguaina', 'YYYY-MM-DD') AS day,
         count(cohort.id) AS enviadas,
         count(cohort.id) FILTER (WHERE cohort.effective_status IN ('delivered', 'read')) AS entregues,
         count(cohort.id) FILTER (WHERE cohort.effective_status = 'read') AS lidas,
         count(cohort.id) FILTER (WHERE cohort.responded) AS respondidas,
         count(cohort.id) FILTER (WHERE cohort.effective_status = 'failed' AND NOT cohort.uncertain) AS falhas
       FROM cohort
       GROUP BY day
       ORDER BY day`,
      values,
    ),
  ]);

  const campaigns: CampaignFunnelMetric[] = campaignQuery.rows.map((row) => {
    const enviadas = number(row.enviadas);
    const entregues = number(row.entregues);
    const lidas = number(row.lidas);
    const respondidas = number(row.respondidas);
    const taxaResposta = percent(respondidas, entregues);
    return {
      id: row.id,
      nome: row.nome,
      tipo: row.tipo,
      data: row.data,
      status: row.status,
      enviadas,
      entregues,
      lidas,
      falhas: number(row.falhas),
      pendentes: number(row.pendentes),
      resultadosIncertos: number(row.resultados_incertos),
      respondidas,
      taxaEntrega: percent(entregues, enviadas),
      taxaLeitura: percent(lidas, entregues),
      taxaResposta,
      conversas: respondidas,
      mensagensRecebidas: respondidas,
      ctr: taxaResposta,
      primeiraRespostaMin: null,
    };
  });

  const totals = campaigns.reduce(
    (sum, campaign) => ({
      enviadas: sum.enviadas + campaign.enviadas,
      entregues: sum.entregues + campaign.entregues,
      lidas: sum.lidas + campaign.lidas,
      respondidas: sum.respondidas + campaign.respondidas,
      falhas: sum.falhas + campaign.falhas,
      pendentes: sum.pendentes + campaign.pendentes,
      resultadosIncertos: sum.resultadosIncertos + campaign.resultadosIncertos,
    }),
    {
      enviadas: 0,
      entregues: 0,
      lidas: 0,
      respondidas: 0,
      falhas: 0,
      pendentes: 0,
      resultadosIncertos: 0,
    },
  );
  const custoEstimado = money(totals.enviadas * MESSAGE_COST_USD);
  const byDay = new Map(dailyQuery.rows.map((row) => [row.day, row]));

  return {
    overview: {
      campanhasAtivas: campaigns.filter((campaign) =>
        ["agendada", "processando"].includes(campaign.status),
      ).length,
      ...totals,
      taxaEntrega: percent(totals.entregues, totals.enviadas),
      taxaLeitura: percent(totals.lidas, totals.entregues),
      taxaResposta: percent(totals.respondidas, totals.entregues),
      custoEstimado,
      custoPorResposta: totals.respondidas ? money(custoEstimado / totals.respondidas) : null,
    },
    campaigns,
    dispatchesByDay: eachDate(range.startDate, range.endDate).map((day) => {
      const row = byDay.get(day);
      const respondidas = number(row?.respondidas);
      return {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
        disparadas: number(row?.enviadas),
        oportunidades: respondidas,
        recebidas: respondidas,
        entregues: number(row?.entregues),
        lidas: number(row?.lidas),
        respondidas,
        falhas: number(row?.falhas),
      };
    }),
    deliveryBreakdown: [
      { nome: "Lidas", valor: totals.lidas, cor: "#7c3aed" },
      {
        nome: "Entregues não lidas",
        valor: Math.max(0, totals.entregues - totals.lidas),
        cor: "#2563eb",
      },
      {
        nome: "Não entregues",
        valor: Math.max(0, totals.enviadas - totals.entregues - totals.falhas),
        cor: "#94a3b8",
      },
      { nome: "Falhas", valor: totals.falhas, cor: "#dc2626" },
    ],
  };
}
