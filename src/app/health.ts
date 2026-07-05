import { Model } from "../model";
import { createRedisAdapter } from "../model/adapters/redis";
import type { ThinkGlobal } from "../think";
import type { BunRedisConfig } from "../model/adapters/redis";

export async function checkHealth(think: ThinkGlobal): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
  const checks: Record<string, { status: string; message?: string }> = {};

  try {
    const modelConfig = think?.config("model", {}) as Record<string, unknown>;
    if (modelConfig.adapter) {
      const testModel = new Model("_health_check", modelConfig);
      await testModel.db().query.execute("SELECT 1");
      checks.database = { status: "ok" };
    }
  } catch (err) {
    checks.database = { status: "error", message: err instanceof Error ? err.message : String(err) };
    result.status = "degraded";
  }

  try {
    const cacheConfig = think?.config("cache", {}) as Record<string, unknown>;
    if (cacheConfig.type === "redis") {
      const redis = createRedisAdapter(cacheConfig as BunRedisConfig);
      await redis.get("__health_check__");
      checks.cache = { status: "ok" };
    }
  } catch (err) {
    checks.cache = { status: "error", message: err instanceof Error ? err.message : String(err) };
    result.status = "degraded";
  }

  result.checks = checks;
  return result;
}
