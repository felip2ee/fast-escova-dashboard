import "./lib/error-capture";

import { DashboardUnavailableError, getDashboardData } from "./lib/dashboard-db";
import { DashboardRangeError, resolveDashboardRange } from "./lib/dashboard-range";
import type { DashboardData, DashboardPeriod } from "./lib/dashboard-types";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type DashboardLoader = (
  period: DashboardPeriod,
  range: { start?: string; end?: string },
) => Promise<DashboardData>;

type ServerDependencies = {
  getDashboardData: DashboardLoader;
  getServerEntry?: () => Promise<ServerEntry>;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function productionServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (module) => (module.default ?? module) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function dashboardPeriod(value: string | null): DashboardPeriod {
  return value === "today" ||
    value === "yesterday" ||
    value === "thisMonth" ||
    value === "7d" ||
    value === "lastMonth" ||
    value === "custom"
    ? value
    : "30d";
}

function dashboardJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function createServer(dependencies: ServerDependencies): ServerEntry {
  const dashboardRequests = new Map<string, Promise<DashboardData>>();

  async function loadOnce(period: DashboardPeriod, range: { start?: string; end?: string }) {
    const key = `${period}:${range.start ?? ""}:${range.end ?? ""}`;
    const current = dashboardRequests.get(key);
    if (current) return current;

    const pending = dependencies
      .getDashboardData(period, range)
      .finally(() => dashboardRequests.delete(key));
    dashboardRequests.set(key, pending);
    return pending;
  }

  return {
    async fetch(request: Request, env: unknown, ctx: unknown) {
      try {
        const url = new URL(request.url);
        if (url.pathname === "/api/health") {
          return Response.json({ status: "ok" });
        }
        if (url.pathname === "/api/dashboard") {
          if (request.method !== "GET") return new Response(null, { status: 405 });
          const period = dashboardPeriod(url.searchParams.get("period"));
          const start = url.searchParams.get("start") ?? undefined;
          const end = url.searchParams.get("end") ?? undefined;
          const range = {
            ...(start ? { start } : {}),
            ...(end ? { end } : {}),
          };
          try {
            resolveDashboardRange(period, range);
            return dashboardJson(await loadOnce(period, range));
          } catch (error) {
            if (error instanceof DashboardRangeError) {
              return dashboardJson({ error: "Intervalo de datas inválido." }, 400);
            }
            console.error(
              error instanceof DashboardUnavailableError
                ? "dashboard refresh unavailable"
                : "dashboard refresh failed",
            );
            return dashboardJson(
              { error: "Não foi possível atualizar os dados do dashboard." },
              503,
            );
          }
        }
        const handler = await (dependencies.getServerEntry ?? productionServerEntry)();
        const response = await handler.fetch(request, env, ctx);
        return await normalizeCatastrophicSsrResponse(response);
      } catch (error) {
        console.error(error);
        return new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    },
  };
}

export default createServer({ getDashboardData });
