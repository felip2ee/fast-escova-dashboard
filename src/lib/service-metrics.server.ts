import type { Pool } from "pg";

import { dashboardDatabase } from "./database.server";
import type { ResolvedDashboardRange } from "./dashboard-range";
import type { AgentMetric } from "./dashboard-types";

type SummaryRow = {
  total_conversas: string;
  mensagens_recebidas: string;
  respostas_humanas: string;
  tempo_resposta_medio_min: string | null;
  primeira_resposta_media_min: string | null;
};

type AgentRow = {
  id: string;
  nome: string;
  conversas: string;
  mensagens_enviadas: string;
  tempo_resposta_medio_min: string | null;
};

type DailyMessageRow = {
  day: string;
  conversas: string;
  enviadas: string;
  recebidas: string;
};

type DailyResponseRow = {
  day: string;
  primeira: string | null;
  media: string | null;
};

export type ServiceMetricsResult = {
  atendimento: {
    totalConversas: number;
    mensagensRecebidas: number;
    respostasHumanas: number;
    mediaConversasDia: number;
    mediaEnviadasDia: number;
    mediaRecebidasDia: number;
    tempoRespostaMedioMin: number | null;
    primeiraRespostaMediaMin: number | null;
  };
  agents: AgentMetric[];
  messagesByDay: Array<{
    dia: string;
    conversas: number;
    enviadas: number;
    recebidas: number;
  }>;
  responseTimeByDay: Array<{
    dia: string;
    primeira: number | null;
    media: number | null;
  }>;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0);
const nullableNumber = (value: string | number | null | undefined) =>
  value == null ? null : Number(value);

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

const responseBlocksSql = `
  WITH canonical AS (
    SELECT *
    FROM dashboard_analytics.chatwoot_messages
    WHERE private = false
      AND (
        (direction = 'incoming' AND kind = 'customer')
        OR (direction = 'outgoing' AND kind = 'human')
      )
  ), closed_blocks AS (
    SELECT
      reply.conversation_id,
      reply.message_id AS reply_message_id,
      reply.author_id,
      reply.created_at AS replied_at,
      pending.started_at,
      dashboard_analytics.business_seconds(pending.started_at, reply.created_at) AS response_seconds
    FROM canonical reply
    JOIN LATERAL (
      SELECT customer.created_at AS started_at
      FROM canonical customer
      WHERE customer.conversation_id = reply.conversation_id
        AND customer.direction = 'incoming'
        AND (customer.created_at, customer.message_id) < (reply.created_at, reply.message_id)
        AND NOT EXISTS (
          SELECT 1
          FROM canonical previous_reply
          WHERE previous_reply.conversation_id = reply.conversation_id
            AND previous_reply.direction = 'outgoing'
            AND (previous_reply.created_at, previous_reply.message_id)
              > (customer.created_at, customer.message_id)
            AND (previous_reply.created_at, previous_reply.message_id)
              < (reply.created_at, reply.message_id)
        )
      ORDER BY customer.created_at, customer.message_id
      LIMIT 1
    ) pending ON true
    WHERE reply.direction = 'outgoing'
      AND reply.created_at >= $1::timestamptz
      AND reply.created_at < $2::timestamptz
  ), first_period_blocks AS (
    SELECT closed_blocks.*,
      row_number() OVER (
        PARTITION BY conversation_id
        ORDER BY started_at, reply_message_id
      ) AS period_order
    FROM closed_blocks
    WHERE started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
  )`;

