import { SQL } from "bun";
import type { SocketInterface } from "../../query";
import type { BunSQLAdapterConfig } from "../sql";

const socketInstances = new Map<string, BunSQLSocket>();

/** Execute raw SQL via tagged template literal.
 *  Uses the standard `sql(strings)` call form so Bun.SQL treats it as a
 *  template literal — avoiding unsafe() which serialises large JSON poorly. */
export function sqlRaw(sqlInstance: SQL, raw: string): Promise<unknown> {
  const strings: string[] & { raw: string[] } = [raw] as string[] & { raw: string[] };
  strings.raw = strings;
  return (sqlInstance as unknown as (strings: { raw: string[] }) => Promise<unknown>)(strings);
}

export class BunSQLSocket implements SocketInterface {
  private sql: SQL;
  private config: BunSQLAdapterConfig;

  // Transaction state — corrects the broken startTrans/commit/rollback
  private _txConnection?: SQL;
  private _txReady?: Promise<SQL>;
  private _txEndResolve?: () => void;
  private _txBeginPromise?: Promise<unknown>;
  private _txActive = false;

  constructor(config: BunSQLAdapterConfig) {
    this.config = config;
    const poolOptions: Record<string, unknown> = {};
    if (config.max !== undefined) poolOptions.max = config.max;
    if (config.idleTimeout !== undefined) poolOptions.idleTimeout = config.idleTimeout;
    if (config.maxLifetime !== undefined) poolOptions.maxLifetime = config.maxLifetime;
    if (config.connectionTimeout !== undefined) poolOptions.connectionTimeout = config.connectionTimeout;
    if (typeof config.connection === "string") {
      this.sql = new SQL({ url: config.connection, ...poolOptions } as unknown as ConstructorParameters<typeof SQL>[0]);
    } else if (typeof config.connection === "object" && config.connection !== null) {
      this.sql = new SQL({ adapter: config.adapter, ...config.connection, ...poolOptions } as unknown as ConstructorParameters<typeof SQL>[0]);
    } else {
      const connParams: Record<string, unknown> = {};
      if (config.host !== undefined) connParams.host = config.host;
      if (config.port !== undefined) connParams.port = config.port;
      if (config.username !== undefined) connParams.username = config.username;
      if (config.user !== undefined) connParams.username = config.user;
      if (config.password !== undefined) connParams.password = config.password;
      if (config.database !== undefined) connParams.database = config.database;
      this.sql = new SQL({ adapter: config.adapter, ...connParams, ...poolOptions } as unknown as ConstructorParameters<typeof SQL>[0]);
    }
  }

  static getInstance(config: BunSQLAdapterConfig): BunSQLSocket {
    const key = JSON.stringify(config);
    if (!socketInstances.has(key)) {
      socketInstances.set(key, new BunSQLSocket(config));
    }
    return socketInstances.get(key)!;
  }

  /** Return the active SQL instance: tx connection when in a transaction, else pool. */
  private _activeSql(): SQL {
    return this._txActive && this._txConnection ? this._txConnection : this.sql;
  }

  async query(sql: string | { sql: string; params?: unknown[] }, _connection?: unknown): Promise<unknown[]> {
    const raw = typeof sql === "string" ? sql : sql.sql;
    const params = typeof sql === "string" ? undefined : sql.params;
    if (raw.includes("mall_order_item") || raw.includes("order_id")) console.error("[SQL]", raw, "| params:", params);
    const result = params
      ? await this._activeSql().unsafe(raw, params)
      : await sqlRaw(this._activeSql(), raw);
    return Array.from(result as Iterable<unknown>);
  }

  async execute(sql: string | { sql: string; params?: unknown[] }, _connection?: unknown): Promise<{ affectedRows: number; insertId?: number }> {
    const raw = typeof sql === "string" ? sql : sql.sql;
    const params = typeof sql === "string" ? undefined : sql.params;
    const result = params
      ? await this._activeSql().unsafe(raw, params)
      : await sqlRaw(this._activeSql(), raw);
    const r = result as { count?: number; affectedRows?: number; lastInsertRowid?: number | null };
    return {
      affectedRows: r.affectedRows ?? r.count ?? 0,
      insertId: r.lastInsertRowid ?? undefined,
    };
  }

  async startTrans(_connection?: unknown): Promise<SQL> {
    if (this._txActive) {
      throw new Error("Nested transactions are not supported");
    }

    if (this.config.adapter === "sqlite") {
      // SQLite is single-connection; raw SQL BEGIN/COMMIT/ROLLBACK is safe.
      await sqlRaw(this.sql, "BEGIN");
      this._txActive = true;
      return this.sql;
    }

    // MySQL / PostgreSQL: use begin() callback with a deferred-end promise
    // so the callback stays alive until commit() or rollback() is called.
    let resolveReady!: (sql: SQL) => void;
    this._txReady = new Promise<SQL>((r) => { resolveReady = r; });

    const endPromise = new Promise<void>((resolve) => {
      this._txEndResolve = resolve;
    });

    this._txBeginPromise = this.sql.begin(async (tx) => {
      const txSQL = tx as unknown as SQL;
      this._txConnection = txSQL;
      this._txActive = true;
      resolveReady(txSQL);
      await endPromise;
    }).catch(() => {
      // Swallow expected rejection from rollback()
    });

    return this._txReady;
  }

  async commit(_connection?: unknown): Promise<void> {
    if (!this._txActive) return;

    if (this.config.adapter === "sqlite") {
      await sqlRaw(this.sql, "COMMIT");
      this._txActive = false;
      return;
    }

    // For begin() callback mode: let the callback return normally.
    // Bun auto-commits on successful callback exit.
    this._txConnection = undefined;
    this._txActive = false;
    this._txEndResolve?.();
    this._txEndResolve = undefined;
    if (this._txBeginPromise) {
      await this._txBeginPromise.catch(() => {});
      this._txBeginPromise = undefined;
    }
  }

  async rollback(_connection?: unknown): Promise<void> {
    if (!this._txActive) return;

    if (this.config.adapter === "sqlite") {
      await sqlRaw(this.sql, "ROLLBACK");
      this._txActive = false;
      return;
    }

    // Execute ROLLBACK on the tx connection, then let callback return.
    // Bun will try to auto-commit a closed tx — this is a no-op on most drivers.
    if (this._txConnection) {
      try { await sqlRaw(this._txConnection, "ROLLBACK"); } catch { /* ignore */ }
    }
    this._txConnection = undefined;
    this._txActive = false;
    this._txEndResolve?.();
    this._txEndResolve = undefined;
    if (this._txBeginPromise) {
      await this._txBeginPromise.catch(() => {});
      this._txBeginPromise = undefined;
    }
  }

  async transaction(fn: (connection: unknown) => Promise<unknown>, _connection?: unknown): Promise<unknown> {
    return this.sql.begin(async (tx) => {
      return fn(tx);
    });
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  get instance(): SQL {
    return this.sql;
  }
}
