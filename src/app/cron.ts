import { loadCronConfig } from "../loader";
import { thinkCache } from "../cache";
import { toError } from "./context";
import type { Logger } from "../logger";
import type { ThinkGlobal } from "../think";

interface CronEntry {
  pattern?: string;
  handle?: string | (() => void | Promise<void>);
  lock?: boolean;
  lockKey?: string;
}

export function setupCronJobs(think: ThinkGlobal, configPath: string, logger: Logger): void {
  const entries = loadCronConfig(configPath) as CronEntry[];
  let cacheAvailable = false;
  try {
    const cacheConfig = think.config("cache", {}) as Record<string, unknown>;
    cacheAvailable = Object.keys(cacheConfig).length > 0 && cacheConfig.type !== undefined;
  } catch {
    cacheAvailable = false;
  }

  for (const entry of entries) {
    const pattern = entry.pattern;
    const handle = entry.handle;
    let lock = entry.lock;
    const entryLockKey = entry.lockKey;

    if (!pattern) continue;

    if (lock === undefined) {
      lock = cacheAvailable;
    }

    const task = async () => {
      if (typeof handle === "function") {
        await handle();
      } else if (typeof handle === "string") {
        await think.service(handle);
      }
    };

    const wrappedTask = async () => {
      const handleStr = typeof handle === "string" ? handle : "anonymous";
      const lockKey = entryLockKey || `cron:lock:${handleStr}`;

      if (lock) {
        try {
          const timeout = estimateCronInterval(pattern);
          const existing = await thinkCache(lockKey);
          if (existing !== undefined && existing !== null) {
            return;
          }
          await thinkCache(lockKey, "1", { timeout });
        } catch (err) {
          logger.error(`Cron lock error for ${handleStr}: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }

      try {
        await task();
      } catch (err) {
        logger.error(err instanceof Error ? err : toError(err));
      } finally {
        if (lock) {
          try {
            await thinkCache(lockKey, null);
          } catch {
            // ignore cleanup errors
          }
        }
      }
    };

    Bun.cron(pattern, wrappedTask);
  }
}

export function estimateCronInterval(pattern: string): number {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length < 5) return 3600;

  const minuteMatch = parts[0].match(/^\*\/(\d+)$/);
  if (minuteMatch) {
    return parseInt(minuteMatch[1], 10) * 60;
  }

  const hourMatch = parts[1].match(/^\*\/(\d+)$/);
  if (hourMatch) {
    return parseInt(hourMatch[1], 10) * 3600;
  }

  if (parts[0] === "0" && parts[1] === "0") {
    return 86400;
  }
  if (parts[0] === "0") {
    return 3600;
  }

  return 3600;
}
