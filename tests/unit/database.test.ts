import { describe, expect, test } from "bun:test";

import { parseChatwootScope } from "../../src/lib/database.server";

describe("Chatwoot database configuration", () => {
  test("accepts positive integer account and inbox ids", () => {
    expect(
      parseChatwootScope({
        CHATWOOT_ACCOUNT_ID: "2",
        CHATWOOT_INBOX_ID: "1",
      }),
    ).toEqual({ accountId: 2, inboxId: 1 });
  });

  test.each([
    [{ CHATWOOT_ACCOUNT_ID: "", CHATWOOT_INBOX_ID: "1" }, "CHATWOOT_ACCOUNT_ID"],
    [{ CHATWOOT_ACCOUNT_ID: "0", CHATWOOT_INBOX_ID: "1" }, "CHATWOOT_ACCOUNT_ID"],
    [{ CHATWOOT_ACCOUNT_ID: "2.5", CHATWOOT_INBOX_ID: "1" }, "CHATWOOT_ACCOUNT_ID"],
    [{ CHATWOOT_ACCOUNT_ID: "2", CHATWOOT_INBOX_ID: "-1" }, "CHATWOOT_INBOX_ID"],
  ])("rejects an invalid scope before querying", (environment, expectedName) => {
    expect(() => parseChatwootScope(environment)).toThrow(expectedName);
  });
});
