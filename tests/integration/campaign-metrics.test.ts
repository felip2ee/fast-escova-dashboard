import { beforeEach, describe, expect, test } from "bun:test";

import { getCampaignMetrics } from "../../src/lib/campaign-metrics.server";
import type { ResolvedDashboardRange } from "../../src/lib/dashboard-range";
import { integrationPool, resetAnalyticsSchema } from "./postgres";

const range: ResolvedDashboardRange = {
  startDate: "2026-10-01",
  endDate: "2026-10-02",
  startAt: "2026-10-01T03:00:00.000Z",
  endAtExclusive: "2026-10-03T03:00:00.000Z",
  days: 2,
};

async function resetCampaignSchema() {
  await resetAnalyticsSchema();
  await integrationPool.query(`
    DROP SCHEMA IF EXISTS disparos CASCADE;
    CREATE SCHEMA disparos;
    CREATE TABLE disparos.campanhas (
      id bigint PRIMARY KEY,
      nome text NOT NULL,
      tipo text,
      status text NOT NULL,
      iniciada_em timestamptz,
      criado_em timestamptz NOT NULL
    );
    CREATE TABLE disparos.contatos (
      id bigint PRIMARY KEY,
      numero_norm text
    );
    CREATE TABLE disparos.campanha_destinatarios (
      id bigint PRIMARY KEY,
      campanha_id bigint NOT NULL REFERENCES disparos.campanhas(id),
      contato_id bigint,
      conta_waba_id bigint,
      celular_norm text,
      chatwoot_message_id bigint,
      chatwoot_conversation_id bigint,
      template_enviado_em timestamptz,
      estado_chatwoot text,
      status_atual text,
      revisao_chatwoot boolean NOT NULL DEFAULT false
    );
    CREATE TABLE disparos.mensagens (
      id bigint PRIMARY KEY,
      conta_waba_id bigint,
      contato_id bigint,
      conversa_id bigint,
      direcao text,
      escopo text,
      wa_timestamp timestamptz,
      criado_em timestamptz NOT NULL
    );
  `);
}

async function campaign(id: number, name = `Campanha ${id}`) {
  await integrationPool.query(
    `INSERT INTO disparos.campanhas (id, nome, tipo, status, iniciada_em, criado_em)
    VALUES ($1, $2, 'chatwoot', 'finalizada', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z')`,
    [id, name],
  );
}

