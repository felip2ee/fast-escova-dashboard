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
type DashboardRange = { start?: string; end?: string };

async function rows<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return (await database().query<T>(sql, values)).rows;
}

export async function getDashboardData(
  period: DashboardPeriod = "30d",
  range: DashboardRange = {},
): Promise<DashboardData> {
  const periodBounds =
    period === "custom"
      ? { start: range.start!, end: range.end! }
      : period === "lastMonth"
        ? {
            start:
              "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 month'",
            end: "date_trunc('month', now() AT TIME ZONE 'America/Araguaina')::date - interval '1 day'",
          }
        : {
            start: `(now() AT TIME ZONE 'America/Araguaina')::date - interval '${period === "today" ? 0 : period === "7d" ? 6 : 29} days'`,
            end: `(now() AT TIME ZONE 'America/Araguaina')::date`,
          };
  const isCustom = period === "custom";
  const periodStart = isCustom ? "$1::date" : periodBounds.start;
  const periodEnd = isCustom ? "$2::date" : periodBounds.end;
  const queryValues = isCustom ? [periodBounds.start, periodBounds.end] : [];
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
        count(cd.id) FILTER (WHERE EXISTS (
          SELECT 1 FROM disparos.mensagens mo
          JOIN disparos.contatos cto ON cto.id=mo.contato_id
          WHERE mo.escopo='conversa' AND mo.direcao='entrada'
            AND mo.conta_waba_id=cd.conta_waba_id
            AND right(regexp_replace(COALESCE(cto.wa_id,cto.celular,''),'[^0-9]','','g'),8)
              = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
            AND length(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g')) >= 8
            AND COALESCE(mo.wa_timestamp,mo.criado_em)
              BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
            AND NOT EXISTS (
              SELECT 1 FROM disparos.campanha_destinatarios cd2
              WHERE cd2.conta_waba_id=cd.conta_waba_id AND cd2.enviado_em>cd.enviado_em
                AND cd2.enviado_em<=COALESCE(mo.wa_timestamp,mo.criado_em)
                AND right(regexp_replace(COALESCE(cd2.celular_snapshot,''),'[^0-9]','','g'),8)
                  = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
            )
            AND (COALESCE(mo.wa_timestamp,mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
              BETWEEN ${periodStart} AND ${periodEnd}
        )) AS conversas,
        (SELECT count(*) FROM disparos.mensagens mr
          JOIN disparos.campanha_destinatarios cdr ON cdr.id=mr.atribuida_destinatario_id
          WHERE cdr.campanha_id=c.id AND mr.escopo='conversa' AND mr.direcao='entrada') AS mensagens_recebidas,
        round(100.0 * count(cd.id) FILTER (WHERE EXISTS (
          SELECT 1 FROM disparos.mensagens mo
          JOIN disparos.contatos cto ON cto.id=mo.contato_id
          WHERE mo.escopo='conversa' AND mo.direcao='entrada'
            AND mo.conta_waba_id=cd.conta_waba_id
            AND right(regexp_replace(COALESCE(cto.wa_id,cto.celular,''),'[^0-9]','','g'),8)
              = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
            AND length(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g')) >= 8
            AND COALESCE(mo.wa_timestamp,mo.criado_em)
              BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
            AND NOT EXISTS (
              SELECT 1 FROM disparos.campanha_destinatarios cd2
              WHERE cd2.conta_waba_id=cd.conta_waba_id AND cd2.enviado_em>cd.enviado_em
                AND cd2.enviado_em<=COALESCE(mo.wa_timestamp,mo.criado_em)
                AND right(regexp_replace(COALESCE(cd2.celular_snapshot,''),'[^0-9]','','g'),8)
                  = right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)
            )
            AND (COALESCE(mo.wa_timestamp,mo.criado_em) AT TIME ZONE 'America/Araguaina')::date
              BETWEEN ${periodStart} AND ${periodEnd}
        ))
          / nullif(count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')), 0), 2) AS ctr,
        round(avg(cd.tempo_resposta_segundos) FILTER (WHERE cd.engajou) / 60.0, 2) AS primeira_resposta_min
      FROM disparos.campanhas c
      LEFT JOIN disparos.campanha_destinatarios cd ON cd.campanha_id = c.id
      WHERE EXISTS (
        SELECT 1 FROM disparos.campanha_destinatarios cdf
        WHERE cdf.campanha_id=c.id AND (
          (cdf.enviado_em AT TIME ZONE 'America/Araguaina')::date BETWEEN ${periodStart} AND ${periodEnd}
          OR EXISTS (
            SELECT 1 FROM disparos.mensagens mf
            JOIN disparos.contatos ctf ON ctf.id=mf.contato_id
            WHERE mf.escopo='conversa' AND mf.direcao='entrada'
              AND mf.conta_waba_id=cdf.conta_waba_id
              AND right(regexp_replace(COALESCE(ctf.wa_id,ctf.celular,''),'[^0-9]','','g'),8)
                = right(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g'),8)
              AND length(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g')) >= 8
              AND COALESCE(mf.wa_timestamp,mf.criado_em)
                BETWEEN cdf.enviado_em AND cdf.enviado_em + interval '48 hours'
              AND NOT EXISTS (
                SELECT 1 FROM disparos.campanha_destinatarios cdf2
                WHERE cdf2.conta_waba_id=cdf.conta_waba_id AND cdf2.enviado_em>cdf.enviado_em
                  AND cdf2.enviado_em<=COALESCE(mf.wa_timestamp,mf.criado_em)
                  AND right(regexp_replace(COALESCE(cdf2.celular_snapshot,''),'[^0-9]','','g'),8)
                    = right(regexp_replace(COALESCE(cdf.celular_snapshot,''),'[^0-9]','','g'),8)
              )
              AND (COALESCE(mf.wa_timestamp,mf.criado_em) AT TIME ZONE 'America/Araguaina')::date
                BETWEEN ${periodStart} AND ${periodEnd}
          )
        )
      )
      GROUP BY c.id ORDER BY COALESCE(c.iniciada_em, c.criado_em) DESC`,
      queryValues,
    ),
    rows<{ dia: string; disparadas: string; oportunidades: string; recebidas: string }>(
      `WITH dias AS (
        SELECT generate_series(${periodStart}, ${periodEnd}, interval '1 day')::date AS dia
      ), oportunidades AS (
        SELECT DISTINCT ON (cand.id) cand.id AS destinatario_id,
          (e.recebida_em AT TIME ZONE 'America/Araguaina')::date AS dia
        FROM (
          SELECT m.conta_waba_id,
            regexp_replace(COALESCE(ct.wa_id,ct.celular,''),'[^0-9]','','g') AS numero,
            COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em
          FROM disparos.mensagens m
          JOIN disparos.contatos ct ON ct.id=m.contato_id
          WHERE m.escopo='conversa' AND m.direcao='entrada'
            AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
              BETWEEN ${periodStart} AND ${periodEnd}
        ) e
        JOIN LATERAL (
          SELECT cd.id FROM disparos.campanha_destinatarios cd
          WHERE cd.conta_waba_id=e.conta_waba_id AND cd.enviado_em IS NOT NULL
            AND length(e.numero) >= 8
            AND right(regexp_replace(COALESCE(cd.celular_snapshot,''),'[^0-9]','','g'),8)=right(e.numero,8)
            AND e.recebida_em BETWEEN cd.enviado_em AND cd.enviado_em + interval '48 hours'
          ORDER BY cd.enviado_em DESC LIMIT 1
        ) cand ON true
        ORDER BY cand.id,e.recebida_em
      ) SELECT to_char(d.dia, 'DD/MM') AS dia,
        count(cd.id) FILTER (WHERE cd.status_atual IN ('enviado','entregue','lido','falha')) AS disparadas,
        (SELECT count(*) FROM oportunidades o WHERE o.dia=d.dia) AS oportunidades,
        (SELECT count(*) FROM disparos.mensagens mr
          WHERE mr.escopo='conversa' AND mr.direcao='entrada' AND mr.atribuida_destinatario_id IS NOT NULL
            AND (COALESCE(mr.wa_timestamp,mr.criado_em) AT TIME ZONE 'America/Araguaina')::date=d.dia) AS recebidas
      FROM dias d LEFT JOIN disparos.campanha_destinatarios cd
        ON (cd.enviado_em AT TIME ZONE 'America/Araguaina')::date = d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      queryValues,
    ),
    rows<{ dia: string; conversas: string; enviadas: string; recebidas: string }>(
      `WITH dias AS (
        SELECT generate_series(${periodStart}, ${periodEnd}, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia, 'DD/MM') AS dia,
        count(DISTINCT m.conversa_id) AS conversas,
        count(m.id) FILTER (WHERE m.direcao='saida' AND m.origem='atendente') AS enviadas,
        count(m.id) FILTER (WHERE m.direcao='entrada') AS recebidas
      FROM dias d LEFT JOIN disparos.mensagens m
        ON m.escopo='conversa'
        AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date = d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      queryValues,
    ),
    rows<{ dia: string; primeira: string | null; media: string | null }>(
      `WITH entradas AS (
        SELECT m.id, m.conversa_id, COALESCE(m.wa_timestamp,m.criado_em) AS recebida_em,
          row_number() OVER (PARTITION BY m.conversa_id,
            (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date
            ORDER BY COALESCE(m.wa_timestamp,m.criado_em),m.id) AS ordem_dia
        FROM disparos.mensagens m
        WHERE m.escopo='conversa' AND m.direcao='entrada'
          AND (COALESCE(m.wa_timestamp,m.criado_em) AT TIME ZONE 'America/Araguaina')::date BETWEEN ${periodStart} AND ${periodEnd}
      ), tempos AS (
        SELECT e.*,
          (SELECT min(COALESCE(s.wa_timestamp,s.criado_em)) FROM disparos.mensagens s
           WHERE s.conversa_id=e.conversa_id AND s.escopo='conversa'
             AND s.direcao='saida' AND s.origem='atendente'
             AND COALESCE(s.wa_timestamp,s.criado_em) > e.recebida_em) AS respondida_em
        FROM entradas e
      ), dias AS (
        SELECT generate_series(${periodStart}, ${periodEnd}, interval '1 day')::date AS dia
      ) SELECT to_char(d.dia,'DD/MM') AS dia,
        round(avg(extract(epoch FROM (t.respondida_em-t.recebida_em))) FILTER
          (WHERE t.respondida_em IS NOT NULL AND t.ordem_dia=1) / 60.0, 2) AS primeira,
        round(avg(extract(epoch FROM (t.respondida_em-t.recebida_em))) FILTER
          (WHERE t.respondida_em IS NOT NULL) / 60.0, 2) AS media
      FROM dias d LEFT JOIN tempos t
        ON (t.recebida_em AT TIME ZONE 'America/Araguaina')::date=d.dia
      GROUP BY d.dia ORDER BY d.dia`,
      queryValues,
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
      AND (COALESCE(wa_timestamp,criado_em) AT TIME ZONE 'America/Araguaina')::date BETWEEN ${periodStart} AND ${periodEnd}`,
    queryValues,
  );
  const totalConversas = n(totalConversationIds[0]?.total);
  const selectedDays = Math.max(1, messagesRaw.length);
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
      mediaConversasDia: totalConversas / selectedDays,
      mediaEnviadasDia: messageTotals.enviadas / selectedDays,
      mediaRecebidasDia: messageTotals.recebidas / selectedDays,
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
