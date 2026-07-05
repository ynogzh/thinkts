import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadDslAppData, type DslAppData } from "./dsl-model/loader";

function loadClassFromFile(filePath: string): unknown {
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);
  return mod.default ?? mod;
}

function resolvePathWithExt(basePath: string): string | null {
  for (const ext of [".ts", ".js"]) {
    const p = basePath + ext;
    if (existsSync(p)) return p;
  }
  return null;
}

/* ── Single-pass feature loader ── */

/**
 * Walk srcPath once, collecting controller/service/model/logic files.
 * Replaces 4 separate loadFeatureBased() calls (one per file type).
 */
function loadAllFeatures(srcPath: string): {
  controllers: Record<string, unknown>;
  logics: Record<string, unknown>;
  services: Record<string, unknown>;
  models: Record<string, unknown>;
} {
  const result = {
    controllers: {} as Record<string, unknown>,
    logics: {} as Record<string, unknown>,
    services: {} as Record<string, unknown>,
    models: {} as Record<string, unknown>,
  };
  if (!existsSync(srcPath)) return result;

  function scan(dir: string, prefix: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const modulePath = prefix ? `${prefix}/${entry}` : entry;

      // Check all 4 file types in a single pass
      const controller = resolvePathWithExt(join(entryPath, "controller"));
      if (controller) {
        try { result.controllers[modulePath] = loadClassFromFile(controller); }
        catch (err) { console.warn(`Failed to load ${controller}:`, err); }
      }

      const service = resolvePathWithExt(join(entryPath, "service"));
      if (service) {
        try { result.services[modulePath] = loadClassFromFile(service); }
        catch (err) { console.warn(`Failed to load ${service}:`, err); }
      }

      const model = resolvePathWithExt(join(entryPath, "model"));
      if (model) {
        try { result.models[modulePath] = loadClassFromFile(model); }
        catch (err) { console.warn(`Failed to load ${model}:`, err); }
      }

      const logic = resolvePathWithExt(join(entryPath, "logic"));
      if (logic) {
        try { result.logics[modulePath] = loadClassFromFile(logic); }
        catch (err) { console.warn(`Failed to load ${logic}:`, err); }
      }

      scan(entryPath, modulePath);
    }
  }
  scan(srcPath, "");
  return result;
}

/* ── Manifest (path-only scan, no load) ── */

function scanFeaturePaths(srcPath: string, fileName: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(srcPath)) return result;

  function scan(dir: string, prefix: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const resolved = resolvePathWithExt(join(entryPath, fileName));
      const modulePath = prefix ? `${prefix}/${entry}` : entry;
      if (resolved) result[modulePath] = resolved;

      scan(entryPath, modulePath);
    }
  }
  scan(srcPath, "");
  return result;
}

/* ── Public API ── */

export interface LoadedData {
  controllers: Record<string, unknown>;
  logics: Record<string, unknown>;
  services: Record<string, unknown>;
  models: Record<string, unknown>;
  dsl?: DslAppData;
}

export interface Manifest {
  controllers: Record<string, string>;
  logics: Record<string, string>;
  services: Record<string, string>;
  models: Record<string, string>;
  dsl?: {
    models: Record<string, { path: string; source: "js" | "json" }>;
    services: Record<string, string>;
    apis: Record<string, string>;
    tables: Record<string, { path: string; source: "js" | "json" }>;
    acls: Record<string, { path: string; source: "js" | "json" }>;
  };
}

function detectDslSource(dir: string, baseName: string): "js" | "json" {
  if (existsSync(join(dir, `${baseName}.js`))) return "js";
  return "json";
}

