/**
 * Generic connection pool for ThinkTS.
 * Aligned with thinkjs pool architecture, usable for any resource type.
 * When using bun:sql, its built-in pool is preferred; this is for other drivers.
 */

export interface PoolFactory<T> {
  create(): Promise<T>;
  destroy(connection: T): Promise<void>;
  validate?(connection: T): Promise<boolean>;
}

export interface PoolOptions {
  min?: number;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  acquireTimeout?: number;
  acquireWaitMillis?: number;
}

interface PooledConnection<T> {
  connection: T;
  createdAt: number;
  lastUsedAt: number;
  idleTimer?: Timer;
}

export class Pool<T> {
  private factory: PoolFactory<T>;
  private min: number;
  private max: number;
  private idleTimeout: number;
  private maxLifetime: number;
  private acquireTimeout: number;
  private acquireWaitMillis: number;

  private available: PooledConnection<T>[] = [];
  private inUse = new Set<PooledConnection<T>>();
  private waiters: Array<{ resolve: (conn: T) => void; reject: (err: Error) => void; timer: Timer }> = [];
  private closed = false;
  private initializing = false;

  constructor(factory: PoolFactory<T>, options: PoolOptions = {}) {
    this.factory = factory;
    this.min = Math.max(0, options.min ?? 0);
    this.max = Math.max(this.min, options.max ?? 10);
    this.idleTimeout = Math.max(0, options.idleTimeout ?? 30000);
    this.maxLifetime = Math.max(0, options.maxLifetime ?? 0);
    this.acquireTimeout = Math.max(0, options.acquireTimeout ?? 60000);
    this.acquireWaitMillis = Math.max(0, options.acquireWaitMillis ?? 200);
  }

  async init(): Promise<void> {
    if (this.initializing || this.closed) return;
    this.initializing = true;
    const targets: Promise<void>[] = [];
    for (let i = this.available.length + this.inUse.size; i < this.min; i++) {
      targets.push(this.createConnection());
    }
    await Promise.all(targets);
    this.initializing = false;
  }

  private async createConnection(): Promise<void> {
    const connection = await this.factory.create();
    const pooled: PooledConnection<T> = {
      connection,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.available.push(pooled);
    this.scheduleIdleCheck(pooled);
  }

  private scheduleIdleCheck(pooled: PooledConnection<T>): void {
    if (this.idleTimeout <= 0) return;
    clearTimeout(pooled.idleTimer as unknown as number);
    pooled.idleTimer = setTimeout(() => {
      if (this.inUse.has(pooled)) return;
      const idx = this.available.indexOf(pooled);
      if (idx >= 0 && this.available.length > this.min) {
        this.available.splice(idx, 1);
        this.factory.destroy(pooled.connection).catch(() => {});
      }
    }, this.idleTimeout);
  }

  private isExpired(pooled: PooledConnection<T>): boolean {
    if (this.maxLifetime <= 0) return false;
    return Date.now() - pooled.createdAt >= this.maxLifetime;
  }

  async acquire(): Promise<T> {
    if (this.closed) throw new Error("Pool is closed");

    // Try to get an available connection
    while (this.available.length > 0) {
      const pooled = this.available.shift()!;
      clearTimeout(pooled.idleTimer as unknown as number);

      if (this.isExpired(pooled)) {
        this.factory.destroy(pooled.connection).catch(() => {});
        continue;
      }

      if (this.factory.validate) {
        const valid = await this.factory.validate(pooled.connection);
        if (!valid) {
          this.factory.destroy(pooled.connection).catch(() => {});
          continue;
        }
      }

      pooled.lastUsedAt = Date.now();
      this.inUse.add(pooled);
      return pooled.connection;
    }

    // Create new if under max
    const currentSize = this.available.length + this.inUse.size;
    if (currentSize < this.max) {
      const connection = await this.factory.create();
      const pooled: PooledConnection<T> = {
        connection,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      this.inUse.add(pooled);
      return pooled.connection;
    }

    // Wait for a connection to be released
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error("Pool acquire timeout"));
      }, this.acquireTimeout);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  release(connection: T): void {
    if (this.closed) {
      this.factory.destroy(connection).catch(() => {});
      return;
    }

    let pooled: PooledConnection<T> | undefined;
    for (const item of this.inUse) {
      if (item.connection === connection) {
        pooled = item;
        break;
      }
    }
    if (!pooled) return;

    this.inUse.delete(pooled);

    if (this.isExpired(pooled)) {
      this.factory.destroy(pooled.connection).catch(() => {});
    } else {
      pooled.lastUsedAt = Date.now();
      this.available.push(pooled);
      this.scheduleIdleCheck(pooled);

      // Wake up a waiter
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        clearTimeout(waiter.timer as unknown as number);
        // Defer to avoid stack overflow in tight loops
        setTimeout(() => {
          this.acquire().then(waiter.resolve).catch(waiter.reject);
        }, this.acquireWaitMillis);
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Reject all waiters
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer as unknown as number);
      waiter.reject(new Error("Pool is closed"));
    }
    this.waiters = [];

    // Destroy available connections
    const destroyTasks = this.available.map((pooled) =>
      this.factory.destroy(pooled.connection).catch(() => {})
    );
    this.available = [];

    // Destroy in-use connections (best effort)
    for (const pooled of this.inUse) {
      destroyTasks.push(this.factory.destroy(pooled.connection).catch(() => {}));
    }
    this.inUse.clear();

    await Promise.all(destroyTasks);
  }

  get size(): number {
    return this.available.length + this.inUse.size;
  }

  get availableCount(): number {
    return this.available.length;
  }

  get inUseCount(): number {
    return this.inUse.size;
  }
}

const poolRegistry = new Map<string, Pool<unknown>>();

export function createPool<T>(
  name: string,
  factory: PoolFactory<T>,
  options?: PoolOptions
): Pool<T> {
  if (poolRegistry.has(name)) {
    return poolRegistry.get(name) as Pool<T>;
  }
  const pool = new Pool(factory, options);
  poolRegistry.set(name, pool as Pool<unknown>);
  return pool;
}

export function getPool<T>(name: string): Pool<T> | undefined {
  return poolRegistry.get(name) as Pool<T> | undefined;
}

export function removePool(name: string): void {
  poolRegistry.delete(name);
}
