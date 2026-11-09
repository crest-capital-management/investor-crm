import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

/**
 * Direct PostgreSQL access (Azure Database for PostgreSQL). Replaces the
 * supabase-js table queries.
 *
 * Results keep the shapes the app got from Supabase's REST layer, so the rest
 * of the code doesn't change: dates and timestamps come back as strings, and
 * bigint / numeric come back as numbers. jsonb and text[] are parsed by pg.
 */

// date -> "YYYY-MM-DD" (pg would otherwise build a Date at local midnight and shift the day).
types.setTypeParser(types.builtins.DATE, (value) => value);
// timestamptz / timestamp -> ISO string.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString());
types.setTypeParser(types.builtins.TIMESTAMP, (value) => new Date(`${value}Z`).toISOString());
// bigint (count(*), size_bytes, unread_count) and numeric -> number.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

function createPool(): Pool {
  const raw = process.env.AZURE_CONNECTION_STRING ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("AZURE_CONNECTION_STRING is not configured.");

  // Accept driver-style schemes such as "postgresql+asyncpg://" (pg only needs "postgresql://").
  const normalised = raw.trim().replace(/^postgres(?:ql)?(?:\+\w+)?:\/\//i, "postgresql://");

  // The ssl setting below decides the encryption, so drop sslmode from the URL to avoid two sources of truth.
  const url = new URL(normalised);
  const sslMode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const useSsl = sslMode ? sslMode !== "disable" : !isLocal;

  const pool = new Pool({
    connectionString: url.toString(),
    // Azure requires TLS. DATABASE_SSL_NO_VERIFY=1 skips certificate checks (only for a self-signed test server).
    ssl: useSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
  });
  // An idle client dropping (e.g. a database restart) must not crash the server.
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  return pool;
}

// One pool per server process, kept across hot reloads in development.
const globalForDb = globalThis as unknown as { __crmPool?: Pool };

function getPool(): Pool {
  globalForDb.__crmPool ??= createPool();
  return globalForDb.__crmPool;
}

type Params = readonly unknown[];

/** The query helpers, shared by the pool and by a transaction. */
export interface Queryable {
  /** All rows. */
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: Params): Promise<T[]>;
  /** The only row; throws if there isn't exactly one. */
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: Params): Promise<T>;
  /** The first row, or null when there is none. */
  maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: Params): Promise<T | null>;
  /** Runs a statement and returns how many rows it changed. */
  execute(text: string, params?: Params): Promise<number>;
}

function queryable(run: (text: string, params?: Params) => Promise<{ rows: QueryResultRow[]; rowCount: number | null }>): Queryable {
  return {
    async query<T extends QueryResultRow>(text: string, params?: Params) {
      return (await run(text, params)).rows as T[];
    },
    async one<T extends QueryResultRow>(text: string, params?: Params) {
      const { rows } = await run(text, params);
      if (rows.length !== 1) throw new Error(`Expected one row but got ${rows.length}.`);
      return rows[0] as T;
    },
    async maybeOne<T extends QueryResultRow>(text: string, params?: Params) {
      const { rows } = await run(text, params);
      return (rows[0] as T | undefined) ?? null;
    },
    async execute(text: string, params?: Params) {
      return (await run(text, params)).rowCount ?? 0;
    },
  };
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: all of its statements are saved together, or none are. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export const db: Db = {
  ...queryable((text, params) => getPool().query(text, params as unknown[])),
  async tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await getPool().connect();
    try {
      await client.query("begin");
      const result = await fn(queryable((text, params) => client.query(text, params as unknown[])));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

/** True for a unique-constraint violation (for example a duplicate phone or wamid). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
