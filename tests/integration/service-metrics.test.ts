import { beforeEach, describe, expect, test } from "bun:test";

import type { ResolvedDashboardRange } from "../../src/lib/dashboard-range";
import { getServiceMetrics } from "../../src/lib/service-metrics.server";
import { integrationPool, resetAnalyticsSchema } from "./postgres";

const range: ResolvedDashboardRange = {
  startDate: "2026-10-05",
  endDate: "2026-10-12",
  startAt: "2026-10-05T03:00:00.000Z",
  endAtExclusive: "2026-10-13T03:00:00.000Z",
  days: 8,
};

async function message(input: {
  id: number;
  conversationId: number;
  createdAt: string;
  direction: "incoming" | "outgoing";
  kind: "customer" | "human" | "template" | "automation" | "system";
  private?: boolean;
  authorId?: number | null;
  authorName?: string | null;
}) {
  await integrationPool.query(
    `INSERT INTO dashboard_analytics.chatwoot_messages (
      message_id, conversation_id, account_id, inbox_id, direction, kind, private,
      delivery_status, author_id, author_name, created_at, source_updated_at
    ) VALUES ($1,$2,2,1,$3,$4,$5,null,$6,$7,$8,$8)`,
    [
      input.id,
      input.conversationId,
      input.direction,
      input.kind,
      input.private ?? false,
      input.authorId ?? null,
      input.authorName ?? null,
      input.createdAt,
    ],
  );
}

describe("general and per-agent service metrics", () => {
  beforeEach(resetAnalyticsSchema);

  test("forms one block from consecutive customer messages and ignores non-human events", async () => {
    await message({
      id: 1,
      conversationId: 10,
      createdAt: "2026-10-05T15:00:00Z",
      direction: "incoming",
      kind: "customer",
    });
    await message({
      id: 2,
      conversationId: 10,
      createdAt: "2026-10-05T15:05:00Z",
      direction: "incoming",
      kind: "customer",
    });
    for (const item of [
      { id: 3, kind: "human" as const, private: true },
      { id: 4, kind: "template" as const, private: false },
      { id: 5, kind: "automation" as const, private: false },
      { id: 6, kind: "system" as const, private: false },
    ]) {
      await message({
        ...item,
        conversationId: 10,
        createdAt: `2026-10-05T15:0${item.id + 3}:00Z`,
        direction: "outgoing",
        authorId: 99,
        authorName: "Ignorada",
      });
    }
    await message({
      id: 7,
      conversationId: 10,
      createdAt: "2026-10-05T15:10:00Z",
      direction: "outgoing",
      kind: "human",
      authorId: 42,
      authorName: "Ana",
    });

    const result = await getServiceMetrics(range, integrationPool);

    expect(result.atendimento).toMatchObject({
      totalConversas: 1,
      mensagensRecebidas: 2,
      respostasHumanas: 1,
      tempoRespostaMedioMin: 10,
      primeiraRespostaMediaMin: 10,
    });
    expect(result.agents).toEqual([
      {
        id: "42",
        nome: "Ana",
        conversas: 1,
        mensagensEnviadas: 1,
        tempoRespostaMedioMin: 10,
      },
    ]);
  });

  test("credits conversations and messages to every actual participating agent", async () => {
    for (const item of [
      { id: 11, agent: 42, name: "Ana", minute: "00" },
      { id: 12, agent: 42, name: "Ana", minute: "01" },
      { id: 13, agent: 43, name: "Bia", minute: "02" },
    ]) {
      await message({
        id: item.id,
        conversationId: 20,
        createdAt: `2026-10-06T15:${item.minute}:00Z`,
        direction: "outgoing",
        kind: "human",
        authorId: item.agent,
        authorName: item.name,
      });
    }

    const result = await getServiceMetrics(range, integrationPool);

    expect(result.atendimento.totalConversas).toBe(1);
    expect(result.agents).toEqual([
      expect.objectContaining({ id: "42", conversas: 1, mensagensEnviadas: 2 }),
      expect.objectContaining({ id: "43", conversas: 1, mensagensEnviadas: 1 }),
    ]);
  });

  test("keeps activity from a deleted agent under a stable fallback name", async () => {
    await message({
      id: 21,
      conversationId: 30,
      createdAt: "2026-10-07T15:00:00Z",
      direction: "outgoing",
      kind: "human",
      authorId: 77,
      authorName: null,
    });

    const result = await getServiceMetrics(range, integrationPool);
    expect(result.agents[0]).toMatchObject({ id: "77", nome: "Atendente #77" });
  });

  test("measures only business minutes across nights and Sunday and excludes unanswered blocks", async () => {
    const rows = [
      // Monday 19:30 local -> Tuesday 08:30 local: 60 minutes.
      [31, 40, "2026-10-05T22:30:00Z", "incoming", "customer", null, null],
      [32, 40, "2026-10-06T11:30:00Z", "outgoing", "human", 42, "Ana"],
      // Saturday 19:30 local -> Monday 08:30 local: 60 minutes.
      [33, 41, "2026-10-10T22:30:00Z", "incoming", "customer", null, null],
      [34, 41, "2026-10-12T11:30:00Z", "outgoing", "human", 43, "Bia"],
      // No human reply: must not enter response averages.
      [35, 42, "2026-10-12T15:00:00Z", "incoming", "customer", null, null],
    ] as const;
    for (const [id, conversationId, createdAt, direction, kind, authorId, authorName] of rows) {
      await message({
        id,
        conversationId,
        createdAt,
        direction,
        kind,
        authorId,
        authorName,
      });
    }

    const result = await getServiceMetrics(range, integrationPool);

    expect(result.atendimento).toMatchObject({
      tempoRespostaMedioMin: 60,
      primeiraRespostaMediaMin: 60,
    });
    expect(result.agents.map((agent) => agent.tempoRespostaMedioMin)).toEqual([60, 60]);
  });

  test("counts a response block only when its human closer is inside the period", async () => {
    await message({
      id: 41,
      conversationId: 50,
      createdAt: "2026-10-05T02:30:00Z",
      direction: "incoming",
      kind: "customer",
    });
    await message({
      id: 42,
      conversationId: 50,
      createdAt: "2026-10-05T03:30:00Z",
      direction: "outgoing",
      kind: "human",
      authorId: 42,
      authorName: "Ana",
    });
    await message({
      id: 43,
      conversationId: 51,
      createdAt: "2026-10-13T02:30:00Z",
      direction: "incoming",
      kind: "customer",
    });
    await message({
      id: 44,
      conversationId: 51,
      createdAt: "2026-10-13T03:30:00Z",
      direction: "outgoing",
      kind: "human",
      authorId: 43,
      authorName: "Bia",
    });

    const result = await getServiceMetrics(range, integrationPool);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({ id: "42" });
  });
});