export async function getServiceMetrics(
  range: ResolvedDashboardRange,
  pool: Pool = dashboardDatabase(),
): Promise<ServiceMetricsResult> {
  const periodValues = [range.startAt, range.endAtExclusive];
  const dailyValues = [...periodValues, range.startDate, range.endDate];
  const [summaryQuery, agentQuery, messagesQuery, responseQuery] = await Promise.all([
    pool.query<SummaryRow>(
      `${responseBlocksSql}
       SELECT
         (SELECT count(DISTINCT conversation_id)
          FROM canonical
          WHERE direction = 'outgoing'
            AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS total_conversas,
         (SELECT count(*)
          FROM canonical
          WHERE direction = 'incoming'
            AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS mensagens_recebidas,
         (SELECT count(*)
          FROM canonical
          WHERE direction = 'outgoing'
            AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS respostas_humanas,
         round(avg(response_seconds) / 60.0, 2) AS tempo_resposta_medio_min,
         (SELECT round(avg(response_seconds) / 60.0, 2)
          FROM first_period_blocks WHERE period_order = 1) AS primeira_resposta_media_min
       FROM closed_blocks`,
      periodValues,
    ),
    pool.query<AgentRow>(
      `${responseBlocksSql}, agent_activity AS (
         SELECT
           author_id,
           max(author_name) FILTER (WHERE author_name IS NOT NULL AND author_name <> '') AS author_name,
           count(DISTINCT conversation_id) AS conversas,
           count(*) AS mensagens_enviadas
         FROM canonical
         WHERE direction = 'outgoing'
           AND author_id IS NOT NULL
           AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
         GROUP BY author_id
       ), agent_response AS (
         SELECT author_id, round(avg(response_seconds) / 60.0, 2) AS response_minutes
         FROM closed_blocks
         WHERE author_id IS NOT NULL
         GROUP BY author_id
       )
       SELECT
         activity.author_id::text AS id,
         COALESCE(activity.author_name, 'Atendente #' || activity.author_id::text) AS nome,
         activity.conversas,
         activity.mensagens_enviadas,
         response.response_minutes AS tempo_resposta_medio_min
       FROM agent_activity activity
       LEFT JOIN agent_response response ON response.author_id = activity.author_id
       ORDER BY lower(COALESCE(activity.author_name, 'Atendente #' || activity.author_id::text)), activity.author_id`,
      periodValues,
    ),
    pool.query<DailyMessageRow>(
      `WITH days AS (
         SELECT generate_series($3::date, $4::date, interval '1 day')::date AS day
       ), canonical AS (
         SELECT *
         FROM dashboard_analytics.chatwoot_messages
         WHERE private = false
           AND (
             (direction = 'incoming' AND kind = 'customer')
             OR (direction = 'outgoing' AND kind = 'human')
           )
           AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
       )
       SELECT
         to_char(days.day, 'YYYY-MM-DD') AS day,
         count(DISTINCT canonical.conversation_id)
           FILTER (WHERE canonical.direction = 'outgoing') AS conversas,
         count(canonical.message_id)
           FILTER (WHERE canonical.direction = 'outgoing') AS enviadas,
         count(canonical.message_id)
           FILTER (WHERE canonical.direction = 'incoming') AS recebidas
       FROM days
       LEFT JOIN canonical
         ON (canonical.created_at AT TIME ZONE 'America/Araguaina')::date = days.day
       GROUP BY days.day
       ORDER BY days.day`,
      dailyValues,
    ),
    pool.query<DailyResponseRow>(
      `${responseBlocksSql}, days AS (
         SELECT generate_series($3::date, $4::date, interval '1 day')::date AS day
       )
       SELECT
         to_char(days.day, 'YYYY-MM-DD') AS day,
         round(avg(first_blocks.response_seconds)
           FILTER (WHERE first_blocks.period_order = 1) / 60.0, 2) AS primeira,
         round(avg(closed_blocks.response_seconds) / 60.0, 2) AS media
       FROM days
       LEFT JOIN closed_blocks
         ON (closed_blocks.replied_at AT TIME ZONE 'America/Araguaina')::date = days.day
       LEFT JOIN first_period_blocks first_blocks
         ON first_blocks.reply_message_id = closed_blocks.reply_message_id
       GROUP BY days.day
       ORDER BY days.day`,
      dailyValues,
    ),
  ]);

  const summary = summaryQuery.rows[0];
  const totalConversas = number(summary?.total_conversas);
  const mensagensRecebidas = number(summary?.mensagens_recebidas);
  const respostasHumanas = number(summary?.respostas_humanas);
  const messageRows = new Map(messagesQuery.rows.map((row) => [row.day, row]));
  const responseRows = new Map(responseQuery.rows.map((row) => [row.day, row]));

  return {
    atendimento: {
      totalConversas,
      mensagensRecebidas,
      respostasHumanas,
      mediaConversasDia: totalConversas / range.days,
      mediaEnviadasDia: respostasHumanas / range.days,
      mediaRecebidasDia: mensagensRecebidas / range.days,
      tempoRespostaMedioMin: nullableNumber(summary?.tempo_resposta_medio_min),
      primeiraRespostaMediaMin: nullableNumber(summary?.primeira_resposta_media_min),
    },
    agents: agentQuery.rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      conversas: number(row.conversas),
      mensagensEnviadas: number(row.mensagens_enviadas),
      tempoRespostaMedioMin: nullableNumber(row.tempo_resposta_medio_min),
    })),
    messagesByDay: eachDate(range.startDate, range.endDate).map((day) => {
      const row = messageRows.get(day);
      return {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
        conversas: number(row?.conversas),
        enviadas: number(row?.enviadas),
        recebidas: number(row?.recebidas),
      };
    }),
    responseTimeByDay: eachDate(range.startDate, range.endDate).map((day) => {
      const row = responseRows.get(day);
      return {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
        primeira: nullableNumber(row?.primeira),
        media: nullableNumber(row?.media),
      };
    }),
  };
}
