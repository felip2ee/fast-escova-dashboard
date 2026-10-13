import { Pool } from "pg";

type ChatwootEnvironment = {
  CHATWOOT_ACCOUNT_ID?: string;
  CHATWOOT_INBOX_ID?: string;
};

let dashboardPool: Pool | undefined;
let chatwootPool: Pool | undefined;

function requiredConnectionString(name: "DATABASE_URL" | "CHATWOOT_DATABASE_URL") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada`);
  return value;
}

function ssl(value: string | undefined) {
  return value === "disable" ? false : { rejectUnauthorized: false };
}

function positiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!value || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} deve ser um inteiro positivo`);
  }
  return parsed;
}

export function parseChatwootScope(environment: ChatwootEnvironment = process.env) {
  return {
    accountId: positiveInteger(environment.CHATWOOT_ACCOUNT_ID, "CHATWOOT_ACCOUNT_ID"),
    inboxId: positiveInteger(environment.CHATWOOT_INBOX_ID, "CHATWOOT_INBOX_ID"),
  };
}

export function dashboardDatabase() {
  dashboardPool ??= new Pool({
    connectionString: requiredConnectionString("DATABASE_URL"),
    ssl: ssl(process.env.DATABASE_SSL),
    max: 5,
    connectionTimeoutMillis: 5_000,
    query_timeout: 20_000,
    statement_timeout: 20_000,
    application_name: "fast-escova-dashboard",
  });
  return dashboardPool;
}

export function chatwootDatabase() {
  parseChatwootScope();
  chatwootPool ??= new Pool({
    connectionString: requiredConnectionString("CHATWOOT_DATABASE_URL"),
    ssl: ssl(process.env.CHATWOOT_DATABASE_SSL),
    max: 3,
    connectionTimeoutMillis: 5_000,
    query_timeout: 20_000,
    statement_timeout: 20_000,
    application_name: "fast-escova-dashboard-readonly",
    options: "-c default_transaction_read_only=on",
  });
  return chatwootPool;
}

export async function closeDatabasePools() {
  const pools = [dashboardPool, chatwootPool].filter((value): value is Pool => value != null);
  dashboardPool = undefined;
  chatwootPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}
