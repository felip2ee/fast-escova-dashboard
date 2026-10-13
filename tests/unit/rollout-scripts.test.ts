import { describe, expect, test } from "bun:test";

import { runBackfill } from "../../scripts/backfill-chatwoot.mjs";
import { parseRangeArguments } from "../../scripts/reconcile-dashboard.mjs";
import {
  assessChatwootSchema,
  requiredChatwootColumns,
} from "../../scripts/verify-chatwoot-schema.mjs";

describe("Chatwoot schema rollout checks", () => {
  test("accepts all required columns and supported enum values", () => {
    const columns = Object.entries(requiredChatwootColumns).flatMap(([table, definitions]) =>
      Object.keys(definitions).map((column) => ({ table, column })),
    );
    expect(assessChatwootSchema(columns, 0)).toEqual({ compatible: true, missing: [] });
  });

  test("rejects a missing column or unsupported enum value", () => {
    const columns = Object.entries(requiredChatwootColumns).flatMap(([table, definitions]) =>
      Object.keys(definitions).map((column) => ({ table, column })),
    );
    columns.pop();
    expect(assessChatwootSchema(columns, 1)).toMatchObject({ compatible: false });
  });
});

describe("resumable backfill", () => {
  test("reuses the production synchronizer until it reports current", async () => {
    let calls = 0;
    const report = await runBackfill({
      sync: async () => {
        calls += 1;
        return calls === 1
          ? { status: "updated", processed: 500, lastSuccessAt: "2026-10-12T12:00:00Z" }
          : { status: "current", processed: 0, lastSuccessAt: "2026-10-12T12:01:00Z" };
      },
      projectionState: async () => ({
        projectionRows: 500,
        cursorUpdatedAt: "2026-10-12T11:59:00Z",
        cursorId: "900",
      }),
    });

    expect(calls).toBe(2);
    expect(report).toEqual({
      status: "current",
      processed: 500,
      projectionRows: 500,
      cursorUpdatedAt: "2026-10-12T11:59:00Z",
      cursorId: "900",
      lastSuccessAt: "2026-10-12T12:01:00Z",
    });
  });
});

describe("reconciliation arguments", () => {
  test("requires a valid inclusive date range", () => {
    expect(parseRangeArguments(["--start", "2026-09-01", "--end", "2026-09-30"])).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(() => parseRangeArguments(["--start", "2026-09-31", "--end", "2026-09-30"])).toThrow(
      "Período inválido",
    );
  });
});
