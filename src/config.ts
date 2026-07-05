import type { AppConfig } from "./types";
import { validateAppConfig } from "./config-validator";

const configCache = new Map<string, Record<string, unknown>>();

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

export function loadConfig(rootPath: string, env: string): AppConfig {
  const cacheKey = `${rootPath}::${env}`;
  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey) as AppConfig;
  }

  let config: AppConfig = {
    port: 8360,
    defaultModule: "home",
    defaultController: "index",
    defaultAction: "index",
    prefix: [],
    suffix: [".html"],
    jsonpCallbackField: "callback",
    jsonContentType: "application/json",
    jsonpContentType: "application/javascript",
    errnoField: "errno",
    errmsgField: "errmsg",
    defaultErrno: 1000,
    staticDir: `${rootPath}/www`,
    staticPrefix: /\/(static|favicon\.ico)/,
  };

  function tryRequire(path: string): unknown {
    for (const ext of [".ts", ".js"]) {
      try {
        const mod = require(path + ext);
        return mod.default ?? mod;
      } catch {
        // try next extension
      }
    }
    return undefined;
  }
  const defaultConfig = tryRequire(`${rootPath}/config/config`);
  if (defaultConfig && typeof defaultConfig === "object") {
    config = deepMerge(config as Record<string, unknown>, defaultConfig as Record<string, unknown>) as AppConfig;
  }
  const envConfig = tryRequire(`${rootPath}/config/config.${env}`);
  if (envConfig && typeof envConfig === "object") {
    config = deepMerge(config as Record<string, unknown>, envConfig as Record<string, unknown>) as AppConfig;
  }
  const adapterConfig = tryRequire(`${rootPath}/config/adapter`);
  if (adapterConfig && typeof adapterConfig === "object") {
    config = deepMerge(config as Record<string, unknown>, adapterConfig as Record<string, unknown>) as AppConfig;
  }
  validateAppConfig(config);
  configCache.set(cacheKey, config as Record<string, unknown>);
  return config;
}

export function getConfig<T = unknown>(name: string, defaultValue?: T, config?: AppConfig): T {
  if (!config) return defaultValue as T;
  const parts = name.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return defaultValue as T;
    }
  }
  return current as T;
}
/** Watch config files for changes and invoke callback on reload. */
export function watchConfig(rootPath: string, env: string, onReload: (config: AppConfig) => void): () => void {
  const configDir = `${rootPath}/config`;
  const files = [
    `${configDir}/config.ts`,
    `${configDir}/config.js`,
    `${configDir}/config.${env}.ts`,
    `${configDir}/config.${env}.js`,
    `${configDir}/adapter.ts`,
    `${configDir}/adapter.js`,
  ];
  let watcher: ReturnType<typeof import("fs/promises").watch> | undefined;
  const abortController = new AbortController();

  const reload = () => {
    const cacheKey = `${rootPath}::${env}`;
    configCache.delete(cacheKey);
    try {
      const newConfig = loadConfig(rootPath, env);
      onReload(newConfig);
    } catch (err) {
      console.error("[config] hot reload failed:", err instanceof Error ? err.message : String(err));
    }
  };

  (async () => {
    try {
      const { watch } = await import("node:fs/promises");
      watcher = watch(configDir, { recursive: true, signal: abortController.signal });
      for await (const event of watcher) {
        const filename = typeof event.filename === "string" ? event.filename : event.filename?.toString();
        if (event.eventType === "change" && filename && files.some((f) => f.endsWith(filename))) {
          reload();
        }
      }
    } catch {
      // watcher closed
    }
  })();

  return () => {
    abortController.abort();
  };
}
