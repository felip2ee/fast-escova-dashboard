import { Pool, type QueryResultRow } from "pg";
import type { DashboardData, DashboardPeriod } from "./dashboard-types";

let pool: Pool | undefined;

function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL nao configurada");
  pool ??= new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
    max: 5,
  });
  return pool;
}

const n = (value: unknown) => Number(value ?? 0);
const nullable = (value: unknown) => (value == null ? null : Number(value));
const daysByPeriod: Record<DashboardPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

async function rows<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return (await database().query<T>(sql, values)).rows;
}

export async function getDashboardData(period: DashboardPeriod = "30d"): Promise<DashboardData> {
  const days = daysByPeriod[period];
  const periodStart = `(now() AT TIME ZONE 'America/Araguaina')::date - ($1::int - 1)`;
  const [campaignsRaw, dispatchRaw, messagesRaw, responseRaw] = await Promise.all([
    rows<{
      id: string;
      nome: string;
      tipo: string;
      data: string;
      status: string;
      enviadas: string;
      entregues: string;
      lidas: string;
      conversas: string;
      mensagens_recebidas: string;
      ctr: string | null;
      primeira_resposta_min: string | null;
    }>(
      `SELECT c.id::text, c.nome, COALESCE(c.tipo, 'avulsa') AS tipo,
        to_char(COALESCE(c.iniciada_em, c.criado_em) AT TIME ZONE 'America/Araguaina', 'DD/MM/YYYY') AS data,
        c.status,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS enviadas,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('entregue','lido')) AS entregues,
        count(cd.id) FILTER (WHERE cd.status_atual = 'lido') AS lidas,
        count(cd.id) FILTER (WHERE cd.engajou) AS conversas,
        (SELECT count(*) FROM disparos.mensagens mr
          JOIN disparos.campanha_destinatarios cdr ON cdr.id=mr.atribuida_destinatario_id
          WHERE cdr.campanha_id=c.id AND mr.escopo='conversa' AND mr.direcao='entrada') AS mensagens_recebidas,
        round(100.0 * count(cd.id) FILTER (WHERE cd.engajou)
          / nullif(count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')), 0), 2) AS ctr,
        round(avg(cd.tempo_resposta_segundos) FILTER (WHERE cd.engajou) / 60.0, 2) AS primeira_resposta_min
      FROM disparos.campanhas c
      LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
      WHERE (COALESCE(c.iniciada_em, c.criado_em) AT TIME ZONE 'America/Araguaina')::date >= ${periodStart}
      GROUP BY c.id ORDER BY COALESCE(c.iniciada_em, c.criado_em) DESC`,
      [days],
    ),
    rows<{ dia: string; disparadas: string; oportunidades: string; recebidas: string }>(
      `WITH dias AS (
        SELECT generate_series(${periodStart}, (now() AT TIME ZONE 'America/Araguaina')::date, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia, 'DD/MM') AS dia,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS disparadas,
        count(cd.id) FILTER (WHERE cd.engajou) AS oportunidades,
        (SELECT count(*) FROM disparos.mensagens mr
          WHERE mr.escopo='conversa' AND mr.direcao='entrada' AND mr.atribuida_destinatario_id IS NOT NULL
            AND (COALESCE(mr.wa_timestamp,mr.criado_em) AT TIME ZONE 'America/Araguaina')::date=d.dia) AS recebidas
      FROM dias d LEFT JOIN disparos.campanha_destinatarios cd
        ON (cd.enviado_em AT TIME ZONE 'America/Araguaina')::date = d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      [days],
    ),
    rows<{ dia: string; conversas: string; enviadas: string; recebidas: string }>(
      `WITH dias AS (
        SELECT generate_series(${periodStart}, (now() AT TIME ZONE 'America/Araguaina')::date, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia, 'DD/MM') AS dia,
        count(DISTINCT m.conversa_id) AS conversas,
        count(m.id) FILTER (WHERE m.direcao='saida' AND m.origem='atendente') AS enviadas,
        count(m.id) FILTER (WHERE m.direcao='entrada') AS recebidas
      FROM dias d LEFT JOIN disparos.mensagens m
        ON m.escopo='conversa'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date = d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      [days],
    ),
    rows<{ dia: string; primeira: string | null; media: string | null }>(
      `WITH entradas AS (
        SELECT m.id, m.conversa_id, COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em,
          row_number() OVER (PARTITION BY m.conversa_id,
            (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
            ORDER BY COALESCE(m.wa_timestamp,m.criado_em),m.id) AS ordem_dia
        FROM disparos.mensagens m
        WHERE m.escopo='conversa' AND m.direcao='entrada'
          AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date >= ${periodStart}
      ), tempos AS (
        SELECT e.*,
          (SELECT min(COALESCE(s.wa_timestamp,s.criado_em)) FROM disparos.mensagens s
           WHERE s.conversa_id=e.conversa_id AND s.escopo='conversa'
             AND s.direcao='saida' AND s.origem='atendente'
             AND COALESCE(s.wa_timestamp,s.criado_em) > e.recebida_em) AS respondida_em
        FROM entradas e
      ), dias AS (
        SELECT generate_series(${periodStart}, (now() AT TIME ZONE 'America/Araguaina')::date, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia,'DD/MM') AS dia,
        round(avg(extract(epoch FROM (t.respondida_em-t.recebida_em))) FILTER
          (WHERE t.respondida_em IS NOT NULL AND t.ordem_dia=1) / 60.0, 2) AS primeira,
        round(avg(extract(epoch FROM (t.respondida_em-t.recebida_em))) FILTER
          (WHERE t.respondida_em IS NOT NULL) / 60.0, 2) AS media
      FROM dias d LEFT JOIN tempos t
        ON (t.recebida_em AT TIME ZONE 'America/Araguaina')::date=d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      [days],
    ),
  ]);

  const campaigns = campaignsRaw.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    data: c.data,
    status: c.status,
    enviadas: n(c.enviadas),
    entregues: n(c.entregues),
    lidas: n(c.lidas),
    conversas: n(c.conversas),
    mensagensRecebidas: n(c.mensagens_recebidas),
    ctr: n(c.ctr),
    primeiraRespostaMin: nullable(c.primeira_resposta_min),
  }));
  const sums = campaigns.reduce(
    (a, c) => ({
      enviadas: a.enviadas + c.enviadas,
      entregues: a.entregues + c.entregues,
      lidas: a.lidas + c.lidas,
      conversas: a.conversas + c.conversas,
      mensagensRecebidas: a.mensagensRecebidas + c.mensagensRecebidas,
    }),
    { enviadas: 0, entregues: 0, lidas: 0, conversas: 0, mensagensRecebidas: 0 },
  );
  const firstValues = campaigns.filter((c) => c.primeiraRespostaMin != null);
  const responseValues = responseRaw.filter((d) => d.media != null);
  const firstDailyValues = responseRaw.filter((d) => d.primeira != null);
  const messageTotals = messagesRaw.reduce(
    (a, d) => ({
      conversas: a.conversas + n(d.conversas),
      enviadas: a.enviadas + n(d.enviadas),
      recebidas: a.recebidas + n(d.recebidas),
    }),
    { conversas: 0, enviadas: 0, recebidas: 0 },
  );
  const totalConversationIds = await rows<{ total: string }>(
    `SELECT count(DISTINCT conversa_id) AS total
    FROM disparos.mensagens WHERE escopo='conversa'
      AND (COALESCE(wa_timestamp,criado_em) AT TIME ZONE 'America/Araguaina')::date >= ${periodStart}`,
    [days],
  );
  const totalConversas = n(totalConversationIds[0]?.total);
  const custoEstimado = sums.enviadas * 0.04;

  return {
    atualizadoEm: new Date().toISOString(),
    campaigns,
    overview: {
      ...sums,
      campanhasAtivas: campaigns.filter((c) => ["agendada", "processando"].includes(c.status))
        .length,
      ctr: sums.enviadas ? Number(((100 * sums.conversas) / sums.enviadas).toFixed(2)) : 0,
      primeiraRespostaMin: firstValues.length
        ? firstValues.reduce((s, c) => s + (c.primeiraRespostaMin ?? 0), 0) / firstValues.length
        : null,
      respostaMediaMin: responseValues.length
        ? responseValues.reduce((s, d) => s + n(d.media), 0) / responseValues.length
        : null,
      custoEstimado,
      custoPorOportunidade: sums.conversas ? custoEstimado / sums.conversas : null,
    },
    atendimento: {
      totalConversas,
      mediaConversasDia: totalConversas / days,
      mediaEnviadasDia: messageTotals.enviadas / days,
      mediaRecebidasDia: messageTotals.recebidas / days,
      tempoRespostaMedioMin: responseValues.length
        ? responseValues.reduce((s, d) => s + n(d.media), 0) / responseValues.length
        : null,
      primeiraRespostaMediaMin: firstDailyValues.length
        ? firstDailyValues.reduce((s, d) => s + n(d.primeira), 0) / firstDailyValues.length
        : null,
    },
    dispatchesByDay: dispatchRaw.map((d) => ({
      dia: d.dia,
      disparadas: n(d.disparadas),
      oportunidades: n(d.oportunidades),
      recebidas: n(d.recebidas),
    })),
    messagesByDay: messagesRaw.map((d) => ({
      dia: d.dia,
      conversas: n(d.conversas),
      enviadas: n(d.enviadas),
      recebidas: n(d.recebidas),
    })),
    responseTimeByDay: responseRaw.map((d) => ({
      dia: d.dia,
      primeira: nullable(d.primeira),
      media: nullable(d.media),
    })),
    deliveryBreakdown: [
      { nome: "Lidas", valor: sums.lidas, cor: "var(--color-chart-1)" },
      {
        nome: "Entregues não lidas",
        valor: Math.max(0, sums.entregues - sums.lidas),
        cor: "var(--color-chart-3)",
      },
      {
        nome: "Não entregues",
        valor: Math.max(0, sums.enviadas - sums.entregues),
        cor: "var(--color-chart-4)",
      },
    ],
  };
}
