import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";
export type {
  DslAppData,
  DslModelEntry,
  DslServiceEntry,
  DslTableEntry,
  DslAclEntry,
} from "./types";
import type {
  ModelDSL,
  ServiceHooks,
  TableDSL,
  AclDSL,
  DataResourceMeta,
  DslAppData,
  DslModelEntry,
} from "./types";
import { BaseModelDSL } from "./base";

const LIFECYCLE_HOOKS = new Set([
  "beforeCreate", "afterCreate", "beforeUpdate", "afterUpdate",
  "beforeDelete", "afterDelete", "beforeFind", "afterFind",
  "afterGet", "beforeList", "afterList",
]);

function tryImport<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    delete require.cache[require.resolve(path)];
    const mod = require(path);
    return (mod.default ?? mod) as T;
  } catch (err) {
    console.warn(`Failed to import ${path}:`, err);
    return undefined;
  }
}

function tryReadJSON<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err) {
    console.warn(`Failed to read JSON ${path}:`, err);
    return undefined;
  }
}

function loadModelDSL(dir: string): ModelDSL | undefined {
  // Prefer JS (can contain logic), fall back to JSON
  const jsValue = tryImport<BaseModelDSL | ModelDSL>(join(dir, "model.js"));
  if (jsValue) {
    if (jsValue instanceof BaseModelDSL) return jsValue.toModelConfig();
    return jsValue as ModelDSL;
  }
  return tryReadJSON<ModelDSL>(join(dir, "model.json"));
}

function loadServiceHooks(dir: string): ServiceHooks {
  const jsPath = join(dir, "service.js");
  return tryImport<ServiceHooks>(jsPath) ?? {};
}

/** Extract non-lifecycle exports from service.js as API route definitions. */
function loadApiRoutes(name: string, path: string, hooks: ServiceHooks): Array<{
  method: string; path: string; handler: string;
}> | undefined {
  const routes: Array<{ method: string; path: string; handler: string }> = [];
  for (const key of Object.keys(hooks)) {
    if (LIFECYCLE_HOOKS.has(key)) continue;
    if (typeof hooks[key] !== "function") continue;
    // Auto-register non-hook exports as POST routes
    routes.push({
      method: "POST",
      path: `/${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
      handler: `service.${key}`,
    });
  }
  return routes.length > 0 ? routes : undefined;
}

function loadTableDSL(dir: string): TableDSL | undefined {
  const jsPath = join(dir, "table.js");
  const jsonPath = join(dir, "table.json");
  return tryImport<TableDSL>(jsPath) ?? tryReadJSON<TableDSL>(jsonPath);
}

function loadAclDSL(dir: string): AclDSL | undefined {
  const jsValue = tryImport<AclDSL | ((ctx: unknown) => unknown)>(join(dir, "acl.js"));
  if (jsValue) {
    if (typeof jsValue === "function") return { rules: jsValue } as unknown as AclDSL;
    return jsValue;
  }
  return tryReadJSON<AclDSL>(join(dir, "acl.json"));
}

function modelNameFromDir(dir: string, srcPath: string): string {
  return dir.slice(srcPath.length).replace(/^\/+/, "").replace(/\/+/g, "_");
}

export function loadDslAppData(srcPath: string): DslAppData {
  const result: DslAppData = {
    models: {}, services: {}, tables: {}, acls: {}, apis: {}, dataResources: {},
  };
  if (!existsSync(srcPath)) return result;

  function scan(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (statSync(entryPath).isDirectory()) scan(entryPath);
    }

    const dsl = loadModelDSL(dir);
    if (!dsl) return;

    const name = dsl.table || modelNameFromDir(dir, srcPath);
    const tableName = dsl.table || basename(dir);

    result.models[name] = { name, path: dir, dsl, modelConfig: dsl as unknown as DslModelEntry["modelConfig"] };

    if (dsl.dataResource) {
      result.dataResources[dsl.dataResource.resourceCode ?? name] = {
        resourceCode: dsl.dataResource.resourceCode ?? name,
        modelName: name,
        ...dsl.dataResource,
      };
    }

    const hooks = loadServiceHooks(dir);
    if (Object.keys(hooks).length > 0) {
      result.services[name] = { name, path: dir, hooks };

      // Auto-register non-hook service exports as API routes
      const apiRoutes = loadApiRoutes(name, dir, hooks);
      if (apiRoutes) {
        result.apis[name] = { name, path: dir, routes: apiRoutes };
      }
    }

    const table = loadTableDSL(dir);
    result.tables[name] = table
      ? { name, path: dir, table }
      : { name, path: dir, table: { title: name, model: tableName } };

    const acl = loadAclDSL(dir);
    if (acl) result.acls[name] = { name, path: dir, acl };
  }

  scan(srcPath);
  return result;
}
