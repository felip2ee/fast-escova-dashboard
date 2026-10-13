import { describe, expect, test } from "bun:test";

import { DashboardUnavailableError } from "../../src/lib/dashboard-db";
import type { DashboardData } from "../../src/lib/dashboard-types";
import { createServer } from "../../src/server";

const dashboardData = {
  atualizadoEm: "2026-10-12T12:00:00.000Z",
  sync: { status: "fresh", lastSuccessAt: "2026-10-12T12:00:00.000Z", warning: null },
} as DashboardData;

function request(query = "period=30d") {
  return new Request(`http://localhost/api/dashboard?${query}`);
}

describe("dashboard endpoint", () => {
  test("returns typed 400 errors for invalid custom calendar dates", async () => {
    const server = createServer({ getDashboardData: async () => dashboardData });
    const response = await server.fetch(
      request("period=custom&start=2026-02-30&end=2026-03-02"),
      {},
      {},
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Intervalo de datas inválido." });
  });

  test("maps first-sync failures to a safe 503 response", async () => {
    const server = createServer({
      getDashboardData: async () => {
        throw new DashboardUnavailableError(
          "postgresql://admin:secret@database/internal raw SQL SELECT *",
        );
      },
    });
    const response = await server.fetch(request(), {}, {});
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("Não foi possível atualizar os dados do dashboard.");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("SELECT");
  });

  test("coalesces only in-flight requests and never caches a completed result", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createServer({
      getDashboardData: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return { ...dashboardData, atualizadoEm: `call-${calls}` };
      },
    });

    const first = server.fetch(request(), {}, {});
    const concurrent = server.fetch(request(), {}, {});
    await Promise.resolve();
    expect(calls).toBe(1);
    release();
    const [firstResponse, concurrentResponse] = await Promise.all([first, concurrent]);
    expect(await firstResponse.json()).toEqual(await concurrentResponse.json());

    const nextResponse = await server.fetch(request(), {}, {});
    expect(calls).toBe(2);
    expect(nextResponse.headers.get("cache-control")).toBe("no-store");
  });
});