async function recipient(input: {
  id: number;
  campaignId: number;
  messageId: number;
  conversationId: number;
  sentAt?: string;
  state?: string;
  status?: string;
}) {
  await integrationPool.query(
    `INSERT INTO disparos.campanha_destinatarios (
      id, campanha_id, chatwoot_message_id, chatwoot_conversation_id,
      template_enviado_em, estado_chatwoot, status_atual
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.campaignId,
      input.messageId,
      input.conversationId,
      input.sentAt ?? "2026-10-01T12:00:00Z",
      input.state ?? "sent",
      input.status ?? "enviado",
    ],
  );
}

async function projected(input: {
  id: number;
  conversationId: number;
  createdAt: string;
  direction?: "incoming" | "outgoing";
  kind?: "customer" | "human" | "template";
  status?: "sent" | "delivered" | "read" | "failed" | null;
  updatedAt?: string;
}) {
  await integrationPool.query(
    `INSERT INTO dashboard_analytics.chatwoot_messages (
      message_id, conversation_id, account_id, inbox_id, direction, kind, private,
      delivery_status, author_id, author_name, created_at, source_updated_at
    ) VALUES ($1,$2,2,1,$3,$4,false,$5,$6,$7,$8,$9)`,
    [
      input.id,
      input.conversationId,
      input.direction ?? "outgoing",
      input.kind ?? "template",
      input.status === undefined ? "delivered" : input.status,
      input.direction === "incoming" ? null : 42,
      input.direction === "incoming" ? null : "Ana",
      input.createdAt,
      input.updatedAt ?? input.createdAt,
    ],
  );
}

describe("campaign funnel metrics", () => {
  beforeEach(resetCampaignSchema);

  test("separates delivered, read, failed, and pending messages", async () => {
    await campaign(1);
    for (const [id, status, state] of [
      [101, "delivered", "delivered"],
      [102, "read", "read"],
      [103, "failed", "permanent_failure"],
      [104, "sent", "waiting_confirmation"],
    ] as const) {
      await recipient({ id, campaignId: 1, messageId: id, conversationId: id, state });
      await projected({ id, conversationId: id, createdAt: "2026-10-01T12:00:00Z", status });
    }

    const result = await getCampaignMetrics(range, integrationPool);

    expect(result.campaigns[0]).toMatchObject({
      enviadas: 4,
      entregues: 2,
      lidas: 1,
      falhas: 1,
      pendentes: 1,
      resultadosIncertos: 0,
      taxaEntrega: 50,
      taxaLeitura: 50,
      taxaResposta: 0,
    });
    expect(result.overview).toMatchObject({
      custoEstimado: 0.16,
      custoPorResposta: null,
    });
  });

  test("counts a first reply at exactly 48 hours but not one microsecond later", async () => {
    await campaign(1);
    await recipient({ id: 201, campaignId: 1, messageId: 201, conversationId: 201 });
    await recipient({ id: 202, campaignId: 1, messageId: 202, conversationId: 202 });
    await projected({ id: 201, conversationId: 201, createdAt: "2026-10-01T12:00:00Z" });
    await projected({ id: 202, conversationId: 202, createdAt: "2026-10-01T12:00:00Z" });
    await projected({
      id: 211,
      conversationId: 201,
      direction: "incoming",
      kind: "customer",
      status: null,
      createdAt: "2026-10-03T12:00:00Z",
    });
    await projected({
      id: 212,
      conversationId: 202,
      direction: "incoming",
      kind: "customer",
      status: null,
      createdAt: "2026-10-03T12:00:00.000001Z",
    });

    const result = await getCampaignMetrics(range, integrationPool);
    expect(result.campaigns[0]).toMatchObject({ respondidas: 1, taxaResposta: 50 });
  });

  test("attributes a reply to the most recent preceding campaign send", async () => {
    await campaign(1, "Antiga");
    await campaign(2, "Recente");
    await recipient({
      id: 301,
      campaignId: 1,
      messageId: 301,
      conversationId: 300,
      sentAt: "2026-10-01T06:00:00Z",
    });
    await recipient({
      id: 302,
      campaignId: 2,
      messageId: 302,
      conversationId: 300,
      sentAt: "2026-10-02T06:00:00Z",
    });
    await projected({ id: 301, conversationId: 300, createdAt: "2026-10-01T06:00:00Z" });
    await projected({ id: 302, conversationId: 300, createdAt: "2026-10-02T06:00:00Z" });
    await projected({
      id: 303,
      conversationId: 300,
      direction: "incoming",
      kind: "customer",
      status: null,
      createdAt: "2026-10-02T07:00:00Z",
    });

    const result = await getCampaignMetrics(range, integrationPool);
    expect(result.campaigns.find((item) => item.id === "1")?.respondidas).toBe(0);
    expect(result.campaigns.find((item) => item.id === "2")?.respondidas).toBe(1);
  });

  test("counts one response per recipient and uses statuses updated after the cohort period", async () => {
    await campaign(1);
    await recipient({ id: 401, campaignId: 1, messageId: 401, conversationId: 401 });
    await projected({
      id: 401,
      conversationId: 401,
      createdAt: "2026-10-01T12:00:00Z",
      updatedAt: "2026-10-10T12:00:00Z",
      status: "read",
    });
    await projected({
      id: 402,
      conversationId: 401,
      direction: "incoming",
      kind: "customer",
      status: null,
      createdAt: "2026-10-01T13:00:00Z",
    });
    await projected({
      id: 403,
      conversationId: 401,
      direction: "incoming",
      kind: "customer",
      status: null,
      createdAt: "2026-10-01T14:00:00Z",
    });

    const result = await getCampaignMetrics(range, integrationPool);
    expect(result.campaigns[0]).toMatchObject({ entregues: 1, lidas: 1, respondidas: 1 });
    expect(result.overview).toMatchObject({ custoEstimado: 0.04, custoPorResposta: 0.04 });
  });

  test("keeps uncertain results separate from confirmed failures", async () => {
    await campaign(1);
    await recipient({
      id: 501,
      campaignId: 1,
      messageId: 501,
      conversationId: 501,
      state: "resultado_incerto",
    });
    await recipient({
      id: 502,
      campaignId: 1,
      messageId: 502,
      conversationId: 502,
      state: "context_pending",
    });
    await projected({ id: 501, conversationId: 501, createdAt: "2026-10-01T12:00:00Z" });
    await projected({ id: 502, conversationId: 502, createdAt: "2026-10-01T12:00:00Z" });

    const result = await getCampaignMetrics(range, integrationPool);
    expect(result.campaigns[0]).toMatchObject({
      falhas: 0,
      pendentes: 1,
      resultadosIncertos: 1,
    });
  });

  test("uses normalized phone only when legacy destinations have no Chatwoot ids", async () => {
    await campaign(1, "Legada");
    await integrationPool.query(
      `INSERT INTO disparos.contatos (id, numero_norm) VALUES (900, '99999999');
       INSERT INTO disparos.campanha_destinatarios (
         id, campanha_id, contato_id, conta_waba_id, celular_norm,
         template_enviado_em, estado_chatwoot, status_atual
       ) VALUES (
         901, 1, 900, 77, '99999999',
         '2026-10-01T12:00:00Z', 'delivered', 'entregue'
       );
       INSERT INTO disparos.mensagens (
         id, conta_waba_id, contato_id, conversa_id, direcao, escopo, wa_timestamp, criado_em
       ) VALUES (
         902, 77, 900, 800, 'entrada', 'conversa',
         '2026-10-01T13:00:00Z', '2026-10-01T13:00:00Z'
       )`,
    );

    const result = await getCampaignMetrics(range, integrationPool);
    expect(result.campaigns[0]).toMatchObject({
      enviadas: 1,
      entregues: 1,
      respondidas: 1,
    });
  });
});
