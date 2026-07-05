import { RedisClient } from "bun";

export interface BunRedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  prefix?: string;
  enableAutoPipelining?: boolean;
}

export class BunRedisAdapter {
  private client: RedisClient;
  private prefix: string;

  constructor(config: BunRedisConfig = {}) {
    let url = config.url;
    if (!url && config.host) {
      const auth = config.password ? `:${encodeURIComponent(config.password)}@` : "";
      const db = config.db !== undefined ? `/${config.db}` : "";
      url = `redis://${auth}${config.host}:${config.port ?? 6379}${db}`;
    }
    this.client = new RedisClient(url, {
      enableAutoPipelining: config.enableAutoPipelining ?? true,
    });
    this.prefix = config.prefix ?? "";
  }

  private buildKey(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  async get(key: string): Promise<string | null> {
    const value = await this.client.get(this.buildKey(key));
    return value ?? null;
  }

  async set(key: string, value: string, timeout?: number): Promise<void> {
    const fullKey = this.buildKey(key);
    await this.client.set(fullKey, value);
    if (timeout !== undefined && timeout > 0) {
      await this.client.expire(fullKey, timeout);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.buildKey(key));
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(this.buildKey(key), seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(this.buildKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.client.exists(this.buildKey(key))
  }
  async incr(key: string): Promise<number> {
    return this.client.incr(this.buildKey(key))
  }
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(this.buildKey(pattern))
  }
  async close(): Promise<void> {
    this.client.close()
  }

}

export function createRedisAdapter(config: BunRedisConfig): BunRedisAdapter {
  return new BunRedisAdapter(config);
}