export function generateManifest(srcPath: string, outPath?: string): Manifest {
  const dslData = loadDslAppData(srcPath);
  const dslManifest: NonNullable<Manifest["dsl"]> = {
    models: {},
    services: {},
    apis: {},
    tables: {},
    acls: {},
  };
  for (const [name, entry] of Object.entries(dslData.models)) {
    dslManifest.models[name] = { path: entry.path, source: detectDslSource(entry.path, "model") };
  }
  for (const [name, entry] of Object.entries(dslData.services)) {
    dslManifest.services[name] = entry.path;
  }
  for (const [name, entry] of Object.entries(dslData.apis)) {
    dslManifest.apis[name] = entry.path;
  }
  for (const [name, entry] of Object.entries(dslData.tables)) {
    dslManifest.tables[name] = { path: entry.path, source: detectDslSource(entry.path, "table") };
  }
  for (const [name, entry] of Object.entries(dslData.acls)) {
    dslManifest.acls[name] = { path: entry.path, source: detectDslSource(entry.path, "acl") };
  }
  const manifest: Manifest = {
    controllers: scanFeaturePaths(srcPath, "controller"),
    logics: scanFeaturePaths(srcPath, "logic"),
    services: scanFeaturePaths(srcPath, "service"),
    models: scanFeaturePaths(srcPath, "model"),
    dsl: Object.keys(dslManifest.models).length > 0 ? dslManifest : undefined,
  };
  const output = outPath ?? join(srcPath, "..", "manifest.json");
  writeFileSync(output, JSON.stringify(manifest, null, 2));
  return manifest;
}

function loadFromManifest(manifest: Manifest): LoadedData {
  const load = (map: Record<string, string>) => {
    const result: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(map)) {
      try {
        result[key] = loadClassFromFile(path);
      } catch (err) {
        console.warn(`Failed to load ${path}:`, err);
      }
    }
    return result;
  };
  return {
    controllers: load(manifest.controllers),
    logics: load(manifest.logics),
    services: load(manifest.services),
    models: load(manifest.models),
  };
}

function loadDslFromManifest(manifest: NonNullable<Manifest["dsl"]>): DslAppData {
  const result: DslAppData = {
    models: {},
    services: {},
    apis: {},
    tables: {},
    acls: {},
    dataResources: {},
  };
  const loadModel = (dir: string) => {
    const jsPath = join(dir, "model.js");
    const jsonPath = join(dir, "model.json");
    if (existsSync(jsPath)) {
      delete require.cache[require.resolve(jsPath)];
      const mod = require(jsPath);
      return mod.default ?? mod;
    }
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
  };
  for (const [name, meta] of Object.entries(manifest.models)) {
    const dsl = loadModel(meta.path);
    result.models[name] = { name, path: meta.path, dsl, modelConfig: dsl };
    if (dsl.dataResource) {
      const resourceCode = dsl.dataResource.resourceCode ?? name;
      result.dataResources[resourceCode] = {
        resourceCode,
        modelName: name,
        ...dsl.dataResource,
      };
    }
  }
  return result;
}

export function loadAppData(srcPath: string): LoadedData {
  const dslData = loadDslAppData(srcPath);
  const manifestPath = join(srcPath, "..", "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = require(manifestPath) as Manifest;
      const data = loadFromManifest(manifest);
      data.dsl = manifest.dsl ? loadDslFromManifest(manifest.dsl) : dslData;
      return data;
    } catch {
      // fallback to scanning
    }
  }
  // Single-pass feature scan: 4 file types in 1 walk
  return { ...loadAllFeatures(srcPath), dsl: dslData };
}

export function loadMiddlewareConfig(configPath: string): Record<string, unknown>[] {
  const resolved = resolvePathWithExt(join(configPath, "middleware"));
  if (!resolved) return [];
  try {
    const mod = require(resolved);
    const config = mod.default ?? mod;
    return Array.isArray(config) ? config : [];
  } catch {
    return [];
  }
}

export function loadRouterConfig(configPath: string): unknown[] {
  const resolved = resolvePathWithExt(join(configPath, "router"));
  if (!resolved) return [];
  try {
    const mod = require(resolved);
    const config = mod.default ?? mod;
    return Array.isArray(config) ? config : [];
  } catch {
    return [];
  }
}

export function loadCronConfig(configPath: string): Record<string, unknown>[] {
  const resolved = resolvePathWithExt(join(configPath, "crond"));
  if (!resolved) return [];
  try {
    const mod = require(resolved);
    const config = mod.default ?? mod;
    return Array.isArray(config) ? config : [];
  } catch {
    return [];
  }
}

export function loadBootstrap(appPath: string, type: string, think?: unknown): void {
  const bootstrapPath = resolvePathWithExt(join(appPath, "bootstrap", type));
  if (!bootstrapPath) return;
  try {
    const mod = require(bootstrapPath);
    const fn = mod?.default ?? mod;
    if (typeof fn === "function") fn(think);
  } catch {
    // ignore
  }
}
