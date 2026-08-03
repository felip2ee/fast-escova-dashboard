import { Pool, type QueryResultRow } from "pg";
import type { DashboardData } from "./dashboard-types";

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

async function rows<T extends QueryResultRow>(sql: string) {
  return (await database().query<T>(sql)).rows;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [campaignsRaw, dailyRaw, responseRaw] = await Promise.all([
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
      ctr: string | null;
      primeira_resposta_min: string | null;
    }>(`SELECT c.id::text, c.nome, COALESCE(c.tipo, 'avulsa') AS tipo,
        to_char(COALESCE(c.iniciada_em, c.criado_em) AT TIME ZONE 'America/Araguaina', 'DD/MM/YYYY') AS data,
        c.status,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido') AND extract(isodow FROM cd.enviado_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time < time '20:00') AS enviadas,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('entregue','lido') AND extract(isodow FROM cd.enviado_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time < time '20:00') AS entregues,
        count(cd.id) FILTER (WHERE cd.status_atual = 'lido' AND extract(isodow FROM cd.lido_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.lido_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.lido_em AT TIME ZONE 'America/Araguaina')::time < time '20:00') AS lidas,
        count(cd.id) FILTER (WHERE cd.engajou AND cd.primeira_resposta_em <= cd.enviado_em + interval '24 hours' AND extract(isodow FROM cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time < time '20:00') AS conversas,
        round(100.0 * count(cd.id) FILTER (WHERE cd.engajou AND cd.primeira_resposta_em <= cd.enviado_em + interval '24 hours' AND extract(isodow FROM cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time < time '20:00')
          / nullif(count(cd.id) FILTER (WHERE cd.status_atual IN ('entregue','lido') AND extract(isodow FROM cd.enviado_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.enviado_em AT TIME ZONE 'America/Araguaina')::time < time '20:00'), 0), 2) AS ctr,
        round(avg(cd.tempo_resposta_segundos) FILTER (WHERE cd.engajou AND cd.primeira_resposta_em <= cd.enviado_em + interval '24 hours' AND extract(isodow FROM cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6 AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time < time '20:00') / 60.0, 2) AS primeira_resposta_min
      FROM disparos.campanhas c
      LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
      GROUP BY c.id ORDER BY COALESCE(c.iniciada_em, c.criado_em) DESC`),
    rows<{ dia: string; enviadas: string; recebidas: string }>(`WITH dias AS (
        SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia, 'DD/MM') AS dia,
        count(m.id) FILTER (WHERE m.escopo = 'disparo' AND m.direcao = 'saida') AS enviadas,
        count(m.id) FILTER (WHERE m.escopo = 'conversa' AND m.direcao = 'entrada') AS recebidas
      FROM dias d LEFT JOIN disparos.mensagens m ON (COALESCE(m.wa_timestamp, m.criado_em) AT TIME ZONE 'America/Araguaina')::date = d.dia
        AND extract(isodow FROM COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::time >= time '08:00'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::time < time '20:00'
      GROUP BY d.dia ORDER BY d.dia`),
    rows<{ dia: string; primeira: string | null; media: string | null }>(`WITH entradas AS (
        SELECT m.id, m.conversa_id, COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em,
          (SELECT min(COALESCE(s.wa_timestamp,s.criado_em)) FROM disparos.mensagens s
           WHERE s.conversa_id=m.conversa_id AND s.escopo='conversa' AND s.direcao='saida'
             AND COALESCE(s.wa_timestamp,s.criado_em) > COALESCE(m.wa_timestamp,m.criado_em)) AS respondida_em
        FROM disparos.mensagens m WHERE m.escopo='conversa' AND m.direcao='entrada'
          AND extract(isodow FROM COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6
          AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::time >= time '08:00'
          AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::time < time '20:00'
      ), dias AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS dia)
      SELECT to_char(d.dia,'DD/MM') AS dia,
        round(avg(cd.tempo_resposta_segundos) / 60.0, 2) AS primeira,
        round(avg(extract(epoch FROM (e.respondida_em-e.recebida_em))) FILTER (WHERE e.respondida_em IS NOT NULL) / 60.0, 2) AS media
      FROM dias d
      LEFT JOIN disparos.campanha_destinatarios cd ON (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::date=d.dia
        AND extract(isodow FROM cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina') BETWEEN 1 AND 6
        AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time >= time '08:00' AND (cd.primeira_resposta_em AT TIME ZONE 'America/Araguaina')::time < time '20:00'
      LEFT JOIN entradas e ON (e.recebida_em AT TIME ZONE 'America/Araguaina')::date=d.dia
      GROUP BY d.dia ORDER BY d.dia`),
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
    ctr: n(c.ctr),
    primeiraRespostaMin: nullable(c.primeira_resposta_min),
  }));
  const sums = campaigns.reduce(
    (a, c) => ({
      enviadas: a.enviadas + c.enviadas,
      entregues: a.entregues + c.entregues,
      lidas: a.lidas + c.lidas,
      conversas: a.conversas + c.conversas,
    }),
    { enviadas: 0, entregues: 0, lidas: 0, conversas: 0 },
  );
  const firstValues = campaigns.filter((c) => c.primeiraRespostaMin != null);
  const responseValues = responseRaw.filter((d) => d.media != null);

  return {
    atualizadoEm: new Date().toISOString(),
    campaigns,
    overview: {
      ...sums,
      campanhasAtivas: campaigns.filter((c) => ["agendada", "processando"].includes(c.status))
        .length,
      ctr: sums.entregues ? Number(((100 * sums.conversas) / sums.entregues).toFixed(2)) : 0,
      primeiraRespostaMin: firstValues.length
        ? firstValues.reduce((s, c) => s + (c.primeiraRespostaMin ?? 0), 0) / firstValues.length
        : null,
      respostaMediaMin: responseValues.length
        ? responseValues.reduce((s, d) => s + n(d.media), 0) / responseValues.length
        : null,
    },
    messagesByDay: dailyRaw.map((d) => ({
      dia: d.dia,
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
