import { describe, expect, test } from "bun:test";

import {
  classifyChatwootMessage,
  type ChatwootMessageRow,
} from "../../src/lib/chatwoot-source.server";

const baseRow: ChatwootMessageRow = {
  message_id: "101",
  conversation_id: "201",
  account_id: "2",
  inbox_id: "1",
  message_type: 0,
  private: false,
  status: null,
  sender_type: "Contact",
  sender_id: "301",
  sender_name: "Cliente",
  created_at: "2026-10-12T12:00:00.000Z",
  updated_at: "2026-10-12T12:01:00.000Z",
};

describe("Chatwoot source classification", () => {
  test("classifies an incoming public contact message as customer input", () => {
    expect(classifyChatwootMessage(baseRow)).toMatchObject({
      direction: "incoming",
      kind: "customer",
      private: false,
      deliveryStatus: null,
      authorId: "301",
      authorName: "Cliente",
    });
  });

  test("classifies a public outgoing User message as a human reply", () => {
    expect(
      classifyChatwootMessage({
        ...baseRow,
        message_type: 1,
        status: 0,
        sender_type: "User",
        sender_id: "42",
        sender_name: "Ana",
      }),
    ).toMatchObject({
      direction: "outgoing",
      kind: "human",
      deliveryStatus: "sent",
      authorId: "42",
      authorName: "Ana",
    });
  });

  test("classifies template, automation, and system messages outside human service", () => {
    expect(classifyChatwootMessage({ ...baseRow, message_type: 3 }).kind).toBe("template");
    expect(
      classifyChatwootMessage({
        ...baseRow,
        message_type: 1,
        sender_type: "AgentBot",
      }).kind,
    ).toBe("automation");
    expect(classifyChatwootMessage({ ...baseRow, message_type: 2 }).kind).toBe("system");
  });

  test("preserves the private flag without counting the message as public", () => {
    expect(
      classifyChatwootMessage({
        ...baseRow,
        message_type: 1,
        sender_type: "User",
        private: true,
      }),
    ).toMatchObject({ kind: "human", private: true });
  });

  test.each([
    [0, "sent"],
    [1, "delivered"],
    [2, "read"],
    [3, "failed"],
  ] as const)("maps status %i to %s", (status, expected) => {
    expect(classifyChatwootMessage({ ...baseRow, message_type: 1, status }).deliveryStatus).toBe(
      expected,
    );
  });

  test("does not project message content", () => {
    expect("content" in classifyChatwootMessage(baseRow)).toBe(false);
  });
});
